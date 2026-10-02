import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Routing of verified Razorpay events onto the shared apply* functions. The
// apply functions, the gateway client and notifications are faked.
const calls = [];
let fetchedOrder = null;
mock.module('../lib/razorpay.js', {
  namedExports: {
    getRazorpayClient: () => ({ orders: { fetch: async (id) => { calls.push(['fetch', id]); return fetchedOrder; } } }),
    normalizeRazorpayError: (err) => { throw err; },
  },
});
mock.module('./wallet.service.js', {
  namedExports: {
    applyTopupPayment: async (ws, order, paymentId, source) => {
      calls.push(['topup', ws, paymentId, source]);
      return { alreadyProcessed: false, balance: 100, transaction: { amount: 100 } };
    },
  },
});
mock.module('./subscription.service.js', {
  namedExports: {
    applyCheckoutPayment: async (ws, order, paymentId, source) => {
      calls.push(['plan', ws, paymentId, source]);
      return { applied: 'immediately' };
    },
    retryPastDueRenewal: async (ws) => { calls.push(['retry', ws]); return null; },
  },
});
mock.module('./addons.service.js', {
  namedExports: {
    applyAddonPayment: async (ws, order, paymentId, source) => { calls.push(['addon', ws, paymentId, source]); return {}; },
  },
});
mock.module('./notification.service.js', { namedExports: { notifyWorkspace: async () => {} } });

const { handleRazorpayEvent } = await import('./razorpayWebhook.service.js');

const paymentEvent = (event, { status = 'captured', amount = 10000, order } = {}) => ({
  event,
  payload: {
    payment: { entity: { id: 'pay_1', order_id: 'order_1', status, amount } },
    ...(order ? { order: { entity: order } } : {}),
  },
});
const order = (notes, amount = 10000) => ({ id: 'order_1', amount, currency: 'INR', notes });

test('order.paid for a wallet top-up credits via applyTopupPayment from the signed payload', async () => {
  calls.length = 0;
  const r = await handleRazorpayEvent(paymentEvent('order.paid', { order: order({ workspaceId: 'ws_1', type: 'wallet_topup' }) }));
  assert.equal(r.handled, true);
  assert.deepEqual(calls, [['topup', 'ws_1', 'pay_1', 'WEBHOOK'], ['retry', 'ws_1']]);
});

test('payment.captured reads the order back from the gateway', async () => {
  calls.length = 0;
  fetchedOrder = order({ workspaceId: 'ws_2', type: 'plan', planId: 'plan_basic' });
  const r = await handleRazorpayEvent(paymentEvent('payment.captured'));
  assert.equal(r.kind, 'PLAN');
  assert.deepEqual(calls, [['fetch', 'order_1'], ['plan', 'ws_2', 'pay_1', 'WEBHOOK']]);
});

test('legacy plan orders without a type, and add-on orders, are routed', async () => {
  calls.length = 0;
  await handleRazorpayEvent(paymentEvent('order.paid', { order: order({ workspaceId: 'ws_1', planId: 'p' }) }));
  await handleRazorpayEvent(paymentEvent('order.paid', { order: order({ workspaceId: 'ws_1', type: 'addon', addonKey: 'crm' }) }));
  assert.deepEqual(calls.map((c) => c[0]), ['plan', 'addon']);
});

test('non-captured payments, other events, amount mismatches and unknown orders are ignored', async () => {
  calls.length = 0;
  const topup = order({ workspaceId: 'ws_1', type: 'wallet_topup' });
  assert.equal((await handleRazorpayEvent(paymentEvent('payment.authorized', { order: topup }))).handled, false);
  assert.equal((await handleRazorpayEvent(paymentEvent('order.paid', { status: 'failed', order: topup }))).handled, false);
  assert.equal((await handleRazorpayEvent(paymentEvent('order.paid', { amount: 1, order: topup }))).handled, false);
  assert.equal((await handleRazorpayEvent(paymentEvent('order.paid', { order: order({ type: 'wallet_topup' }) }))).handled, false);
  assert.equal((await handleRazorpayEvent(paymentEvent('order.paid', { order: order({ workspaceId: 'ws_1', type: 'other' }) }))).handled, false);
  assert.equal(calls.length, 0);
});
