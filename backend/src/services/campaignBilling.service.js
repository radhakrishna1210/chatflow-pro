// Per-recipient billing for campaign sends.
//
// The unit of billing is the *recipient*, not the send attempt. A message that
// took four retries to deliver is charged once; one that never delivered is
// charged nothing. That cannot be expressed by counting attempts, because a
// retry is a second attempt at the same billable thing.
//
// How the money actually moves:
//
//   launch      campaigns.service reserves the plan's remaining quota for as
//               many recipients as it covers, debits `the rest x category
//               rate`, and stamps Campaign.chargedAt. This is a *reservation* — it
//               guarantees a campaign can never strand mid-flight for lack of
//               funds, which is why it is taken before anything is sent.
//   per send    a recipient that reaches Meta claims its share of that
//               reservation here, exactly once.
//   settlement  when the campaign reaches a terminal state, the unclaimed
//               remainder goes back to the wallet (settleCampaignRefund).
//
// So the net charge equals the number of recipients that were actually sent,
// and every rule holds: failures cost nothing, permanent failures cost
// nothing, and no recipient is ever charged twice.
//
// Reserving at launch rather than charging on delivery is a deliberate choice,
// reaffirmed 2026-08-06: it is what guarantees a campaign cannot strand
// mid-flight for lack of funds. The visible cost is that a wallet dips at
// launch and partially returns at completion, which reads like a bug but is
// not. Switching to charge-on-delivery is a small change now that this ledger
// exists — the reservation and the settlement are the only two pieces to drop.

import { prisma } from '../lib/prisma.js';
import { messageRate } from '../lib/messagePricing.js';

// Keeps a 24-hour hourly retry pattern from growing the row unboundedly.
const MAX_HISTORY_ENTRIES = 10;

// The rate this campaign was quoted at. Campaign.costPerMessage is written at
// launch and is authoritative: Meta can re-categorise a template afterwards
// (webhook.service.js), and a customer must not be billed at a rate they were
// never shown. The category lookup is only the fallback for campaigns that
// predate that column.
export function campaignRate(campaign) {
  const locked = Number(campaign?.costPerMessage);
  if (Number.isFinite(locked) && locked > 0) return locked;
  return messageRate(null, campaign?.template?.category);
}

// The per-message rate a campaign is quoted and launched at: the same
// messageRate() inbox overage and wallet health use, on this workspace's plan,
// so a template costs the same as a campaign as it does from the inbox.
export async function campaignMessageRate(workspaceId, category) {
  const subscription = await prisma.subscription.findUnique({ where: { workspaceId }, include: { plan: true } });
  return messageRate(subscription?.plan ?? null, category);
}

// Claims the charge for one recipient. THE idempotency guard for the whole
// billing system: `billedAt: null` in the WHERE means the first writer wins
// and every subsequent caller — a duplicate retry job, a redelivered BullMQ
// message, a worker that restarted mid-send — gets `false` and charges
// nothing. Returns whether *this* call is the one that billed it.
export async function claimRecipientCharge(campaign, recipient) {
  const amount = campaignRate(campaign);
  const category = campaign?.template?.category ?? null;

  const claimed = await prisma.campaignRecipient.updateMany({
    where: { id: recipient.id, billedAt: null },
    data: {
      billedAt: new Date(),
      billedAmount: amount,
      billingStatus: 'CHARGED',
      messageCategory: category,
    },
  });

  return { billed: claimed.count > 0, amount, category };
}

// Records that a recipient reached a terminal state without ever being
// delivered. Never overwrites a charge: a recipient that was sent and then
// failed a later delivery webhook keeps its CHARGED mark, because the message
// did leave for Meta and the reservation was legitimately consumed.
export async function markRecipientNotCharged(recipientId) {
  await prisma.campaignRecipient.updateMany({
    where: { id: recipientId, billedAt: null },
    data: { billingStatus: 'NOT_CHARGED' },
  });
}

// Appends one attempt to the recipient's retry history. Read-modify-write
// rather than a JSON append because Prisma has no array-push for Json columns;
// the row is only ever touched by the single job that owns that attempt, so
// the read-modify-write is not contended.
export async function recordAttempt(recipientId, entry) {
  const current = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    select: { retryHistory: true },
  });
  const history = Array.isArray(current?.retryHistory) ? current.retryHistory : [];
  history.push({ at: new Date().toISOString(), ...entry });
  await prisma.campaignRecipient.update({
    where: { id: recipientId },
    data: { retryHistory: history.slice(-MAX_HISTORY_ENTRIES) },
  }).catch((err) => console.error(`[CampaignBilling] Could not record attempt history for recipient ${recipientId}:`, err.message));
}

// How many recipients of a campaign have actually been billed. This is what
// settlement refunds against — counting rows with a charge claimed, rather
// than re-deriving from delivery status, so the refund can never disagree
// with what was charged.
export async function billedCount(campaignId) {
  return prisma.campaignRecipient.count({ where: { campaignId, billedAt: { not: null } } });
}

// ─── Plan quota for campaigns ────────────────────────────────────────────────
// A campaign reserves the plan's remaining included messages at launch, and
// the wallet is charged only for the rest (lib/campaignCharge.js). Reserved
// quota is counted in UsageCounter.messagesUsed straight away, so a launch and
// a concurrent inbox send cannot both spend the same allowance; the worker
// therefore never meters quota again for a prepaid campaign.

const QUOTA_STATUSES = ['ACTIVE', 'PAST_DUE'];
const MAX_RESERVE_ATTEMPTS = 5;

async function quotaContext(workspaceId) {
  const subscription = await prisma.subscription.findUnique({ where: { workspaceId }, include: { plan: true } });
  if (!subscription || !QUOTA_STATUSES.includes(subscription.status) || !subscription.plan) return null;
  const { plan, currentPeriodStart, currentPeriodEnd } = subscription;
  const usage = await prisma.usageCounter.upsert({
    where: { workspaceId_periodStart: { workspaceId, periodStart: currentPeriodStart } },
    update: {},
    create: { workspaceId, periodStart: currentPeriodStart, periodEnd: currentPeriodEnd, messagesUsed: 0 },
  });
  const quota = Number(plan.messageQuota);
  const remaining = quota === -1 ? Infinity : Math.max(0, quota - usage.messagesUsed);
  return { periodStart: currentPeriodStart, used: usage.messagesUsed, quota, remaining };
}

// Read-only: what the plan still includes this cycle. 0 without an active
// subscription.
export async function getRemainingQuota(workspaceId) {
  const ctx = await quotaContext(workspaceId);
  return { remaining: ctx ? ctx.remaining : 0, periodStart: ctx?.periodStart ?? null };
}

// Reserves up to `units` of the remaining quota. Compare-and-set on the exact
// counter value, so a concurrent send between the read and the write makes
// this attempt lose and re-read rather than overspend the allowance.
export async function reserveCampaignQuota(workspaceId, units) {
  const wanted = Math.max(0, Math.floor(Number(units) || 0));
  if (wanted === 0) return { reserved: 0, periodStart: null };

  for (let attempt = 0; attempt < MAX_RESERVE_ATTEMPTS; attempt += 1) {
    const ctx = await quotaContext(workspaceId);
    if (!ctx || ctx.remaining <= 0) return { reserved: 0, periodStart: null };
    const take = ctx.remaining === Infinity ? wanted : Math.min(wanted, ctx.remaining);
    const claimed = await prisma.usageCounter.updateMany({
      where: { workspaceId, periodStart: ctx.periodStart, messagesUsed: ctx.used },
      data: { messagesUsed: { increment: take } },
    });
    if (claimed.count > 0) return { reserved: take, periodStart: ctx.periodStart };
  }
  // Persistent contention: fall back to charging the wallet for everything,
  // which is never wrong, only less generous.
  return { reserved: 0, periodStart: null };
}

// Gives reserved quota back to the cycle it was taken from. A cycle that has
// since rolled over is decremented too, which is harmless: it no longer
// authorises anything.
export async function releaseCampaignQuota(workspaceId, periodStart, units) {
  const n = Math.max(0, Math.floor(Number(units) || 0));
  if (!n || !periodStart) return { released: 0 };
  const done = await prisma.usageCounter.updateMany({
    where: { workspaceId, periodStart, messagesUsed: { gte: n } },
    data: { messagesUsed: { decrement: n } },
  });
  if (done.count > 0) return { released: n };
  // Never below zero.
  await prisma.usageCounter.updateMany({
    where: { workspaceId, periodStart, messagesUsed: { lt: n } },
    data: { messagesUsed: 0 },
  });
  return { released: n };
}
