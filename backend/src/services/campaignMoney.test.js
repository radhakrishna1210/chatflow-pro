// Money and lifecycle invariants of campaigns, the wallet and gateway
// verification, exercised against the real database (row locks, unique keys
// and advisory locks are the whole point, so a mocked Prisma would prove
// nothing). Only the BullMQ queue and the Razorpay client are faked: a real
// queue would hand these campaigns to the dev server's live worker.
//
// Everything lives in a throwaway workspace that is deleted afterwards.
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const queued = [];
let failNextAdd = false;
const fakeOrders = new Map();

let prisma; let wallet; let campaigns; let addons; let razorpay; let env;
let dbAvailable = false;
let workspaceId; let templateId; let waNumberId;
const stamp = Date.now();

before(async () => {
  mock.module('../queues/campaign.queue.js', {
    namedExports: {
      campaignQueue: {
        add: async (name, data, opts) => {
          if (failNextAdd) { failNextAdd = false; throw new Error('redis down'); }
          const job = { id: `job${queued.length + 1}`, name, data, opts };
          queued.push(job);
          return job;
        },
        getJob: async () => null,
        getJobs: async () => [],
      },
    },
  });
  ({ prisma } = await import('../lib/prisma.js'));
  try { await prisma.$connect(); await prisma.$queryRaw`SELECT 1`; dbAvailable = true; } catch { return; }

  ({ env } = await import('../config/env.js'));
  env.RAZORPAY_KEY_ID = env.RAZORPAY_KEY_ID || 'rzp_test_key';
  env.RAZORPAY_KEY_SECRET = 'test_secret_for_signatures';
  razorpay = await import('../lib/razorpay.js');
  // The one gateway call verification makes: read the order back.
  razorpay.getRazorpayClient().orders = { fetch: async (id) => fakeOrders.get(id) };

  wallet = await import('./wallet.service.js');
  campaigns = await import('./campaigns.service.js');
  addons = await import('./addons.service.js');

  const ws = await prisma.workspace.create({ data: { name: `test-money-${stamp}`, walletBalance: 0, costPerMessage: 1 } });
  workspaceId = ws.id;
  const tpl = await prisma.template.create({
    data: {
      workspaceId, name: `tpl_${stamp}`, category: 'UTILITY', language: 'en', status: 'APPROVED',
      components: [{ type: 'BODY', text: 'Hello {{1}}' }],
    },
  });
  templateId = tpl.id;
  const wa = await prisma.waNumber.create({
    data: { workspaceId, phoneNumber: '+10000000000', metaPhoneNumberId: `pn${stamp}`, wabaId: 'w', encryptedAccessToken: 'x' },
  });
  waNumberId = wa.id;
});

after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  await prisma?.$disconnect().catch(() => {});
});

const balance = async () => Number((await prisma.workspace.findUnique({ where: { id: workspaceId } })).walletBalance);
const setBalance = (v) => prisma.workspace.update({ where: { id: workspaceId }, data: { walletBalance: v } });

let phoneSeq = 0;
async function makeCampaign(phones) {
  const campaign = await prisma.campaign.create({
    data: { workspaceId, name: `c${stamp}_${phoneSeq}`, templateId, waNumberId, status: 'DRAFT' },
  });
  for (const phone of phones) {
    phoneSeq += 1;
    const contact = await prisma.contact.create({ data: { workspaceId, name: `p${phoneSeq}`, phoneNumber: phone ?? `+9198${String(stamp).slice(-6)}${String(phoneSeq).padStart(2, '0')}` } });
    await prisma.campaignRecipient.create({ data: { campaignId: campaign.id, contactId: contact.id } });
  }
  return campaign;
}

test('concurrent debits never overspend the wallet and the ledger chains', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await setBalance(100);
  const results = await Promise.all(Array.from({ length: 15 }, (_, i) =>
    wallet.debit(workspaceId, 10, { reason: `race ${i}` })));
  assert.equal(results.filter((r) => r.ok).length, 10);
  assert.equal(await balance(), 0);
  const rows = await prisma.walletTransaction.findMany({ where: { workspaceId, reason: { startsWith: 'race' } } });
  assert.equal(rows.length, 10);
  for (const row of rows) assert.equal(Number(row.balanceBefore) - Number(row.amount), Number(row.balanceAfter));
});

test('a credit replayed concurrently with one idempotency key lands once', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await setBalance(0);
  const results = await Promise.all(Array.from({ length: 5 }, () =>
    wallet.credit(workspaceId, 50, { idempotencyKey: `test_dup_${stamp}` })));
  assert.equal(results.filter((r) => !r.alreadyProcessed).length, 1);
  assert.equal(await balance(), 50);
});

test('two contacts with one phone number are sent and priced once', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await setBalance(100);
  const shared = `+9177${String(stamp).slice(-8)}`;
  const campaign = await makeCampaign([shared, shared.replace('+', ''), null]);
  const launched = await campaigns.launchCampaign(workspaceId, campaign.id);
  assert.equal(launched.summary.validContacts, 2);
  const rows = await prisma.campaignRecipient.findMany({ where: { campaignId: campaign.id } });
  const pending = rows.filter((r) => r.status === 'PENDING');
  assert.equal(pending.length, 2, 'the duplicate must not stay PENDING for the worker to send');
  assert.equal(rows.filter((r) => r.status === 'SKIPPED' && r.failReason === 'Duplicate phone number').length, 1);
  assert.equal(await balance(), 100 - 2 * 0.16);
});

test('a charged campaign cannot have its audience or template changed', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await setBalance(100);
  const campaign = await makeCampaign([null]);
  await campaigns.launchCampaign(workspaceId, campaign.id);
  // Immediate launch: still DRAFT until the worker picks the job up.
  assert.equal((await prisma.campaign.findUnique({ where: { id: campaign.id } })).status, 'DRAFT');
  const extra = await prisma.contact.create({ data: { workspaceId, name: 'late', phoneNumber: `+9166${String(stamp).slice(-8)}` } });
  await assert.rejects(campaigns.addRecipients(workspaceId, campaign.id, [extra.id]), { status: 409 });
  await assert.rejects(campaigns.setRecipients(workspaceId, campaign.id, [extra.id]), { status: 409 });
  await assert.rejects(campaigns.updateCampaign(workspaceId, campaign.id, { templateId }), { status: 409 });
});

test('double launch charges once', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await setBalance(100);
  const campaign = await makeCampaign([null, null]);
  const results = await Promise.allSettled([
    campaigns.launchCampaign(workspaceId, campaign.id),
    campaigns.launchCampaign(workspaceId, campaign.id),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await balance(), 100 - 2 * 0.16);
});

test('a launch that could not be queued is refunded and charged again on relaunch', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await setBalance(10);
  const campaign = await makeCampaign([null]);
  failNextAdd = true;
  await assert.rejects(campaigns.launchCampaign(workspaceId, campaign.id), /redis down/);
  assert.equal(await balance(), 10);
  const reverted = await prisma.campaign.findUnique({ where: { id: campaign.id } });
  assert.equal(reverted.chargedAt, null);
  assert.equal(reverted.refundedAt, null);

  await campaigns.launchCampaign(workspaceId, campaign.id);
  assert.equal(await balance(), 10 - 0.16, 'the relaunch must actually be charged');

  // And its eventual settlement must still refund what is never sent.
  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'RUNNING' } });
  await campaigns.cancelCampaign(workspaceId, campaign.id);
  assert.equal(await balance(), 10);
});

test('pause parks waiting retries and resume always queues a resumable job', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await setBalance(100);
  const campaign = await makeCampaign([null, null]);
  await campaigns.launchCampaign(workspaceId, campaign.id);
  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'RUNNING' } });
  const [first] = await prisma.campaignRecipient.findMany({ where: { campaignId: campaign.id } });
  await prisma.campaignRecipient.update({ where: { id: first.id }, data: { status: 'RETRYING', retryStatus: 'SCHEDULED', retryCount: 1 } });

  await campaigns.pauseCampaign(workspaceId, campaign.id);
  const parked = await prisma.campaignRecipient.findUnique({ where: { id: first.id } });
  assert.equal(parked.status, 'PENDING');
  assert.equal(parked.retryCount, 1);

  const before = queued.length;
  await campaigns.resumeCampaign(workspaceId, campaign.id);
  assert.equal(queued.length, before + 1);
  assert.equal(queued.at(-1).data.resume, true, 'without resume:true the worker refuses a RUNNING campaign');
  await assert.rejects(campaigns.resumeCampaign(workspaceId, campaign.id), { status: 400 });
});

test('pause never overwrites a campaign that already finished', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const campaign = await makeCampaign([null]);
  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'COMPLETED' } });
  await assert.rejects(campaigns.pauseCampaign(workspaceId, campaign.id), { status: 400 });
  await assert.rejects(campaigns.cancelCampaign(workspaceId, campaign.id), { status: 400 });
  assert.equal((await prisma.campaign.findUnique({ where: { id: campaign.id } })).status, 'COMPLETED');
});

const sign = (orderId, paymentId) => createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

test('payment signatures are checked exactly, in constant time, and fail closed', (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const good = sign('order_1', 'pay_1');
  assert.equal(razorpay.verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: good }), true);
  assert.equal(razorpay.verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_2', signature: good }), false);
  assert.equal(razorpay.verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: good.slice(1) }), false);
  assert.equal(razorpay.verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: undefined }), false);
  const secret = env.RAZORPAY_KEY_SECRET;
  env.RAZORPAY_KEY_SECRET = '';
  try {
    assert.equal(razorpay.verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: good }), false);
  } finally { env.RAZORPAY_KEY_SECRET = secret; }
});

test('a wallet top-up verified twice (even concurrently) credits once', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await setBalance(0);
  const orderId = `order_top_${stamp}`; const paymentId = `pay_top_${stamp}`;
  fakeOrders.set(orderId, { id: orderId, amount: 25000, currency: 'INR', notes: { workspaceId, type: 'wallet_topup' } });
  const body = { orderId, paymentId, signature: sign(orderId, paymentId) };
  await Promise.all([wallet.verifyTopupPayment(workspaceId, body), wallet.verifyTopupPayment(workspaceId, body)]);
  assert.equal(await balance(), 250);
  await assert.rejects(wallet.verifyTopupPayment(workspaceId, { ...body, signature: sign(orderId, 'pay_forged') }), { status: 400 });
});

test('an add-on payment cannot be replayed to re-activate an expired add-on', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const orderId = `order_addon_${stamp}`; const paymentId = `pay_addon_${stamp}`;
  fakeOrders.set(orderId, { id: orderId, amount: 49900, currency: 'INR', notes: { workspaceId, type: 'addon', addonKey: 'fields' } });
  const body = { orderId, paymentId, signature: sign(orderId, paymentId) };

  const [a, b] = await Promise.all([addons.verifyAddonPayment(workspaceId, body), addons.verifyAddonPayment(workspaceId, body)]);
  assert.equal([a, b].filter((r) => r.alreadyProcessed).length, 1);
  assert.equal(await prisma.invoice.count({ where: { workspaceId, reference: paymentId } }), 1);

  // A month later the add-on has lapsed; the same, still-valid signature is sent again.
  const lapsed = new Date(Date.now() - 1000);
  await prisma.workspaceAddon.update({ where: { workspaceId_addonKey: { workspaceId, addonKey: 'fields' } }, data: { currentPeriodEnd: lapsed } });
  await addons.verifyAddonPayment(workspaceId, body);
  const row = await prisma.workspaceAddon.findUnique({ where: { workspaceId_addonKey: { workspaceId, addonKey: 'fields' } } });
  assert.equal(row.currentPeriodEnd.getTime(), lapsed.getTime(), 'replay must not extend the add-on');
});

test('concurrent first requests of a billing period all get one usage counter', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const { getActiveSubscription, consumeMessageCredit } = await import('./subscription.service.js');
  const plan = await prisma.plan.findFirst({ where: { messageQuota: { gt: 0 } } });
  const start = new Date(Date.now() - 1000);
  await prisma.subscription.upsert({
    where: { workspaceId },
    update: { planId: plan.id, currentPeriodStart: start, currentPeriodEnd: new Date(Date.now() + 86_400_000), status: 'ACTIVE' },
    create: { workspaceId, planId: plan.id, status: 'ACTIVE', currentPeriodStart: start, currentPeriodEnd: new Date(Date.now() + 86_400_000) },
  });
  const results = await Promise.allSettled([
    ...Array.from({ length: 8 }, () => getActiveSubscription(workspaceId)),
    ...Array.from({ length: 4 }, () => consumeMessageCredit(workspaceId, { prepaid: true })),
  ]);
  assert.deepEqual(results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message), []);
  const rows = await prisma.usageCounter.findMany({ where: { workspaceId, periodStart: start } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].messagesUsed, 4);
});
