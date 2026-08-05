import { prisma } from '../lib/prisma.js';
import { campaignQueue } from '../queues/campaign.queue.js';
import { assertWithinLimit } from './subscription.service.js';
import { normalizeRetryConfig } from '../lib/retry.js';
import { credit, debit } from './wallet.service.js';
import { getOptedOutPhoneSet, normalizePhone } from './optout.service.js';
import { notifyWorkspace } from './notification.service.js';
import { rateForCategory } from '../lib/messagePricing.js';

const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

// A number needs a country code and a subscriber part to be sendable. Anything
// shorter is a typo, not a phone number, and Meta would reject it anyway — so
// it's reported as invalid up front instead of billed for and failed later.
const MIN_MSISDN_DIGITS = 8;
const MAX_MSISDN_DIGITS = 15; // E.164

const isSendableNumber = (phone) => {
  const digits = normalizePhone(phone);
  return digits.length >= MIN_MSISDN_DIGITS && digits.length <= MAX_MSISDN_DIGITS;
};

export async function listCampaigns(workspaceId, { page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    prisma.campaign.findMany({
      where: { workspaceId },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        template: { select: { id: true, name: true } },
        waNumber: { select: { id: true, phoneNumber: true, displayName: true } },
      },
    }),
    prisma.campaign.count({ where: { workspaceId } }),
  ]);
  return { data, total };
}

export async function createCampaign(workspaceId, { name, templateId, numberId, whatsappNumberId, replyRules, retryConfig, trackingConfig, fallbackConfig }, user = null) {
  if (!name || !String(name).trim()) { const e = new Error('Campaign name is required'); e.status = 400; throw e; }
  // Plan's campaign cap (null = unlimited); reads the plan live so admin edits
  // in the Plans tab apply immediately.
  await assertWithinLimit(workspaceId, 'campaign');
  const resolvedNumberId = numberId ?? whatsappNumberId;
  const [template, waNumber] = await Promise.all([
    prisma.template.findFirst({ where: { id: templateId, workspaceId } }),
    prisma.waNumber.findFirst({ where: { id: resolvedNumberId, workspaceId } }),
  ]);

  if (!template) { const e = new Error('Template not found'); e.status = 404; throw e; }
  if (template.status === 'DELETED') {
    const e = new Error('That template was deleted on Meta and can no longer be used'); e.status = 400; throw e;
  }
  if (!waNumber) { const e = new Error('WhatsApp number not found'); e.status = 404; throw e; }
  // Enforce per-number template privacy: the template must belong to this number
  // (or be a legacy template with no number binding yet).
  if (template.waNumberId && template.waNumberId !== waNumber.id) {
    const e = new Error('Selected template belongs to a different WhatsApp number'); e.status = 400; throw e;
  }

  return prisma.campaign.create({
    data: {
      workspaceId, name: String(name).trim(), templateId, waNumberId: waNumber.id, status: 'DRAFT',
      createdByUserId: user?.id ?? null,
      // Advanced wizard config (reply flows / retries / conversion tracking) is
      // persisted as JSON so it survives and can drive future execution.
      replyRules: replyRules ?? undefined,
      retryConfig: retryConfig ? normalizeRetryConfig(retryConfig) : undefined,
      trackingConfig: trackingConfig ?? undefined,
      fallbackConfig: fallbackConfig ?? undefined,
    },
  });
}

export async function updateCampaign(workspaceId, campaignId, { name, replyRules, retryConfig, trackingConfig, fallbackConfig }) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!campaign) { const e = new Error('Campaign not found'); e.status = 404; throw e; }
  if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED') {
    const e = new Error('Only DRAFT or SCHEDULED campaigns can be updated'); e.status = 400; throw e;
  }
  const data = {};
  if (name !== undefined) data.name = String(name).trim();
  if (replyRules !== undefined) data.replyRules = replyRules;
  if (retryConfig !== undefined) data.retryConfig = retryConfig ? normalizeRetryConfig(retryConfig) : null;
  if (trackingConfig !== undefined) data.trackingConfig = trackingConfig;
  if (fallbackConfig !== undefined) data.fallbackConfig = fallbackConfig;

  return prisma.campaign.update({ where: { id: campaignId }, data });
}

export async function addRecipients(workspaceId, campaignId, contactIds) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!campaign) { const e = new Error('Campaign not found'); e.status = 404; throw e; }
  if (campaign.status !== 'DRAFT') { const e = new Error('Recipients can only be added while the campaign is a draft'); e.status = 400; throw e; }

  const ids = Array.isArray(contactIds) ? [...new Set(contactIds.filter(Boolean))] : [];
  const validContacts = await prisma.contact.findMany({
    where: { id: { in: ids }, workspaceId },
    select: { id: true, phoneNumber: true, optedOut: true },
  });
  const validIds = validContacts.map((c) => c.id);
  const invalidIds = ids.filter((id) => !validIds.includes(id));

  if (validIds.length === 0) {
    const e = new Error(`No valid contacts in this workspace. Invalid IDs: ${JSON.stringify(invalidIds)}`);
    e.status = 400;
    throw e;
  }

  const createData = validIds.map((contactId) => ({ campaignId, contactId }));
  // createMany reports the number of rows actually inserted — skipDuplicates
  // silently drops recipients already on the campaign, so use the real count.
  const { count: added } = await prisma.campaignRecipient.createMany({ data: createData, skipDuplicates: true });
  const duplicates = validIds.length - added;

  const total = await prisma.campaignRecipient.count({ where: { campaignId } });
  await prisma.campaign.update({ where: { id: campaignId }, data: { totalContacts: total } });

  // Opted-out recipients are reported here so the wizard can show the count
  // before launch. They stay on the campaign (the report needs them under
  // "Skipped") and are marked SKIPPED — never sent, never billed — at launch.
  const blockedSet = await getOptedOutPhoneSet(workspaceId, validContacts.map((c) => c.phoneNumber));
  const blocked = validContacts.filter((c) => c.optedOut === true || blockedSet.has(normalizePhone(c.phoneNumber))).length;

  return { added, skipped: invalidIds.length + duplicates, duplicates, invalidIds, blocked, totalContacts: total };
}

// Breaks a set of contacts into the four buckets the campaign summary screen
// shows — valid / duplicate / blocked / invalid — and prices the valid ones.
// Used both by the pre-launch preview endpoint and by launchCampaign itself,
// so the number the customer approves is the number they're charged.
async function analyseAudience(workspaceId, contacts) {
  const seenContactIds = new Set();
  const seenPhones = new Set();

  const valid = [];
  const duplicates = [];
  const invalid = [];
  const candidates = [];

  for (const contact of contacts) {
    if (!contact) continue;
    const digits = normalizePhone(contact.phoneNumber);
    if (seenContactIds.has(contact.id) || (digits && seenPhones.has(digits))) {
      duplicates.push(contact);
      continue;
    }
    seenContactIds.add(contact.id);
    if (digits) seenPhones.add(digits);

    if (!isSendableNumber(contact.phoneNumber)) { invalid.push(contact); continue; }
    candidates.push(contact);
  }

  const blockedSet = await getOptedOutPhoneSet(workspaceId, candidates.map((c) => c.phoneNumber));
  const blocked = [];
  for (const contact of candidates) {
    if (contact.optedOut === true || blockedSet.has(normalizePhone(contact.phoneNumber))) blocked.push(contact);
    else valid.push(contact);
  }

  return { valid, duplicates, blocked, invalid };
}

// Resolves the per-message rate for a campaign's template category, falling
// back to the workspace rate when the category is missing/unrecognised.
async function resolveTemplateCategory(workspaceId, templateId) {
  if (!templateId) return null;
  const template = await prisma.template.findFirst({
    where: { id: templateId, workspaceId },
    select: { category: true },
  });
  return template?.category ?? null;
}

async function priceAudience(workspaceId, contacts, templateCategory = null) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { walletBalance: true, costPerMessage: true },
  });
  if (!workspace) { const e = new Error('Workspace not found'); e.status = 404; throw e; }

  const { valid, duplicates, blocked, invalid } = await analyseAudience(workspaceId, contacts);
  const costPerMessage = rateForCategory(templateCategory, workspace.costPerMessage);
  const totalCost = money(valid.length * costPerMessage);
  const walletBalance = Number(workspace.walletBalance);

  return {
    totalContacts: contacts.length,
    validContacts: valid.length,
    duplicateContacts: duplicates.length,
    blockedContacts: blocked.length,
    invalidContacts: invalid.length,
    messageCategory: templateCategory ?? null,
    costPerMessage,
    totalCost,
    walletBalance,
    remainingBalance: money(walletBalance - totalCost),
    sufficientBalance: walletBalance >= totalCost,
    blockedNumbers: blocked.slice(0, 25).map((c) => ({ id: c.id, name: c.name, phoneNumber: c.phoneNumber })),
    validContactIds: valid.map((c) => c.id),
  };
}

// Pre-launch summary (Part 4 of the spec). Accepts either a list of contact
// ids (the create-campaign wizard, before the campaign row exists) or an
// existing draft campaign id.
export async function estimateCampaignCost(workspaceId, { contactIds, campaignId, templateId } = {}) {
  let contacts = [];
  // Pricing depends on the template's category. An existing campaign carries
  // its own template; the wizard estimates before the campaign row exists and
  // so passes the template it has selected.
  let category = null;

  if (campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, workspaceId },
      select: { id: true, template: { select: { category: true } } },
    });
    if (!campaign) { const e = new Error('Campaign not found'); e.status = 404; throw e; }
    category = campaign.template?.category ?? null;
    const recipients = await prisma.campaignRecipient.findMany({
      where: { campaignId, status: 'PENDING' },
      include: { contact: true },
    });
    contacts = recipients.map((r) => r.contact).filter(Boolean);
  } else {
    category = await resolveTemplateCategory(workspaceId, templateId);
    const ids = Array.isArray(contactIds) ? contactIds.filter(Boolean) : [];
    if (ids.length === 0) { const e = new Error('Select at least one contact to estimate a campaign'); e.status = 400; throw e; }
    if (ids.length > 10_000) { const e = new Error('A campaign can target at most 10,000 contacts at a time'); e.status = 400; throw e; }
    const found = await prisma.contact.findMany({ where: { id: { in: [...new Set(ids)] }, workspaceId } });
    const byId = new Map(found.map((c) => [c.id, c]));
    // Preserve the caller's list (including its repeats) so "duplicate
    // contacts" reflects what they actually selected.
    contacts = ids.map((cid) => byId.get(cid)).filter(Boolean);
    const missing = ids.length - contacts.length;
    if (missing > 0) {
      const summary = await priceAudience(workspaceId, contacts, category);
      return { ...summary, totalContacts: ids.length, invalidContacts: summary.invalidContacts + missing };
    }
  }

  return priceAudience(workspaceId, contacts, category);
}

export async function launchCampaign(workspaceId, campaignId, scheduledAt, retryConfig, user = null) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: { template: { select: { category: true } } },
  });
  if (!campaign) { const e = new Error('Campaign not found'); e.status = 404; throw e; }
  if (campaign.status !== 'DRAFT') {
    const e = new Error('Campaign is not in DRAFT status'); e.status = 400; throw e;
  }

  // Validate the schedule before touching money — a bad date must not leave a
  // charged, unqueued campaign behind.
  let scheduledDate = null;
  if (scheduledAt) {
    scheduledDate = new Date(scheduledAt);
    if (Number.isNaN(scheduledDate.getTime())) {
      const e = new Error('Invalid scheduledAt date'); e.status = 400; throw e;
    }
    // Reject clearly-past dates instead of silently firing immediately.
    if (scheduledDate.getTime() - Date.now() < -60_000) {
      const e = new Error('scheduledAt must be in the future'); e.status = 400; throw e;
    }
  }

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: 'PENDING' },
    include: { contact: true },
  });
  if (recipients.length === 0) {
    const e = new Error('Add at least one recipient before launching'); e.status = 400; throw e;
  }

  const contacts = recipients.map((r) => r.contact).filter(Boolean);
  const { valid, blocked, invalid } = await analyseAudience(workspaceId, contacts);
  const sendableIds = new Set(valid.map((c) => c.id));

  // Opted-out and unsendable recipients are marked up front so they are never
  // attempted and never billed. A blocked number is a skip, not a failure —
  // and one blocked number must never stop the campaign.
  const skipIds = recipients.filter((r) => !sendableIds.has(r.contactId)).map((r) => r.id);
  const blockedIds = new Set(blocked.map((c) => c.id));
  if (skipIds.length > 0) {
    await prisma.campaignRecipient.updateMany({
      where: { id: { in: recipients.filter((r) => blockedIds.has(r.contactId)).map((r) => r.id) } },
      data: { status: 'SKIPPED', failReason: 'Recipient opted out', retryStatus: 'SKIPPED' },
    });
    const invalidIds = new Set(invalid.map((c) => c.id));
    await prisma.campaignRecipient.updateMany({
      where: { id: { in: recipients.filter((r) => invalidIds.has(r.contactId)).map((r) => r.id) } },
      // INVALID_NUMBER (rather than PERMANENT_FAILURE) marks this as rejected
      // at launch, before any charge — settleCampaignRefund() relies on that
      // to tell "never billed" apart from "billed and attempted".
      data: { status: 'FAILED', failedAt: new Date(), failReason: 'Invalid phone number', retryStatus: 'INVALID_NUMBER' },
    });
  }

  if (valid.length === 0) {
    const e = new Error(
      blocked.length > 0
        ? 'Every recipient on this campaign has opted out — there is nobody left to send to.'
        : 'No recipient on this campaign has a valid phone number.'
    );
    e.status = 400;
    throw e;
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { walletBalance: true, costPerMessage: true },
  });
  // Priced by the template's category (marketing/utility/authentication), with
  // the workspace rate as the fallback. Persisted onto the campaign below, so
  // refunds and the campaign detail view keep using the rate actually charged.
  const costPerMessage = rateForCategory(campaign.template?.category, workspace.costPerMessage);
  const totalCost = money(valid.length * costPerMessage);
  const walletBefore = Number(workspace.walletBalance);

  if (totalCost > walletBefore) {
    const e = new Error('Insufficient Wallet Balance. Please recharge your wallet.');
    e.status = 402;
    e.code = 'INSUFFICIENT_WALLET_BALANCE';
    e.details = { required: totalCost, balance: walletBefore, shortfall: money(totalCost - walletBefore) };
    throw e;
  }

  // Claim the campaign for charging. `chargedAt: null` in the WHERE is the
  // idempotency guard: a browser refresh, a double-submit, a network retry or
  // a resumed launch all lose this race and stop here instead of paying twice.
  const claim = await prisma.campaign.updateMany({
    where: { id: campaignId, workspaceId, status: 'DRAFT', chargedAt: null },
    data: { chargedAt: new Date() },
  });
  if (claim.count === 0) {
    const e = new Error('This campaign has already been launched'); e.status = 409; throw e;
  }

  let walletAfter = walletBefore;
  if (totalCost > 0) {
    let charge;
    try {
      charge = await debit(workspaceId, totalCost, {
        reason: `Campaign: ${campaign.name}`,
        reference: campaignId,
        category: 'CAMPAIGN',
        // Unique per campaign — the ledger itself refuses a second charge.
        idempotencyKey: `campaign_charge_${campaignId}`,
      });
    } catch (err) {
      await prisma.campaign.updateMany({ where: { id: campaignId }, data: { chargedAt: null } });
      throw err;
    }
    if (!charge.ok) {
      // Balance moved between the check above and the debit (a concurrent
      // campaign spent it). Release the claim so the customer can retry.
      await prisma.campaign.updateMany({ where: { id: campaignId }, data: { chargedAt: null } });
      const e = new Error('Insufficient Wallet Balance. Please recharge your wallet.');
      e.status = 402;
      e.code = 'INSUFFICIENT_WALLET_BALANCE';
      e.details = { required: totalCost, balance: charge.balance, shortfall: money(totalCost - charge.balance) };
      throw e;
    }
    walletAfter = charge.balance;
  }

  const normRetry = retryConfig ? normalizeRetryConfig(retryConfig) : (campaign.retryConfig ? normalizeRetryConfig(campaign.retryConfig) : undefined);
  const costData = {
    costPerMessage,
    totalCost,
    walletBefore,
    walletAfter,
    // Baselines for the live counters the campaigns list reads. The worker
    // increments from here as it sends.
    skipped: blocked.length,
    failed: invalid.length,
    ...(user?.id ? { createdByUserId: user.id } : {}),
    ...(normRetry !== undefined ? { retryConfig: normRetry } : {}),
  };

  try {
    if (scheduledDate) {
      const delay = Math.max(0, scheduledDate.getTime() - Date.now());
      const job = await campaignQueue.add('send-campaign', { campaignId, workspaceId }, { delay });
      // SCHEDULED status distinguishes "queued for future" from a true draft and
      // lets startup recovery re-queue lost jobs after a Redis/server restart.
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { ...costData, status: 'SCHEDULED', scheduledAt: scheduledDate, queueJobId: String(job.id) },
      });
    } else {
      const job = await campaignQueue.add('send-campaign', { campaignId, workspaceId });
      // The worker flips the campaign to RUNNING once it actually starts —
      // marking RUNNING here would show a false "running" state if the worker
      // never picks the job up.
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { ...costData, scheduledAt: new Date(), queueJobId: String(job.id) },
      });
    }
  } catch (err) {
    // The campaign never made it into the queue, so it never starts — refund
    // in full rather than leaving the customer charged for nothing.
    await refundCampaign(campaignId, totalCost, 'Campaign could not be queued');
    await prisma.campaign.updateMany({ where: { id: campaignId }, data: { chargedAt: null, status: 'DRAFT' } });
    throw err;
  }

  notifyWorkspace(workspaceId, {
    type: 'CAMPAIGN_LAUNCHED',
    title: scheduledDate ? `Campaign "${campaign.name}" scheduled` : `Campaign "${campaign.name}" launched`,
    body: `${valid.length} recipient${valid.length === 1 ? '' : 's'} · ₹${totalCost.toFixed(2)} deducted${blocked.length ? ` · ${blocked.length} skipped (opted out)` : ''}`,
    link: 'campaigns',
    meta: { campaignId },
  }).catch(() => {});

  const launched = await prisma.campaign.findUnique({ where: { id: campaignId } });
  return {
    ...launched,
    summary: {
      totalContacts: recipients.length,
      validContacts: valid.length,
      blockedContacts: blocked.length,
      invalidContacts: invalid.length,
      costPerMessage,
      totalCost,
      walletBefore,
      walletAfter,
    },
  };
}

// Credits back the unspent part of a campaign charge. Idempotent via both the
// `refundedAt` guard and the ledger's unique idempotency key, so a retried
// cancel can't refund twice.
async function refundCampaign(campaignId, amount, reason) {
  const value = money(amount);
  if (!(value > 0)) return null;

  const claim = await prisma.campaign.updateMany({
    where: { id: campaignId, refundedAt: null },
    data: { refundedAt: new Date(), refundAmount: value },
  });
  if (claim.count === 0) return null;

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return null;

  const result = await credit(campaign.workspaceId, value, {
    reason: `${reason}: ${campaign.name}`,
    reference: campaignId,
    category: 'REFUND',
    gateway: 'system',
    idempotencyKey: `campaign_refund_${campaignId}`,
  }).catch((err) => {
    console.error(`[Campaign] Refund failed for ${campaignId}:`, err.message);
    return null;
  });

  if (!result) {
    await prisma.campaign.updateMany({ where: { id: campaignId }, data: { refundedAt: null, refundAmount: null } });
    return null;
  }

  await prisma.campaign.update({ where: { id: campaignId }, data: { walletAfter: result.balance } });
  return result;
}

export async function getCampaign(workspaceId, campaignId) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: {
      template: true,
      waNumber: { select: { id: true, phoneNumber: true, displayName: true } },
      recipients: {
        take: 100,
        orderBy: { sentAt: 'desc' },
        include: { contact: { select: { id: true, name: true, phoneNumber: true } } },
      },
    },
  });
  if (!campaign) { const e = new Error('Campaign not found'); e.status = 404; throw e; }

  // Counters live on the campaign row for speed, but the report is derived
  // from the recipients themselves so it can never drift from reality.
  const byStatus = await prisma.campaignRecipient.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: { _all: true },
  });
  const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count._all]));
  const totalRecipients = byStatus.reduce((sum, row) => sum + row._count._all, 0);

  return {
    ...campaign,
    report: {
      totalContacts: totalRecipients || campaign.totalContacts,
      sent: (counts.SENT || 0) + (counts.DELIVERED || 0) + (counts.READ || 0),
      delivered: (counts.DELIVERED || 0) + (counts.READ || 0),
      read: counts.READ || 0,
      failed: counts.FAILED || 0,
      skipped: counts.SKIPPED || 0,
      pending: (counts.PENDING || 0) + (counts.RETRYING || 0),
      costPerMessage: campaign.costPerMessage == null ? null : Number(campaign.costPerMessage),
      totalCost: campaign.totalCost == null ? null : Number(campaign.totalCost),
      walletBefore: campaign.walletBefore == null ? null : Number(campaign.walletBefore),
      walletAfter: campaign.walletAfter == null ? null : Number(campaign.walletAfter),
      refundAmount: campaign.refundAmount == null ? null : Number(campaign.refundAmount),
    },
  };
}

export async function cancelCampaign(workspaceId, campaignId) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!campaign) { const e = new Error('Campaign not found'); e.status = 404; throw e; }
  if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(campaign.status)) {
    const e = new Error(`Campaign is already ${campaign.status}`); e.status = 400; throw e;
  }

  // Set CANCELLED first: the worker re-checks this before every send and at
  // claim time, so even a job that slipped into 'active' stops quickly.
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'CANCELLED' } });

  // Remove the queued job by its stored ID (reliable) and by scan (fallback).
  if (campaign.queueJobId) {
    const job = await campaignQueue.getJob(campaign.queueJobId).catch(() => null);
    if (job) await job.remove().catch(() => {});
  }
  const jobs = await campaignQueue.getJobs(['delayed', 'waiting', 'paused']).catch(() => []);
  for (const job of jobs) {
    if (job.data?.campaignId === campaignId) await job.remove().catch(() => {});
  }

  await settleCampaignRefund(campaignId, 'Refund for cancelled campaign');

  return prisma.campaign.findUnique({ where: { id: campaignId } });
}

// Refunds every message that was paid for at launch but never actually left
// the system. Called whenever a campaign reaches a terminal state —
// cancelled, failed, or completed — so money can never be kept for a send
// that didn't happen.
//
// The arithmetic is deliberately derived from what was charged rather than
// from the recipient rows alone:
//   paidFor  = totalCost / costPerMessage  (exactly the valid recipients at launch)
//   consumed = recipients the worker really handed to Meta
// Recipients rejected at launch carry retryStatus INVALID_NUMBER or SKIPPED
// and were never part of `paidFor`, so they cancel out of both sides. A
// contact who replies STOP mid-campaign lands in `paidFor` but not in
// `consumed`, and is therefore refunded — which is the behaviour that makes
// "you are never charged for a blocked number" true even when the block
// arrives after the campaign has started.
export async function settleCampaignRefund(campaignId, reason = 'Refund for unsent campaign messages') {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || !campaign.chargedAt || campaign.refundedAt) return null;

  const perMessage = Number(campaign.costPerMessage || 0);
  const totalCost = Number(campaign.totalCost || 0);
  if (!(perMessage > 0) || !(totalCost > 0)) return null;

  const paidFor = Math.round(totalCost / perMessage);
  // Only a message that actually went out is billable. This used to count any
  // recipient with `failedAt` set as consumed, so a send Meta rejected
  // outright — an unreachable phone number ID, an expired token, a number
  // that isn't on WhatsApp — was charged for in full despite never reaching
  // anyone. Meta itself bills on delivery, so a failure has no cost to pass
  // on. SENT/DELIVERED/READ are exactly the recipients a message left for;
  // FAILED, SKIPPED, PENDING and RETRYING are all refunded.
  const consumed = await prisma.campaignRecipient.count({
    where: { campaignId, status: { in: ['SENT', 'DELIVERED', 'READ'] } },
  });

  const refundable = Math.min(money(Math.max(0, paidFor - consumed) * perMessage), totalCost);
  if (!(refundable > 0)) return null;

  console.log(`[Campaign] Refunding ₹${refundable} to ${campaign.workspaceId} — ${paidFor} paid for, ${consumed} sent (${campaign.name})`);
  return refundCampaign(campaignId, refundable, reason);
}

// Called at startup: re-queue SCHEDULED campaigns whose BullMQ jobs were lost
// (e.g. ephemeral Redis restart). Past-due campaigns fire immediately.
export async function recoverScheduledCampaigns() {
  const scheduled = await prisma.campaign.findMany({
    where: { status: 'SCHEDULED' },
    select: { id: true, workspaceId: true, scheduledAt: true, queueJobId: true },
  });

  let recovered = 0;
  for (const c of scheduled) {
    if (c.queueJobId) {
      const existing = await campaignQueue.getJob(c.queueJobId).catch(() => null);
      if (existing) continue; // job survived — nothing to do
    }
    const delay = Math.max(0, (c.scheduledAt?.getTime() ?? 0) - Date.now());
    const job = await campaignQueue.add('send-campaign', { campaignId: c.id, workspaceId: c.workspaceId }, { delay });
    await prisma.campaign.update({ where: { id: c.id }, data: { queueJobId: String(job.id) } });
    recovered++;
  }
  return recovered;
}
