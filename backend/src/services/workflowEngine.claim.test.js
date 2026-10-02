import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Run ownership and recovery in the workflow engine:
//  - advanceRun claims a run atomically, so concurrent replies, retries and
//    cancellations cannot double-run steps or resurrect a cancelled run;
//  - parked runs record resumeAt, and the sweep re-enqueues overdue ones so a
//    delay survives the loss of its Redis job.
// Real engine, in-memory WorkflowRun store, Meta send and queue captured.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';

const sent = [];
let onSend = null;
mock.module('./outbound.service.js', {
  namedExports: {
    sendAutomatedReply: async (args) => {
      sent.push(args.body);
      if (onSend) await onSend(args);
      return { id: `msg_${sent.length}` };
    },
  },
});
const queued = [];
let queueFails = false;
mock.module('../queues/workflow.queue.js', {
  namedExports: {
    enqueueWorkflowResume: async (runId, cursor, delay) => {
      if (queueFails) throw new Error('Redis down');
      queued.push({ kind: 'resume', runId, cursor, delay });
    },
    enqueueReplyReminder: async (runId, cursor, delay) => { queued.push({ kind: 'remind', runId, cursor, delay }); },
  },
});

const { prisma } = await import('../lib/prisma.js');
const engine = await import('./workflowEngine.service.js');
const { updateManyRuns, matchRunWhere } = await import('./workflowRunStore.testutil.js');

const WS = 'ws_claim';
const CONV = 'conv_claim';
const contact = { id: 'ct_1', name: 'Asha', phoneNumber: '+919800000000', tags: [], createdAt: new Date(0) };
const runs = new Map();

prisma.conversation.findUnique = async () => ({ id: CONV, waNumberId: 'wa_1', contactId: contact.id, contact, humanHandoffAt: null });
prisma.template.findFirst = async () => null;
prisma.workflowRun.create = async ({ data }) => {
  const run = { id: `run_${runs.size + 1}`, startedAt: new Date(), variables: null, version: 0, resumeAt: null, ...structuredClone(data) };
  runs.set(run.id, run);
  return structuredClone(run);
};
prisma.workflowRun.findUnique = async ({ where }) => (runs.has(where.id) ? structuredClone(runs.get(where.id)) : null);
prisma.workflowRun.updateMany = async (args) => updateManyRuns(() => runs.values(), args);
prisma.workflowRun.findMany = async ({ where, take }) => [...runs.values()]
  .filter((r) => matchRunWhere(r, where))
  .slice(0, take ?? Infinity)
  .map((r) => structuredClone(r));

const workflow = (nodes) => ({ id: 'wf_1', name: 'Test', workspaceId: WS, nodes: [{ type: 'trigger', subtype: 'keyword', value: 'HI' }, ...nodes] });
const start = (nodes) => engine.startRun(workflow(nodes), { workspaceId: WS, conversationId: CONV, contactId: contact.id, triggerMessage: 'HI' });
const reset = () => { sent.length = 0; queued.length = 0; runs.clear(); onSend = null; queueFails = false; };
const row = (id) => runs.get(id);

test('a delay parks the run WAITING with a persisted resumeAt', async () => {
  reset();
  const before = Date.now();
  const run = await start([
    { type: 'action', subtype: 'message', value: 'one' },
    { type: 'action', subtype: 'delay', value: '1 hour' },
    { type: 'action', subtype: 'message', value: 'two' },
  ]);
  assert.equal(run.status, 'WAITING');
  assert.equal(run.cursor, 2);
  const due = new Date(row(run.id).resumeAt).getTime();
  assert.ok(due >= before + 3_600_000 && due <= Date.now() + 3_600_000);
  assert.deepEqual(sent, ['one']);
  assert.equal(queued[0].kind, 'resume');
});

test('a resume job that cannot be queued leaves the run WAITING for the sweep instead of failing it', async () => {
  reset();
  queueFails = true;
  const run = await start([
    { type: 'action', subtype: 'delay', value: '5 min' },
    { type: 'action', subtype: 'message', value: 'later' },
  ]);
  assert.equal(run.status, 'WAITING');
  assert.ok(row(run.id).resumeAt);
});

test('the sweep re-enqueues an overdue delay run (Redis lost the job) and the resume finishes it', async () => {
  reset();
  const run = await start([
    { type: 'action', subtype: 'delay', value: '1 hour' },
    { type: 'action', subtype: 'message', value: 'after the delay' },
  ]);
  queued.length = 0;
  const later = new Date(Date.now() + 2 * 3_600_000);
  const summary = await engine.sweepDueRuns({ now: later });
  assert.equal(summary.resumed, 1);
  assert.deepEqual(queued.map((q) => [q.kind, q.runId, q.cursor]), [['resume', run.id, 1]]);

  // A second sweep right after does not enqueue it again (resumeAt was pushed out).
  queued.length = 0;
  await engine.sweepDueRuns({ now: later });
  assert.equal(queued.length, 0);

  const done = await engine.advanceRun(run.id);
  assert.equal(done.status, 'COMPLETED');
  assert.deepEqual(sent, ['after the delay']);
  assert.equal(row(run.id).resumeAt, null);
});

test('the sweep leaves runs that are not due alone', async () => {
  reset();
  await start([{ type: 'action', subtype: 'delay', value: '1 hour' }, { type: 'action', subtype: 'message', value: 'x' }]);
  queued.length = 0;
  const summary = await engine.sweepDueRuns({ now: new Date() });
  assert.equal(summary.due, 0);
  assert.equal(queued.length, 0);
});

test('a reply wait past 24 hours is closed by the sweep; an owed reminder is enqueued', async () => {
  reset();
  const run = await start([
    { type: 'action', subtype: 'message', value: 'Your order ID?' },
    { type: 'action', subtype: 'wait_reply', value: 'order', reminder: 'Still there?', remindAfter: '10 min' },
    { type: 'action', subtype: 'message', value: 'Thanks' },
  ]);
  assert.equal(run.status, 'WAITING');
  queued.length = 0;

  await engine.sweepDueRuns({ now: new Date(Date.now() + 15 * 60_000) });
  assert.deepEqual(queued.map((q) => q.kind), ['remind']);

  const expired = await engine.sweepDueRuns({ now: new Date(Date.now() + 25 * 3_600_000) });
  assert.equal(expired.expired, 1);
  assert.equal(row(run.id).status, 'COMPLETED');
  assert.equal(row(run.id).resumeAt, null);
});

test('two replies racing for the same waiting run advance it once', async () => {
  reset();
  const run = await start([
    { type: 'action', subtype: 'message', value: 'Pick one' },
    { type: 'action', subtype: 'wait_reply', value: 'choice' },
    { type: 'action', subtype: 'message', value: 'Got {{choice}}' },
  ]);
  sent.length = 0;
  const [a, b] = await Promise.all([
    engine.advanceRun(run.id, { reply: 'A' }),
    engine.advanceRun(run.id, { reply: 'B' }),
  ]);
  assert.equal(sent.length, 1, `the follow-up must go out once, got ${JSON.stringify(sent)}`);
  assert.ok([a, b].some((r) => r.status === 'COMPLETED'));
  assert.equal(row(run.id).status, 'COMPLETED');
});

test('a pass that dies part-way is recovered from its last checkpoint, not from the start', async () => {
  reset();
  // The DB write after the second message throws (a pool timeout), killing the pass.
  const realUpdateMany = prisma.workflowRun.updateMany;
  let failNextCheckpointAt = 2;
  prisma.workflowRun.updateMany = async (args) => {
    if (args.data?.cursor === failNextCheckpointAt) { failNextCheckpointAt = null; throw new Error('P2024 pool timeout'); }
    return realUpdateMany(args);
  };
  let runId;
  try {
    await assert.rejects(() => start([
      { type: 'action', subtype: 'message', value: 'one' },
      { type: 'action', subtype: 'message', value: 'two' },
      { type: 'action', subtype: 'message', value: 'three' },
    ]), /pool timeout/);
    runId = [...runs.keys()].at(-1);
  } finally {
    prisma.workflowRun.updateMany = realUpdateMany;
  }
  assert.deepEqual(sent, ['one', 'two']);
  assert.equal(row(runId).status, 'RUNNING');
  assert.equal(row(runId).cursor, 1, 'the last checkpoint is before step two');

  // An immediate retry does not barge in on the (apparently) live pass.
  sent.length = 0;
  await engine.advanceRun(runId);
  assert.deepEqual(sent, []);

  // Once the lease lapses the sweep resumes it from the checkpoint: step one is
  // not sent again; only the step in flight when it died is repeated.
  row(runId).resumeAt = new Date(Date.now() - 1000);
  const summary = await engine.sweepDueRuns({ now: new Date() });
  assert.equal(summary.resumed, 1);
  const done = await engine.advanceRun(runId);
  assert.equal(done.status, 'COMPLETED');
  assert.deepEqual(sent, ['two', 'three']);
});

test('a RUNNING run under a live lease cannot be claimed; once the lease expires it can', async () => {
  reset();
  const run = await start([{ type: 'action', subtype: 'delay', value: '1 hour' }, { type: 'action', subtype: 'message', value: 'x' }]);
  const stored = structuredClone(row(run.id));
  // Someone else claimed it a moment ago.
  assert.notEqual(await engine.claimRun(stored), null);
  const held = structuredClone(row(run.id));
  assert.equal(held.status, 'RUNNING');
  assert.equal(await engine.claimRun(held), null, 'a live lease must not be stolen');
  assert.equal(await engine.claimRun(stored), null, 'a stale version must not claim');

  const afterLease = new Date(Date.now() + engine.RUN_LEASE_MS + 1000);
  assert.equal(await engine.claimRun(held, afterLease), held.version + 1, 'an expired lease is recoverable');

  queued.length = 0;
  const summary = await engine.sweepDueRuns({ now: new Date(afterLease.getTime() + engine.RUN_LEASE_MS + 1000) });
  assert.equal(summary.resumed, 1, 'the sweep re-enqueues a RUNNING run whose worker died');
});

test('a cancel during a pass stops it and the run is not resurrected by a later delay', async () => {
  reset();
  onSend = async ({ body }) => {
    if (body === 'one') await engine.cancelActiveRuns(WS, CONV, 'Customer typed cancel');
  };
  const run = await start([
    { type: 'action', subtype: 'message', value: 'one' },
    { type: 'action', subtype: 'delay', value: '1 hour' },
    { type: 'action', subtype: 'message', value: 'two' },
  ]);
  assert.equal(run.status, 'CANCELLED');
  assert.equal(row(run.id).status, 'CANCELLED');
  assert.equal(queued.length, 0, 'no resume may be scheduled for a cancelled run');

  const again = await engine.advanceRun(run.id);
  assert.equal(again.status, 'CANCELLED');
  assert.deepEqual(sent, ['one']);
});

test('deactivating a workflow cancels its waiting runs', async () => {
  reset();
  const run = await start([{ type: 'action', subtype: 'delay', value: '1 hour' }, { type: 'action', subtype: 'message', value: 'x' }]);
  const n = await engine.cancelRunsForWorkflow(WS, 'wf_1');
  assert.equal(n, 1);
  assert.equal(row(run.id).status, 'CANCELLED');
  assert.equal(row(run.id).resumeAt, null);
  assert.equal((await engine.advanceRun(run.id)).status, 'CANCELLED');
  assert.deepEqual(sent, []);
});
