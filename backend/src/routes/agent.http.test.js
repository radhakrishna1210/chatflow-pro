import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// HTTP-level checks for the autonomous agent's routes (CF-046, CF-038): the
// real router, authorize(), requireFeature() and service run against an
// in-memory prisma. Mounted the way routes/index.js mounts it — at the AI
// Agents family's /ai-agents/autonomous and at the old /agent alias.

const state = {};

function reset() {
  state.planFeatures = { autonomousAgent: true };
  state.enabled = true;
  state.tasks = [
    { id: 't-pending', workspaceId: 'ws1', kind: 'schedule_followup', targetType: 'deal', targetId: 'd1', status: 'PENDING', runAfter: new Date(Date.now() + 86400000), attempts: 0, activeKey: 'schedule_followup:deal:d1' },
    { id: 't-failed', workspaceId: 'ws1', kind: 'advance_contacted', targetType: 'lead', targetId: 'l1', status: 'FAILED', runAfter: new Date(), attempts: 3, activeKey: null, lastError: 'boom' },
    { id: 't-other', workspaceId: 'ws2', kind: 'schedule_followup', targetType: 'deal', targetId: 'd9', status: 'PENDING', runAfter: new Date(), attempts: 0, activeKey: 'x' },
  ];
  state.queued = [];
}

const matches = (row, where) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if (Array.isArray(v.in)) return v.in.includes(row[k]);
    return true;
  }
  return row[k] === v;
});
const pick = (row, select) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : row);

const fakePrisma = {
  workspace: {
    findUnique: async () => ({ autonomousAgentEnabled: state.enabled }),
    // agentAllowed: eligible only when switched on and the plan has the flag.
    findFirst: async ({ where }) => (where.id === 'ws1' && state.enabled && state.planFeatures.autonomousAgent === true ? { id: 'ws1' } : null),
    update: async ({ data }) => { state.enabled = data.autonomousAgentEnabled; return {}; },
  },
  subscription: {
    findUnique: async () => ({ id: 's1', currentPeriodStart: new Date(0), currentPeriodEnd: new Date(), plan: { features: state.planFeatures } }),
  },
  usageCounter: { findUnique: async () => ({ messagesUsed: 0 }) },
  agentTask: {
    count: async ({ where }) => state.tasks.filter((t) => matches(t, where)).length,
    findMany: async ({ where, select }) => state.tasks.filter((t) => matches(t, where)).map((t) => pick(t, select)),
    findFirst: async ({ where, select }) => { const t = state.tasks.find((r) => matches(r, where)); return t ? pick(t, select) : null; },
    updateMany: async ({ where, data }) => {
      const rows = state.tasks.filter((t) => matches(t, where));
      rows.forEach((t) => Object.assign(t, data));
      return { count: rows.length };
    },
    update: async ({ where, data }) => Object.assign(state.tasks.find((t) => t.id === where.id), data),
  },
  agentFact: {
    count: async () => 1,
    findMany: async () => [{ id: 'f1', targetType: 'deal', targetId: 'd1', field: 'nextStep', value: 'Call', score: 0.4, rationale: 'weak', createdAt: new Date() }],
  },
  agentRun: { findMany: async () => [] },
  deal: { findMany: async () => [{ id: 'd1', title: 'Acme renewal' }] },
  lead: { findMany: async () => [{ id: 'l1', contact: { name: 'Asha', phoneNumber: '+911' } }] },
};

let server;
let base;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: fakePrisma } });
  mock.module('../config/env.js', { namedExports: { env: { ADMIN_EMAIL: 'admin@example.test' } } });
  mock.module('../queues/agent.queue.js', { namedExports: { enqueueRunNow: async (id) => { state.queued.push(id); } } });
  mock.module('../middleware/authenticate.js', {
    namedExports: {
      authenticate: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
      authenticateOptional: (_req, _res, next) => next(),
    },
  });
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

  const { default: express } = await import('express');
  const { default: agentRoutes } = await import('./agent.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/w/:workspaceId/ai-agents/autonomous', agentRoutes);
  app.use('/w/:workspaceId/agent', agentRoutes);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/w/ws1`;
});

test.after(() => server?.close());
test.beforeEach(reset);

const call = (path, { method = 'GET', role = 'ADMIN', body } = {}) => fetch(`${base}${path}`, {
  method,
  headers: { 'content-type': 'application/json', 'x-test-role': role },
  body: body ? JSON.stringify(body) : undefined,
});

test('the pending-work view is ADMIN only and lists the rows behind the counts', async () => {
  assert.equal((await call('/ai-agents/autonomous/pending', { role: 'CLIENT' })).status, 403);
  const res = await call('/ai-agents/autonomous/pending');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.queued, 1);
  assert.deepEqual(body.tasks.map((t) => t.id), ['t-pending'], 'another workspace\'s queue is not listed');
  assert.equal(body.tasks[0].targetLabel, 'Acme renewal');
  assert.deepEqual(body.failed.map((t) => [t.id, t.targetLabel]), [['t-failed', 'Asha']]);
  assert.equal(body.suggestionItems[0].id, 'f1');
});

test('the old /agent path is an alias of the same routes', async () => {
  const res = await call('/agent/pending');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).queued, 1);
});

test('settings report whether the plan includes the agent', async () => {
  let body = await (await call('/ai-agents/autonomous/settings', { role: 'VIEWER' })).json();
  assert.deepEqual(body, { enabled: true, planAllows: true });
  state.planFeatures = {};
  body = await (await call('/ai-agents/autonomous/settings')).json();
  assert.equal(body.planAllows, false);
});

test('switching on needs the plan feature; switching off never does', async () => {
  state.planFeatures = {};
  state.enabled = false;
  let res = await call('/ai-agents/autonomous/settings', { method: 'PATCH', body: { enabled: true } });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'PLAN_FEATURE_LOCKED');
  assert.equal(state.enabled, false);

  state.enabled = true;
  res = await call('/ai-agents/autonomous/settings', { method: 'PATCH', body: { enabled: false } });
  assert.equal(res.status, 200);
  assert.equal(state.enabled, false);
});

test('running the agent on demand needs the plan feature', async () => {
  state.planFeatures = {};
  assert.equal((await call('/ai-agents/autonomous/run', { method: 'POST' })).status, 403);
  assert.deepEqual(state.queued, []);
  state.planFeatures = { autonomousAgent: true };
  assert.equal((await call('/ai-agents/autonomous/run', { method: 'POST' })).status, 202);
  assert.deepEqual(state.queued, ['ws1']);
});

test('cancel withdraws a queued task and frees its key; only queued tasks', async () => {
  assert.equal((await call('/ai-agents/autonomous/tasks/t-pending/cancel', { method: 'POST', role: 'CLIENT' })).status, 403);
  const res = await call('/ai-agents/autonomous/tasks/t-pending/cancel', { method: 'POST' });
  assert.equal(res.status, 200);
  const t = state.tasks.find((x) => x.id === 't-pending');
  assert.equal(t.status, 'SKIPPED');
  assert.equal(t.activeKey, null);
  assert.equal((await call('/ai-agents/autonomous/tasks/t-failed/cancel', { method: 'POST' })).status, 409);
  assert.equal((await call('/ai-agents/autonomous/tasks/t-other/cancel', { method: 'POST' })).status, 404, 'another workspace\'s task');
  // Cancelling stays open on a plan without the agent, so it can be stopped.
  state.planFeatures = {};
  state.tasks.push({ id: 't2', workspaceId: 'ws1', status: 'PENDING', kind: 'k', targetType: 'deal', targetId: 'd2' });
  assert.equal((await call('/ai-agents/autonomous/tasks/t2/cancel', { method: 'POST' })).status, 200);
});

test('retry re-queues a failed task with a fresh budget', async () => {
  const res = await call('/ai-agents/autonomous/tasks/t-failed/retry', { method: 'POST' });
  assert.equal(res.status, 200);
  const t = state.tasks.find((x) => x.id === 't-failed');
  assert.equal(t.status, 'PENDING');
  assert.equal(t.attempts, 0);
  assert.equal(t.lastError, null);
  assert.equal(t.activeKey, 'advance_contacted:lead:l1');
  assert.equal((await call('/ai-agents/autonomous/tasks/t-pending/retry', { method: 'POST' })).status, 409);
});

test('retry and run-early need the plan feature and a switched-on agent', async () => {
  state.planFeatures = {};
  assert.equal((await call('/ai-agents/autonomous/tasks/t-failed/retry', { method: 'POST' })).status, 403);
  assert.equal((await call('/ai-agents/autonomous/tasks/t-pending/run', { method: 'POST' })).status, 403);
  state.planFeatures = { autonomousAgent: true };
  state.enabled = false;
  assert.equal((await call('/ai-agents/autonomous/tasks/t-failed/retry', { method: 'POST' })).status, 409);
});

test('run-early moves a queued task to now', async () => {
  const res = await call('/ai-agents/autonomous/tasks/t-pending/run', { method: 'POST' });
  assert.equal(res.status, 200);
  const t = state.tasks.find((x) => x.id === 't-pending');
  assert.ok(t.runAfter.getTime() <= Date.now());
});
