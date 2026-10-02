import { Worker } from 'bullmq';
import { createBullConnection, logRedisError } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/encryption.js';
import { sendWhatsAppMessage } from '../lib/meta.js';
import { buildTemplateSendPayload } from '../services/templatePayload.service.js';
import { contactVariableResolver } from '../lib/templateParams.js';
import { campaignCtaComponent, buildCampaignContext } from '../services/campaignAi.service.js';
import { env } from '../config/env.js';
import { queueCampaignCompletedEmail, queueCampaignFailedEmail } from '../services/email.service.js';
import { consumeMessageCredit, releaseMessageCredit } from '../services/subscription.service.js';
import { runFallbackForRecipient } from '../services/fallback.service.js';
import { handleRecipientFailure, checkAndCompleteCampaign, notifyRetrySucceeded } from '../services/retry.service.js';
import { settleCampaignRefund } from '../services/campaigns.service.js';
import { claimRecipientCharge, markRecipientNotCharged, recordAttempt } from '../services/campaignBilling.service.js';
import { isOptedOut } from '../services/optout.service.js';
import { notifyWorkspace } from '../services/notification.service.js';
import { sendAuthenticationOtp } from '../authentication/authentication.service.js';
// Meta Cloud API Tier-1 numbers are limited to ~250 msgs/min. The old 60ms
// delay (~1000/min) triggered rate-limit errors (code 131042). 250ms ≈ 240/min.
const RATE_DELAY_MS = Math.max(env.CAMPAIGN_RATE_DELAY_MS, 250);

const normalizePhone = (raw) => String(raw || '').replace(/[^\d]/g, '');
const isAuthenticationCampaign = (campaign) =>
  String(campaign?.template?.category || '').toUpperCase() ===
  'AUTHENTICATION';

// A campaign launched with chargedAt set reserved its plan quota and paid the
// wallet for the rest up front (campaigns.service.js#launchCampaign), so a
// send must not meter either a second time — that double-counted every
// campaign message against the plan's allowance. The subscription still has
// to be live for anything to go out. Campaigns without a launch charge (none
// are created any more) keep the per-send path.
const SENDABLE_SUBSCRIPTION = ['ACTIVE', 'PAST_DUE'];
async function takeSendCredit(campaign, reason) {
  if (campaign.chargedAt) {
    const sub = await prisma.subscription.findUnique({
      where: { workspaceId: campaign.workspaceId }, select: { status: true },
    });
    return sub && SENDABLE_SUBSCRIPTION.includes(sub.status)
      ? { ok: true, source: null }
      : { ok: false, code: 'SUBSCRIPTION_INACTIVE' };
  }
  return consumeMessageCredit(campaign.workspaceId, {
    reason,
    messageCategory: campaign.template?.category ?? null,
  });
}

const creditFailureReason = (code) => (code === 'SUBSCRIPTION_INACTIVE'
  ? 'Subscription is not active'
  : 'Quota and wallet balance exhausted');

// Marks a recipient as skipped because the number is opted out. Skips are
// tracked separately from failures: they cost nothing, are never retried, and
// must never abort the rest of the campaign.
async function skipOptedOutRecipient(campaignId, recipient) {
  await prisma.campaignRecipient.update({
    where: { id: recipient.id },
    data: {
      status: 'SKIPPED',
      failReason: 'Recipient opted out',
      lastFailureReason: 'Recipient opted out',
      retryStatus: 'SKIPPED',
      nextRetryAt: null,
    },
  });
  await prisma.campaign.update({ where: { id: campaignId }, data: { skipped: { increment: 1 } } });
  console.log(`[CampaignWorker] Skipped ${recipient.contact?.phoneNumber} — opted out`);
}

// Meta's raw errors are unreadable to a workspace admin ("Unsupported post
// request. Object with ID '1027…' does not exist … (code 100/33)"). Translate
// the ones that have an actual fix into that fix; pass everything else
// through unchanged so nothing is hidden.
const describeMetaError = (metaErr, fallback) => {
  if (!metaErr) return fallback;
  // error_data.details is the only part of a Meta error that names the actual
  // offender ("buttons: Button at index 0 of type Url requires a parameter");
  // the top-level message is generic to the point of being unactionable.
  const details = metaErr.error_data?.details;
  const raw = `${metaErr.message}${details ? ` — ${details}` : ''} (code ${metaErr.code}${metaErr.error_subcode ? `/${metaErr.error_subcode}` : ''})`;
  const code = Number(metaErr.code);
  const sub = Number(metaErr.error_subcode);

  if (code === 100 && (sub === 33 || /does not exist|cannot be loaded/i.test(metaErr.message || ''))) {
    return 'This WhatsApp number is no longer reachable on Meta (its phone number ID is missing, was moved to another WABA, or the access token lost permission). Reconnect the number in Number Setup, then relaunch. — ' + raw;
  }
  if (code === 190) return 'The WhatsApp access token has expired — reconnect the number in Number Setup. — ' + raw;
  if (code === 131047) return 'Outside the 24-hour customer service window — this recipient can only be reached with an approved template. — ' + raw;
  if (code === 131026) return 'The recipient number is not a valid WhatsApp account. — ' + raw;
  if (code === 132000 || code === 132001) return 'The template is not usable as sent (wrong variable count, or not approved for this number). — ' + raw;
  if (code === 131042) return 'Meta rejected the send for a billing/rate reason on the business account. — ' + raw;
  // The two formats whose payloads are assembled differently from a standard
  // template. Naming the component keeps the root cause visible instead of it
  // reading as a generic "invalid parameter".
  if (code === 100 && /button/i.test(details || '') && /text/i.test(details || '')) {
    return 'Meta Error 100: a carousel button parameter was empty. The template card buttons are missing a label or a URL example — re-save it in the template editor. — ' + raw;
  }
  // Reached only once the payload itself is right: the catalog button is being
  // sent correctly, but the business account has no catalog behind it. That is
  // a Commerce Manager setting, not something a send can fix.
  if (code === 131009 && /catalog/i.test(`${metaErr.message} ${details || ''}`)) {
    return 'Meta Error 131009: no product catalog is connected to this WhatsApp Business Account. Connect one in Commerce Manager and enable it under WhatsApp Manager → Commerce Settings, then relaunch. — ' + raw;
  }
  if (code === 131008 && /components/i.test(`${metaErr.message} ${details || ''}`)) {
    return 'Meta Error 131008: the template was sent with no components. A catalog or carousel template needs its button/card components — re-save it in the template editor. — ' + raw;
  }
  return raw;
};

// The full `template` object for one recipient's send.
//
// The assembly itself lives in services/templatePayload.service.js, which is
// also what the API Playground sends through — a template that works in one
// and not the other is a class of bug that used to be possible.
//
// `campaign` is passed so a campaign with an AI agent can stamp its CTA
// quick-reply with the recipient's id: that payload comes straight back on the
// tap, which is what lets the agent open on the right campaign.
const buildTemplatePayload = async (template, contact, { phoneNumberId, accessToken, campaign = null, recipientId = null }) => {
  const ctaComponent = campaign?.aiAgentEnabled
    ? campaignCtaComponent(template.components, { ctaLabel: campaign.aiAgentCtaLabel, recipientId })
    : null;

  return buildTemplateSendPayload(template, {
    phoneNumberId,
    accessToken,
    resolve: contactVariableResolver(contact),
    extraComponents: ctaComponent ? [ctaComponent] : [],
    campaignId: campaign?.id ?? null,
  });
};

// Records what this contact was actually sent, so the campaign AI agent can
// answer from the message in front of the customer rather than from whatever
// the template says by the time they ask. Best-effort: a failure here must
// never turn a delivered message into a failed one.
const snapshotRecipientContext = async (campaign, recipient) => {
  if (!campaign?.aiAgentEnabled) return;
  try {
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        aiContext: buildCampaignContext({
          campaign,
          template: campaign.template,
          contact: recipient.contact,
          ctaLabel: campaign.aiAgentCtaLabel,
        }),
      },
    });
  } catch (err) {
    console.error(`[CampaignWorker] Could not snapshot AI context for ${recipient.id}:`, err.message);
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Hands one recipient's message to Meta and returns the message id. This is
// the only step whose failure means "not sent".
async function sendToRecipient(campaign, recipient, { phoneNumberId, accessToken }) {
  if (isAuthenticationCampaign(campaign)) {
    // Each recipient gets a freshly generated OTP and its own
    // AuthenticationTransaction, sent from the campaign's template and number.
    const authenticationResult = await sendAuthenticationOtp(campaign.workspaceId, {
      templateId: campaign.template.id,
      to: recipient.contact.phoneNumber,
      waNumberId: campaign.waNumber.id,
      campaignId: campaign.id,
    });
    return authenticationResult?.metaMessageId ?? null;
  }

  const templatePayload = await buildTemplatePayload(
    campaign.template,
    recipient.contact,
    { phoneNumberId, accessToken, campaign, recipientId: recipient.id },
  );
  const result = await sendWhatsAppMessage(
    phoneNumberId,
    accessToken,
    normalizePhone(recipient.contact.phoneNumber),
    templatePayload,
  );
  return result?.messages?.[0]?.id ?? null;
}

// Once Meta has accepted a message everything else is bookkeeping, and none of
// it may route the recipient back into failure handling: that scheduled a retry
// (a duplicate paid send) for a message the customer already had, and released
// the credit for a message that was delivered. Each step runs on its own and a
// failure is logged, not thrown.
async function bookkeep(label, recipientId, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[CampaignWorker] ${label} failed for recipient ${recipientId} after Meta accepted the message:`, err.message);
    return null;
  }
}

// The write that records a send. It is what keeps the message from being sent
// again (recovery re-sends a SENDING/IN_PROGRESS row that never got it), so a
// transient database error gets a couple of short retries before giving up.
async function markRecipientSent(recipientId, data) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await prisma.campaignRecipient.update({ where: { id: recipientId }, data });
      return true;
    } catch (err) {
      if (attempt === 3) {
        console.error(`[CampaignWorker] Could not record the send for recipient ${recipientId} — Meta accepted it:`, err.message);
        return false;
      }
      await sleep(500 * attempt);
    }
  }
  return false;
}

// Files the outbound message on the contact's conversation so delivery/read
// webhooks (matched by metaMessageId) can update the right recipient.
async function persistOutboundMessage(campaign, recipient, metaMessageId, body) {
  if (!metaMessageId) return;
  const where = { contactId: recipient.contactId, waNumberId: campaign.waNumberId };
  let convo = await prisma.conversation.findFirst({ where });
  if (!convo) {
    convo = await prisma.conversation.create({
      data: { workspaceId: campaign.workspaceId, ...where, status: 'OPEN' },
    }).catch(() => prisma.conversation.findFirst({ where }));
  }
  if (!convo) return;
  await prisma.message.create({
    data: {
      conversationId: convo.id,
      body,
      direction: 'OUTBOUND',
      metaMessageId,
      campaignRecipientId: recipient.id,
      sentAt: new Date(),
    },
  });
}

async function processRetryJob(job) {
  const { campaignId, workspaceId, recipientId, attempt = 1 } = job.data;
  console.log(`[CampaignRetry] Retry started for recipient ${recipientId} (attempt #${attempt})`);

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: { template: true, waNumber: true },
  });

  if (!campaign) {
    console.log(`[CampaignRetry] Campaign ${campaignId} not found — skipping retry`);
    return;
  }
  if (isAuthenticationCampaign(campaign) ? campaign.status !== 'RUNNING' : campaign.status === 'CANCELLED') {
    console.log(`[CampaignRetry] Campaign ${campaignId} was cancelled — skipping retry for ${recipientId}`);
    return;
  }
  if (!campaign.waNumber) {
    await handleRecipientFailure(campaign, { id: recipientId, retryCount: attempt }, 'No WhatsApp number configured on campaign');
    return;
  }

  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    include: { contact: true },
  });

  if (!recipient || !recipient.contact) return;
  if (recipient.status === 'DELIVERED' || recipient.status === 'READ') {
    console.log(`[CampaignRetry] Recipient ${recipientId} is already ${recipient.status} — skipping retry`);
    return;
  }
  // The customer may have opted out between the original send and this retry.
  if (await isOptedOut(workspaceId, recipient.contact.phoneNumber)) {
    await skipOptedOutRecipient(campaignId, recipient);
    await checkAndCompleteCampaign(campaignId);
    return;
  }

  // Claim the attempt atomically. BullMQ can redeliver a job whose worker
  // stalled, and the DELIVERED/READ check above cannot catch a duplicate that
  // is still mid-flight — both copies would pass it and both would send. Only
  // the writer that flips RETRYING to IN_PROGRESS proceeds; the loser returns
  // without sending. The status guard also rejects a stale job for a recipient
  // that has since been failed off or skipped.
  const claimed = await prisma.campaignRecipient.updateMany({
    where: { id: recipientId, status: 'RETRYING', retryStatus: { not: 'IN_PROGRESS' } },
    data: { retryStatus: 'IN_PROGRESS', lastRetryAt: new Date(), retryCount: attempt },
  });
  if (claimed.count === 0) {
    console.log('[CampaignRetry] Attempt #' + attempt + ' for ' + recipientId + ' is already claimed elsewhere - skipping duplicate');
    return;
  }

  // From here on every path must leave the claim: the send succeeds (SENT),
  // or failure handling reschedules / fails the recipient. A throw that escaped
  // (a decrypt failure, a database error) used to leave IN_PROGRESS behind,
  // which every later job refused and which kept the campaign from completing.
  let creditSource = null;
  let creditAmount = null;
  let metaMessageId = null;
  try {
    const accessToken = decrypt(campaign.waNumber.encryptedAccessToken);
    const phoneNumberId = campaign.waNumber.metaPhoneNumberId;

    const credit = await takeSendCredit(campaign, 'Campaign retry attempt');
    creditSource = credit.ok ? credit.source : null;
    creditAmount = credit.ok ? (credit.amount ?? null) : null;
    if (!credit.ok) {
      console.warn(`[CampaignRetry] cannot send to ${recipient.contact.phoneNumber}: ${credit.code}`);
      await handleRecipientFailure(campaign, recipient, creditFailureReason(credit.code), null);
      return;
    }

    metaMessageId = await sendToRecipient(campaign, recipient, { phoneNumberId, accessToken });
  } catch (err) {
    const metaErr = err.response?.data?.error;
    const reason = describeMetaError(metaErr, err.message);
    console.error(`[CampaignRetry] Retry failed for ${recipient.contact.phoneNumber}:`, reason);

    try {
      // Nothing went out, so the retry's credit goes back — otherwise every
      // retry attempt would burn quota for a message that never arrived.
      await releaseMessageCredit(workspaceId, { source: creditSource, amount: creditAmount }).catch(() => {});
      await recordAttempt(recipient.id, { attempt, ok: false, reason, metaCode: metaErr?.code ?? null });
      await handleRecipientFailure(campaign, { ...recipient, retryCount: attempt }, reason, metaErr?.code);
    } catch (handlingErr) {
      // Hand the claim back so the recovery sweep re-queues this attempt.
      console.error(`[CampaignRetry] Could not record the failure for ${recipient.id}:`, handlingErr.message);
      await prisma.campaignRecipient.updateMany({
        where: { id: recipient.id, retryStatus: 'IN_PROGRESS' },
        data: { retryStatus: 'SCHEDULED' },
      }).catch(() => {});
    }
    return;
  }

  console.log(`[CampaignRetry] Retry succeeded for recipient ${recipient.id} on attempt #${attempt}:`, metaMessageId);

  const wasSent = Boolean(recipient.sentAt);
  await markRecipientSent(recipient.id, {
    status: 'SENT',
    sentAt: recipient.sentAt || new Date(),
    retryStatus: 'SUCCESS',
    nextRetryAt: null,
    failReason: null,
    lastFailureReason: null,
  });

  await snapshotRecipientContext(campaign, recipient);
  // First attempt that actually reached Meta claims the charge. If the
  // initial send already billed this recipient, this is a no-op — never a
  // second charge for the same person.
  await bookkeep('Charge claim', recipient.id, () => claimRecipientCharge(campaign, recipient));
  await bookkeep('Attempt history', recipient.id, () => recordAttempt(recipient.id, { attempt, ok: true }));
  await bookkeep('Retry notification', recipient.id, () => notifyRetrySucceeded(campaign, recipient, attempt));
  if (!wasSent) {
    await bookkeep('Sent counter', recipient.id, () => prisma.campaign.update({
      where: { id: campaignId },
      data: { sent: { increment: 1 } },
    }));
  }
  await bookkeep('Message record', recipient.id, () =>
    persistOutboundMessage(campaign, recipient, metaMessageId, `[Campaign Retry: ${campaign.name}]`));
  await bookkeep('Completion check', recipient.id, () => checkAndCompleteCampaign(campaignId));
}

// One recipient of the main loop, already claimed PENDING -> SENDING. Every
// path moves the row out of SENDING. Returns false when nothing was offered to
// Meta (an opt-out skip), so the caller can skip the rate-limit pause.
async function sendClaimedRecipient(campaign, recipient, { phoneNumberId, accessToken }) {
  const campaignId = campaign.id;
  // Declared outside the try so the catch below knows which kind of credit to
  // hand back when the send fails.
  let creditSource = null;
  let creditAmount = null;
  let metaMessageId = null;
  try {
    // Re-checked per recipient rather than only at launch: a customer can
    // reply STOP while the campaign is mid-flight, and that must take effect
    // for the messages that haven't gone out yet.
    if (await isOptedOut(campaign.workspaceId, recipient.contact.phoneNumber)) {
      await skipOptedOutRecipient(campaignId, recipient);
      return false;
    }

    const credit = await takeSendCredit(campaign, 'Campaign overage');
    creditSource = credit.ok ? credit.source : null;
    creditAmount = credit.ok ? (credit.amount ?? null) : null;
    if (!credit.ok) {
      console.warn(`[CampaignWorker] cannot send to ${recipient.contact.phoneNumber}: ${credit.code}`);
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'FAILED', failedAt: new Date(),
          failReason: creditFailureReason(credit.code),
          initialStatus: 'FAILED',
        },
      });
      // Nothing was sent, so nothing is owed for this recipient.
      await markRecipientNotCharged(recipient.id);
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { failed: { increment: 1 } },
      });
      return true;
    }

    metaMessageId = await sendToRecipient(campaign, recipient, { phoneNumberId, accessToken });
  } catch (err) {
    const metaErr = err.response?.data?.error;
    const reason = describeMetaError(metaErr, err.message);
    console.error(`[CampaignWorker] send failed for ${recipient.contact.phoneNumber}:`, reason, metaErr || '');
    try {
      // The credit was claimed before the send that just failed — give it
      // back so a message nobody received doesn't count against the quota.
      await releaseMessageCredit(campaign.workspaceId, { source: creditSource, amount: creditAmount }).catch(() => {});
      // No charge is claimed on a failed send — the recipient stays unbilled
      // until an attempt actually reaches Meta.
      await prisma.campaignRecipient.update({
        where: { id: recipient.id }, data: { initialStatus: 'FAILED' },
      }).catch(() => {});
      await recordAttempt(recipient.id, { attempt: 0, ok: false, reason, metaCode: metaErr?.code ?? null });
      await handleRecipientFailure(campaign, recipient, reason, metaErr?.code);
    } catch (handlingErr) {
      // Nothing went out. Hand the row back rather than leaving it SENDING, so
      // a later run (or the recovery sweep) picks it up again.
      console.error(`[CampaignWorker] Could not record the failure for ${recipient.id}:`, handlingErr.message);
      await prisma.campaignRecipient.updateMany({
        where: { id: recipient.id, status: 'SENDING' },
        data: { status: 'PENDING' },
      }).catch(() => {});
    }
    return true;
  }

  console.log(`[CampaignWorker] sent to ${recipient.contact.phoneNumber}:`, metaMessageId);
  await markRecipientSent(recipient.id, { status: 'SENT', sentAt: new Date(), initialStatus: 'SENT' });
  await snapshotRecipientContext(campaign, recipient);
  // The message reached Meta, so this recipient claims its share of the
  // launch reservation — once, no matter how many attempts follow. What
  // is never claimed here is refunded at settlement.
  await bookkeep('Charge claim', recipient.id, () => claimRecipientCharge(campaign, recipient));
  await bookkeep('Attempt history', recipient.id, () => recordAttempt(recipient.id, { attempt: 0, ok: true }));
  await bookkeep('Sent counter', recipient.id, () => prisma.campaign.update({
    where: { id: campaignId },
    data: { sent: { increment: 1 } },
  }));
  await bookkeep('Message record', recipient.id, () =>
    persistOutboundMessage(campaign, recipient, metaMessageId, `[Campaign: ${campaign.name}]`));
  return true;
}

// Ends a campaign that cannot be sent. Never overwrites a CANCELLED/COMPLETED
// one. A campaign that died before sending (a disconnected number, an expired
// token) has already taken the money, so everything that never went out is
// given back — otherwise FAILED is a dead end with no refund path, since
// cancel() refuses terminal campaigns.
async function failCampaign(campaignId, message) {
  const res = await prisma.campaign.updateMany({
    where: { id: campaignId, status: { in: ['RUNNING', 'SCHEDULED', 'DRAFT'] } },
    data: { status: 'FAILED' },
  });
  if (res.count === 0) return;
  console.error(`[CampaignWorker] Campaign ${campaignId} failed: ${message}`);

  const failed = await prisma.campaign.findUnique({ where: { id: campaignId } }).catch(() => null);
  if (!failed) return;
  await settleCampaignRefund(failed.id, 'Refund for failed campaign').catch((e) =>
    console.error(`[Campaign] Settlement failed for ${failed.id}:`, e.message));

  queueCampaignFailedEmail(failed).catch(() => {});
  notifyWorkspace(failed.workspaceId, {
    type: 'CAMPAIGN_FAILED',
    title: `Campaign "${failed.name}" failed`,
    body: message,
    link: 'campaigns',
    meta: { campaignId: failed.id },
  }).catch(() => {});
}

// Exported for tests; production runs it only through startCampaignWorker().
export async function processCampaign(job) {
  if (job.name === 'retry-recipient' || job.data?.type === 'retry') {
    await processRetryJob(job);
    return;
  }
  const { campaignId, workspaceId } = job.data;

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: { template: true, waNumber: true },
  });

  // A deleted campaign can never come back, so throwing here only bought
  // three pointless BullMQ retries per orphaned job and a wall of
  // "Campaign … not found" in the log. Treated as a no-op instead, which is
  // how processRetryJob already handles the same case.
  if (!campaign) {
    console.log(`[CampaignWorker] Campaign ${campaignId} no longer exists — discarding job`);
    return;
  }
  // Cancellation may have happened while the job sat in the queue. Never
  // resurrect a cancelled/completed campaign.
  if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED' && campaign.status !== 'RUNNING') {
    console.log(`[CampaignWorker] Campaign ${campaignId} is ${campaign.status} — skipping`);
    return;
  }
  // Both are permanent: retrying the job cannot fix them, and a retry that
  // found the campaign already FAILED used to return quietly, so the refund
  // in the final-attempt handler never ran.
  if (!campaign.waNumber) {
    await failCampaign(campaignId, `Campaign ${campaignId} has no WhatsApp number`);
    return;
  }
  let accessToken;
  try {
    accessToken = decrypt(campaign.waNumber.encryptedAccessToken);
  } catch {
    await failCampaign(campaignId, 'The WhatsApp access token for this number could not be read — reconnect the number in Number Setup, then relaunch.');
    return;
  }
  const phoneNumberId = campaign.waNumber.metaPhoneNumberId;

  // Atomic status guard: only transition to RUNNING if the campaign wasn't
  // cancelled or paused in the meantime (closes the cancel race with getJobs()).
  const claimed = await prisma.campaign.updateMany({
    where: { id: campaignId, status: { in: ['DRAFT', 'SCHEDULED'] } },
    data: { status: 'RUNNING', launchedAt: campaign.launchedAt || new Date() },
  });
  if (claimed.count === 0) {
    // RUNNING is deliberately not claimable above, so an unrelated second job
    // (a double launch) cannot start another loop over the same recipients.
    // Re-entry is legitimate for a resume or recovery job (flagged `resume`)
    // and for a redelivery of the very job that owns the campaign — a stalled
    // worker, or BullMQ's own retry after a throw mid-run. Without the latter
    // the retry returned "success" and the campaign stayed RUNNING forever.
    // Each recipient is still claimed PENDING -> SENDING before it is sent,
    // which is what actually rules out a double send.
    const current = await prisma.campaign.findUnique({
      where: { id: campaignId }, select: { status: true, queueJobId: true },
    });
    if (current?.status !== 'RUNNING') {
      console.log(`[CampaignWorker] Campaign ${campaignId} could not be claimed (${current?.status}) — skipping`);
      return;
    }
    const ownsCampaign = Boolean(current.queueJobId) && String(job.id) === current.queueJobId;
    if (!job.data?.resume && !ownsCampaign) {
      console.warn(`[CampaignWorker] Campaign ${campaignId} is already being sent by another job — refusing to send it twice.`);
      return;
    }
  }

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: 'PENDING' },
    include: { contact: true },
  });

  let cancelled = false;
  let paused = false;
  let processed = 0;

  for (const recipient of recipients) {
    const refreshed = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
    if (refreshed?.status === 'CANCELLED') { cancelled = true; break; }
    // Pausing has to bite immediately, not at the end of the batch — that is
    // the whole point of being able to stop a campaign mid-flight.
    if (refreshed?.status === 'PAUSED') {
      console.log(`[CampaignWorker] Campaign ${campaignId} was paused — stopping after ${processed} recipient(s).`);
      paused = true;
      break;
    }

    // Claim this recipient before sending. The retry path already does this;
    // the main loop did not, so anything that ran the loop twice concurrently
    // would send to the same person twice. Only the writer that moves PENDING
    // to SENDING proceeds.
    const claimedRecipient = await prisma.campaignRecipient.updateMany({
      where: { id: recipient.id, status: 'PENDING' },
      data: { status: 'SENDING' },
    });
    if (claimedRecipient.count === 0) {
      console.log(`[CampaignWorker] Recipient ${recipient.id} already claimed elsewhere — skipping duplicate.`);
      continue;
    }
    processed += 1;

    const attempted = await sendClaimedRecipient(campaign, recipient, { phoneNumberId, accessToken });
    if (attempted) await sleep(RATE_DELAY_MS);
  }

  // A cancelled campaign must stay CANCELLED — never flip it to COMPLETED.
  if (cancelled) {
    console.log(`[CampaignWorker] Campaign ${campaignId} cancelled mid-run — leaving status CANCELLED`);
    return;
  }

  // Same for a pause: the remaining recipients are still PENDING and belong to
  // whoever resumes it. Releasing the claim on any recipient this run had
  // marked SENDING but not yet sent keeps them eligible.
  if (paused) {
    await prisma.campaignRecipient.updateMany({
      where: { campaignId, status: 'SENDING', sentAt: null },
      data: { status: 'PENDING' },
    }).catch(() => {});
    console.log(`[CampaignWorker] Campaign ${campaignId} paused mid-run — leaving status PAUSED`);
    return;
  }

  await checkAndCompleteCampaign(campaignId);
}

export function startCampaignWorker() {
  const worker = new Worker('campaigns', processCampaign, {
    connection: createBullConnection('campaign-worker'),
    concurrency: env.CAMPAIGN_WORKER_CONCURRENCY,
    drainDelay: env.WORKER_DRAIN_DELAY_SEC,
    stalledInterval: env.WORKER_STALLED_INTERVAL_MS,
  });

  worker.on('error', (err) => logRedisError('campaign-worker', err));
  worker.on('completed', (job) => console.log(`[CampaignWorker] Job ${job.id} completed`));
  worker.on('failed', async (job, err) => {
    console.error(`[CampaignWorker] Job ${job?.id} failed:`, err.message);
    // Only flag FAILED after the final attempt of a main send job. A retry
    // job failing is one recipient's problem, never the whole campaign's.
    const isFinalAttempt = job && job.attemptsMade >= (job.opts?.attempts ?? 1);
    const isSendJob = job?.name === 'send-campaign' && job?.data?.type !== 'retry';
    if (isFinalAttempt && isSendJob && job?.data?.campaignId) {
      await failCampaign(job.data.campaignId, err.message).catch((e) =>
        console.error(`[CampaignWorker] Could not mark ${job.data.campaignId} failed:`, e.message));
    }
  });

  return worker;
}
