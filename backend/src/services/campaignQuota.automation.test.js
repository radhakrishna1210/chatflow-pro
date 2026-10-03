import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Campaign quota reservation vs. automated replies (WF-EV-8).
//
// The audit reported that a campaign launch reserves ALL of the plan's
// remaining included messages, leaving every automated reply (workflow,
// keyword trigger, welcome, AI) to the wallet — on Free, automation stopped
// right after any campaign. The reservation is in fact bounded by the
// campaign's recipient count (reserveCampaignQuota takes
// min(remaining, recipients)), and the unused part goes back when the
// campaign completes, fails or is cancelled, exactly once. These tests pin
// that down end to end against the real metering (consumeMessageCredit) and
// the real settlement (settleCampaignRefund).
//
// What remains true by design: a campaign with more recipients than the plan
// has left does use the rest of the quota (the overflow is charged to the
// wallet at launch), so automated replies after it need wallet balance until
// the campaign settles and returns whatever it did not send.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;

let walletBalance = 0;
mock.module('./wallet.service.js', {
  namedExports: {
    LOW_BALANCE_MESSAGES: 100,
    walletStatus: () => ({}),
    getWallet: async () => ({ balance: walletBalance }),
    credit: async () => ({ ok: true }),
    debit: async (workspaceId, amount) => {
      if (walletBalance < amount) return { ok: false };
      walletBalance -= amount;
      return { ok: true, balance: walletBalance };
    },
    createTopupOrder: async () => ({}),
    verifyTopupPayment: async () => ({}),
    applyTopupPayment: async () => ({}),
    getWalletSummary: async () => ({}),
  },
});
mock.module('../queues/campaign.queue.js', { namedExports: { campaignQueue: { add: async () => ({ id: 'j' }) } } });

const { prisma } = await import('../lib/prisma.js');

const periodStart = new Date('2026-10-01T00:00:00Z');
const FREE = { key: 'FREE', name: 'Free', messageQuota: 100, overageRatePerMsg: 0.02, overageRates: null, features: {} };
let usage;
prisma.subscription.findUnique = async () => ({ workspaceId: 'ws', status: 'ACTIVE', plan: FREE, currentPeriodStart: periodStart, currentPeriodEnd: new Date('2026-10-31T00:00:00Z') });
prisma.usageCounter.upsert = async () => ({ ...usage });
prisma.usageCounter.findUnique = async () => ({ ...usage });
prisma.usageCounter.update = async ({ data }) => { usage.messagesUsed += data.messagesUsed?.increment ?? 0; return { ...usage }; };
prisma.usageCounter.updateMany = async ({ where, data }) => {
  const used = usage.messagesUsed;
  const m = where.messagesUsed;
  const ok = m === undefined
    || (typeof m === 'number' && used === m)
    || (typeof m === 'object' && (m.lt === undefined || used < m.lt) && (m.gte === undefined || used >= m.gte));
  if (!ok) return { count: 0 };
  if (data.messagesUsed?.increment !== undefined) usage.messagesUsed += data.messagesUsed.increment;
  else if (data.messagesUsed?.decrement !== undefined) usage.messagesUsed -= data.messagesUsed.decrement;
  else if (typeof data.messagesUsed === 'number') usage.messagesUsed = data.messagesUsed;
  return { count: 1 };
};
prisma.$transaction = async (fn) => fn(prisma);

const { consumeMessageCredit } = await import('./subscription.service.js');
const { reserveCampaignQuota } = await import('./campaignBilling.service.js');
const { settleCampaignRefund } = await import('./campaigns.service.js');

const automatedReply = () => consumeMessageCredit('ws', { reason: 'Automated reply' });

test('a campaign reserves only as many messages as it has recipients; automated replies keep the rest', async () => {
  usage = { workspaceId: 'ws', periodStart, messagesUsed: 3 };
  walletBalance = 0;
  assert.equal((await automatedReply()).ok, true);

  const { reserved } = await reserveCampaignQuota('ws', 20);
  assert.equal(reserved, 20, 'min(remaining, recipients), not the whole remaining quota');
  assert.equal(usage.messagesUsed, 24);

  const credit = await automatedReply();
  assert.equal(credit.ok, true, 'an automated reply after the launch is still covered by the plan');
  assert.equal(credit.source, 'QUOTA');
});

test('a campaign bigger than what is left takes the rest, and settlement gives back what it did not send — once', async () => {
  usage = { workspaceId: 'ws', periodStart, messagesUsed: 4 };
  walletBalance = 0;
  const { reserved } = await reserveCampaignQuota('ws', 500);
  assert.equal(reserved, 96);
  assert.equal((await automatedReply()).ok, false, 'quota used by the campaign, no wallet: refused until it settles');

  // The campaign is cancelled after 30 sends: 66 quota units come back.
  const campaign = {
    id: 'cmp', workspaceId: 'ws', name: 'Diwali', status: 'CANCELLED', chargedAt: new Date(),
    costPerMessage: 0.8, totalCost: 0, quotaUnits: 96, quotaPeriodStart: periodStart, quotaReleasedAt: null, refundedAt: null,
  };
  prisma.campaign.findUnique = async () => ({ ...campaign });
  prisma.campaign.updateMany = async ({ where, data }) => {
    if (where.quotaReleasedAt === null && campaign.quotaReleasedAt) return { count: 0 };
    if (where.refundedAt === null && campaign.refundedAt) return { count: 0 };
    Object.assign(campaign, data);
    return { count: 1 };
  };
  prisma.campaignRecipient.count = async ({ where }) => (where.billedAt ? 30 : 0);

  await settleCampaignRefund('cmp');
  assert.equal(usage.messagesUsed, 100 - 66);
  assert.ok(campaign.quotaReleasedAt instanceof Date);
  assert.equal((await automatedReply()).ok, true, 'automation is covered by the plan again');

  // A second settlement (recovery sweep, duplicate job) releases nothing more.
  const after = usage.messagesUsed;
  await settleCampaignRefund('cmp');
  assert.equal(usage.messagesUsed, after);
});

test('a failed or completed campaign releases its unused reservation too', async () => {
  for (const status of ['FAILED', 'COMPLETED']) {
    usage = { workspaceId: 'ws', periodStart, messagesUsed: 0 };
    const { reserved } = await reserveCampaignQuota('ws', 50);
    assert.equal(reserved, 50);
    const campaign = {
      id: `c_${status}`, workspaceId: 'ws', name: status, status, chargedAt: new Date(),
      costPerMessage: 0.8, totalCost: 0, quotaUnits: 50, quotaPeriodStart: periodStart, quotaReleasedAt: null, refundedAt: null,
    };
    prisma.campaign.findUnique = async () => ({ ...campaign });
    prisma.campaign.updateMany = async ({ where, data }) => {
      if (where.quotaReleasedAt === null && campaign.quotaReleasedAt) return { count: 0 };
      Object.assign(campaign, data);
      return { count: 1 };
    };
    prisma.campaignRecipient.count = async ({ where }) => (where.billedAt ? 10 : 0);
    await settleCampaignRefund(campaign.id);
    assert.equal(usage.messagesUsed, 10, `${status}: only the 10 sent stay counted`);
  }
});
