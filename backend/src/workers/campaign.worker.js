import { Worker } from 'bullmq';
import { createBullConnection, logRedisError } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/encryption.js';
import { sendWhatsAppMessage } from '../lib/meta.js';
import { headerImageComponent } from '../services/templateImage.service.js';
import { templateHasVariables, contactVariableResolver, buildTextComponents, buildButtonComponents } from '../lib/templateParams.js';
import { campaignCtaComponent, buildCampaignContext } from '../services/campaignAi.service.js';
import { env } from '../config/env.js';
import { queueCampaignCompletedEmail, queueCampaignFailedEmail } from '../services/email.service.js';
import { consumeMessageCredit, releaseMessageCredit } from '../services/subscription.service.js';
import { runFallbackForRecipient } from '../services/fallback.service.js';
import { handleRecipientFailure, checkAndCompleteCampaign } from '../services/retry.service.js';
import { settleCampaignRefund } from '../services/campaigns.service.js';
import { claimRecipientCharge, markRecipientNotCharged, recordAttempt } from '../services/campaignBilling.service.js';
import { isOptedOut } from '../services/optout.service.js';
import { notifyWorkspace } from '../services/notification.service.js';

// Meta Cloud API Tier-1 numbers are limited to ~250 msgs/min. The old 60ms
// delay (~1000/min) triggered rate-limit errors (code 131042). 250ms ≈ 240/min.
const RATE_DELAY_MS = Math.max(env.CAMPAIGN_RATE_DELAY_MS, 250);

const normalizePhone = (raw) => String(raw || '').replace(/[^\d]/g, '');

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
  return raw;
};

// The full `template` object for one recipient's send.
//
// Neither an image header nor a parameterised button has {{n}} placeholders in
// a `text` field, so the text-variable check above misses both — that is why an
// approved image template used to go out with no picture (failing with 132000),
// and why a link button failed with 131008. Each is resolved on its own and the
// pieces assembled header → body → buttons, the order Meta expects.
//
// `campaign` is passed so a campaign with an AI agent can stamp its CTA
// quick-reply with the recipient's id: that payload comes straight back on the
// tap, which is what lets the agent open on the right campaign.
const buildTemplatePayload = async (template, contact, { phoneNumberId, accessToken, campaign = null, recipientId = null }) => {
  const payload = { name: template.name, language: { code: template.language } };

  const header = await headerImageComponent(template, { phoneNumberId, accessToken });
  const textComponents = templateHasVariables(template.components)
    ? buildTextComponents(template.components, contactVariableResolver(contact))
    : [];
  const buttonComponents = buildButtonComponents(template.components);
  const ctaComponent = campaign?.aiAgentEnabled
    ? campaignCtaComponent(template.components, { ctaLabel: campaign.aiAgentCtaLabel, recipientId })
    : null;

  const components = [
    ...(header ? [header] : []),
    ...textComponents,
    ...buttonComponents,
    ...(ctaComponent ? [ctaComponent] : []),
  ];
  if (components.length) payload.components = components;
  return payload;
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
  if (campaign.status === 'CANCELLED') {
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

  const accessToken = decrypt(campaign.waNumber.encryptedAccessToken);
  const phoneNumberId = campaign.waNumber.metaPhoneNumberId;

  // Declared outside the try so the catch below knows which kind of credit to
  // hand back when the retry send fails.
  let creditSource = null;
  let creditAmount = null;
  try {
    const credit = await consumeMessageCredit(workspaceId, {
      reason: 'Campaign retry attempt',
      prepaid: !!campaign.chargedAt,
      // Overage is priced by the template's category, same as the launch charge.
      messageCategory: campaign.template?.category ?? null,
    });
    creditSource = credit.ok ? credit.source : null;
    creditAmount = credit.ok ? (credit.amount ?? null) : null;
    if (!credit.ok) {
      console.warn(`[CampaignRetry] quota/wallet exhausted for ${recipient.contact.phoneNumber}: ${credit.code}`);
      await handleRecipientFailure(campaign, recipient, 'Quota and wallet balance exhausted', null);
      return;
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
      templatePayload
    );
    const metaMessageId = result?.messages?.[0]?.id ?? null;
    console.log(`[CampaignRetry] Retry succeeded for recipient ${recipient.id} on attempt #${attempt}:`, metaMessageId);

    await snapshotRecipientContext(campaign, recipient);

    const wasSent = Boolean(recipient.sentAt);
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: 'DELIVERED',
        sentAt: recipient.sentAt || new Date(),
        deliveredAt: new Date(),
        retryStatus: 'SUCCESS',
        nextRetryAt: null,
        failReason: null,
        lastFailureReason: null,
      },
    });

    // First attempt that actually reached Meta claims the charge. If the
    // initial send already billed this recipient, this is a no-op — never a
    // second charge for the same person.
    await claimRecipientCharge(campaign, recipient);
    await recordAttempt(recipient.id, { attempt, ok: true });

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        delivered: { increment: 1 },
        ...(wasSent ? {} : { sent: { increment: 1 } }),
      },
    });

    if (metaMessageId) {
      let convo = await prisma.conversation.findFirst({
        where: { contactId: recipient.contactId, waNumberId: campaign.waNumberId },
      });
      if (!convo) {
        convo = await prisma.conversation.create({
          data: {
            workspaceId: campaign.workspaceId,
            contactId: recipient.contactId,
            waNumberId: campaign.waNumberId,
            status: 'OPEN',
          },
        }).catch(() => null);
      }
      if (convo) {
        await prisma.message.create({
          data: {
            conversationId: convo.id,
            body: `[Campaign Retry: ${campaign.name}]`,
            direction: 'OUTBOUND',
            metaMessageId,
            campaignRecipientId: recipient.id,
            sentAt: new Date(),
          },
        }).catch(() => null);
      }
    }

    await checkAndCompleteCampaign(campaignId);
  } catch (err) {
    const metaErr = err.response?.data?.error;
    const reason = describeMetaError(metaErr, err.message);
    console.error(`[CampaignRetry] Retry failed for ${recipient.contact.phoneNumber}:`, reason);

    // Nothing went out, so the retry's credit goes back — otherwise every
    // retry attempt would burn quota for a message that never arrived.
    await releaseMessageCredit(workspaceId, { source: creditSource, amount: creditAmount }).catch(() => {});
    await recordAttempt(recipient.id, { attempt, ok: false, reason, metaCode: metaErr?.code ?? null });
    await handleRecipientFailure(campaign, { ...recipient, retryCount: attempt }, reason, metaErr?.code);
  }
}

async function processCampaign(job) {
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
  if (!campaign.waNumber) {
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'FAILED' } });
    throw new Error(`Campaign ${campaignId} has no WhatsApp number`);
  }

  // Atomic status guard: only transition to RUNNING if the campaign wasn't
  // cancelled in the meantime (closes the cancel race with getJobs()).
  const claimed = await prisma.campaign.updateMany({
    where: { id: campaignId, status: { in: ['DRAFT', 'SCHEDULED', 'RUNNING'] } },
    data: { status: 'RUNNING', launchedAt: campaign.launchedAt || new Date() },
  });
  if (claimed.count === 0) {
    console.log(`[CampaignWorker] Campaign ${campaignId} could not be claimed (likely cancelled) — skipping`);
    return;
  }

  const accessToken = decrypt(campaign.waNumber.encryptedAccessToken);
  const phoneNumberId = campaign.waNumber.metaPhoneNumberId;

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: 'PENDING' },
    include: { contact: true },
  });

  let cancelled = false;

  for (const recipient of recipients) {
    const refreshed = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
    if (refreshed?.status === 'CANCELLED') { cancelled = true; break; }

    // Re-checked per recipient rather than only at launch: a customer can
    // reply STOP while the campaign is mid-flight, and that must take effect
    // for the messages that haven't gone out yet.
    if (await isOptedOut(campaign.workspaceId, recipient.contact.phoneNumber)) {
      await skipOptedOutRecipient(campaignId, recipient);
      continue;
    }

    // Declared outside the try so the catch below knows which kind of credit
    // to hand back when the send fails.
    let creditSource = null;
    let creditAmount = null;
    try {
      // Campaigns are paid for in full at launch (campaigns.service.js), so
      // the per-send call only meters quota here — charging again would
      // double-bill the same message.
      const credit = await consumeMessageCredit(campaign.workspaceId, {
        reason: 'Campaign overage',
        prepaid: !!campaign.chargedAt,
        // Only used when this send is not prepaid; prices overage by category.
        messageCategory: campaign.template?.category ?? null,
      });
      creditSource = credit.ok ? credit.source : null;
      creditAmount = credit.ok ? (credit.amount ?? null) : null;
      if (!credit.ok) {
        console.warn(`[CampaignWorker] quota/wallet exhausted for ${recipient.contact.phoneNumber}: ${credit.code}`);
        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: 'FAILED', failedAt: new Date(),
            failReason: 'Quota and wallet balance exhausted',
            initialStatus: 'FAILED',
          },
        });
        // Nothing was sent, so nothing is owed for this recipient.
        await markRecipientNotCharged(recipient.id);
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { failed: { increment: 1 } },
        });
        await new Promise((r) => setTimeout(r, RATE_DELAY_MS));
        continue;
      }

      // Only carries `components` when there is something to substitute — the
      // template's own definition (type:BODY/text:...) causes Meta to reject.
      const templatePayload = await buildTemplatePayload(
        campaign.template,
        recipient.contact,
        { phoneNumberId, accessToken, campaign, recipientId: recipient.id },
      );

      const result = await sendWhatsAppMessage(
        phoneNumberId,
        accessToken,
        normalizePhone(recipient.contact.phoneNumber),
        templatePayload
      );
      const metaMessageId = result?.messages?.[0]?.id ?? null;
      console.log(`[CampaignWorker] sent to ${recipient.contact.phoneNumber}:`, metaMessageId);

      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: 'SENT', sentAt: new Date(), initialStatus: 'SENT' },
      });

      await snapshotRecipientContext(campaign, recipient);

      // The message reached Meta, so this recipient claims its share of the
      // launch reservation — once, no matter how many attempts follow. What
      // is never claimed here is refunded at settlement.
      await claimRecipientCharge(campaign, recipient);
      await recordAttempt(recipient.id, { attempt: 0, ok: true });

      await prisma.campaign.update({
        where: { id: campaignId },
        data: { sent: { increment: 1 } },
      });

      // Persist the outbound message with a link back to the campaign
      // recipient so delivery/read webhooks can update the right rows.
      if (metaMessageId) {
        let convo = await prisma.conversation.findFirst({
          where: { contactId: recipient.contactId, waNumberId: campaign.waNumberId },
        });
        if (!convo) {
          convo = await prisma.conversation.create({
            data: {
              workspaceId: campaign.workspaceId,
              contactId: recipient.contactId,
              waNumberId: campaign.waNumberId,
              status: 'OPEN',
            },
          }).catch(() => null);
        }
        if (convo) {
          await prisma.message.create({
            data: {
              conversationId: convo.id,
              body: `[Campaign: ${campaign.name}]`,
              direction: 'OUTBOUND',
              metaMessageId,
              campaignRecipientId: recipient.id,
              sentAt: new Date(),
            },
          });
        }
      }
    } catch (err) {
      const metaErr = err.response?.data?.error;
      const reason = describeMetaError(metaErr, err.message);
      console.error(`[CampaignWorker] send failed for ${recipient.contact.phoneNumber}:`, reason, metaErr || '');
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
    }

    await new Promise((r) => setTimeout(r, RATE_DELAY_MS));
  }

  // A cancelled campaign must stay CANCELLED — never flip it to COMPLETED.
  if (cancelled) {
    console.log(`[CampaignWorker] Campaign ${campaignId} cancelled mid-run — leaving status CANCELLED`);
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
    // Only flag FAILED after the final attempt, and never overwrite a
    // CANCELLED/COMPLETED campaign.
    const isFinalAttempt = job && job.attemptsMade >= (job.opts?.attempts ?? 1);
    if (isFinalAttempt && job?.data?.campaignId) {
      const res = await prisma.campaign.updateMany({
        where: { id: job.data.campaignId, status: { in: ['RUNNING', 'SCHEDULED', 'DRAFT'] } },
        data: { status: 'FAILED' },
      }).catch(() => null);
      if (res?.count > 0) {
        const failed = await prisma.campaign.findUnique({ where: { id: job.data.campaignId } }).catch(() => null);
        if (failed) {
          // A campaign that died before sending (a disconnected number, an
          // expired token) has already taken the money. Give back everything
          // that never went out — otherwise a FAILED campaign is a dead end
          // with no refund path, since cancel() refuses terminal campaigns.
          await settleCampaignRefund(failed.id, 'Refund for failed campaign').catch((e) =>
            console.error(`[Campaign] Settlement failed for ${failed.id}:`, e.message));

          queueCampaignFailedEmail(failed).catch(() => {});
          notifyWorkspace(failed.workspaceId, {
            type: 'CAMPAIGN_FAILED',
            title: `Campaign "${failed.name}" failed`,
            body: err.message,
            link: 'campaigns',
            meta: { campaignId: failed.id },
          }).catch(() => {});
        }
      }
    }
  });

  return worker;
}
