// Today's stock for an order form: orders count it down, a quantity larger
// than what is left is refused, and when everything has run out the form
// stops taking orders and says so.
import { test, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { flowFingerprint } from '../lib/formFlowScreen.js';

const form = {
  id: 'f1', workspaceId: 'ws1', name: 'Mushroom Order', status: 'Active', keyword: 'PLACE ORDER',
  completionMessage: 'Total ₹{{= q2*button_price + q3*oyster_price + q4*babycorn_price}}',
  schema: [
    { key: 'what', label: 'What would you like to order?', type: 'multi', required: true, options: ['White Button Mushroom', 'Oyster Mushroom', 'Baby Corn'] },
    { key: 'boxes', label: 'How many 10 kg boxes of White Button Mushroom?', type: 'number', required: true, options: [], showIf: { question: 1, option: 'White Button Mushroom' } },
    { key: 'packs', label: 'How many 200 g packs of Oyster Mushroom?', type: 'number', required: true, options: [], showIf: { question: 1, option: 'Oyster Mushroom' } },
    { key: 'corn', label: 'How many kg of Baby Corn?', type: 'number', required: true, options: [], showIf: { question: 1, option: 'Baby Corn' } },
    { key: 'address', label: 'Delivery address for this order?', type: 'text', required: true, options: [] },
  ],
};
const FP = flowFingerprint(form);
const contact = { id: 'c1', name: 'krishna', phoneNumber: '+919226381481', tags: [], attributes: { button_price: '1100', oyster_price: '40', babycorn_price: '90' } };
const conversation = { id: 'conv1', waNumberId: 'wa1' };
const MORNING = new Date('2026-01-02T03:00:00.000Z');

const db = {};

let stockService; let forms; let screens;
before(async () => {
  mock.module('../lib/prisma.js', {
    namedExports: {
      prisma: {
        whatsappFormStock: {
          findUnique: async () => { if (db.noTable) throw new Error('The table `WhatsappFormStock` does not exist'); return db.stock; },
          upsert: async ({ create, update }) => { db.stock = db.stock ? { ...db.stock, ...update } : { formId: 'f1', ...create }; return db.stock; },
        },
        whatsappFormSubmission: {
          // With a where on completedAt it is the stock count; otherwise the form runtime.
          findMany: async ({ where }) => (where.completedAt
            ? db.orders.filter((o) => o.completedAt >= where.completedAt.gte).map((o) => ({ answers: o.answers }))
            : []),
          findFirst: async ({ where }) => (where.id ? db.byId[where.id] ?? null : db.open),
          create: async ({ data }) => { const row = { id: `s${db.created.length + 10}`, ...data }; db.created.push(row); return row; },
          update: async (args) => { db.updates.push(args); return args; },
        },
        whatsappForm: {
          findFirst: async () => db.form,
          findMany: async () => [db.form],
          update: async () => ({}),
        },
        whatsappFormScreen: { findUnique: async () => null },
        contact: {
          findUnique: async () => contact,
          findMany: async () => [contact],
          update: async (args) => { db.contactUpdates.push(args); return {}; },
        },
        workspaceCustomField: { findMany: async () => [] },
        workspace: { findUnique: async () => ({ orderingEnabled: true }) },
      },
    },
  });
  mock.module('../lib/encryption.js', { namedExports: { decrypt: () => 'token', encrypt: (v) => v } });
  mock.module('../lib/meta.js', { namedExports: {
    createFlow: async () => ({}), uploadFlowJson: async () => ({}), publishFlow: async () => ({}),
    deprecateFlow: async () => ({}), deleteFlow: async () => ({}), sendFlowMessage: async () => ({}),
  } });
  mock.module('./optout.service.js', { namedExports: { isOptedOut: async () => false } });
  mock.module('./messagingWindow.js', { namedExports: { getWindowState: async () => ({ open: true }), WINDOW_MS: 86400000 } });
  mock.module('./outbound.service.js', { namedExports: { sendAutomatedReply: async ({ body }) => { db.sent.push(body); } } });
  mock.module('./subscription.service.js', { namedExports: { assertWithinLimit: async () => {} } });
  mock.module('./automation.service.js', {
    namedExports: { keywordMatches: (keyword, body) => String(body).trim().toUpperCase() === keyword },
  });
  stockService = await import('./whatsappFormStock.service.js');
  forms = await import('./whatsappForms.service.js');
  screens = await import('./whatsappFormScreen.service.js');
});

beforeEach(() => {
  contact.tags = [];
  Object.assign(db, {
    form, noTable: false, open: null, byId: {}, created: [], updates: [], sent: [], contactUpdates: [],
    stock: { formId: 'f1', limits: { boxes: 10, packs: 100 }, countFrom: MORNING, soldOutMessage: null },
    // Yesterday's order must not count; today's two do.
    orders: [
      { completedAt: new Date('2026-01-01T10:00:00.000Z'), answers: { boxes: '9', packs: '90', corn: '50' } },
      { completedAt: new Date('2026-01-02T04:00:00.000Z'), answers: { boxes: '4', packs: '0', corn: '5', __total: 4850 } },
      { completedAt: new Date('2026-01-02T05:00:00.000Z'), answers: { boxes: '3', packs: '60', corn: '0' } },
    ],
  });
});

const inbound = (messageBody) => forms.handleFormInbound({ workspaceId: 'ws1', conversation, contact, messageBody });

// ── Counting ───────────────────────────────────────────────────────────────

test('orders since the stock was entered count it down; items without a limit are not tracked', async () => {
  const stock = await stockService.stockFor(form);
  assert.equal(stock.active, true);
  assert.equal(stock.soldOut, false);
  assert.deepEqual(stock.items, {
    boxes: { label: 'How many 10 kg boxes of White Button Mushroom?', limit: 10, used: 7, left: 3 },
    packs: { label: 'How many 200 g packs of Oyster Mushroom?', limit: 100, used: 60, left: 40 },
  });
  assert.equal(stock.items.corn, undefined, 'Baby Corn has no limit');
});

test('a form with no stock entered, or a database without the table, has no limits', async () => {
  db.stock = null;
  assert.equal((await stockService.stockFor(form)).active, false);
  db.stock = { formId: 'f1', limits: {}, countFrom: MORNING };
  assert.equal((await stockService.stockFor(form)).active, false);
  db.noTable = true;
  const none = await stockService.stockFor(form);
  assert.equal(none.active, false);
  assert.equal(none.soldOut, false);
});

test('sold out means every item with a limit has nothing left', async () => {
  db.orders.push({ completedAt: new Date('2026-01-02T06:00:00.000Z'), answers: { boxes: '3' } });
  assert.equal((await stockService.stockFor(form)).soldOut, false, 'packs are still available');
  db.orders.push({ completedAt: new Date('2026-01-02T07:00:00.000Z'), answers: { packs: '45' } });
  const stock = await stockService.stockFor(form);
  assert.equal(stock.soldOut, true);
  assert.equal(stock.items.packs.left, 0, 'never negative');
  assert.equal(stock.message, stockService.DEFAULT_SOLD_OUT_MESSAGE);
});

// ── In chat ────────────────────────────────────────────────────────────────

test('a quantity larger than what is left is refused with what is left, and asked again', async () => {
  db.open = { id: 's1', formId: 'f1', form, cursor: 1, completed: false, answers: { what: 'White Button Mushroom' } };
  assert.equal(await inbound('5'), true);
  assert.deepEqual(db.sent, ['Sorry, only 3 left today. Please send 3 or less.\n\nHow many 10 kg boxes of White Button Mushroom?']);
  assert.equal(db.updates.length, 0, 'the answer is not saved');

  // Exactly what is left is accepted and the form moves on.
  db.sent = [];
  assert.equal(await inbound('3'), true);
  assert.equal(db.updates.at(-1).data.answers.boxes, '3');
  assert.deepEqual(db.sent, ['Delivery address for this order?']);
});

test('a sold-out item can be skipped with 0; an item without a limit is never refused', async () => {
  db.orders.push({ completedAt: new Date('2026-01-02T06:00:00.000Z'), answers: { boxes: '3' } });
  db.open = { id: 's1', formId: 'f1', form, cursor: 1, completed: false, answers: { what: 'White Button Mushroom, Baby Corn' } };
  assert.equal(await inbound('1'), true);
  assert.deepEqual(db.sent, ['Sorry, this is sold out for today. Reply 0 to carry on without it.\n\nHow many 10 kg boxes of White Button Mushroom?']);

  db.sent = [];
  assert.equal(await inbound('0'), true);
  assert.deepEqual(db.sent, ['How many kg of Baby Corn?']);

  db.open = { ...db.open, cursor: 3, answers: { what: 'White Button Mushroom, Baby Corn', boxes: '0', packs: '0' } };
  db.sent = [];
  assert.equal(await inbound('5000'), true);
  assert.deepEqual(db.sent, ['Delivery address for this order?']);
});

test('when everything is sold out the form does not start: the customer is told and waitlisted', async () => {
  db.orders.push({ completedAt: new Date('2026-01-02T06:00:00.000Z'), answers: { boxes: '3', packs: '40' } });
  db.stock.soldOutMessage = 'Aaj ka stock khatam. Kal subah order karein.';
  assert.equal(await inbound('Place order'), true);
  assert.deepEqual(db.sent, ['Aaj ka stock khatam. Kal subah order karein.']);
  assert.equal(db.created.length, 0, 'no order is opened');
  assert.deepEqual(db.contactUpdates, [{ where: { id: 'c1' }, data: { tags: { push: 'waitlist' } } }]);

  // Already on the waitlist: told again, not tagged twice.
  contact.tags = ['waitlist'];
  db.contactUpdates = [];
  await inbound('Place order');
  assert.deepEqual(db.contactUpdates, []);
});

test('with stock left the form starts as usual', async () => {
  assert.equal(await inbound('PLACE ORDER'), true);
  assert.equal(db.created.length, 1);
  assert.match(db.sent[0], /^What would you like to order\?/);
});

// ── On the form screen ─────────────────────────────────────────────────────

const submit = (data) => {
  db.byId.s1 = { id: 's1', formId: 'f1', contactId: 'c1', form, completed: false, answers: { __screen: true } };
  return screens.handleFlowReply({ workspaceId: 'ws1', conversation, contact, flowReply: { token: `s1.${FP.slice(0, 12)}`, data } });
};

test('a submitted screen asking for more than is left is refused, naming each item', async () => {
  assert.equal(await submit({ f1_o1: true, f2: '5', f1_o2: true, f3: '41', f1_o3: true, f4: '900', f5: 'Baner' }), true);
  assert.equal(db.updates.length, 0, 'nothing is saved');
  assert.deepEqual(db.sent, [
    'Sorry, we do not have that much left today:\n'
    + '• How many 10 kg boxes of White Button Mushroom? Only 3 left today.\n'
    + '• How many 200 g packs of Oyster Mushroom? Only 40 left today.\n\n'
    + 'Open the form again, change the quantity and tap Submit.',
  ]);
});

test('a submitted screen within what is left is saved as an order', async () => {
  assert.equal(await submit({ f1_o1: true, f2: '3', f1_o3: true, f4: '2', f5: 'Baner' }), true);
  const saved = db.updates.find((u) => u.where.id === 's1').data;
  assert.equal(saved.completed, true);
  assert.equal(saved.answers.__total, 3480);
  assert.deepEqual(db.sent, ['Total ₹3,480']);
});

test('a screen submitted after everything sold out gets the sold-out message', async () => {
  db.orders.push({ completedAt: new Date('2026-01-02T06:00:00.000Z'), answers: { boxes: '3', packs: '40' } });
  assert.equal(await submit({ f1_o3: true, f4: '2', f5: 'Baner' }), true);
  assert.equal(db.updates.length, 0);
  assert.deepEqual(db.sent, [stockService.DEFAULT_SOLD_OUT_MESSAGE]);
  assert.equal(db.contactUpdates.length, 1);
});

// ── Entering the stock ─────────────────────────────────────────────────────

test('the editor sees every quantity question with its limit, ordered and left', async () => {
  const state = await stockService.getStock('ws1', 'f1');
  assert.deepEqual(state.items, [
    { key: 'boxes', label: 'How many 10 kg boxes of White Button Mushroom?', limit: 10, used: 7, left: 3 },
    { key: 'packs', label: 'How many 200 g packs of Oyster Mushroom?', limit: 100, used: 60, left: 40 },
    { key: 'corn', label: 'How many kg of Baby Corn?', limit: null, used: 0, left: null },
  ]);
  assert.equal(state.soldOut, false);
  assert.equal(state.soldOutMessage, stockService.DEFAULT_SOLD_OUT_MESSAGE);
});

test("entering today's stock starts a fresh count; a top-up keeps today's orders", async () => {
  const before = Date.now();
  const fresh = await stockService.setStock('ws1', 'f1', { limits: { boxes: '20', packs: '', corn: 150, address: 5, nonsense: 9 }, soldOutMessage: '  Sold out for today.  ' });
  assert.deepEqual(db.stock.limits, { boxes: 20, corn: 150 }, 'only quantity questions; empty removes the limit');
  assert.ok(db.stock.countFrom.getTime() >= before, 'the count restarts now');
  assert.equal(db.stock.soldOutMessage, 'Sold out for today.');
  assert.deepEqual(fresh.items.map((i) => [i.key, i.limit, i.used, i.left]), [['boxes', 20, 0, 20], ['packs', null, 0, null], ['corn', 150, 0, 150]]);

  // Top up mid-day: the numbers change, the orders already placed still count.
  db.stock = { formId: 'f1', limits: { boxes: 10 }, countFrom: MORNING, soldOutMessage: null };
  const topped = await stockService.setStock('ws1', 'f1', { limits: { boxes: 15 }, restart: false });
  assert.equal(db.stock.countFrom, MORNING);
  assert.deepEqual(topped.items[0], { key: 'boxes', label: form.schema[1].label, limit: 15, used: 7, left: 8 });
});

test('stock must be a number, 0 or more; 0 means none available', async () => {
  await assert.rejects(stockService.setStock('ws1', 'f1', { limits: { boxes: -1 } }), { status: 400 });
  await assert.rejects(stockService.setStock('ws1', 'f1', { limits: { boxes: 'lots' } }), { status: 400 });
  const state = await stockService.setStock('ws1', 'f1', { limits: { boxes: 0 } });
  assert.equal(state.soldOut, true);
  assert.deepEqual(state.items[0], { key: 'boxes', label: form.schema[1].label, limit: 0, used: 0, left: 0 });
});
