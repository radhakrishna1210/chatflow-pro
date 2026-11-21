import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// The workflow engine's "start a form" step: a workflow hands the customer
// into a WhatsApp form directly, instead of relying on a button label that
// happens to match the form's keyword.
//
// The engine and the form service are the real code; the database is an
// in-memory store and the send is captured.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.GEMINI_API_KEY = '';

const sent = [];
mock.module('./outbound.service.js', {
  namedExports: {
    sendAutomatedReply: async (args) => { sent.push(args); return { id: `out_${sent.length}` }; },
    markNumberUnreachable: async () => {},
  },
});
mock.module('../queues/workflow.queue.js', {
  namedExports: {
    workflowQueue: {},
    enqueueWorkflowResume: async () => {},
    enqueueReplyReminder: async () => {},
    enqueueDelayedResponseCheck: async () => {},
  },
});

const { Prisma } = await import('@prisma/client');
const { prisma } = await import('../lib/prisma.js');

let seq = 0;
for (const model of Prisma.dmmf.datamodel.models) {
  const delegate = prisma[model.name[0].toLowerCase() + model.name.slice(1)];
  if (!delegate) continue;
  Object.assign(delegate, {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    count: async () => 0,
    create: async ({ data }) => ({ id: `${model.name}_${++seq}`, ...data }),
    update: async ({ data }) => ({ ...data }),
    updateMany: async () => ({ count: 0 }),
  });
}

const conversation = {
  id: 'conv_1', workspaceId: 'ws_A', waNumberId: 'wa_A', contactId: 'c_1', humanHandoffAt: null,
  contact: { id: 'c_1', phoneNumber: '+911234567890', name: 'Asha', tags: [], createdAt: new Date() },
};
let forms;
let submissions;
const runs = new Map();

prisma.conversation.findUnique = async () => structuredClone(conversation);
prisma.whatsappForm.findFirst = async ({ where }) => {
  const wanted = where.OR.map((o) => o.id ?? (typeof o.name === 'string' ? o.name : o.name?.equals)).filter(Boolean);
  return forms.find((f) => f.workspaceId === where.workspaceId
    && wanted.some((w) => f.id === w || f.name.toLowerCase() === String(w).toLowerCase())) ?? null;
};
prisma.whatsappFormSubmission.count = async ({ where }) => submissions
  .filter((s) => s.conversationId === where.conversationId && !s.completed).length;
prisma.whatsappFormSubmission.create = async ({ data }) => {
  const row = { id: `sub_${submissions.length + 1}`, completed: false, ...data };
  submissions.push(row);
  return row;
};
prisma.workflowRun.create = async ({ data }) => {
  const run = { id: `run_${runs.size + 1}`, startedAt: new Date(), variables: {}, ...data };
  runs.set(run.id, run);
  return structuredClone(run);
};
prisma.workflowRun.findUnique = async ({ where }) => structuredClone(runs.get(where.id) ?? null);
prisma.workflowRun.update = async ({ where, data }) => {
  const run = Object.assign(runs.get(where.id), data);
  return structuredClone(run);
};

const { startRun, runSentMessage } = await import('./workflowEngine.service.js');

const orderForm = (over = {}) => ({
  id: 'form_1', workspaceId: 'ws_A', name: 'Order form', status: 'Active', keyword: null,
  schema: [
    { key: 'item', label: 'What would you like?', type: 'choice', required: true, options: ['Tea', 'Coffee'] },
    { key: 'qty', label: 'How many?', type: 'number', required: true, options: [] },
  ],
  ...over,
});

const workflowWith = (value) => ({
  id: 'wf_1',
  name: 'Start order',
  nodes: [
    { type: 'trigger', subtype: 'keyword', value: 'BUY' },
    { type: 'action', subtype: 'message', value: 'Great, a few quick questions.' },
    { type: 'action', subtype: 'form', value },
  ],
});

const run = (workflow) => startRun(workflow, {
  workspaceId: 'ws_A', conversationId: 'conv_1', contactId: 'c_1', triggerMessage: 'buy',
});

function reset(form = orderForm()) {
  forms = [form];
  submissions = [];
  runs.clear();
  sent.length = 0;
}

test('a form step opens the form and asks its first question', async () => {
  reset();
  const result = await run(workflowWith('order form'));

  assert.equal(result.status, 'COMPLETED');
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].formId, 'form_1');
  assert.equal(submissions[0].conversationId, 'conv_1');
  // The workflow's own message, then the form's first question with its options.
  assert.equal(sent.length, 2);
  assert.match(sent[1].body, /What would you like\?/);
  assert.match(sent[1].body, /1\. Tea/);
  // Counts as a reply, so the inbound handler does not add a welcome on top.
  assert.equal(runSentMessage(result), true);
  assert.match(result.trace.at(-1).detail, /Started form "Order form"/);
});

test('a form step also accepts the form id', async () => {
  reset();
  await run(workflowWith('form_1'));
  assert.equal(submissions.length, 1);
});

test('a missing or draft form fails the run with a reason instead of doing nothing', async () => {
  reset();
  const missing = await run(workflowWith('Survey'));
  assert.equal(missing.status, 'FAILED');
  assert.match(missing.error, /Form "Survey" not found/);
  assert.equal(submissions.length, 0);

  reset(orderForm({ status: 'Draft' }));
  const draft = await run(workflowWith('Order form'));
  assert.equal(draft.status, 'FAILED');
  assert.match(draft.error, /is a draft/);
  assert.equal(submissions.length, 0);
});

test('a form from another workspace is never opened', async () => {
  reset(orderForm({ workspaceId: 'ws_B' }));
  const result = await run(workflowWith('Order form'));
  assert.equal(result.status, 'FAILED');
  assert.equal(submissions.length, 0);
});

test('a customer already filling in a form is not started on a second one', async () => {
  reset();
  submissions.push({ id: 'sub_0', conversationId: 'conv_1', completed: false });
  const result = await run(workflowWith('Order form'));
  assert.equal(result.status, 'COMPLETED');
  assert.equal(submissions.length, 1);
  assert.match(result.trace.at(-1).detail, /already filling in a form/);
});
