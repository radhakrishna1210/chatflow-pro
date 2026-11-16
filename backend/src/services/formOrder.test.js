// Owner-approved orders: an order goes to the owner on WhatsApp, through a
// revised-quantity step if needed, to payment and a screenshot, and is final
// only when the owner confirms.
import { test, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  shortLabel, itemLines, detailLines, parseQuantities, actionId, parseAction, samePhone, pastCutoff,
} from '../lib/orderText.js';

const form = {
  id: 'f1', workspaceId: 'ws1', name: 'Mushroom Order', status: 'Active', keyword: 'PLACE ORDER',
  completionMessage: [
    '{{? q2}}White Button: {{q2}} box = ₹{{= q2 * button_price}}',
    '{{? q3}}Oyster: {{q3}} pack = ₹{{= q3 * oyster_price}}',
    '{{? q4}}Baby Corn: {{q4}} kg = ₹{{= q4 * babycorn_price}}',
    'Total to pay: ₹{{= q2*button_price + q3*oyster_price + q4*babycorn_price}}',
  ].join('\n'),
  schema: [
    { key: 'what', label: 'What would you like to order?', type: 'multi', required: true, options: ['White Button Mushroom', 'Oyster Mushroom', 'Baby Corn'] },
    { key: 'boxes', label: 'How many 10 kg boxes of White Button Mushroom?', type: 'number', required: true, options: [] },
    { key: 'packs', label: 'How many 200 g packs of Oyster Mushroom?', type: 'number', required: true, options: [] },
    { key: 'corn', label: 'How many kg of Baby Corn?', type: 'number', required: true, options: [] },
    { key: 'address', label: 'Delivery address for this order?', type: 'text', required: true, options: [] },
  ],
};
const OWNER = '+919000000001';
const customer = { id: 'c1', name: 'krishna', phoneNumber: '+919226381481', attributes: { button_price: '1100', oyster_price: '40', babycorn_price: '90' } };
const ownerContact = { id: 'c-owner', name: 'Owner', phoneNumber: OWNER };
const custConv = { id: 'conv-c', waNumberId: 'wa1', contactId: 'c1' };
const ownerConv = { id: 'conv-o', waNumberId: 'wa1', contactId: 'c-owner' };
const waNumber = { id: 'wa1', workspaceId: 'ws1', metaPhoneNumberId: 'pn1', encryptedAccessToken: 'enc' };

const db = {};
const net = {};

const matches = (row, where = {}) => Object.entries(where).every(([key, cond]) => {
  const value = row[key];
  if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('in' in cond) return cond.in.includes(value);
    if ('not' in cond) return value !== cond.not;
    if ('lt' in cond) return value instanceof Date && value < cond.lt;
    return true;
  }
  return value === cond;
});

let orders; let stockService;
before(async () => {
  mock.module('../lib/prisma.js', {
    namedExports: {
      prisma: {
        whatsappFormOrderFlow: {
          findUnique: async () => { if (db.noTables) throw new Error('The table `WhatsappFormOrderFlow` does not exist'); return db.flow; },
          findMany: async ({ where }) => (db.flow && (!where.enabled || db.flow.enabled) ? [db.flow] : []),
          upsert: async ({ create, update }) => { db.flow = db.flow ? { ...db.flow, ...update } : { ...create }; return db.flow; },
        },
        whatsappFormOrder: {
          count: async () => db.orders.length,
          create: async ({ data }) => { const row = { id: `o${db.orders.length + 1}`, cancelReason: null, expiresAt: null, confirmedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data }; db.orders.push(row); return { ...row }; },
          findFirst: async ({ where }) => { const hit = [...db.orders].reverse().find((o) => matches(o, where)); return hit ? { ...hit } : null; },
          findMany: async ({ where }) => db.orders.filter((o) => matches(o, where)).map((o) => ({ ...o })),
          update: async ({ where, data }) => { const row = db.orders.find((o) => o.id === where.id); Object.assign(row, data, { updatedAt: new Date() }); return { ...row }; },
          updateMany: async ({ where, data }) => { const hits = db.orders.filter((o) => matches(o, where)); hits.forEach((o) => Object.assign(o, data)); return { count: hits.length }; },
        },
        whatsappForm: { findFirst: async () => form },
        whatsappFormSubmission: {
          findFirst: async ({ where }) => db.submissions[where.id] ?? null,
          update: async ({ where, data }) => { db.submissions[where.id] = { ...db.submissions[where.id], ...data }; return db.submissions[where.id]; },
          findMany: async ({ where }) => Object.values(db.submissions)
            .filter((s) => s.completed && s.completedAt >= where.completedAt.gte).map((s) => ({ answers: s.answers })),
        },
        whatsappFormStock: { findUnique: async () => db.stock },
        contact: {
          findUnique: async ({ where }) => [customer, ownerContact].find((c) => c.id === where.id) ?? null,
          findFirst: async () => (db.ownerHasChat ? ownerContact : null),
          findMany: async () => [customer],
        },
        conversation: {
          findUnique: async ({ where }) => [custConv, ownerConv].find((c) => c.id === where.id) ?? null,
          findFirst: async () => (db.ownerHasChat ? ownerConv : null),
          update: async () => ({}),
        },
        waNumber: { findUnique: async () => waNumber },
        message: { create: async ({ data }) => { db.messages.push(data); return data; } },
        notification: { create: async ({ data }) => { db.notifications.push(data); return data; } },
      },
    },
  });
  mock.module('../lib/encryption.js', { namedExports: { decrypt: () => 'token', encrypt: (v) => v } });
  const send = (kind) => async (pn, token, to, payload) => {
    if (net.ownerUnreachable && to === OWNER) throw Object.assign(new Error('Re-engagement message'), { response: { data: { error: { code: 131047, message: 'Re-engagement message' } } } });
    net.sent.push({ to, kind, body: typeof payload === 'string' ? payload : (payload.body ?? payload.caption), buttons: payload.buttons, mediaId: payload.mediaId });
    return { messages: [{ id: `wamid.${net.sent.length}` }] };
  };
  mock.module('../lib/meta.js', {
    namedExports: {
      sendTextMessage: send('text'),
      sendReplyButtons: send('buttons'),
      sendMediaMessage: send('image'),
      uploadPhoneMedia: async ({ buffer, mimeType }) => { net.uploads.push({ bytes: buffer.length, mimeType }); return `media-${net.uploads.length}`; },
      downloadMediaBuffer: async (mediaId) => { if (net.downloadFails) throw new Error('gone'); return { buffer: Buffer.from(`bytes-of-${mediaId}`), mimeType: 'image/jpeg' }; },
    },
  });
  mock.module('./whatsappForms.service.js', {
    namedExports: { handleFormInbound: async (args) => { db.formStarts.push(args.messageBody); return true; } },
  });
  orders = await import('./formOrder.service.js');
  stockService = await import('./whatsappFormStock.service.js');
});

beforeEach(() => {
  Object.assign(db, {
    noTables: false, ownerHasChat: true, orders: [], messages: [], notifications: [], formStarts: [], stock: null,
    flow: {
      formId: 'f1', workspaceId: 'ws1', enabled: true, ownerPhone: OWNER, upiId: 'farm@upi', payeeName: 'Fresh Farm',
      bankDetails: 'A/C 123456\nIFSC ABCD0001', qrImage: null, qrMime: null, replyMinutes: 60, paymentMinutes: 120,
      cutoffTime: null, timezone: 'Asia/Kolkata',
    },
    submissions: {
      s1: {
        id: 's1', workspaceId: 'ws1', formId: 'f1', conversationId: 'conv-c', completed: true, completedAt: new Date(),
        answers: { what: 'White Button Mushroom, Baby Corn', boxes: '5', packs: '0', corn: '5', address: 'Baner branch, Pune', __total: 5950, __status: 'PENDING' },
      },
    },
  });
  Object.assign(net, { sent: [], uploads: [], ownerUnreachable: false, downloadFails: false });
});

const place = async () => {
  const s = db.submissions.s1;
  const order = await orders.placeOrder({ workspaceId: 'ws1', form, submission: s, contact: customer, answers: s.answers });
  net.sent = [];
  return order;
};
const inbound = (from, parsed) => orders.handleOrderInbound({
  workspaceId: 'ws1', waNumber, fromPhone: from.phoneNumber, contact: from,
  conversation: from === customer ? custConv : ownerConv, parsed,
});
const tap = (from, orderId, action) => inbound(from, { type: 'INTERACTIVE', body: 'x', buttonPayload: actionId(orderId, action) });
const says = (from, body) => inbound(from, { type: 'TEXT', body, buttonPayload: null });
const picture = (from) => inbound(from, { type: 'IMAGE', body: '[photo]', buttonPayload: null, media: { mediaId: 'm1', mediaMimeType: 'image/jpeg' } });
const order1 = () => db.orders[0];
const toOwner = () => net.sent.filter((m) => m.to === OWNER);
const toCust = () => net.sent.filter((m) => m.to === customer.phoneNumber);
const titles = (m) => (m.buttons || []).map((b) => b.title);

// ── Text helpers ───────────────────────────────────────────────────────────

test('an order is written out as items and details, without the asking', () => {
  assert.equal(shortLabel('How many 10 kg boxes of White Button Mushroom?'), '10 kg boxes of White Button Mushroom');
  const answers = db.submissions.s1.answers;
  assert.deepEqual(itemLines(form.schema, answers), ['• 10 kg boxes of White Button Mushroom: 5', '• kg of Baby Corn: 5']);
  assert.deepEqual(detailLines(form.schema, answers), ['Delivery address for this order: Baner branch, Pune']);
});

test("the owner's quantities are read only when there is one number per item", () => {
  assert.deepEqual(parseQuantities('3, 0, 5', 3), [3, 0, 5]);
  assert.deepEqual(parseQuantities('3 0 2.5', 3), [3, 0, 2.5]);
  assert.equal(parseQuantities('3, 0', 3), null);
  assert.equal(parseQuantities('three boxes', 3), null);
  assert.equal(parseQuantities('-1, 0, 5', 3), null);
});

test('buttons name their order; phones compare by digits; the cutoff follows the local clock', () => {
  assert.deepEqual(parseAction(actionId('ck123abc', 'ok')), { orderId: 'ck123abc', action: 'ok' });
  assert.equal(parseAction('place_order_0'), null);
  assert.equal(samePhone('+91 92263 81481', '919226381481'), true);
  assert.equal(samePhone('+919226381481', '+919226381482'), false);
  // 13:00 UTC is 18:30 in India.
  const now = new Date('2026-11-16T13:00:00.000Z');
  assert.equal(pastCutoff('18:00', 'Asia/Kolkata', now), true);
  assert.equal(pastCutoff('19:00', 'Asia/Kolkata', now), false);
  assert.equal(pastCutoff('', 'Asia/Kolkata', now), false);
  assert.equal(pastCutoff('6pm', 'Asia/Kolkata', now), false);
});

// ── Placing ────────────────────────────────────────────────────────────────

test('a finished form opens an order: the customer is told, the owner gets it with three buttons', async () => {
  const s = db.submissions.s1;
  await orders.placeOrder({ workspaceId: 'ws1', form, submission: s, contact: customer, answers: s.answers });

  assert.equal(order1().status, 'PENDING_OWNER');
  assert.equal(order1().number, 1);
  assert.equal(order1().total, 5950);

  assert.equal(toCust()[0].body,
    'Thank you krishna. We have received your order #1:\n• 10 kg boxes of White Button Mushroom: 5\n• kg of Baby Corn: 5\nDelivery address for this order: Baner branch, Pune\n\nWe are checking stock and will confirm it shortly.');
  const card = toOwner()[0];
  assert.equal(card.body,
    'New order #1\nkrishna (+919226381481)\n• 10 kg boxes of White Button Mushroom: 5\n• kg of Baby Corn: 5\nDelivery address for this order: Baner branch, Pune\nTotal ₹5,950');
  assert.deepEqual(card.buttons, [
    { id: 'ord:o1:ok', title: 'Available' }, { id: 'ord:o1:change', title: 'Edit quantities' }, { id: 'ord:o1:cancel', title: 'Cancel order' },
  ]);
  assert.equal(db.messages.length, 2, 'both recorded for the Inbox');
});

test('the owner sees what stock is left on the order', async () => {
  db.stock = { formId: 'f1', limits: { boxes: 10 }, countFrom: new Date('2026-01-01T00:00:00Z'), soldOutMessage: null };
  const s = db.submissions.s1;
  await orders.placeOrder({ workspaceId: 'ws1', form, submission: s, contact: customer, answers: s.answers });
  assert.match(toOwner()[0].body, /\n\nStock left today\n• 10 kg boxes of White Button Mushroom: 10$/);
});

// ── Owner: available ───────────────────────────────────────────────────────

test('Available sends the final price and payment details, and starts the payment clock', async () => {
  db.flow.qrImage = Buffer.from('PNGDATA'); db.flow.qrMime = 'image/png';
  await place();
  const before = Date.now();
  assert.equal(await tap(ownerContact, 'o1', 'ok'), true);

  assert.equal(order1().status, 'AWAITING_PAYMENT');
  const wait = order1().expiresAt.getTime() - before;
  assert.ok(wait >= 120 * 60_000 - 1000 && wait <= 120 * 60_000 + 5000, 'two hours to pay');

  const c = toCust();
  assert.deepEqual(c.map((m) => m.kind), ['image', 'text', 'buttons']);
  assert.equal(c[0].body, 'Scan to pay ₹5,950 for order #1');
  assert.deepEqual(net.uploads, [{ bytes: 7, mimeType: 'image/png' }]);
  assert.equal(c[1].body,
    'Order #1 is available ✅\n\nWhite Button: 5 box = ₹5,500\nBaby Corn: 5 kg = ₹450\nTotal to pay: ₹5,950\n\n'
    + 'Please pay ₹5,950 within 2 hours.\nUPI ID: farm@upi\nName: Fresh Farm\n\nBank details\nA/C 123456\nIFSC ABCD0001');
  assert.deepEqual(titles(c[2]), ['Edit order', 'Delete order']);
  assert.match(toOwner()[0].body, /Order #1 marked available/);
});

// ── Owner: edit ────────────────────────────────────────────────────────────

test('Edit quantities asks the owner for numbers, then sends the revised order to the customer', async () => {
  await place();
  await tap(ownerContact, 'o1', 'change');
  assert.equal(order1().status, 'OWNER_EDITING');
  assert.equal(toOwner()[0].body,
    'Send the quantities you can supply for order #1, in this order, separated by commas:\n'
    + '1. 10 kg boxes of White Button Mushroom (now 5)\n2. 200 g packs of Oyster Mushroom (now 0)\n3. kg of Baby Corn (now 5)\n\nExample: 1, 2, 3');

  net.sent = [];
  assert.equal(await says(ownerContact, 'only three'), true);
  assert.match(toOwner()[0].body, /I could not read that\. For order #1 send 3 numbers separated by commas/);
  assert.equal(order1().status, 'OWNER_EDITING');

  net.sent = [];
  await says(ownerContact, '0, 0, 0');
  assert.match(toOwner()[0].body, /All quantities are 0/);

  net.sent = [];
  const before = Date.now();
  await says(ownerContact, '3, 0, 5');
  assert.equal(order1().status, 'PENDING_CUSTOMER');
  assert.equal(order1().total, 3750);
  assert.ok(order1().expiresAt.getTime() - before >= 60 * 60_000 - 1000, 'one hour to answer');
  const saved = db.submissions.s1.answers;
  assert.deepEqual([saved.boxes, saved.packs, saved.corn], ['3', '0', '5']);

  const ask = toCust()[0];
  assert.equal(ask.body,
    'For order #1 we can supply:\n• 10 kg boxes of White Button Mushroom: 3\n• kg of Baby Corn: 5\nDelivery address for this order: Baner branch, Pune\nTotal ₹3,750\n\nDo you accept? Please answer within 1 hour.');
  assert.deepEqual(ask.buttons, [{ id: 'ord:o1:accept', title: 'Accept' }, { id: 'ord:o1:reject', title: 'Reject' }]);
  assert.match(toOwner()[0].body, /Revised order #1 sent to the customer/);
});

test('the customer accepting a revised order moves it to payment at the revised price', async () => {
  await place();
  await tap(ownerContact, 'o1', 'change');
  await says(ownerContact, '3, 0, 5');
  net.sent = [];
  assert.equal(await tap(customer, 'o1', 'accept'), true);
  assert.equal(order1().status, 'AWAITING_PAYMENT');
  assert.match(toCust()[0].body, /Total to pay: ₹3,750\n\nPlease pay ₹3,750 within 2 hours\./);
  assert.match(toOwner()[0].body, /accepted the revised order #1/);
});

test('the customer rejecting a revised order cancels it and offers tomorrow', async () => {
  await place();
  await tap(ownerContact, 'o1', 'change');
  await says(ownerContact, '3, 0, 5');
  net.sent = [];
  await tap(customer, 'o1', 'reject');
  assert.equal(order1().status, 'CANCELLED');
  assert.equal(order1().cancelReason, 'customer_rejected');
  assert.equal(db.submissions.s1.answers.__status, 'CANCELLED');
  assert.equal(toCust()[0].body, "Order #1 is cancelled. You can pre-book tomorrow's order: send PLACE ORDER any time.");
  assert.match(toOwner()[0].body, /did not accept the revised order #1/);
});

// ── Owner: cancel ──────────────────────────────────────────────────────────

test('Cancel order tells the customer, with no reason', async () => {
  await place();
  await tap(ownerContact, 'o1', 'cancel');
  assert.equal(order1().status, 'CANCELLED');
  assert.equal(order1().cancelReason, 'owner');
  assert.deepEqual(toCust().map((m) => m.body), ['Sorry, your order #1 has been cancelled.']);
});

// ── Payment ────────────────────────────────────────────────────────────────

test('a payment screenshot goes to the owner; confirming makes the order final and takes the stock', async () => {
  db.stock = { formId: 'f1', limits: { boxes: 10 }, countFrom: new Date('2026-01-01T00:00:00Z'), soldOutMessage: null };
  await place();
  await tap(ownerContact, 'o1', 'ok');
  assert.equal((await stockService.stockFor(form)).items.boxes.left, 10, 'an unconfirmed order takes no stock');

  net.sent = [];
  assert.equal(await picture(customer), true);
  assert.equal(order1().status, 'PAYMENT_REVIEW');
  assert.equal(order1().expiresAt, null, 'the payment clock stops');
  const o = toOwner();
  assert.deepEqual(o.map((m) => m.kind), ['image', 'buttons']);
  assert.equal(o[0].body, 'Payment screenshot for order #1');
  assert.equal(o[1].body, 'Order #1: payment screenshot from krishna (+919226381481).\nTotal ₹5,950\n\nConfirm when the payment has arrived.');
  assert.deepEqual(o[1].buttons, [{ id: 'ord:o1:paid', title: 'Confirm payment' }]);
  assert.match(toCust()[0].body, /received your payment screenshot for order #1/);

  net.sent = [];
  await tap(ownerContact, 'o1', 'paid');
  assert.equal(order1().status, 'CONFIRMED');
  assert.ok(order1().confirmedAt instanceof Date);
  assert.equal(db.submissions.s1.answers.__status, 'CONFIRMED');
  assert.equal((await stockService.stockFor(form)).items.boxes.left, 5, 'now it counts');
  assert.equal(toCust()[0].body,
    'Your order #1 is confirmed ✅\n• 10 kg boxes of White Button Mushroom: 5\n• kg of Baby Corn: 5\nDelivery address for this order: Baner branch, Pune\nTotal ₹5,950\n\nWe will message you when it is dispatched.');
  assert.match(toOwner()[0].body, /Order #1 is confirmed and the customer has been told\.\n\nStock left today\n• 10 kg boxes of White Button Mushroom: 5/);
  assert.deepEqual(titles(toOwner()[0]), ['Mark dispatched']);

  net.sent = [];
  await tap(ownerContact, 'o1', 'sent');
  assert.equal(order1().status, 'DISPATCHED');
  assert.equal(toCust()[0].body, 'Your order #1 has been dispatched and is on its way. 🚚');
});

test('a screenshot that cannot be forwarded still reaches the owner as an order to confirm', async () => {
  await place();
  await tap(ownerContact, 'o1', 'ok');
  net.sent = []; net.downloadFails = true;
  await picture(customer);
  assert.equal(order1().status, 'PAYMENT_REVIEW');
  assert.deepEqual(toOwner().map((m) => m.kind), ['buttons']);
  assert.match(toOwner()[0].body, /The screenshot could not be forwarded\. Open the chat in the Inbox/);
});

// ── Customer, before paying ────────────────────────────────────────────────

test('before paying the customer can edit: the old order closes and the form runs again', async () => {
  await place();
  await tap(ownerContact, 'o1', 'ok');
  net.sent = [];
  assert.equal(await tap(customer, 'o1', 'edit'), true);
  assert.equal(order1().status, 'CANCELLED');
  assert.equal(order1().cancelReason, 'customer_edit');
  assert.deepEqual(db.formStarts, ['PLACE ORDER']);
  assert.match(toOwner()[0].body, /changing order #1\. A new order will follow/);
});

test('before paying the customer can delete the order', async () => {
  await place();
  await tap(ownerContact, 'o1', 'ok');
  net.sent = [];
  await tap(customer, 'o1', 'delete');
  assert.equal(order1().cancelReason, 'customer_deleted');
  assert.deepEqual(toCust().map((m) => m.body), ['Order #1 has been deleted.']);
  assert.match(toOwner()[0].body, /The customer deleted order #1/);
});

test('once confirmed, the customer can no longer edit or delete', async () => {
  await place();
  await tap(ownerContact, 'o1', 'ok');
  await picture(customer);
  await tap(ownerContact, 'o1', 'paid');
  for (const action of ['edit', 'delete']) {
    net.sent = [];
    assert.equal(await tap(customer, 'o1', action), true);
    assert.equal(order1().status, 'CONFIRMED');
    assert.deepEqual(toCust().map((m) => m.body), ['Order #1 is already confirmed and can no longer be changed.']);
    assert.deepEqual(db.formStarts, []);
  }
});

// ── Who may press what ─────────────────────────────────────────────────────

test('a button only works for the person it was sent to', async () => {
  await place();
  // The customer somehow sends the owner's button.
  assert.equal(await tap(customer, 'o1', 'ok'), true);
  assert.equal(order1().status, 'PENDING_OWNER');
  assert.deepEqual(net.sent, []);
  // Another customer sends this customer's button.
  await tap(ownerContact, 'o1', 'change');
  await says(ownerContact, '3, 0, 5');
  net.sent = [];
  const stranger = { id: 'c2', name: 'Other', phoneNumber: '+919999999999' };
  assert.equal(await orders.handleOrderInbound({
    workspaceId: 'ws1', waNumber, fromPhone: stranger.phoneNumber, contact: stranger, conversation: { id: 'conv-x', waNumberId: 'wa1' },
    parsed: { type: 'INTERACTIVE', body: 'Accept', buttonPayload: actionId('o1', 'accept') },
  }), true);
  assert.equal(order1().status, 'PENDING_CUSTOMER');
  assert.deepEqual(net.sent, []);
});

test('a button tapped twice is answered, not acted on twice', async () => {
  await place();
  await tap(ownerContact, 'o1', 'ok');
  net.sent = [];
  await tap(ownerContact, 'o1', 'ok');
  assert.deepEqual(toOwner().map((m) => m.body), ['Order #1 is already waiting for payment.']);
  assert.deepEqual(toCust(), []);
});

test('messages that are not about an order are left for the rest of the automation', async () => {
  assert.equal(await says(customer, 'hello'), false);
  assert.equal(await picture(customer), false, 'a photo with no order waiting for payment');
  assert.equal(await inbound(customer, { type: 'INTERACTIVE', body: 'Place order', buttonPayload: 'place_order_0' }), false);
  assert.equal(await tap(customer, 'does-not-exist', 'accept'), false);
  db.flow.enabled = false;
  assert.equal(await says(ownerContact, 'hello'), false, 'owner approval is off');
  db.noTables = true;
  assert.equal(await says(customer, 'hello'), false);
});

// ── Owner out of reach ─────────────────────────────────────────────────────

test('when WhatsApp will not deliver to the owner, the workspace is told and the order waits', async () => {
  net.ownerUnreachable = true;
  const s = db.submissions.s1;
  await orders.placeOrder({ workspaceId: 'ws1', form, submission: s, contact: customer, answers: s.answers });
  assert.equal(order1().status, 'PENDING_OWNER');
  assert.equal(toCust().length, 1, 'the customer is still told');
  assert.equal(db.notifications.length, 1);
  assert.match(db.notifications[0].title, /Order #1 could not be sent to the owner/);

  // The owner messages the business number: every waiting order is sent again.
  net.ownerUnreachable = false; net.sent = [];
  assert.equal(await says(ownerContact, 'hi'), true);
  assert.deepEqual(toOwner().map((m) => titles(m)), [['Available', 'Edit quantities', 'Cancel order']]);

  db.orders[0].status = 'CONFIRMED'; net.sent = [];
  await says(ownerContact, 'hi');
  assert.deepEqual(toOwner().map((m) => m.body), ['No orders are waiting for you.']);
});

// ── Time limits ────────────────────────────────────────────────────────────

test('silence past the time limit cancels the order and offers tomorrow', async () => {
  await place();
  await tap(ownerContact, 'o1', 'ok');
  const later = new Date(Date.now() + 121 * 60_000);

  net.sent = [];
  assert.equal(await orders.sweepExpiredOrders(new Date()), 0, 'not due yet');
  assert.equal(order1().status, 'AWAITING_PAYMENT');

  assert.equal(await orders.sweepExpiredOrders(later), 1);
  assert.equal(order1().status, 'CANCELLED');
  assert.equal(order1().cancelReason, 'no_payment');
  assert.equal(db.submissions.s1.answers.__status, 'CANCELLED');
  assert.equal(toCust()[0].body, "We did not receive the payment for order #1 in time, so it has been cancelled. You can pre-book tomorrow's order: send PLACE ORDER any time.");
  assert.match(toOwner()[0].body, /Order #1 was cancelled: no payment from the customer in time/);

  net.sent = [];
  assert.equal(await orders.sweepExpiredOrders(later), 0, 'only once');
  assert.deepEqual(net.sent, []);
});

test('no answer to a revised order within the hour cancels it too', async () => {
  await place();
  await tap(ownerContact, 'o1', 'change');
  await says(ownerContact, '3, 0, 5');
  net.sent = [];
  assert.equal(await orders.sweepExpiredOrders(new Date(Date.now() + 61 * 60_000)), 1);
  assert.equal(order1().cancelReason, 'no_reply');
  assert.match(toCust()[0].body, /We did not hear back about order #1/);
});

test('an order waiting on the owner or already paid never expires', async () => {
  await place();
  assert.equal(await orders.sweepExpiredOrders(new Date(Date.now() + 10 * 24 * 3600_000)), 0);
  await tap(ownerContact, 'o1', 'ok');
  await picture(customer);
  assert.equal(await orders.sweepExpiredOrders(new Date(Date.now() + 10 * 24 * 3600_000)), 0);
  assert.equal(order1().status, 'PAYMENT_REVIEW');
});

// ── Settings ───────────────────────────────────────────────────────────────

test('settings: the owner number is required to turn it on, and values are checked', async () => {
  db.flow = null;
  assert.deepEqual(await orders.getOrderFlow('ws1', 'f1'), {
    enabled: false, ownerPhone: '', upiId: '', payeeName: '', bankDetails: '', hasQr: false,
    replyMinutes: 60, paymentMinutes: 120, cutoffTime: '', timezone: 'Asia/Kolkata',
  });
  assert.equal(await orders.activeFlow(form), null);
  await assert.rejects(orders.saveOrderFlow('ws1', 'f1', { enabled: true }), /Add the owner's WhatsApp number/);
  await assert.rejects(orders.saveOrderFlow('ws1', 'f1', { ownerPhone: '12345' }), /with the country code/);
  await assert.rejects(orders.saveOrderFlow('ws1', 'f1', { ownerPhone: OWNER, cutoffTime: '6pm' }), /must look like 18:00/);
  await assert.rejects(orders.saveOrderFlow('ws1', 'f1', { ownerPhone: OWNER, paymentMinutes: 2 }), /between 5 minutes and 24 hours/);

  const saved = await orders.saveOrderFlow('ws1', 'f1', {
    enabled: true, ownerPhone: '+91 90000 00001', upiId: ' farm@upi ', payeeName: 'Fresh Farm', bankDetails: 'A/C 1', replyMinutes: 60, paymentMinutes: 90, cutoffTime: '18:00',
  });
  assert.equal(saved.ownerPhone, OWNER);
  assert.equal(saved.upiId, 'farm@upi');
  assert.equal(saved.paymentMinutes, 90);
  assert.equal((await orders.activeFlow(form)).ownerPhone, OWNER);

  // The QR code is stored and reported, never sent back.
  const withQr = await orders.saveOrderFlowQr('ws1', 'f1', { buffer: Buffer.from('PNG'), mimeType: 'image/png' });
  assert.equal(withQr.hasQr, true);
  assert.equal((await orders.saveOrderFlowQr('ws1', 'f1', null)).hasQr, false);
});

test('past the cutoff the form is closed with a message; before it, or with no cutoff, it is open', async () => {
  assert.equal(await orders.ordersClosedMessage(form), null, 'no cutoff set');
  db.flow.cutoffTime = '00:00';
  assert.equal(await orders.ordersClosedMessage(form),
    "Orders for tomorrow's delivery are closed for today. You can pre-book the next day's order from tomorrow morning: send PLACE ORDER.");
  db.flow.enabled = false;
  assert.equal(await orders.ordersClosedMessage(form), null, 'owner approval is off');
});

test('the form editor lists orders with the customer and where each stands', async () => {
  await place();
  await tap(ownerContact, 'o1', 'ok');
  const list = await orders.listOrders('ws1', 'f1');
  assert.equal(list.length, 1);
  assert.deepEqual(
    { number: list[0].number, status: list[0].status, total: list[0].total, contactName: list[0].contactName },
    { number: 1, status: 'AWAITING_PAYMENT', total: 5950, contactName: 'krishna' },
  );
});
