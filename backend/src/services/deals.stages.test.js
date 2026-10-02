import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Custom pipeline stages are stored as customFields.stageKey over the
// QUALIFICATION enum. These run against an in-memory prisma stand-in.

const STAGES = [
  { key: 'QUALIFICATION', probability: 10 },
  { key: 'PROPOSAL', probability: 50 },
  { key: 'SITE_VISIT', probability: 60 },
  { key: 'CLOSED_WON', probability: 100 },
  { key: 'CLOSED_LOST', probability: 0 },
];

let deals = [];
let lastDealWhere = null;

const fakePrisma = {
  contact: { findFirst: async () => ({ id: 'c1' }) },
  pipelineStage: {
    findMany: async () => STAGES.map((s, i) => ({ ...s, sortOrder: i })),
    createMany: async () => ({ count: 0 }),
  },
  deal: {
    findMany: async ({ where }) => {
      lastDealWhere = where;
      if (where.stage?.in) return [];
      return deals;
    },
    count: async () => deals.length,
  },
};

let listDeals;
let createDeal;
let getForecast;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: fakePrisma } });
  mock.module('./dealHealth.service.js', {
    namedExports: { computeWorkspaceDealHealth: async () => new Map(), computeDealHealth: async () => null },
  });
  mock.module('./recordScope.service.js', { namedExports: { scopeFilter: async () => ({}) } });
  mock.module('./workflowCrm.service.js', { namedExports: { emitCrmEvent: () => {} } });
  ({ listDeals, createDeal } = await import('./deals.service.js'));
  ({ getForecast } = await import('./forecast.service.js'));
});

test('a built-in stage filter keeps deals that carry other custom-field values', async () => {
  deals = [
    { id: 'a', stage: 'PROPOSAL', customFields: null },
    { id: 'b', stage: 'PROPOSAL', customFields: { region: 'EU' } },
    { id: 'c', stage: 'QUALIFICATION', customFields: { stageKey: 'PROPOSAL' } },
    { id: 'd', stage: 'QUALIFICATION', customFields: { stageKey: 'SITE_VISIT' } },
  ];
  const { data, total } = await listDeals('ws1', { stage: 'PROPOSAL' });
  assert.deepEqual(data.map((d) => d.id), ['a', 'b', 'c']);
  assert.equal(total, 3);
  assert.ok(Array.isArray(lastDealWhere.AND), 'stage filter must not overwrite a scope OR');
});

test('a deal stored on QUALIFICATION with a custom stageKey is not listed as QUALIFICATION', async () => {
  deals = [
    { id: 'q', stage: 'QUALIFICATION', customFields: { notes: 'x' } },
    { id: 's', stage: 'QUALIFICATION', customFields: { stageKey: 'SITE_VISIT' } },
  ];
  const { data } = await listDeals('ws1', { stage: 'QUALIFICATION' });
  assert.deepEqual(data.map((d) => d.id), ['q']);
});

test('forecast weights a custom-stage deal by that stage probability', async () => {
  deals = [
    { id: 's', stage: 'QUALIFICATION', customFields: { stageKey: 'SITE_VISIT' }, value: 1000, ownerUserId: null },
    { id: 'q', stage: 'QUALIFICATION', customFields: null, value: 1000, ownerUserId: null },
  ];
  const result = await getForecast('ws1', { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(result.totals.bestCase.weighted, 600);
  assert.equal(result.totals.pipeline.weighted, 100);
});

test('an unknown stage key is rejected', async () => {
  await assert.rejects(
    () => createDeal('ws1', { contactId: 'c1', title: 'x', stage: 'TYPO' }, 'u1'),
    (e) => e.status === 400 && /Unknown pipeline stage/.test(e.message),
  );
});
