import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// HTTP-level checks for CRM routes: the real routers, validate() and
// authorize() run against an in-memory prisma stand-in. Service-only tests
// passed while these endpoints were unreachable, because the route validators
// disagreed with what the services and UI actually send.

const state = {};

function reset() {
  state.savedViews = [];
  state.fieldDefs = [];
  state.leads = [];
  state.members = [];
  state.createdTasks = [];
  state.leadUpdates = [];
}

const fakePrisma = {
  savedView: {
    findFirst: async ({ where }) => state.savedViews.find((v) => Object.entries(where).every(([k, val]) => v[k] === val)) ?? null,
    create: async ({ data }) => { const row = { id: `sv${state.savedViews.length + 1}`, ...data }; state.savedViews.push(row); return row; },
    update: async ({ where, data }) => Object.assign(state.savedViews.find((v) => v.id === where.id), data),
  },
  customFieldDefinition: {
    findFirst: async ({ where }) => state.fieldDefs.find((d) => d.workspaceId === where.workspaceId && d.entity === where.entity && d.key === where.key) ?? null,
    count: async () => state.fieldDefs.length,
    create: async ({ data }) => { const row = { id: `cf${state.fieldDefs.length + 1}`, ...data }; state.fieldDefs.push(row); return row; },
  },
  lead: {
    findMany: async ({ where }) => state.leads.filter((l) => l.workspaceId === where.workspaceId && where.id.in.includes(l.id)),
    update: async (args) => { state.leadUpdates.push(args); return args; },
  },
  task: {
    createMany: async ({ data }) => { state.createdTasks.push(...data); return { count: data.length }; },
  },
  workspaceMember: {
    findFirst: async ({ where }) => state.members.find((m) => m.workspaceId === where.workspaceId && m.userId === where.userId) ?? null,
  },
  $transaction: async (ops) => Promise.all(ops),
};

let baseUrl;
let server;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: fakePrisma } });
  mock.module('../config/env.js', { namedExports: { env: { ADMIN_EMAIL: 'admin@example.test' } } });
  mock.module('../middleware/authenticate.js', {
    namedExports: {
      authenticate: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
      authenticateOptional: (_req, _res, next) => next(),
    },
  });
  // The role comes from a test header so each case can pick who is calling.
  mock.module('../middleware/workspaceContext.js', {
    namedExports: {
      workspaceContext: (req, _res, next) => {
        req.user.workspaceId = req.params.workspaceId;
        req.user.role = req.get('x-test-role') || 'ADMIN';
        req.user.workspaceRoleVerified = true;
        next();
      },
    },
  });
  mock.module('../services/recordScope.service.js', { namedExports: { scopeFilter: async () => ({}) } });
  mock.module('../services/workflowCrm.service.js', { namedExports: { emitCrmEvent: () => {} } });

  const { default: express } = await import('express');
  const { default: savedViewsRoutes } = await import('./savedViews.routes.js');
  const { default: customFieldsRoutes } = await import('./customFields.routes.js');
  const { default: leadsRoutes } = await import('./leads.routes.js');

  const app = express();
  app.use(express.json());
  app.use('/w/:workspaceId/saved-views', savedViewsRoutes);
  app.use('/w/:workspaceId/custom-fields', customFieldsRoutes);
  app.use('/w/:workspaceId/leads', leadsRoutes);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}/w/ws1`;
});

test.after(() => server?.close());
test.beforeEach(reset);

const post = (path, body, role) => fetch(`${baseUrl}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
  body: JSON.stringify(body),
});

test('saving a leads view with the entity the UI sends succeeds', async () => {
  const res = await post('/saved-views', { entity: 'leads', name: 'Hot', filters: { category: 'HOT' } });
  assert.equal(res.status, 201);
  assert.equal(state.savedViews[0].entity, 'leads');
});

test('saved views reject entities the service does not know', async () => {
  const res = await post('/saved-views', { entity: 'LEAD', name: 'Hot' });
  assert.equal(res.status, 400);
});

test('every custom field type the UI offers can be created', async () => {
  for (const type of ['TEXTAREA', 'CURRENCY', 'URL', 'EMAIL', 'PHONE', 'USER']) {
    const res = await post('/custom-fields', { entity: 'lead', label: `F ${type}`, type });
    assert.equal(res.status, 201, type);
  }
  const res = await post('/custom-fields', { entity: 'deal', label: 'Size', type: 'DROPDOWN', options: ['S', 'M'] });
  assert.equal(res.status, 201);
  assert.deepEqual(state.fieldDefs.at(-1).options, ['S', 'M']);
});

test('a SELECT custom field is refused at the route instead of reaching the DB', async () => {
  const res = await post('/custom-fields', { entity: 'lead', label: 'Legacy', type: 'SELECT', options: ['a'] });
  assert.equal(res.status, 400);
  assert.equal(state.fieldDefs.length, 0);
});

test('only admins define custom fields', async () => {
  const res = await post('/custom-fields', { entity: 'lead', label: 'Region', type: 'TEXT' }, 'CLIENT');
  assert.equal(res.status, 403);
});

test('bulk task creates one task per lead without a priority column', async () => {
  state.leads = [
    { id: 'l1', workspaceId: 'ws1', contactId: 'c1', ownerUserId: 'owner' },
    { id: 'l2', workspaceId: 'ws1', contactId: 'c2', ownerUserId: null },
    { id: 'lx', workspaceId: 'other', contactId: 'c3', ownerUserId: null },
  ];
  const res = await post('/leads/bulk-task', { ids: ['l1', 'l2', 'lx'], title: 'Call', dueDate: '2026-10-05', priority: 'HIGH' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { count: 2 });
  assert.equal(state.createdTasks.length, 2);
  for (const t of state.createdTasks) {
    assert.equal('priority' in t, false);
    assert.match(t.description, /HIGH/);
  }
  assert.equal(state.createdTasks[0].assignedToUserId, 'owner');
  assert.equal(state.createdTasks[1].assignedToUserId, 'u1');
});

test('bulk task requires a title', async () => {
  const res = await post('/leads/bulk-task', { ids: ['l1'] });
  assert.equal(res.status, 400);
});

test('bulk status stores a custom lifecycle key in customFields', async () => {
  state.leads = [{ id: 'l1', workspaceId: 'ws1', contactId: 'c1', status: 'NEW', customFields: { region: 'EU' } }];
  const res = await post('/leads/bulk-status', { ids: ['l1'], status: 'SITE_VISIT' });
  assert.equal(res.status, 200);
  const { data } = state.leadUpdates[0];
  assert.equal(data.status, 'NEW');
  assert.deepEqual(data.customFields, { region: 'EU', statusKey: 'SITE_VISIT' });
});

test('bulk status to a built-in status clears a custom key', async () => {
  state.leads = [{ id: 'l1', workspaceId: 'ws1', contactId: 'c1', status: 'NEW', customFields: { statusKey: 'SITE_VISIT' } }];
  const res = await post('/leads/bulk-status', { ids: ['l1'], status: 'QUALIFIED' });
  assert.equal(res.status, 200);
  assert.deepEqual(state.leadUpdates[0].data, { status: 'QUALIFIED', customFields: null });
});

test('bulk assign refuses an owner from outside the workspace', async () => {
  const res = await post('/leads/bulk-assign', { ids: ['l1'], ownerUserId: 'stranger' });
  assert.equal(res.status, 400);
});

test('bulk category only accepts HOT/WARM/COLD', async () => {
  const res = await post('/leads/bulk-category', { ids: ['l1'], category: 'LUKEWARM' });
  assert.equal(res.status, 400);
});
