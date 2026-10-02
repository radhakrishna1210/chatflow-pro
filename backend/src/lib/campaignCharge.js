// How a campaign's messages are paid for: the plan's remaining message quota
// first, the wallet only for what the quota does not cover — the same order
// an inbox send consumes them in (subscription.service.js#consumeMessageCredit).
//
// Pure arithmetic, shared by the pre-launch estimate, the launch reservation
// and the settlement, so the three can never disagree.

const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

// `remainingQuota` is what the plan still includes this cycle (Infinity for an
// unlimited plan). Returns how many messages ride on the quota, how many are
// charged, and the wallet amount.
export function splitCampaignCharge({ units, remainingQuota, rate }) {
  const total = Math.max(0, Math.floor(Number(units) || 0));
  const quota = remainingQuota === Infinity
    ? total
    : Math.max(0, Math.floor(Number(remainingQuota) || 0));
  const quotaUnits = Math.min(total, quota);
  const walletUnits = total - quotaUnits;
  const perMessage = Number(rate) > 0 ? Number(rate) : 0;
  return { quotaUnits, walletUnits, totalCost: money(walletUnits * perMessage) };
}

// What goes back once a campaign is finished. Messages actually sent consume
// the quota share first (it is free to the customer), so whatever was not sent
// returns as money before it returns as quota.
export function settleCampaignUnits({ walletUnits, quotaUnits, billed }) {
  const wallet = Math.max(0, Math.floor(Number(walletUnits) || 0));
  const quota = Math.max(0, Math.floor(Number(quotaUnits) || 0));
  const sent = Math.max(0, Math.floor(Number(billed) || 0));
  const quotaUsed = Math.min(sent, quota);
  const walletUsed = Math.min(wallet, sent - quotaUsed);
  return {
    walletRefundUnits: wallet - walletUsed,
    quotaReleaseUnits: quota - quotaUsed,
  };
}
