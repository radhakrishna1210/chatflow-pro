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

const db = { open: null, updates: [], sent: [], submissions: [], ordering: true };

let service;
before(async () => {
  mock.module('../lib/prisma.js', {
    namedExports: {
      prisma: {
        whatsappFormSubmission: {
          findFirst: async () => db.open,
          update: async (args) => { db.updates.push(args); return args; },
          findMany: async (args) => { db.lastFind = args; return db.submissions; },
        },
        whatsappForm: {
          update: async () => ({}),
          findFirst: async () => form,
          findMany: async () => [],
        },
        contact: {
          findUnique: async () => contact,
          findMany: async () => [contact],
          update: async () => ({}),
        },
        workspaceCustomField: { findMany: async () => [] },
        workspace: {
          findUnique: async () => ({ orderingEnabled: db.ordering }),
          update: async ({ data }) => { db.ordering = data.orderingEnabled; return { orderingEnabled: db.ordering }; },
        },
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

beforeEach(() => { db.updates = []; db.sent = []; db.ordering = true; });

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
  assert.equal(rows[0].totalEstimated, false);
  assert.equal(rows[1].total, null); // not finished
});

test('a finished order without a saved total gets one worked out, flagged', async () => {
  const before = db.submissions;
  db.submissions = [{ id: 's3', contactId: 'c1', createdAt: new Date(), completed: true, cursor: 2, answers: { oyster_kg: '1', milky_kg: '2' } }];
  const [row] = await service.listSubmissions('ws1', 'f1');
  assert.equal(row.total, 465); // 1 × 165 + 2 × 150
  assert.equal(row.totalEstimated, true);
  db.submissions = before;
});

test('export can be narrowed to a time window (today)', async () => {
  const from = '2026-11-02T18:30:00.000Z'; // midnight IST
  const to = '2026-11-03T18:30:00.000Z';
  const { filename } = await service.exportSubmissionsCsv('ws1', 'f1', { from, to, label: '2026-11-03' });
  assert.deepEqual(db.lastFind.where.createdAt, { gte: new Date(from), lt: new Date(to) });
  assert.equal(filename, 'mushroom_order_submissions_2026-11-03.csv');

  await service.exportSubmissionsCsv('ws1', 'f1');
  assert.equal(db.lastFind.where.createdAt, undefined);

  await assert.rejects(service.exportSubmissionsCsv('ws1', 'f1', { from: 'yesterday-ish' }), /from must be a date/);
  const { filename: odd } = await service.exportSubmissionsCsv('ws1', 'f1', { label: '../../etc' });
  assert.equal(odd, 'mushroom_order_submissions.csv');
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

// ── Workspaces without "Orders with per-customer prices" ───────────────────

test('ordering off: closing message is sent exactly as written, no total saved', async () => {
  db.ordering = false;
  db.open = { id: 's9', formId: 'f1', form, cursor: 1, answers: { oyster_kg: '2' } };
  await service.handleFormInbound({
    workspaceId: 'ws1', conversation: { id: 'conv1', waNumberId: 'wa1' }, contact, messageBody: '1',
  });
  const saved = db.updates.find((u) => u.where.id === 's9').data;
  assert.deepEqual(saved.answers, { oyster_kg: '2', milky_kg: '1' });
  assert.equal(db.sent.at(-1), CLOSING);
});

test('ordering off: no totals in the list, no Total column in the export', async () => {
  db.ordering = false;
  const before = db.submissions;
  db.submissions = [
    { id: 's1', contactId: 'c1', createdAt: new Date('2026-11-03T13:55:00Z'), completed: true, cursor: 2, answers: { oyster_kg: '2', milky_kg: '1', __total: 480 } },
  ];
  const [row] = await service.listSubmissions('ws1', 'f1');
  assert.equal(row.total, null);
  assert.equal(row.totalEstimated, false);
  assert.equal(row.contactName, 'Harshal'); // customer columns stay for everyone
  const { csv } = await service.exportSubmissionsCsv('ws1', 'f1');
  const [header, line] = csv.split('\r\n');
  assert.equal(header, '"When","Customer","Phone","How many kg of Oyster?","How many kg of Milky?","Status"');
  assert.equal(line, '"2026-11-03T13:55:00.000Z","Harshal","+919322126234","2","1","Complete"');
  db.submissions = before;
});

test('pick several: a whole order conversation asks only for the picked mushrooms', async () => {
  const schema = service.normalizeSchema([
    { label: 'Which mushrooms do you want?', type: 'multi', options: ['Oyster', 'Button', 'Shiitake', 'Milky'] },
    { label: 'How many kg of Oyster?', type: 'number', showIf: { question: 1, option: 'Oyster' } },
    { label: 'How many kg of Button?', type: 'number', showIf: { question: 1, option: 'Button' } },
    { label: 'How many kg of Shiitake?', type: 'number', showIf: { question: 1, option: 'Shiitake' } },
    { label: 'How many kg of Milky?', type: 'number', showIf: { question: 1, option: 'Milky' } },
    { label: 'Your full delivery address?', type: 'text' },
  ]);
  assert.deepEqual(schema[3].showIf, { question: 1, option: 'Shiitake' });
  const shop = { ...form, schema, completionMessage: [
    '{{? q2}}Oyster: {{q2}} kg = ₹{{= q2 * oyster_price}}',
    '{{? q5}}Milky: {{q5}} kg = ₹{{= q5 * milky_price}}',
    'Total ₹{{= q2*oyster_price + q5*milky_price}}',
  ].join('\n') };

  db.open = { id: 'm1', formId: 'f1', form: shop, cursor: 0, answers: {} };
  const say = async (text) => {
    await service.handleFormInbound({ workspaceId: 'ws1', conversation: { id: 'conv1', waNumberId: 'wa1' }, contact, messageBody: text });
    const last = db.updates.at(-1)?.data;
    if (last) db.open = { ...db.open, cursor: last.cursor ?? db.open.cursor, answers: last.answers ?? db.open.answers };
    return db.sent.at(-1);
  };

  assert.match(await say('1, 9'), /numbers of the ones you want/); // 9 is not an option
  assert.equal(await say('1 and 4'), 'How many kg of Oyster?');
  assert.equal(await say('2'), 'How many kg of Milky?'); // Button and Shiitake skipped
  assert.equal(await say('1'), 'Your full delivery address?');
  assert.equal(await say('Narhe, Pune'), 'Oyster: 2 kg = ₹330\nMilky: 1 kg = ₹150\nTotal ₹480');
  const saved = db.updates.at(-1).data;
  assert.equal(saved.completed, true);
  assert.equal(saved.answers.which_mushrooms_do_you_want, 'Oyster, Milky');
  assert.equal(saved.answers.how_many_kg_of_button, '0');
  assert.equal(saved.answers.__total, 480);
});

test('settings: read and switch the workspace setting', async () => {
  db.ordering = false;
  assert.deepEqual(await service.getFormSettings('ws1'), { orderingEnabled: false });
  assert.deepEqual(await service.updateFormSettings('ws1', { orderingEnabled: true }), { orderingEnabled: true });
  await assert.rejects(service.updateFormSettings('ws1', { orderingEnabled: 'yes' }), /true or false/);
});
