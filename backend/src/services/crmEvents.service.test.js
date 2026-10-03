import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// The CRM event bus (WF-EV-4, WF-EV-5).
//
//  - A status set by an automation (the workflow `lead_status` action, the
//    sequence UPDATE_FIELD step) raises lead_status_changed like one made by
//    hand, one chain level deeper, and the chain stops at MAX_CHAIN_DEPTH.
//  - A bulk edit loads the workspace's CRM workflows once and runs the
//    matching ones a few at a time, instead of one concurrent look-up per lead
//    (500 at once against a pool of 5 hit P2024 and dropped automations).
//  - Events no trigger listens to cost no query at all.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';

const started = [];
mock.module('./workflowEngine.service.js', {
  namedExports: {
    startRun: async (workflow, ctx) => {
      started.push({ workflowId: workflow.id, ...ctx });
      await new Promise((r) => setImmediate(r));
      return { id: `run_${started.length}` };
    },
    advanceRun: async () => null,
  },
});

const { prisma } = await import('../lib/prisma.js');
const { runCrmAction, MAX_CHAIN_DEPTH } = await import('./workflowCrm.service.js');
const { advanceEnrollment } = await import('./sequenceEngine.service.js');
const { bulkUpdateStatus } = await import('./leads.service.js');
const {
  emitCrmEvent, dispatchCrmEvents, invalidateCrmTriggers, CRM_EVENT_CONCURRENCY,
} = await import('./crmEvents.service.js');

const flush = (ms = 120) => new Promise((r) => setTimeout(r, ms));

let lead;
let workflows;
let lookups;
let inFlight;
let peak;
let stamped;

prisma.savedView.findFirst = async () => null; // default lead lifecycle
prisma.lead.findFirst = async () => (lead ? { ...lead } : null);
prisma.lead.update = async ({ data }) => Object.assign(lead, data);
prisma.workflow.findMany = async () => {
  lookups += 1;
  inFlight += 1; peak = Math.max(peak, inFlight);
  for (let i = 0; i < 3; i += 1) await new Promise((r) => setImmediate(r));
  inFlight -= 1;
  return workflows;
};
prisma.workflowRun.updateMany = async (args) => { stamped.push(args); return { count: args.where.id.in.length }; };

const statusWorkflow = (value = 'QUALIFIED') => ({
  id: 'wf_status', name: 'On qualified', isActive: true,
  nodes: [{ type: 'trigger', subtype: 'lead_status', value }, { type: 'action', subtype: 'task', value: 'Call them' }],
});

function reset({ wfs = [statusWorkflow()] } = {}) {
  lead = { id: 'lead_1', workspaceId: 'ws', status: 'NEW', customFields: null, contactId: 'ct_1' };
  workflows = wfs;
  lookups = 0; inFlight = 0; peak = 0;
  started.length = 0;
  stamped = [];
  invalidateCrmTriggers();
}

test('workflow lead_status action: the status is written and "lead status changed" workflows run', async () => {
  reset();
  const out = await runCrmAction({ id: 'run', workspaceId: 'ws', leadId: 'lead_1' }, { type: 'action', subtype: 'lead_status', value: 'QUALIFIED' });
  await flush();
  assert.equal(out.result, 'ok');
  assert.equal(lead.status, 'QUALIFIED');
  assert.equal(started.length, 1, 'the QUALIFIED workflow was started');
  assert.equal(started[0].leadId, 'lead_1');
  assert.equal(started[0].workflowId, 'wf_status');
  // The new run is one level down the chain, and remembers it for a resume.
  assert.equal(stamped.at(-1)?.data.chainDepth, 1);
});

test('sequence UPDATE_FIELD step: the status is written and "lead status changed" workflows run', async () => {
  reset();
  const enrollment = {
    id: 'en', workspaceId: 'ws', sequenceId: 's', contactId: 'ct_1', leadId: 'lead_1', status: 'ACTIVE', cursor: 0,
    nextRunAt: null, enrolledAt: new Date(), steps: [{ kind: 'UPDATE_FIELD', status: 'QUALIFIED' }],
    sequence: { status: 'PUBLISHED', respectBusinessHours: false },
  };
  prisma.sequenceEnrollment.findUnique = async () => ({ ...enrollment });
  prisma.sequenceEnrollment.updateMany = async () => ({ count: 1 });
  prisma.sequenceEnrollment.update = async () => ({});
  prisma.sequenceStepRun.create = async () => ({});
  prisma.contact.findFirst = async () => ({ optedOut: false, phoneNumber: '+919800000000' });
  prisma.sequence.findFirst = async () => ({ status: 'PUBLISHED', exitOnReply: false });
  prisma.optOut.findUnique = async () => null;
  const r = await advanceEnrollment('en');
  await flush();
  assert.equal(r.status, 'COMPLETED');
  assert.equal(lead.status, 'QUALIFIED');
  assert.equal(started.length, 1);
});

test('a status that is already set raises nothing', async () => {
  reset();
  lead.status = 'QUALIFIED';
  const out = await runCrmAction({ id: 'run', workspaceId: 'ws', leadId: 'lead_1' }, { type: 'action', subtype: 'lead_status', value: 'QUALIFIED' });
  await flush();
  assert.match(out.detail, /Already/);
  assert.equal(lookups, 0);
  assert.equal(started.length, 0);
});

test('a run at the last chain level still writes the status but starts no further workflow', async () => {
  reset();
  // A run resumed after a delay: no live context, the depth comes from the row.
  const out = await runCrmAction(
    { id: 'run', workspaceId: 'ws', leadId: 'lead_1', chainDepth: MAX_CHAIN_DEPTH - 1 },
    { type: 'action', subtype: 'lead_status', value: 'QUALIFIED' },
  );
  await flush();
  assert.equal(out.result, 'ok');
  assert.equal(lead.status, 'QUALIFIED');
  assert.equal(started.length, 0, 'the chain stops at MAX_CHAIN_DEPTH');
  assert.equal(lookups, 0, 'not even a look-up');
});

test('two workflows that set each other\'s status stop after MAX_CHAIN_DEPTH runs', async () => {
  reset({
    wfs: [
      { id: 'wf_a', isActive: true, nodes: [{ type: 'trigger', subtype: 'lead_status', value: 'QUALIFIED' }, { type: 'action', subtype: 'lead_status', value: 'CONTACTED' }] },
      { id: 'wf_b', isActive: true, nodes: [{ type: 'trigger', subtype: 'lead_status', value: 'CONTACTED' }, { type: 'action', subtype: 'lead_status', value: 'QUALIFIED' }] },
    ],
  });
  // The engine is stubbed, so play each run's single action here, inside the
  // run's own context, as advanceRun would.
  const wfNodes = Object.fromEntries(workflows.map((w) => [w.id, w.nodes[1]]));
  const realStart = started.push.bind(started);
  started.push = (entry) => {
    const n = realStart(entry);
    runCrmAction({ id: `run_${n}`, workspaceId: 'ws', leadId: entry.leadId }, wfNodes[entry.workflowId]).catch(() => {});
    return n;
  };
  try {
    emitCrmEvent('ws', 'lead_status_changed', { leadId: 'lead_1', contactId: 'ct_1', status: 'QUALIFIED', previousStatus: 'NEW' });
    await flush(400);
  } finally {
    delete started.push;
  }
  assert.equal(started.length, MAX_CHAIN_DEPTH, `${started.map((s) => s.workflowId).join(' -> ')}`);
});

test('bulk status change of 500 leads with no listening workflow: one look-up, no fan-out', async () => {
  reset({ wfs: [] });
  const N = 500;
  prisma.lead.findMany = async () => Array.from({ length: N }, (_, i) => ({ id: `l${i}`, status: 'NEW', customFields: null, contactId: `c${i}` }));
  prisma.lead.update = (args) => args;
  prisma.$transaction = async (writes) => writes;
  const res = await bulkUpdateStatus('ws', Array.from({ length: N }, (_, i) => `l${i}`), 'QUALIFIED');
  await flush(100);
  assert.equal(res.count, N);
  assert.equal(lookups, 1);
  assert.equal(started.length, 0);
});

test('bulk status change of 500 leads that all match: every run starts, never more than a few at once', async () => {
  reset();
  const N = 500;
  prisma.lead.findMany = async () => Array.from({ length: N }, (_, i) => ({ id: `l${i}`, status: 'NEW', customFields: null, contactId: `c${i}` }));
  await bulkUpdateStatus('ws', Array.from({ length: N }, (_, i) => `l${i}`), 'QUALIFIED');
  for (let i = 0; i < 100 && started.length < N; i += 1) await flush(50);
  assert.equal(started.length, N, 'no automation dropped');
  assert.ok(peak <= CRM_EVENT_CONCURRENCY, `peak concurrent workflow look-ups ${peak}`);
});

test('events no CRM trigger listens to never look anything up', async () => {
  reset();
  for (const event of ['lead_deleted', 'lead_assigned', 'lead_category_changed']) {
    emitCrmEvent('ws', event, { leadId: 'lead_1' });
    assert.deepEqual(await dispatchCrmEvents('ws', event, [{ leadId: 'lead_1' }]), { matched: 0 });
  }
  await flush();
  assert.equal(lookups, 0);
});

test('a burst of single events shares one workflow look-up', async () => {
  reset({ wfs: [] });
  for (let i = 0; i < 50; i += 1) emitCrmEvent('ws', 'lead_score_changed', { leadId: `l${i}`, score: 80, previousScore: 10 });
  await flush(60);
  assert.equal(lookups, 1);
});
