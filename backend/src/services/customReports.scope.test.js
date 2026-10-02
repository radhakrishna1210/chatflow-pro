import test from 'node:test';
import assert from 'node:assert/strict';

// Custom reports without a database: input validation, record visibility,
// custom status/stage keys, and who may delete a saved report.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;

const { prisma } = await import('../lib/prisma.js');
const { executeCustomReport, deleteSavedReport } = await import('./customReports.service.js');
const { reportSchemas } = await import('../validators/index.js');

const queries = [];
prisma.workspace.findUnique = async () => ({ recordVisibility: 'OWN' });
prisma.lead.groupBy = async (args) => { queries.push(args.where); return []; };
prisma.deal.groupBy = async (args) => { queries.push(args.where); return []; };
prisma.crmActivity.groupBy = async (args) => { queries.push(args.where); return []; };

let report;
const deleted = [];
prisma.savedView.findFirst = async () => report;
prisma.savedView.delete = async ({ where }) => { deleted.push(where.id); };

const me = { id: 'me', role: 'CLIENT' };
const ownScope = { OR: [{ ownerUserId: 'me' }, { ownerUserId: null }] };

test.beforeEach(() => { queries.length = 0; deleted.length = 0; });

test('the query schema rejects unknown entities and bad activity types, and strips template extras', () => {
  assert.equal(reportSchemas.query.safeParse({ entity: 'users' }).success, false);
  assert.equal(reportSchemas.query.safeParse({ entity: 'activities', filters: { type: 'FAX' } }).success, false);
  const parsed = reportSchemas.query.parse({ entity: 'leads', id: 'tmpl', description: 'x', filters: { category: 'HOT' } });
  assert.deepEqual(parsed, { entity: 'leads', metric: 'count', groupBy: 'source', filters: { category: 'HOT' }, range: '30d' });
  assert.equal(reportSchemas.save.safeParse({ name: '', config: {} }).success, false);
});

test('lead and deal reports are AND-scoped for OWN members', async () => {
  await executeCustomReport('ws', { entity: 'leads', groupBy: 'status', filters: { status: 'NEW' } }, me);
  await executeCustomReport('ws', { entity: 'deals', groupBy: 'stage', filters: { stage: 'PROPOSAL' } }, me);
  assert.deepEqual(queries[0].AND, [ownScope]);
  assert.equal(queries[0].status, 'NEW');
  assert.deepEqual(queries[1].AND, [ownScope]);
  assert.equal(queries[1].stage, 'PROPOSAL');
});

test('activity reports use the activity scope', async () => {
  await executeCustomReport('ws', { entity: 'activities', groupBy: 'type' }, me);
  assert.equal(queries[0].AND.length, 1);
  assert.ok(queries[0].AND[0].OR.some((c) => c.createdByUserId === 'me'));
});

test('custom lifecycle statuses and stage keys filter customFields instead of the enum', async () => {
  await executeCustomReport('ws', { entity: 'leads', groupBy: 'status', filters: { status: 'DEMO_BOOKED' } }, me);
  await executeCustomReport('ws', { entity: 'deals', groupBy: 'stage', filters: { stage: 'PILOT' } }, me);
  assert.equal(queries[0].status, undefined);
  assert.deepEqual(queries[0].customFields, { path: ['statusKey'], equals: 'DEMO_BOOKED' });
  assert.equal(queries[1].stage, undefined);
  assert.deepEqual(queries[1].customFields, { path: ['stageKey'], equals: 'PILOT' });
});

test('only the author or an admin can delete a shared report; a private one is invisible to others', async () => {
  report = { id: 'r1', createdByUserId: 'someone', isShared: true };
  await assert.rejects(deleteSavedReport('ws', 'r1', me), (e) => e.status === 403);
  await deleteSavedReport('ws', 'r1', { id: 'boss', role: 'ADMIN' });
  report = { id: 'r2', createdByUserId: 'someone', isShared: false };
  await assert.rejects(deleteSavedReport('ws', 'r2', me), (e) => e.status === 404);
  report = { id: 'r3', createdByUserId: 'me', isShared: false };
  await deleteSavedReport('ws', 'r3', me);
  assert.deepEqual(deleted, ['r1', 'r3']);
});
