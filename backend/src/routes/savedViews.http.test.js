import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, mockIdentity, startApp } from './crmHttp.testutil.js';

// Saved views through the real router (CF-163). These replace the DB-only
// service tests, which called the service with inputs the route never
// validated and were skipped wherever there was no database.

const store = createStore();
let app;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: store.prisma } });
  mockIdentity(mock, { defaultRole: 'CLIENT' });
  const { default: savedViews } = await import('./savedViews.routes.js');
  app = await startApp({ '/saved-views': savedViews });
});
test.after(() => app?.server.close());
test.beforeEach(() => store.reset());

const save = (body, opts) => app.call('POST', '/saved-views', body, opts);
const list = async (query = '', opts) => (await app.call('GET', `/saved-views${query}`, undefined, opts)).json();

test('a view round-trips its filters', async () => {
  const res = await save({ entity: 'leads', name: 'Hot leads', filters: { status: 'QUALIFIED', sort: 'score', minScore: 70 } });
  assert.equal(res.status, 201);
  const view = await res.json();
  assert.deepEqual(view.filters, { status: 'QUALIFIED', sort: 'score', minScore: 70 });
  assert.equal(view.isShared, false);
  assert.equal(view.createdByUserId, 'u1');
});

test('re-saving the same name updates in place instead of duplicating', async () => {
  const first = await (await save({ entity: 'deals', name: 'Closing soon', filters: { stage: 'PROPOSAL' } })).json();
  const second = await (await save({ entity: 'deals', name: 'Closing soon', filters: { stage: 'NEGOTIATION' } })).json();
  assert.equal(second.id, first.id);
  const { data } = await list('?entity=deals');
  assert.equal(data.length, 1);
  assert.deepEqual(data[0].filters, { stage: 'NEGOTIATION' });
});

test('a private view is invisible to everyone but its author', async () => {
  await save({ entity: 'tasks', name: 'Mine', filters: {} });
  assert.equal((await list('?entity=tasks')).data.length, 1);
  assert.equal((await list('?entity=tasks', { user: 'u2' })).data.length, 0);
});

test('a shared view is readable by the workspace but only its author may change it', async () => {
  const shared = await (await save({ entity: 'leads', name: 'Team pipeline', filters: {}, isShared: true })).json();
  assert.ok((await list('?entity=leads', { user: 'u2' })).data.some((v) => v.id === shared.id));

  assert.equal((await app.call('PATCH', `/saved-views/${shared.id}`, { name: 'Hijacked' }, { user: 'u2' })).status, 403);
  assert.equal((await app.call('DELETE', `/saved-views/${shared.id}`, undefined, { user: 'u2' })).status, 403);
  assert.equal(store.rows('savedView')[0].name, 'Team pipeline');

  const renamed = await app.call('PATCH', `/saved-views/${shared.id}`, { name: 'Renamed', isShared: false });
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).name, 'Renamed');
  assert.equal((await app.call('DELETE', `/saved-views/${shared.id}`)).status, 204);
  assert.equal(store.rows('savedView').length, 0);
});

test('unknown entities and unknown fields are refused at the route', async () => {
  assert.equal((await save({ entity: 'invoices', name: 'Nope' })).status, 400);
  assert.equal((await app.call('GET', '/saved-views?entity=invoices')).status, 400);
  // The update schema is strict: entity/workspace cannot be rewritten.
  const view = await (await save({ entity: 'leads', name: 'X' })).json();
  assert.equal((await app.call('PATCH', `/saved-views/${view.id}`, { entity: 'deals' })).status, 400);
});

test('viewers cannot save views', async () => {
  assert.equal((await save({ entity: 'leads', name: 'V' }, { role: 'VIEWER' })).status, 403);
});

test('configuration rows sharing the table are neither listed nor deletable', async () => {
  store.seed('savedView',
    { id: 'cfg', workspaceId: 'ws1', entity: 'crm_customization', name: '__CRM_CUSTOMIZATION_LEAD_TAGS__', createdByUserId: 'u1', isShared: true, filters: {} },
    { id: 'rules', workspaceId: 'ws1', entity: 'lead_distribution_rules', name: 'rules', createdByUserId: null, isShared: true, filters: {} });
  assert.deepEqual((await list()).data, []);
  // Not even by their author.
  assert.equal((await app.call('DELETE', '/saved-views/cfg')).status, 404);
  assert.equal((await app.call('PATCH', '/saved-views/cfg', { isShared: false })).status, 404);
  assert.equal(store.rows('savedView').length, 2);
});

test('views from another workspace are never returned', async () => {
  await save({ entity: 'leads', name: 'Foreign', isShared: true }, { workspace: 'ws2' });
  assert.equal((await list()).data.length, 0);
});
