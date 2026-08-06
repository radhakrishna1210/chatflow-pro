// Per-recipient billing for campaign sends.
//
// The unit of billing is the *recipient*, not the send attempt. A message that
// took four retries to deliver is charged once; one that never delivered is
// charged nothing. That cannot be expressed by counting attempts, because a
// retry is a second attempt at the same billable thing.
//
// How the money actually moves:
//
//   launch      campaigns.service debits `valid recipients x category rate`
//               and stamps Campaign.chargedAt. This is a *reservation* — it
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

import { prisma } from '../lib/prisma.js';
import { rateForCategory } from '../lib/messagePricing.js';

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
  return rateForCategory(campaign?.template?.category, 0);
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
  }).catch(() => {});
}

// How many recipients of a campaign have actually been billed. This is what
// settlement refunds against — counting rows with a charge claimed, rather
// than re-deriving from delivery status, so the refund can never disagree
// with what was charged.
export async function billedCount(campaignId) {
  return prisma.campaignRecipient.count({ where: { campaignId, billedAt: { not: null } } });
}
