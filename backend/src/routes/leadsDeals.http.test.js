import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, mockIdentity, startApp } from './crmHttp.testutil.js';

// Lead conversion and deal stage moves through the real routers (CF-163,
// CF-071). These replace leads.convert.test.js (service called directly) and
// the DB-only leadsDeals.transactions.test.js, and add what neither covered:
// two converts racing over HTTP.

const store = createStore({
  defaults: {
    lead: { status: 'NEW', customFields: null, convertedDealId: null, ownerUserId: null },
    deal: { closedAt: null, lostReason: null },
  },
});
const events = [];
let app;
let Prisma;

const STAGES = ['QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST', 'PILOT'];

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: store.prisma } });
  mockIdentity(mock, { defaultRole: 'CLIENT' });
  mock.module('../services/workflowCrm.service.js', {
    namedExports: { emitCrmEvent: (_ws, event, payload) => events.push({ event, payload }) },
  });
  mock.module('../services/crmEvents.service.js', {
    namedExports: {
      emitCrmEvent: (_ws, event, payload) => events.push({ event, payload }),
      emitCrmEvents: (_ws, event, payloads) => payloads.forEach((payload) => events.push({ event, payload })),
      applyLeadStatus: async () => ({ changed: false }),
      currentChainDepth: () => undefined,
    },
  });
  mock.module('../services/dealHealth.service.js', {
    namedExports: { computeDealHealth: async () => null, computeWorkspaceDealHealth: async () => new Map() },
  });
  ({ Prisma } = await import('@prisma/client'));
  const { default: leads } = await import('./leads.routes.js');
  const { default: deals } = await import('./deals.routes.js');
  app = await startApp({ '/leads': leads, '/deals': deals });
});
test.after(() => app?.server.close());
test.beforeEach(() => {
  store.reset();
  events.length = 0;
  store.seed('workspace', { id: 'ws1', recordVisibility: 'ALL' }, { id: 'ws2', recordVisibility: 'ALL' });
  store.seed('workspaceMember', { userId: 'u1', workspaceId: 'ws1', role: 'CLIENT' }, { userId: 'u2', workspaceId: 'ws1', role: 'CLIENT' });
  store.seed('pipelineStage', ...STAGES.map((key, sortOrder) => ({ workspaceId: 'ws1', key, label: key, sortOrder, isActive: true })));
  store.seed('lead', { id: 'L', workspaceId: 'ws1', contactId: 'C', ownerUserId: 'u1' });
});

const convert = (body, opts) => app.call('POST', '/leads/L/convert', body, opts);
const move = (dealId, body, opts) => app.call('PATCH', `/deals/${dealId}/stage`, body, opts);

test('converting creates the deal and its first history row and marks the lead converted', async () => {
  const res = await convert({ title: 'Converted Deal', value: 5000 });
  assert.equal(res.status, 201);
  const deal = await res.json();
  const [lead] = store.rows('lead');
  assert.equal(lead.status, 'CONVERTED');
  assert.equal(lead.convertedDealId, deal.id);
  assert.ok(lead.convertedAt instanceof Date);
  assert.deepEqual(store.rows('dealStageHistory').map((h) => [h.fromStage, h.toStage]), [[null, 'QUALIFICATION']]);
  // The new deal entering its first stage is a stage change for workflows too.
  assert.deepEqual(events.map((e) => e.event), ['lead_status_changed', 'deal_stage_changed']);
  assert.deepEqual(events[1].payload, { dealId: deal.id, leadId: 'L', contactId: 'C', stage: 'QUALIFICATION', previousStage: null });
});

test('two concurrent converts create exactly one deal; the loser gets 409', async () => {
  const results = await Promise.all([convert({ title: 'A' }), convert({ title: 'B' })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(store.rows('deal').length, 1);
  assert.equal(store.rows('lead')[0].convertedDealId, store.rows('deal')[0].id);
  assert.equal(store.rows('dealStageHistory').length, 1);
  assert.equal(events.length, 2, 'only the winner tells workflows (its status change and the deal\'s first stage)');
});

test('converting an already-converted lead is refused with 409', async () => {
  assert.equal((await convert({ title: 'First' })).status, 201);
  assert.equal((await convert({ title: 'Second' })).status, 409);
  assert.equal(store.rows('deal').length, 1);
});

test('a custom stage keeps its key; a custom lifecycle key is cleared', async () => {
  store.rows('lead')[0].customFields = { statusKey: 'DEMO_BOOKED', note: 'keep' };
  const res = await convert({ title: 'X', stage: 'PILOT' });
  assert.equal((await res.json()).stage, 'PILOT');
  const [history] = store.rows('dealStageHistory');
  assert.equal(history.toStage, 'QUALIFICATION');
  assert.equal(history.toStageKey, 'PILOT');
  assert.deepEqual(store.rows('lead')[0].customFields, { note: 'keep' });
  assert.deepEqual(events[0].payload, { leadId: 'L', contactId: 'C', status: 'CONVERTED', previousStatus: 'DEMO_BOOKED' });
});

test('a lead whose only custom field was statusKey is left with a DB null', async () => {
  store.rows('lead')[0].customFields = { statusKey: 'DEMO_BOOKED' };
  await convert({ title: 'X' });
  assert.equal(store.rows('lead')[0].customFields, Prisma.DbNull);
});

test('conversion is scoped and validated at the route', async () => {
  store.rows('workspace')[0].recordVisibility = 'OWN';
  // Someone else's lead under OWN visibility is indistinguishable from none.
  assert.equal((await convert({ title: 'X' }, { user: 'u2' })).status, 404);
  assert.equal((await convert({ title: 'X', ownerUserId: 'stranger' })).status, 404);
  assert.equal((await convert({ title: 'X', stage: 'NOT_A_STAGE' })).status, 400);
  assert.equal((await convert({})).status, 400, 'a title is required');
  assert.equal((await convert({ title: 'X' }, { role: 'VIEWER' })).status, 403);
  assert.equal(store.rows('deal').length, 0);
  assert.equal(events.length, 0);
});

test('every stage move appends a history row and closes terminal stages', async () => {
  const deal = await (await convert({ title: 'Moving Deal' })).json();
  for (const stage of ['PROPOSAL', 'NEGOTIATION']) assert.equal((await move(deal.id, { stage })).status, 200);
  const won = await (await move(deal.id, { stage: 'CLOSED_WON' })).json();
  assert.equal(won.stage, 'CLOSED_WON');
  assert.ok(won.closedAt, 'a terminal stage sets closedAt');
  const history = store.rows('dealStageHistory');
  assert.deepEqual(history.map((h) => h.toStage), ['QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON']);
  assert.equal(history[1].fromStage, 'QUALIFICATION');
});

test('reopening a closed-lost deal clears the loss reason and close date', async () => {
  const deal = await (await convert({ title: 'Reopen Me' })).json();
  const lost = await (await move(deal.id, { stage: 'CLOSED_LOST', lostReason: 'Budget cut' })).json();
  assert.equal(lost.lostReason, 'Budget cut');
  assert.ok(lost.closedAt);
  const reopened = await (await move(deal.id, { stage: 'PROPOSAL' })).json();
  assert.equal(reopened.lostReason, null);
  assert.equal(reopened.closedAt, null);
});

test('a deal from another workspace is not reachable', async () => {
  const deal = await (await convert({ title: 'Private Deal' })).json();
  store.seed('pipelineStage', ...STAGES.map((key, sortOrder) => ({ workspaceId: 'ws2', key, label: key, sortOrder, isActive: true })));
  assert.equal((await move(deal.id, { stage: 'PROPOSAL' }, { workspace: 'ws2' })).status, 404);
  assert.equal((await app.call('GET', `/deals/${deal.id}`, undefined, { workspace: 'ws2' })).status, 404);
  assert.equal(store.rows('deal')[0].stage, 'QUALIFICATION');
});

test('recalculating a score goes through the real scorer and only fires on a change', async () => {
  store.seed('contact', { id: 'C', workspaceId: 'ws1', name: 'Asha', phoneNumber: '+919876543210', email: 'a@x.test', optedOut: false, tags: [] });
  store.rows('lead')[0].score = 0;
  const res = await app.call('POST', '/leads/L/recalculate-score');
  assert.equal(res.status, 200);
  const [lead] = store.rows('lead');
  assert.ok(lead.scoreComputedAt instanceof Date);
  assert.ok(Array.isArray(lead.scoreFactors));
  const fired = events.filter((e) => e.event === 'lead_score_changed').length;
  assert.equal(fired, lead.score === 0 ? 0 : 1);

  events.length = 0;
  await app.call('POST', '/leads/L/recalculate-score');
  assert.equal(events.filter((e) => e.event === 'lead_score_changed').length, 0, 'an unchanged score fires nothing');
  assert.equal((await app.call('POST', '/leads/L/recalculate-score', undefined, { workspace: 'ws2' })).status, 404);
});
