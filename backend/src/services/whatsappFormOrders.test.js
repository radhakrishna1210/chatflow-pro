// Form submissions as orders: the total is saved when the form finishes, and
// the submissions list / CSV export show who placed each order.
import { test, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { closingTotal } from '../lib/formMessage.js';

const CLOSING = 'Oyster ₹{{= q1 * oyster_price}}\nTotal ₹{{= q1*oyster_price + q2*milky_price}}';
const form = {
  id: 'f1', workspaceId: 'ws1', name: 'Mushroom Order', completionMessage: CLOSING,
  schema: [
    { key: 'oyster_kg', label: 'How many kg of Oyster?', type: 'number' },
    { key: 'milky_kg', label: 'How many kg of Milky?', type: 'number' },
  ],
};
const contact = {
  id: 'c1', name: 'Harshal', phoneNumber: '+919322126234',
  attributes: { oyster_price: '165', milky_price: '150' },
};

const db = { open: null, updates: [], sent: [], submissions: [] };

let service;
before(async () => {
  mock.module('../lib/prisma.js', {
    namedExports: {
      prisma: {
        whatsappFormSubmission: {
          findFirst: async () => db.open,
          update: async (args) => { db.updates.push(args); return args; },
          findMany: async () => db.submissions,
        },
        whatsappForm: {
          update: async () => ({}),
          findFirst: async () => form,
          findMany: async () => [],
        },
        contact: {
          findUnique: async () => contact,
          findMany: async () => [{ id: 'c1', name: 'Harshal', phoneNumber: '+919322126234' }],
          update: async () => ({}),
        },
        workspaceCustomField: { findMany: async () => [] },
      },
    },
  });
  mock.module('./outbound.service.js', {
    namedExports: { sendAutomatedReply: async ({ body }) => { db.sent.push(body); } },
  });
  mock.module('./subscription.service.js', { namedExports: { assertWithinLimit: async () => {} } });
  mock.module('./automation.service.js', { namedExports: { keywordMatches: () => false } });
  service = await import('./whatsappForms.service.js');
});

beforeEach(() => { db.updates = []; db.sent = []; });

test('closingTotal is the last calculation in the closing message', () => {
  const answers = { oyster_kg: '2', milky_kg: '1' };
  assert.equal(closingTotal(CLOSING, { contact, fields: form.schema, answers }), 480);
  assert.equal(closingTotal('Thanks!', { contact, fields: form.schema, answers }), null);
  assert.equal(closingTotal('₹{{= q1 * nothing}}', { contact, fields: form.schema, answers }), null);
});

test('finishing the form saves the total and sends the receipt', async () => {
  db.open = { id: 's1', formId: 'f1', form, cursor: 1, answers: { oyster_kg: '2' } };
  const handled = await service.handleFormInbound({
    workspaceId: 'ws1', conversation: { id: 'conv1', waNumberId: 'wa1' }, contact, messageBody: '1',
  });
  assert.equal(handled, true);
  const saved = db.updates.find((u) => u.where.id === 's1').data;
  assert.equal(saved.completed, true);
  assert.deepEqual(saved.answers, { oyster_kg: '2', milky_kg: '1', __total: 480 });
  assert.equal(db.sent.at(-1), 'Oyster ₹330\nTotal ₹480');
});

test('submissions list carries customer name, phone and total', async () => {
  db.submissions = [
    { id: 's1', contactId: 'c1', createdAt: new Date('2026-11-03T13:55:00Z'), completed: true, cursor: 2, answers: { oyster_kg: '2', milky_kg: '1', __total: 480 } },
    { id: 's2', contactId: 'c1', createdAt: new Date('2026-11-03T12:00:00Z'), completed: false, cursor: 1, answers: { oyster_kg: '3' } },
  ];
  const rows = await service.listSubmissions('ws1', 'f1');
  assert.equal(rows[0].contactName, 'Harshal');
  assert.equal(rows[0].contactPhone, '+919322126234');
  assert.equal(rows[0].total, 480);
  assert.equal(rows[1].total, null);
});

test('CSV export has customer, phone, answers, total and status', async () => {
  const { csv, filename, count } = await service.exportSubmissionsCsv('ws1', 'f1');
  assert.equal(filename, 'mushroom_order_submissions.csv');
  assert.equal(count, 2);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '"When","Customer","Phone","How many kg of Oyster?","How many kg of Milky?","Total","Status"');
  assert.equal(lines[1], '"2026-11-03T13:55:00.000Z","Harshal","+919322126234","2","1","480","Complete"');
  assert.equal(lines[2], '"2026-11-03T12:00:00.000Z","Harshal","+919322126234","3","","","Stopped at Q2"');
});
