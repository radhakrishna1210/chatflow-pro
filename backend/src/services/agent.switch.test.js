import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// The autonomous agent's workspace switch and sweep coverage, against an
// in-memory prisma — no database or Redis needed.

mock.module('../lib/redis.js', {
  namedExports: { createBullConnection: () => null, redis: {}, logRedisError: () => {} },
});

const { prisma } = await import('../lib/prisma.js');
const agent = await import('./agent.service.js');
const { sweepAll } = await import('../workers/agent.worker.js');

let workspaces = [];
let tasks = [];

// Evaluates the slice of AGENT_ELIGIBLE_WHERE the service uses, so the test
// exercises the real filter object rather than a copy of it.
const eligible = (ws, where) => {
  if (where.id?.gt !== undefined && !(ws.id > where.id.gt)) return false;
  if (typeof where.id === 'string' && ws.id !== where.id) return false;
  if (where.autonomousAgentEnabled !== undefined && ws.autonomousAgentEnabled !== where.autonomousAgentEnabled) return false;
  if (where.suspended !== undefined && ws.suspended !== where.suspended) return false;
  if (where.OR) {
    const ok = where.OR.some((cond) => {
      const is = cond.subscription.is;
      if (is === null) return ws.subscription == null;
      return ws.subscription != null && !is.status.notIn.includes(ws.subscription.status);
    });
    if (!ok) return false;
  }
  return true;
};

prisma.workspace.findMany = async ({ where, orderBy, take }) => {
  assert.deepEqual(orderBy, { id: 'asc' }, 'the sweep must walk workspaces in a stable order');
  return workspaces.filter((w) => eligible(w, where)).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, take).map(({ id }) => ({ id }));
};
prisma.workspace.findFirst = async ({ where }) => {
  const ws = workspaces.find((w) => eligible(w, where));
  return ws ? { id: ws.id } : null;
};
prisma.workspace.findUnique = async ({ where }) => {
  const ws = workspaces.find((w) => w.id === where.id);
  return ws ? { autonomousAgentEnabled: ws.autonomousAgentEnabled } : null;
};
prisma.workspace.update = async ({ where, data }) => Object.assign(workspaces.find((w) => w.id === where.id), data);
prisma.agentTask.updateMany = async ({ where, data }) => {
  let count = 0;
  for (const t of tasks) {
    if (t.workspaceId === where.workspaceId && t.status === where.status) { Object.assign(t, data); count += 1; }
  }
  return { count };
};
prisma.deal.findMany = async () => [];
prisma.lead.findMany = async () => [];

const ws = (id, extra = {}) => ({ id, autonomousAgentEnabled: true, suspended: false, subscription: null, ...extra });

test('only switched-on, active workspaces are eligible', async () => {
  workspaces = [
    ws('a'),
    ws('b', { autonomousAgentEnabled: false }),
    ws('c', { suspended: true }),
    ws('d', { subscription: { status: 'EXPIRED' } }),
    ws('e', { subscription: { status: 'CANCELLED' } }),
    ws('f', { subscription: { status: 'ACTIVE' } }),
  ];
  assert.deepEqual(await agent.listAgentWorkspaceIds({ take: 50 }), ['a', 'f']);
  assert.equal(await agent.agentAllowed('a'), true);
  assert.equal(await agent.agentAllowed('b'), false);
  assert.equal(await agent.agentAllowed('c'), false);
  assert.equal(await agent.agentAllowed('d'), false);
});

test('sweepWorkspace books nothing for a workspace that is switched off', async () => {
  workspaces = [ws('off', { autonomousAgentEnabled: false })];
  const r = await agent.sweepWorkspace('off');
  assert.equal(r.booked, 0);
  assert.equal(r.skipped, true);
});

test('sweepAll walks every eligible workspace page by page, past the old 500 cap', async () => {
  workspaces = Array.from({ length: 650 }, (_, i) => ws(`w${String(i).padStart(4, '0')}`));
  workspaces.push(ws('zzz-suspended', { suspended: true }));
  const seen = [];
  const result = await sweepAll({
    listPage: agent.listAgentWorkspaceIds,
    sweep: async (id) => { seen.push(id); return { booked: 1 }; },
  });
  assert.equal(seen.length, 650);
  assert.equal(new Set(seen).size, 650, 'no workspace swept twice');
  assert.equal(seen.includes('zzz-suspended'), false);
  assert.equal(result.booked, 650);
});

test('one failing workspace is logged and does not stop the sweep', async () => {
  workspaces = [ws('a'), ws('b'), ws('c')];
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const result = await sweepAll({
      listPage: agent.listAgentWorkspaceIds,
      sweep: async (id) => { if (id === 'b') throw new Error('boom'); return { booked: 2 }; },
    });
    assert.equal(result.booked, 4);
    assert.equal(result.failed, 1);
    assert.ok(errors.some((e) => e.includes('workspace b') && e.includes('boom')));
  } finally {
    console.error = original;
  }
});

test('switching off retires queued work', async () => {
  workspaces = [ws('a')];
  tasks = [
    { id: 't1', workspaceId: 'a', status: 'PENDING', activeKey: 'k1' },
    { id: 't2', workspaceId: 'a', status: 'DONE', activeKey: null },
    { id: 't3', workspaceId: 'other', status: 'PENDING', activeKey: 'k3' },
  ];
  const out = await agent.setAgentEnabled('a', false);
  assert.deepEqual(out, { enabled: false });
  assert.equal(tasks[0].status, 'SKIPPED');
  assert.equal(tasks[0].activeKey, null);
  assert.equal(tasks[1].status, 'DONE');
  assert.equal(tasks[2].status, 'PENDING', 'another workspace\'s queue is untouched');

  assert.deepEqual(await agent.setAgentEnabled('a', true), { enabled: true });
});
