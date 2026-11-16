// Where the order form meets owner approval: finishing the form hands the
// order over instead of confirming it, and the daily cutoff closes the form.
import { test, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const form = {
  id: 'f1', workspaceId: 'ws1', name: 'Order', status: 'Active', keyword: 'PLACE ORDER',
  completionMessage: 'Total ₹{{= q1 * price}}',
  schema: [
    { key: 'qty', label: 'How many boxes?', type: 'number', required: true, options: [] },
    { key: 'address', label: 'Delivery address?', type: 'text', required: true, options: [] },
  ],
};
const contact = { id: 'c1', name: 'krishna', phoneNumber: '+919226381481', attributes: { price: '100' } };
const conversation = { id: 'conv1', waNumberId: 'wa1' };

const db = {};

let forms;
before(async () => {
  mock.module('../lib/prisma.js', {
    namedExports: {
      prisma: {
        whatsappFormSubmission: {
          findFirst: async () => db.open,
          create: async ({ data }) => { db.created.push(data); return { id: 's9', ...data }; },
          update: async (args) => { db.updates.push(args); return args; },
          findMany: async () => [],
        },
        whatsappForm: { update: async () => ({}), findFirst: async () => form, findMany: async () => [form] },
        contact: { findUnique: async () => contact, findMany: async () => [contact], update: async () => ({}) },
        workspaceCustomField: { findMany: async () => [] },
        workspace: { findUnique: async () => ({ orderingEnabled: true }) },
      },
    },
  });
  mock.module('./outbound.service.js', { namedExports: { sendAutomatedReply: async ({ body }) => { db.sent.push(body); } } });
  mock.module('./subscription.service.js', { namedExports: { assertWithinLimit: async () => {} } });
  mock.module('./automation.service.js', {
    namedExports: { keywordMatches: (keyword, body) => String(body).trim().toUpperCase() === keyword },
  });
  mock.module('./formOrder.service.js', {
    namedExports: {
      activeFlow: async () => (db.approvalOn ? { enabled: true, ownerPhone: '+919000000001' } : null),
      ordersClosedMessage: async () => db.closedMessage,
      placeOrder: async (args) => { if (db.placeFails) throw new Error('database down'); db.placed.push(args); return { id: 'o1' }; },
    },
  });
  forms = await import('./whatsappForms.service.js');
});

beforeEach(() => {
  Object.assign(db, {
    open: { id: 's1', formId: 'f1', conversationId: 'conv1', form, cursor: 1, completed: false, answers: { qty: '3' } },
    created: [], updates: [], sent: [], placed: [], approvalOn: true, closedMessage: null, placeFails: false,
  });
});

const inbound = (messageBody) => forms.handleFormInbound({ workspaceId: 'ws1', conversation, contact, messageBody });

test('with owner approval on, the finished form becomes a pending order, not a confirmed one', async () => {
  assert.equal(await inbound('Baner, Pune'), true);

  const saved = db.updates.find((u) => u.where.id === 's1').data;
  assert.equal(saved.completed, true);
  assert.deepEqual(saved.answers, { qty: '3', address: 'Baner, Pune', __total: 300, __status: 'PENDING' });

  assert.equal(db.placed.length, 1);
  assert.equal(db.placed[0].submission.id, 's1');
  assert.equal(db.placed[0].contact.id, 'c1');
  assert.equal(db.placed[0].answers.__status, 'PENDING');
  assert.deepEqual(db.sent, [], 'the usual closing message is not sent');
});

test('with owner approval off, the form confirms straight away as before', async () => {
  db.approvalOn = false;
  await inbound('Baner, Pune');
  const saved = db.updates.find((u) => u.where.id === 's1').data;
  assert.deepEqual(saved.answers, { qty: '3', address: 'Baner, Pune', __total: 300 });
  assert.deepEqual(db.placed, []);
  assert.deepEqual(db.sent, ['Total ₹300']);
});

test('if the order cannot be opened for approval, the customer still gets the closing message', async () => {
  db.placeFails = true;
  await inbound('Baner, Pune');
  assert.deepEqual(db.sent, ['Total ₹300']);
});

test('past the daily cutoff the form does not start', async () => {
  db.open = null;
  db.closedMessage = "Orders for tomorrow's delivery are closed for today.";
  assert.equal(await inbound('PLACE ORDER'), true);
  assert.deepEqual(db.sent, ["Orders for tomorrow's delivery are closed for today."]);
  assert.deepEqual(db.created, []);

  db.closedMessage = null; db.sent = [];
  assert.equal(await inbound('PLACE ORDER'), true);
  assert.equal(db.created.length, 1);
  assert.deepEqual(db.sent, ['How many boxes?']);
});
