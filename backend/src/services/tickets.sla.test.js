import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { unscopedRecordScope } from './recordScope.testStub.js';

// Category SLAs and first-response stamping, against an in-memory prisma
// stand-in.

const CONFIG = {
  categories: [
    { name: 'Account Access', slaHours: 4, priority: 'URGENT' },
    { name: 'No Target', slaHours: null },
  ],
};

let created;
let updateManyArgs;

const fakePrisma = {
  crmTicket: {
    findFirst: async () => ({ ticketNumber: 'T-0001' }),
    create: async ({ data }) => { created = data; return data; },
    updateMany: async (args) => { updateManyArgs = args; return { count: 1 }; },
  },
  $transaction: async (fn) => fn(fakePrisma),
};

let svc;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: fakePrisma } });
  mock.module('./crmCustomization.service.js', { namedExports: { getSection: async () => CONFIG } });
  mock.module('./recordScope.service.js', { namedExports: unscopedRecordScope });
  svc = await import('./tickets.service.js');
});

const hoursUntil = (date) => Math.round((date.getTime() - Date.now()) / 3600_000);

test('a category SLA overrides the priority default', async () => {
  await svc.createTicket('ws1', { subject: 'Locked out', priority: 'LOW', category: 'account access' });
  assert.equal(hoursUntil(created.dueAt), 4);
});

test('without a category SLA the priority default applies', async () => {
  await svc.createTicket('ws1', { subject: 'Hi', priority: 'LOW', category: 'No Target' });
  assert.equal(hoursUntil(created.dueAt), svc.SLA_HOURS.LOW);
  await svc.createTicket('ws1', { subject: 'Hi', priority: 'HIGH' });
  assert.equal(hoursUntil(created.dueAt), svc.SLA_HOURS.HIGH);
});

test('categorySlaHours ignores missing or non-positive targets', () => {
  assert.equal(svc.categorySlaHours(CONFIG, 'Account Access'), 4);
  assert.equal(svc.categorySlaHours(CONFIG, 'No Target'), null);
  assert.equal(svc.categorySlaHours(CONFIG, 'Unknown'), null);
  assert.equal(svc.categorySlaHours(null, 'Account Access'), null);
});

test('an agent reply stamps first response only on open, unstamped tickets', async () => {
  await svc.markFirstResponseForConversation('ws1', 'conv1');
  assert.deepEqual(updateManyArgs.where, {
    workspaceId: 'ws1', conversationId: 'conv1', firstRespondedAt: null, status: { notIn: ['RESOLVED', 'CLOSED'] },
  });
});
