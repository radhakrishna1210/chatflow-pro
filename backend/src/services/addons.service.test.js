import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Add-on packs: stacking, exactly-once activation, and the renewal/expiry
// sweep. The database is an in-memory table; the gateway, the wallet and
// notifications are faked.

const DAY = 24 * 60 * 60 * 1000;
let packs;
let invoices;
let appliedPayments;
let debits;
let balance;
let notes;
let seq;

// Just enough of Prisma's `where` for the queries addons.service makes.
function matches(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return cond.some((w) => matches(row, w));
    const v = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond && !cond.in.includes(v)) return false;
      if ('gt' in cond && !(v > cond.gt)) return false;
      if ('lte' in cond && !(v <= cond.lte)) return false;
      return true;
    }
    if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
    return v === cond;
  });
}
const sortBy = (rows, orderBy) => {
  if (!orderBy) return rows;
  const [[field, dir]] = Object.entries(orderBy);
  return [...rows].sort((a, b) => (dir === 'asc' ? a[field] - b[field] : b[field] - a[field]));
};

const db = {
  workspaceAddon: {
    findMany: async ({ where, orderBy } = {}) => sortBy(packs.filter((p) => matches(p, where)), orderBy),
    findFirst: async ({ where } = {}) => packs.find((p) => matches(p, where)) ?? null,
    count: async ({ where } = {}) => packs.filter((p) => matches(p, where)).length,
    create: async ({ data }) => {
      const row = { id: `p${++seq}`, status: 'ACTIVE', autoRenew: false, currency: 'INR', ...data };
      packs.push(row);
      return row;
    },
    updateMany: async ({ where, data }) => {
      const hit = packs.filter((p) => matches(p, where));
      hit.forEach((p) => Object.assign(p, data));
      return { count: hit.length };
    },
  },
  invoice: {
    findFirst: async ({ where }) => invoices.find((i) => matches(i, where)) ?? null,
    create: async ({ data }) => { invoices.push(data); return data; },
  },
};
db.$transaction = async (fn) => fn(db);

const here = (rel) => new URL(rel, import.meta.url).href;
mock.module(here('../lib/prisma.js'), { namedExports: { prisma: db } });
mock.module(here('../config/env.js'), { namedExports: { env: { RAZORPAY_KEY_ID: 'rzp_test' } } });
mock.module(here('../lib/razorpay.js'), {
  namedExports: {
    getRazorpayClient: () => ({ orders: { create: async (o) => ({ id: 'order_1', ...o }) } }),
    verifyPaymentSignature: () => true,
    normalizeRazorpayError: (err) => { throw err; },
  },
});
mock.module(here('./gatewayPayment.service.js'), {
  namedExports: {
    // The real one claims the payment id under a unique index; a Set is the same contract.
    applyGatewayPaymentOnce: async (claim, apply) => {
      if (appliedPayments.has(claim.paymentId)) return { duplicate: true };
      appliedPayments.add(claim.paymentId);
      return { duplicate: false, result: await apply(db) };
    },
  },
});
mock.module(here('./wallet.service.js'), {
  namedExports: {
    debit: async (ws, amount, opts) => {
      if (debits.some((d) => d.key === opts.idempotencyKey)) return { ok: true, alreadyProcessed: true, balance };
      if (balance < amount) return { ok: false, balance };
      balance -= amount;
      debits.push({ amount, key: opts.idempotencyKey, category: opts.category });
      return { ok: true, alreadyProcessed: false, balance };
    },
  },
});
mock.module(here('./notification.service.js'), {
  namedExports: {
    notifyWorkspace: async (ws, note) => { notes.push(note); },
    notifyWorkspaceGrouped: async (ws, note) => { notes.push(note); },
  },
});

const addons = await import('./addons.service.js');

const order = (paymentNo, extra = {}) => ({
  id: `order_${paymentNo}`, amount: 49900, currency: 'INR',
  notes: { workspaceId: 'w1', type: 'addon', addonKey: 'fields', ...extra },
});

beforeEach(() => {
  packs = [];
  invoices = [];
  appliedPayments = new Set();
  debits = [];
  balance = 0;
  notes = [];
  seq = 0;
});

test('buying the same add-on twice stacks two packs and doubles the allowance', async () => {
  await addons.applyAddonPayment('w1', order(1), 'pay_1');
  const second = await addons.createAddonOrder('w1', 'fields');
  assert.equal(second.amount, 49900, 'a live pack no longer blocks buying another');
  const r = await addons.applyAddonPayment('w1', order(2), 'pay_2');

  assert.equal(r.quantity, 2);
  assert.equal(await addons.addonAllowance('w1', 'customFields'), 10);
  const list = await addons.listAddons('w1');
  const fields = list.addons.find((a) => a.key === 'fields');
  assert.equal(fields.quantity, 2);
  assert.equal(fields.packs.length, 2);
});

test('the same payment applied twice (verify + webhook) adds one pack', async () => {
  await addons.applyAddonPayment('w1', order(1), 'pay_1', 'VERIFY');
  const again = await addons.applyAddonPayment('w1', order(1), 'pay_1', 'WEBHOOK');
  assert.equal(packs.length, 1);
  assert.equal(invoices.length, 1);
  assert.equal(again.quantity, 1);
});

test('auto-renew chosen at checkout is kept on the pack, and later packs follow it', async () => {
  await addons.applyAddonPayment('w1', order(1, { autoRenew: '1' }), 'pay_1');
  await addons.applyAddonPayment('w1', order(2), 'pay_2');
  assert.deepEqual(packs.map((p) => p.autoRenew), [true, true]);
});

test('an auto-renewing pack is renewed from the wallet once per period', async () => {
  const now = new Date('2026-10-03T02:00:00Z');
  const end = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  packs.push({ id: 'p1', workspaceId: 'w1', addonKey: 'fields', status: 'ACTIVE', autoRenew: true, currency: 'INR', currentPeriodEnd: end });
  balance = 1000;

  const r = await addons.runAddonRenewalSweep(now);
  assert.equal(r.renewed, 1);
  assert.deepEqual(debits, [{ amount: 499, key: `addon_renew_p1_${end.getTime()}`, category: 'ADDON' }]);
  assert.equal(packs[0].currentPeriodEnd.getTime(), end.getTime() + 30 * DAY, 'the new period starts where the paid one ends');
  assert.equal(invoices.length, 1);

  // The next sweep (or a retry of this one) finds nothing due.
  const again = await addons.runAddonRenewalSweep(now);
  assert.equal(again.renewed, 0);
  assert.equal(debits.length, 1);
});

test('a lapsed pack renewed late starts its new period from now', async () => {
  const now = new Date('2026-10-03T02:00:00Z');
  packs.push({ id: 'p1', workspaceId: 'w1', addonKey: 'fields', status: 'ACTIVE', autoRenew: true, currency: 'INR', currentPeriodEnd: new Date(now.getTime() - 3 * DAY) });
  balance = 1000;
  await addons.runAddonRenewalSweep(now);
  assert.equal(packs[0].currentPeriodEnd.getTime(), now.getTime() + 30 * DAY);
});

test('without the balance a pack is kept until it ends, then expires with a notification', async () => {
  const now = new Date('2026-10-03T02:00:00Z');
  const end = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  packs.push({ id: 'p1', workspaceId: 'w1', addonKey: 'fields', status: 'ACTIVE', autoRenew: true, currency: 'INR', currentPeriodEnd: end });
  balance = 10;

  const before = await addons.runAddonRenewalSweep(now);
  assert.equal(before.unpaid, 1);
  assert.equal(packs[0].status, 'ACTIVE');
  assert.equal(notes[0].type, 'ADDON_RENEWAL_PENDING');

  const after = await addons.runAddonRenewalSweep(new Date(end.getTime() + 60_000));
  assert.equal(after.expired, 1);
  assert.equal(packs[0].status, 'EXPIRED');
  assert.equal(notes.at(-1).type, 'ADDON_RENEWAL_FAILED');
  assert.equal(debits.length, 0, 'nothing was charged');
  assert.equal(await addons.addonAllowance('w1', 'customFields'), 0);
});

test('packs without auto-renew expire; only an unexpected lapse is announced', async () => {
  const now = new Date('2026-10-03T02:00:00Z');
  const ended = new Date(now.getTime() - 1000);
  packs.push({ id: 'p1', workspaceId: 'w1', addonKey: 'fields', status: 'ACTIVE', autoRenew: false, currentPeriodEnd: ended });
  packs.push({ id: 'p2', workspaceId: 'w1', addonKey: 'events', status: 'CANCELLED', autoRenew: false, currentPeriodEnd: ended });
  // Not due yet and not renewing: untouched.
  packs.push({ id: 'p3', workspaceId: 'w1', addonKey: 'fields', status: 'ACTIVE', autoRenew: false, currentPeriodEnd: new Date(now.getTime() + 2 * 60 * 60 * 1000) });

  const r = await addons.runAddonRenewalSweep(now);
  assert.equal(r.expired, 2);
  assert.deepEqual(packs.map((p) => p.status), ['EXPIRED', 'EXPIRED', 'ACTIVE']);
  assert.deepEqual(notes.map((n) => n.type), ['ADDON_EXPIRED']);
});

test('cancelling stops renewal; switching auto-renew back on undoes the cancellation', async () => {
  await addons.applyAddonPayment('w1', order(1, { autoRenew: '1' }), 'pay_1');
  await addons.cancelAddon('w1', 'fields');
  assert.equal(packs[0].status, 'CANCELLED');
  assert.equal(packs[0].autoRenew, false);
  assert.equal(await addons.hasAddon('w1', 'fields'), true, 'still usable until the period ends');

  await addons.setAddonAutoRenew('w1', 'fields', true);
  assert.equal(packs[0].status, 'ACTIVE');
  assert.equal(packs[0].autoRenew, true);
});

test('auto-renew cannot be switched on for an add-on that is not held', async () => {
  await assert.rejects(() => addons.setAddonAutoRenew('w1', 'fields', true), { status: 404 });
});
