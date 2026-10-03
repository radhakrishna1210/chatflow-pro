import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Nightly CRM upkeep and quote numbering under contention, against an
// in-memory prisma stand-in.

let staleLeads;
let refreshed;
let quoteUpdates;
let txAttempts;
let txFailures;

const p2002 = (target) => Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target } });

const fakePrisma = {
  lead: {
    findMany: async ({ where }) => {
      const excluded = new Set(where.id?.notIn ?? []);
      return staleLeads.filter((l) => !excluded.has(l.id)).slice(0, 200);
    },
    findFirst: async ({ where }) => ({ id: where.id, contactId: 'c1', score: 10 }),
  },
  quote: {
    updateMany: async (args) => { quoteUpdates.push(args); return { count: 3 }; },
  },
  $transaction: async (fn) => {
    txAttempts += 1;
    if (txFailures.length) throw txFailures.shift();
    return fn({
      quote: {
        findFirst: async (args) => (args.select?.quoteNumber ? { quoteNumber: 'Q-0007' } : { id: 'q1' }),
        create: async ({ data }) => ({ id: 'q1', ...data }),
      },
    });
  },
};

let svc;
let quotes;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: fakePrisma } });
  mock.module('./workflowCrm.service.js', { namedExports: { emitCrmEvent: () => {} } });
  mock.module('./crmEvents.service.js', { namedExports: { emitCrmEvent: () => {}, emitCrmEvents: () => {}, applyLeadStatus: async () => ({ changed: false }), currentChainDepth: () => undefined } });
  mock.module('./leadSegmentation.service.js', {
    namedExports: {
      computeLeadCategory: async (_ws, leadId) => {
        refreshed.push(leadId);
        // A refreshed lead is no longer stale.
        staleLeads = staleLeads.filter((l) => l.id !== leadId);
        if (leadId === 'bad') throw new Error('boom');
        return { id: leadId, score: 20 };
      },
    },
  });
  svc = await import('./crmMaintenance.service.js');
  quotes = await import('./quotes.service.js');
});

test.beforeEach(() => {
  staleLeads = [];
  refreshed = [];
  quoteUpdates = [];
  txAttempts = 0;
  txFailures = [];
});

test('the nightly sweep expires overdue draft and sent quotes', async () => {
  const now = new Date('2026-10-02T03:30:00Z');
  const res = await svc.runNightlyCrmSweep({ now });
  assert.equal(res.expired, 3);
  assert.deepEqual(quoteUpdates[0].where.status, { in: ['DRAFT', 'SENT'] });
  assert.deepEqual(quoteUpdates[0].where.validUntil, { lt: now });
  assert.deepEqual(quoteUpdates[0].data, { status: 'EXPIRED' });
});

test('stale leads are rescored once each and a failure does not stop the sweep', async () => {
  staleLeads = [
    { id: 'l1', workspaceId: 'ws1' },
    { id: 'bad', workspaceId: 'ws1' },
    { id: 'l2', workspaceId: 'ws2' },
  ];
  const res = await svc.rescoreStaleLeads();
  assert.deepEqual(refreshed, ['l1', 'bad', 'l2']);
  assert.deepEqual(res, { processed: 2, failed: 1 });
});

test('a quote number collision is retried with a fresh number', async () => {
  txFailures = [p2002(['workspaceId', 'quoteNumber'])];
  const quote = await quotes.createQuote('ws1', {}, 'u1');
  assert.equal(txAttempts, 2);
  assert.equal(quote.id, 'q1');
});

test('other unique violations are not retried', async () => {
  txFailures = [p2002(['somethingElse'])];
  await assert.rejects(() => quotes.createQuote('ws1', {}, 'u1'), (e) => e.code === 'P2002');
  assert.equal(txAttempts, 1);
});
