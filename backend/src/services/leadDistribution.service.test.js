import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Round-robin assignment and assignee membership, against an in-memory
// prisma stand-in. The counter itself is a single UPDATE ... RETURNING, so
// the stand-in hands out sequential tickets the way the database would.

let rules;
let members;
let ticket;
let savedFilters;

const fakePrisma = {
  savedView: {
    findFirst: async () => (rules ? { id: 'v1', filters: rules } : null),
    update: async ({ data }) => { savedFilters = data.filters; },
    create: async ({ data }) => { savedFilters = data.filters; },
  },
  workspaceMember: {
    findMany: async ({ where }) => members
      .filter((m) => !where.userId?.in || where.userId.in.includes(m))
      .map((userId) => ({ userId })),
    findFirst: async ({ where }) => (members.includes(where.userId) ? { userId: where.userId } : null),
  },
  lead: {
    findFirst: async ({ where }) => ({ id: where.id, workspaceId: 'ws1', contactId: 'c1', category: 'HOT', score: 50, source: null, LeadFormSubmission: [] }),
    update: async ({ data }) => ({ owner: { name: data.ownerUserId } }),
  },
  crmActivity: { create: async () => ({}) },
  $queryRaw: async () => [{ ticket: BigInt(++ticket) }],
};

let svc;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: fakePrisma } });
  mock.module('./workflowCrm.service.js', { namedExports: { emitCrmEvent: () => {} } });
  mock.module('./crmEvents.service.js', { namedExports: { emitCrmEvent: () => {}, emitCrmEvents: () => {}, applyLeadStatus: async () => ({ changed: false }), currentChainDepth: () => undefined } });
  svc = await import('./leadDistribution.service.js');
});

test.beforeEach(() => {
  members = ['u1', 'u2'];
  ticket = 0;
  savedFilters = null;
  rules = {
    enabled: true,
    roundRobinIndex: 0,
    rules: [{ name: 'All', enabled: true, conditions: {}, assignment: { type: 'ROUND_ROBIN', poolUserIds: ['u1', 'foreign', 'u2'] } }],
  };
});

test('round robin cycles through workspace members only', async () => {
  const owners = [];
  for (const id of ['l1', 'l2', 'l3', 'l4']) {
    const res = await svc.evaluateAndAssignLead('ws1', id);
    owners.push(res.ownerUserId);
  }
  assert.deepEqual(owners, ['u1', 'u2', 'u1', 'u2']);
  assert.equal(savedFilters, null, 'assignment must not rewrite the stored rules');
});

test('saving rules that name a non-member is refused', async () => {
  await assert.rejects(
    () => svc.saveDistributionRules('ws1', { enabled: true, rules: rules.rules }),
    (e) => e.status === 400,
  );
});

test('saving rules with members only succeeds', async () => {
  const valid = [{ ...rules.rules[0], assignment: { type: 'ROUND_ROBIN', poolUserIds: ['u1', 'u2'] } }];
  await svc.saveDistributionRules('ws1', { enabled: true, rules: valid });
  assert.deepEqual(savedFilters.rules, valid);
});
