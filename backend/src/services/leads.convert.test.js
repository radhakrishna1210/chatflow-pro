import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Lead → deal conversion: scoped like every other lead path, claims the lead
// before creating the deal so a concurrent second convert cannot create a
// duplicate, clears a custom lifecycle key, and tells workflows about it.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;

const events = [];
mock.module('./workflowCrm.service.js', {
  namedExports: { emitCrmEvent: (ws, event, payload) => events.push({ event, payload }) },
});

const { Prisma } = await import('@prisma/client');
const { prisma } = await import('../lib/prisma.js');
const { convertLead } = await import('./leads.service.js');

let lead;
let claimCount;
const writes = [];

prisma.workspace.findUnique = async () => ({ recordVisibility: 'OWN' });
// convertLead refuses stages the workspace has not configured; PILOT is one
// custom stage alongside the defaults.
prisma.pipelineStage.findMany = async () => ['QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST', 'PILOT']
  .map((key, sortOrder) => ({ key, sortOrder }));
prisma.pipelineStage.createMany = async () => ({ count: 0 });
prisma.workspaceMember.findUnique = async ({ where }) => (where.userId_workspaceId.userId === 'me' ? { userId: 'me' } : null);
const tx = {
  lead: {
    findFirst: async ({ where }) => {
      const scope = where.AND?.[0];
      if (scope && lead.ownerUserId && !scope.OR.some((c) => c.ownerUserId === lead.ownerUserId)) return null;
      return lead;
    },
    updateMany: async (args) => { writes.push(['claim', args]); return { count: claimCount }; },
    update: async (args) => { writes.push(['lead', args]); return lead; },
  },
  deal: { create: async (args) => { writes.push(['deal', args]); return { id: 'deal_1', ...args.data }; } },
  dealStageHistory: { create: async (args) => { writes.push(['history', args]); return {}; } },
};
prisma.$transaction = async (fn) => fn(tx);

const me = { id: 'me', role: 'CLIENT' };

test.beforeEach(() => {
  lead = { id: 'L', workspaceId: 'ws', contactId: 'C', ownerUserId: 'me', status: 'NEW', customFields: { statusKey: 'DEMO_BOOKED', note: 'keep' }, convertedDealId: null };
  claimCount = 1;
  writes.length = 0;
  events.length = 0;
});

test('claims the lead conditionally, clears statusKey, records the custom stage key and emits', async () => {
  const deal = await convertLead('ws', 'L', { title: 'X', stage: 'PILOT' }, 'me', me);
  assert.equal(deal.stage, 'PILOT');

  const [kind, claim] = writes[0];
  assert.equal(kind, 'claim', 'the claim happens before the deal is created');
  assert.deepEqual(claim.where, { id: 'L', workspaceId: 'ws', convertedDealId: null, status: { not: 'CONVERTED' } });
  assert.equal(claim.data.status, 'CONVERTED');
  assert.deepEqual(claim.data.customFields, { note: 'keep' });

  const history = writes.find(([k]) => k === 'history')[1].data;
  assert.equal(history.toStage, 'QUALIFICATION');
  assert.equal(history.toStageKey, 'PILOT');

  assert.deepEqual(events, [{ event: 'lead_status_changed', payload: { leadId: 'L', contactId: 'C', status: 'CONVERTED', previousStatus: 'DEMO_BOOKED' } }]);
});

test('a lead whose only custom field was statusKey gets a DB null', async () => {
  lead.customFields = { statusKey: 'DEMO_BOOKED' };
  await convertLead('ws', 'L', { title: 'X' }, 'me', me);
  assert.equal(writes[0][1].data.customFields, Prisma.DbNull);
});

test('losing the race returns 409 and creates no deal', async () => {
  claimCount = 0;
  await assert.rejects(convertLead('ws', 'L', { title: 'X' }, 'me', me), (e) => e.status === 409);
  assert.ok(!writes.some(([k]) => k === 'deal'));
  assert.equal(events.length, 0);
});

test('an out-of-scope lead is a 404, and a non-member owner is refused', async () => {
  lead.ownerUserId = 'someone_else';
  await assert.rejects(convertLead('ws', 'L', { title: 'X' }, 'me', me), (e) => e.status === 404);
  lead.ownerUserId = 'me';
  await assert.rejects(convertLead('ws', 'L', { title: 'X', ownerUserId: 'outsider' }, 'me', me), (e) => e.status === 404 && /Owner/.test(e.message));
  assert.equal(writes.length, 0);
});
