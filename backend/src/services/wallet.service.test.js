import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// The wallet ledger's money rules against an in-memory Prisma: balance only
// moves inside the locked transaction, idempotency keys make replays no-ops,
// a debit never overdraws, and top-ups trust the gateway's order, not the
// client. No database.

const db = { balance: 0, ledger: [], failNextCreate: null };
const findByKey = (key) => db.ledger.find((r) => r.idempotencyKey === key) ?? null;

const tx = {
  $queryRaw: async () => [{ walletBalance: db.balance }],
  workspace: {
    findUnique: async () => ({ walletBalance: db.balance }),
    update: async ({ data }) => { db.balance = data.walletBalance; },
  },
  walletTransaction: {
    findUnique: async ({ where }) => findByKey(where.idempotencyKey),
    create: async ({ data }) => {
      if (db.failNextCreate) {
        const err = db.failNextCreate;
        db.failNextCreate = null;
        throw err;
      }
      const row = { id: `t${db.ledger.length + 1}`, createdAt: new Date(), ...data };
      db.ledger.push(row);
      return row;
    },
  },
  invoice: { create: async () => {} },
};

// Interactive transactions roll back on throw: snapshot and restore.
const prisma = {
  ...tx,
  async $transaction(fn) {
    const snapshot = { balance: db.balance, ledger: [...db.ledger] };
    try {
      return await fn(tx);
    } catch (err) {
      db.balance = snapshot.balance;
      db.ledger = snapshot.ledger;
      throw err;
    }
  },
};

let signatureOk = true;
let gatewayOrder = null;
mock.module('../lib/prisma.js', { namedExports: { prisma } });
mock.module('../config/env.js', { namedExports: { env: { RAZORPAY_KEY_ID: 'rzp_test' } } });
mock.module('../lib/razorpay.js', {
  namedExports: {
    getRazorpayClient: () => ({ orders: { fetch: async () => gatewayOrder } }),
    verifyPaymentSignature: () => signatureOk,
    normalizeRazorpayError: (err) => { throw err; },
  },
});
mock.module('./gatewayPayment.service.js', {
  namedExports: {
    applyGatewayPaymentOnce: async (_payment, apply) => ({ duplicate: false, result: await prisma.$transaction(apply) }),
  },
});

const wallet = await import('./wallet.service.js');

function reset(balance = 0) {
  db.balance = balance;
  db.ledger = [];
  db.failNextCreate = null;
  signatureOk = true;
  gatewayOrder = null;
}

test('credit adds to the balance and records before/after on the ledger row', async () => {
  reset(10);
  const res = await wallet.credit('ws1', 5.255, { idempotencyKey: 'pay_1', reference: 'pay_1' });
  assert.equal(res.alreadyProcessed, false);
  assert.equal(res.balance, 15.26);
  assert.equal(db.balance, 15.26);
  assert.equal(db.ledger.length, 1);
  assert.deepEqual(
    [res.transaction.type, res.transaction.balanceBefore, res.transaction.balanceAfter],
    ['CREDIT', 10, 15.26],
  );
});

test('a replayed credit with the same idempotency key does not credit twice', async () => {
  reset(0);
  await wallet.credit('ws1', 100, { idempotencyKey: 'rzp_topup_pay_9' });
  const replay = await wallet.credit('ws1', 100, { idempotencyKey: 'rzp_topup_pay_9' });
  assert.equal(replay.alreadyProcessed, true);
  assert.equal(db.balance, 100);
  assert.equal(db.ledger.length, 1);
});

test('losing the unique-key race converges on the winner instead of failing', async () => {
  reset(50);
  // The concurrent request committed first: its row exists, ours hits P2002.
  const winner = { id: 'w', idempotencyKey: 'campaign_c1', type: 'DEBIT', amount: 20, balanceAfter: 30, createdAt: new Date() };
  db.failNextCreate = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  const origFind = tx.walletTransaction.findUnique;
  let lookups = 0;
  tx.walletTransaction.findUnique = async (args) => {
    lookups += 1;
    // First lookup (inside the tx) misses; the post-conflict lookup finds the winner.
    return lookups === 1 ? null : winner;
  };
  try {
    const res = await wallet.debit('ws1', 20, { idempotencyKey: 'campaign_c1' });
    assert.equal(res.ok, true);
    assert.equal(res.alreadyProcessed, true);
    assert.equal(res.transaction.id, 'w');
    assert.equal(db.balance, 50, 'our attempt was rolled back');
  } finally {
    tx.walletTransaction.findUnique = origFind;
  }
});

test('a P2002 without an idempotency key is not swallowed', async () => {
  reset(50);
  db.failNextCreate = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  await assert.rejects(() => wallet.debit('ws1', 5), /Unique constraint/);
  assert.equal(db.balance, 50);
});

test('debit refuses to overdraw and writes nothing', async () => {
  reset(9.99);
  const res = await wallet.debit('ws1', 10, { idempotencyKey: 'campaign_c2' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'Insufficient balance');
  assert.equal(res.required, 10);
  assert.equal(db.balance, 9.99);
  assert.equal(db.ledger.length, 0);
});

test('debit of the exact balance empties the wallet without drift', async () => {
  reset(0.3);
  const res = await wallet.debit('ws1', 0.1);
  await wallet.debit('ws1', 0.2);
  assert.equal(res.ok, true);
  assert.equal(db.balance, 0);
  assert.equal(db.ledger.at(-1).type, 'DEBIT');
  assert.equal(db.ledger.at(-1).gateway, 'system');
});

test('a replayed debit is charged once', async () => {
  reset(100);
  await wallet.debit('ws1', 40, { idempotencyKey: 'campaign_c3' });
  const replay = await wallet.debit('ws1', 40, { idempotencyKey: 'campaign_c3' });
  assert.equal(replay.ok, true);
  assert.equal(replay.alreadyProcessed, true);
  assert.equal(db.balance, 60);
});

test('zero, negative and non-numeric amounts are a 400 for both directions', async () => {
  reset(100);
  for (const amount of [0, -5, 'abc', Number.NaN, 0.001]) {
    await assert.rejects(() => wallet.credit('ws1', amount), (e) => e.status === 400, `credit ${amount}`);
    await assert.rejects(() => wallet.debit('ws1', amount), (e) => e.status === 400, `debit ${amount}`);
  }
  assert.equal(db.balance, 100);
  assert.equal(db.ledger.length, 0);
});

test('a caller-supplied transaction is used instead of opening a new one', async () => {
  reset(30);
  let opened = 0;
  const orig = prisma.$transaction;
  prisma.$transaction = async (fn) => { opened += 1; return orig(fn); };
  try {
    const res = await wallet.debit('ws1', 10, {}, tx);
    assert.equal(res.ok, true);
    assert.equal(opened, 0);
  } finally {
    prisma.$transaction = orig;
  }
});

test('top-up verify rejects a bad signature before touching the gateway or the ledger', async () => {
  reset(0);
  signatureOk = false;
  await assert.rejects(
    () => wallet.verifyTopupPayment('ws1', { orderId: 'o1', paymentId: 'p1', signature: 'bad' }),
    (e) => e.status === 400,
  );
  assert.equal(db.ledger.length, 0);
});

test('top-up verify refuses an order that belongs to another workspace', async () => {
  reset(0);
  gatewayOrder = { id: 'o1', amount: 50000, currency: 'INR', notes: { workspaceId: 'other', type: 'wallet_topup' } };
  await assert.rejects(
    () => wallet.verifyTopupPayment('ws1', { orderId: 'o1', paymentId: 'p1', signature: 'sig' }),
    (e) => e.status === 403,
  );
  assert.equal(db.balance, 0);
});

test('top-up credits the amount from the gateway order, not anything the client sent', async () => {
  reset(0);
  gatewayOrder = { id: 'o1', amount: 25050, currency: 'INR', notes: { workspaceId: 'ws1', type: 'wallet_topup' } };
  const res = await wallet.verifyTopupPayment('ws1', { orderId: 'o1', paymentId: 'pay_77', signature: 'sig', amount: 999999 });
  assert.equal(res.balance, 250.5);
  assert.equal(db.ledger[0].idempotencyKey, 'rzp_topup_pay_77');
  assert.equal(db.ledger[0].gateway, 'razorpay');
});

test('top-up verify requires all three gateway fields', async () => {
  reset(0);
  await assert.rejects(() => wallet.verifyTopupPayment('ws1', { orderId: 'o1', paymentId: 'p1' }), (e) => e.status === 400);
});

test('walletStatus scales "low" by the per-message rate', () => {
  assert.equal(wallet.walletStatus(0, 1).status, 'EMPTY');
  assert.equal(wallet.walletStatus(50, 1).status, 'LOW');
  assert.equal(wallet.walletStatus(50, 1).messagesRemaining, 50);
  assert.equal(wallet.walletStatus(150, 1).status, 'HEALTHY');
  // No known rate: never a false LOW.
  assert.equal(wallet.walletStatus(1, 0).status, 'HEALTHY');
});
