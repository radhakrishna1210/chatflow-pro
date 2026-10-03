import test from 'node:test';
import assert from 'node:assert/strict';

// A failed workflow run tells the workspace, at most once per workflow per day.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';

const { prisma } = await import('../lib/prisma.js');
const { notifyWorkflowFailed, resetWorkflowAlerts, WORKFLOW_ALERT_TYPE } = await import('./workflowAlerts.service.js');

const DAY = 24 * 3_600_000;
let created;
prisma.workflow.findFirst = async () => ({ name: 'Order status' });
prisma.notification.create = async ({ data }) => { created.push({ ...data, createdAt: data.createdAt ?? new Date() }); return data; };
prisma.notification.findFirst = async ({ where }) => created.find((n) => n.workspaceId === where.workspaceId
  && n.type === where.type
  && n.meta?.workflowId === where.meta.equals
  && n.createdAt >= where.createdAt.gte) ?? null;

const run = (workflowId = 'wf_1', id = 'run_1') => ({ id, workspaceId: 'ws', workflowId });

test('a failed run notifies the workspace with the workflow name and the reason', async () => {
  resetWorkflowAlerts(); created = [];
  assert.equal(await notifyWorkflowFailed(run(), 'Step 1 (message): message quota and wallet are empty'), true);
  assert.equal(created.length, 1);
  assert.equal(created[0].type, WORKFLOW_ALERT_TYPE);
  assert.equal(created[0].link, 'automation');
  assert.match(created[0].title, /"Order status" failed/);
  assert.match(created[0].body, /wallet are empty/);
  assert.deepEqual(created[0].meta, { workflowId: 'wf_1', runId: 'run_1' });
});

test('many failures of one workflow are one notification per day; other workflows still notify', async () => {
  resetWorkflowAlerts(); created = [];
  const now = new Date();
  for (let i = 0; i < 20; i += 1) await notifyWorkflowFailed(run('wf_1', `run_${i}`), 'boom', { now });
  await notifyWorkflowFailed(run('wf_2'), 'boom', { now });
  assert.deepEqual(created.map((n) => n.meta.workflowId), ['wf_1', 'wf_2']);
});

test('the limit holds across restarts (database check) and lifts after a day', async () => {
  resetWorkflowAlerts(); created = [];
  await notifyWorkflowFailed(run(), 'boom');
  resetWorkflowAlerts(); // a restart forgets the in-memory throttle
  assert.equal(await notifyWorkflowFailed(run(), 'boom'), false);
  assert.equal(await notifyWorkflowFailed(run(), 'boom', { now: new Date(Date.now() + DAY + 1000) }), true);
  assert.equal(created.length, 2);
});
