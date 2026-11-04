// The Razorpay webhook, end to end through the controller, against the real
// database: the guarantee under test is that the webhook and the browser's
// verify call — in either order, concurrently, or with the webhook delivered
// twice — credit a payment exactly once, and that is a property of row locks,
// advisory locks and unique keys, which a mocked Prisma would not exercise.
// Only the Razorpay API client is faked (orders.fetch).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const fakeOrders = new Map();
let prisma; let env; let wallet; let addons; let subscription; let controller;
let dbAvailable = false;
let workspaceId;
const stamp = Date.now();
const WEBHOOK_SECRET = 'whsec_test_razorpay';

before(async () => {
  ({ prisma } = await import('../lib/prisma.js'));
  try { await prisma.$connect(); await prisma.$queryRaw`SELECT 1`; dbAvailable = true; } catch { return; }
  ({ env } = await import('../config/env.js'));
  env.RAZORPAY_KEY_ID = env.RAZORPAY_KEY_ID || 'rzp_test_key';
  env.RAZORPAY_KEY_SECRET = 'test_secret_for_signatures';
  env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const razorpay = await import('../lib/razorpay.js');
  razorpay.getRazorpayClient().orders = { fetch: async (id) => fakeOrders.get(id) };

  wallet = await import('./wallet.service.js');
  addons = await import('./addons.service.js');
  subscription = await import('./subscription.service.js');
  controller = await import('../controllers/razorpayWebhook.controller.js');

  const ws = await prisma.workspace.create({ data: { name: `test-rzp-webhook-${stamp}`, walletBalance: 0, costPerMessage: 1 } });
  workspaceId = ws.id;
});

after(async () => {
  if (workspaceId) {
    await prisma.invoice.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  }
  await prisma?.$disconnect().catch(() => {});
});

const balance = async () => Number((await prisma.workspace.findUnique({ where: { id: workspaceId } })).walletBalance);
const checkoutSig = (orderId, paymentId) => createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

let seq = 0;
function topupOrder(amountPaise = 50000) {
  seq += 1;
  const orderId = `order_wh_${stamp}_${seq}`;
  const paymentId = `pay_wh_${stamp}_${seq}`;
  fakeOrders.set(orderId, { id: orderId, amount: amountPaise, currency: 'INR', status: 'paid', notes: { workspaceId, type: 'wallet_topup' } });
  return { orderId, paymentId };
}

// Calls the controller the way Express would after express.json() kept the raw bytes.
async function deliver(payload, { secret = WEBHOOK_SECRET, signature } = {}) {
  const raw = Buffer.from(JSON.stringify(payload));
  const sig = signature ?? createHmac('sha256', secret).update(raw).digest('hex');
  const req = { rawBody: raw, body: JSON.parse(raw.toString()), get: (h) => (h.toLowerCase() === 'x-razorpay-signature' ? sig : undefined) };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await controller.receive(req, res);
  return res;
}

const capturedEvent = (orderId, paymentId, amount = 1) => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id: paymentId, order_id: orderId, status: 'captured', amount } } },
});
const orderPaidEvent = (orderId, paymentId, amount = 1) => ({
  event: 'order.paid',
  payload: {
    payment: { entity: { id: paymentId, order_id: orderId, status: 'captured', amount } },
    order: { entity: { id: orderId, amount, status: 'paid' } },
  },
});

test('a valid payment.captured credits the stored order amount once', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const before = await balance();
  const { orderId, paymentId } = topupOrder(50000);
  // The webhook body claims ₹99,999; the stored order (₹500) is what counts.
  const res = await deliver(capturedEvent(orderId, paymentId, 9_999_900));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.outcome, 'credited');
  assert.equal(await balance(), before + 500);
  assert.equal(await prisma.invoice.count({ where: { workspaceId, reference: paymentId } }), 1);
});

test('duplicate delivery (and payment.captured + order.paid for one payment) credits once', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const before = await balance();
  const { orderId, paymentId } = topupOrder(20000);
  const results = await Promise.all([
    deliver(capturedEvent(orderId, paymentId)),
    deliver(capturedEvent(orderId, paymentId)),
    deliver(orderPaidEvent(orderId, paymentId)),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode), [200, 200, 200]);
  assert.equal(results.filter((r) => r.body.outcome === 'credited').length, 1);
  await deliver(orderPaidEvent(orderId, paymentId));
  assert.equal(await balance(), before + 200);
  assert.equal(await prisma.walletTransaction.count({ where: { workspaceId, reference: paymentId } }), 1);
  assert.equal(await prisma.invoice.count({ where: { workspaceId, reference: paymentId } }), 1);
});

test('verify then webhook credits once', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const before = await balance();
  const { orderId, paymentId } = topupOrder(10000);
  const v = await wallet.verifyTopupPayment(workspaceId, { orderId, paymentId, signature: checkoutSig(orderId, paymentId) });
  assert.equal(v.alreadyProcessed, false);
  const res = await deliver(capturedEvent(orderId, paymentId));
  assert.equal(res.body.outcome, 'already_processed');
  assert.equal(await balance(), before + 100);
});

test('webhook then verify credits once', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const before = await balance();
  const { orderId, paymentId } = topupOrder(10000);
  assert.equal((await deliver(orderPaidEvent(orderId, paymentId))).body.outcome, 'credited');
  const v = await wallet.verifyTopupPayment(workspaceId, { orderId, paymentId, signature: checkoutSig(orderId, paymentId) });
  assert.equal(v.alreadyProcessed, true);
  assert.equal(await balance(), before + 100);
});

test('webhook and verify at the same moment credit once', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const before = await balance();
  const { orderId, paymentId } = topupOrder(30000);
  await Promise.all([
    deliver(capturedEvent(orderId, paymentId)),
    wallet.verifyTopupPayment(workspaceId, { orderId, paymentId, signature: checkoutSig(orderId, paymentId) }),
    deliver(orderPaidEvent(orderId, paymentId)),
  ]);
  assert.equal(await balance(), before + 300);
  assert.equal(await prisma.invoice.count({ where: { workspaceId, reference: paymentId } }), 1);
});

test('add-on: webhook then verify activates once and writes one invoice', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  seq += 1;
  const orderId = `order_wh_addon_${stamp}`; const paymentId = `pay_wh_addon_${stamp}`;
  fakeOrders.set(orderId, { id: orderId, amount: 49900, currency: 'INR', notes: { workspaceId, type: 'addon', addonKey: 'fields' } });
  assert.equal((await deliver(capturedEvent(orderId, paymentId))).body.outcome, 'credited');
  const first = await prisma.workspaceAddon.findUnique({ where: { workspaceId_addonKey: { workspaceId, addonKey: 'fields' } } });
  const v = await addons.verifyAddonPayment(workspaceId, { orderId, paymentId, signature: checkoutSig(orderId, paymentId) });
  assert.equal(v.alreadyProcessed, true);
  const second = await prisma.workspaceAddon.findUnique({ where: { workspaceId_addonKey: { workspaceId, addonKey: 'fields' } } });
  assert.equal(second.currentPeriodEnd.getTime(), first.currentPeriodEnd.getTime());
  assert.equal(await prisma.invoice.count({ where: { workspaceId, reference: paymentId } }), 1);
});

test('plan: verify then webhook applies once', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const plan = await prisma.plan.findFirst({ where: { isActive: true } });
  if (!plan) return t.skip('no plan seeded');
  await prisma.subscription.upsert({
    where: { workspaceId },
    update: {},
    create: { workspaceId, planId: plan.id, status: 'ACTIVE', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86_400_000) },
  });
  const orderId = `order_wh_plan_${stamp}`; const paymentId = `pay_wh_plan_${stamp}`;
  fakeOrders.set(orderId, { id: orderId, amount: 99900, currency: 'INR', notes: { workspaceId, planId: plan.id, cycle: 'monthly' } });
  const v = await subscription.verifyCheckoutPayment(workspaceId, { orderId, paymentId, signature: checkoutSig(orderId, paymentId) });
  assert.equal(v.applied, 'immediately');
  const res = await deliver(orderPaidEvent(orderId, paymentId));
  assert.equal(res.body.outcome, 'already_processed');
  assert.equal(await prisma.invoice.count({ where: { workspaceId, reference: paymentId } }), 1);
});

test('a bad signature is refused with 401 and credits nothing', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const before = await balance();
  const { orderId, paymentId } = topupOrder(10000);
  assert.equal((await deliver(capturedEvent(orderId, paymentId), { secret: 'wrong_secret' })).statusCode, 401);
  assert.equal((await deliver(capturedEvent(orderId, paymentId), { signature: '' })).statusCode, 401);
  assert.equal((await deliver(capturedEvent(orderId, paymentId), { signature: 'abc' })).statusCode, 401);
  assert.equal(await balance(), before);
});

test('with no webhook secret configured every call is refused with 503', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const before = await balance();
  const { orderId, paymentId } = topupOrder(10000);
  env.RAZORPAY_WEBHOOK_SECRET = '';
  try {
    // Even one "signed" with an empty secret.
    const res = await deliver(capturedEvent(orderId, paymentId), { secret: '' });
    assert.equal(res.statusCode, 503);
  } finally { env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET; }
  assert.equal(await balance(), before);
});

test('unknown events and orders that are not ours are acknowledged with 200 and change nothing', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const before = await balance();
  const unknown = await deliver({ event: 'refund.created', payload: {} });
  assert.equal(unknown.statusCode, 200);
  assert.equal(unknown.body.outcome, 'ignored');
  fakeOrders.set('order_foreign', { id: 'order_foreign', amount: 100, currency: 'INR', notes: {} });
  const foreign = await deliver(capturedEvent('order_foreign', `pay_foreign_${stamp}`));
  assert.equal(foreign.statusCode, 200);
  assert.equal(foreign.body.outcome, 'ignored');
  assert.equal(await balance(), before);
});
