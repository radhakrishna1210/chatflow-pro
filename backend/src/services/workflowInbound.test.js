import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// A WhatsApp message arriving at the webhook and running a workflow, end to
// end: webhook payload → inbound handler → contact/conversation → trigger
// matching → engine → send step. Everything is the real code except the two
// edges — the database is an in-memory store and the Meta send is captured —
// so what these tests see is what a customer would receive.
//
// The database URL is pointed at a closed local port and the LLM keys are
// blanked before anything loads: a query this file forgot to fake fails loudly
// instead of reaching a real database, and no test calls a model.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';

const sent = [];
let sendFails = false;
mock.module('./outbound.service.js', {
  namedExports: {
    sendAutomatedReply: async (args) => {
      if (sendFails) return null;
      sent.push(args);
      return { id: `out_${sent.length}` };
    },
    markNumberUnreachable: async () => {},
  },
});

const scheduled = [];
mock.module('../queues/workflow.queue.js', {
  namedExports: {
    workflowQueue: {},
    enqueueWorkflowResume: async (runId, cursor, ms) => { scheduled.push({ kind: 'resume', runId, cursor, ms }); },
    enqueueReplyReminder: async (runId, cursor, ms) => { scheduled.push({ kind: 'remind', runId, cursor, ms }); },
    enqueueDelayedResponseCheck: async () => {},
  },
});

const { Prisma } = await import('@prisma/client');
const { prisma } = await import('../lib/prisma.js');

// ── In-memory store ─────────────────────────────────────────────────────────

let db;
let seq = 0;
const id = (p) => `${p}_${++seq}`;
let intentRuleQueries = 0;
let workflowQueries = [];

function resetDb() {
  db = {
    waNumbers: [
      { id: 'wa_A', workspaceId: 'ws_A', metaPhoneNumberId: 'PN_A', phoneNumber: '+10000000001' },
      { id: 'wa_B', workspaceId: 'ws_B', metaPhoneNumberId: 'PN_B', phoneNumber: '+10000000002' },
    ],
    workspaces: {
      ws_A: { id: 'ws_A', aiAgentEnabled: false, autoWelcomeEnabled: false, escalationRules: { refund: true } },
      ws_B: { id: 'ws_B', aiAgentEnabled: false, autoWelcomeEnabled: false, escalationRules: {} },
    },
    members: [
      { workspaceId: 'ws_A', userId: 'u_admin', role: 'ADMIN', user: { id: 'u_admin', name: 'Owner', email: 'owner@a.test' } },
      { workspaceId: 'ws_A', userId: 'u_support', role: 'MEMBER', user: { id: 'u_support', name: 'Support', email: 'support@a.test' } },
    ],
    contacts: [],
    conversations: [],
    messages: [],
    workflows: [],
    runs: new Map(),
  };
  sent.length = 0;
  scheduled.length = 0;
  sendFails = false;
  intentRuleQueries = 0;
  workflowQueries = [];
}

const clone = (v) => (v == null ? v : structuredClone(v));

function applyData(target, data) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) target[key] = (target[key] ?? 0) + value.increment;
    else if (value && typeof value === 'object' && 'push' in value) target[key] = [...(target[key] ?? []), value.push];
    else target[key] = value;
  }
  return target;
}

const statusMatches = (status, want) => (want == null ? true
  : typeof want === 'string' ? status === want
    : Array.isArray(want.in) ? want.in.includes(status) : true);

// Every model starts as an empty table, so a code path this file does not
// care about (forms, campaign sessions, intent rules, leads) sees "nothing
// here" rather than hitting the network.
for (const model of Prisma.dmmf.datamodel.models) {
  const delegate = prisma[model.name[0].toLowerCase() + model.name.slice(1)];
  if (!delegate) continue;
  Object.assign(delegate, {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    count: async () => 0,
    create: async ({ data }) => ({ id: id(model.name), ...data }),
    update: async ({ data }) => ({ ...data }),
    updateMany: async () => ({ count: 0 }),
    upsert: async ({ create }) => ({ id: id(model.name), ...create }),
    delete: async () => null,
    deleteMany: async () => ({ count: 0 }),
    aggregate: async () => ({}),
    groupBy: async () => [],
  });
}
prisma.$transaction = async (arg) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg));

prisma.waNumber.findFirst = async ({ where }) => clone(db.waNumbers.find((n) => n.metaPhoneNumberId === where.metaPhoneNumberId) ?? null);
prisma.waNumber.findUnique = async ({ where }) => clone(db.waNumbers.find((n) => n.id === where.id) ?? null);
prisma.workspace.findUnique = async ({ where }) => clone(db.workspaces[where.id] ?? null);
prisma.workspaceMember.findMany = async ({ where }) => clone(db.members.filter((m) => m.workspaceId === where.workspaceId));

prisma.contact.findFirst = async ({ where }) => {
  const phones = (where.OR ?? []).map((o) => o.phoneNumber);
  return clone(db.contacts.find((c) => c.workspaceId === where.workspaceId && phones.includes(c.phoneNumber)) ?? null);
};
prisma.contact.findMany = async ({ where }) => clone(db.contacts.filter((c) => c.workspaceId === where.workspaceId
  && String(c.phoneNumber).includes(where.phoneNumber?.contains ?? '')));
prisma.contact.create = async ({ data }) => {
  const row = { id: id('ct'), tags: [], createdAt: new Date(), ...data };
  db.contacts.push(row);
  return clone(row);
};
prisma.contact.findUnique = async ({ where }) => clone(db.contacts.find((c) => c.id === where.id) ?? null);
prisma.contact.update = async ({ where, data }) => clone(applyData(db.contacts.find((c) => c.id === where.id), data));

const withContact = (c) => c && { ...clone(c), contact: clone(db.contacts.find((x) => x.id === c.contactId)) };
prisma.conversation.findFirst = async ({ where }) => clone(db.conversations.find((c) => c.workspaceId === where.workspaceId
  && c.contactId === where.contactId && c.waNumberId === where.waNumberId) ?? null);
prisma.conversation.create = async ({ data }) => {
  const row = { id: id('conv'), humanHandoffAt: null, assignedToUserId: null, unreadCount: 0, ...data };
  db.conversations.push(row);
  return clone(row);
};
prisma.conversation.findUnique = async ({ where }) => withContact(db.conversations.find((c) => c.id === where.id) ?? null);
prisma.conversation.update = async ({ where, data }) => clone(applyData(db.conversations.find((c) => c.id === where.id), data));

prisma.message.create = async ({ data }) => {
  if (data.metaMessageId && db.messages.some((m) => m.metaMessageId === data.metaMessageId)) {
    throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  }
  const row = { id: id('msg'), createdAt: new Date(), ...data };
  db.messages.push(row);
  return clone(row);
};

prisma.intentRule.findMany = async () => { intentRuleQueries += 1; return []; };

prisma.workflow.findMany = async ({ where }) => {
  workflowQueries.push(where);
  return clone(db.workflows.filter((w) => w.workspaceId === where.workspaceId && (where.isActive === undefined || w.isActive === where.isActive)));
};
prisma.workflowRun.create = async ({ data }) => {
  const run = { id: id('run'), startedAt: new Date(), variables: null, error: null, ...clone(data) };
  db.runs.set(run.id, run);
  return clone(run);
};
prisma.workflowRun.findUnique = async ({ where }) => clone(db.runs.get(where.id) ?? null);
prisma.workflowRun.update = async ({ where, data }) => {
  const run = { ...db.runs.get(where.id), ...clone(data) };
  db.runs.set(where.id, run);
  return clone(run);
};
const runFilter = (where) => [...db.runs.values()].filter((r) => r.workspaceId === where.workspaceId
  && (!where.conversationId || r.conversationId === where.conversationId)
  && statusMatches(r.status, where.status));
prisma.workflowRun.findMany = async ({ where }) => clone(runFilter(where).sort((a, b) => b.startedAt - a.startedAt));
prisma.workflowRun.count = async ({ where }) => runFilter(where).length;

const { processWebhook } = await import('./webhook.service.js');
const engine = await import('./workflowEngine.service.js');
const { __testing: generator, keywordMatches } = await import('./automation.service.js');

// ── Helpers ─────────────────────────────────────────────────────────────────

const CUSTOMER = '919800000001';

function webhookFor(phoneNumberId, text, { from = CUSTOMER, messageId } = {}) {
  return {
    entry: [{
      id: 'waba_1',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: phoneNumberId },
          contacts: [{ profile: { name: 'Asha' } }],
          messages: [{
            from,
            id: messageId ?? `wamid.${++seq}`,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: text },
          }],
        },
      }],
    }],
  };
}

// What the customer sees back for one message they send.
async function customerSends(text, opts = {}) {
  const before = sent.length;
  await processWebhook(webhookFor(opts.phoneNumberId ?? 'PN_A', text, opts));
  return sent.slice(before).map((s) => s.body);
}

const runs = () => [...db.runs.values()];
const conversationOf = (workspaceId) => db.conversations.find((c) => c.workspaceId === workspaceId);
const contactOf = (workspaceId) => db.contacts.find((c) => c.workspaceId === workspaceId);

function addWorkflow(fields) {
  const wf = { id: id('wf'), workspaceId: 'ws_A', isActive: true, createdAt: new Date(), name: 'Workflow', edges: [], ...fields };
  db.workflows.push(wf);
  return wf;
}

const MINIMAL = {
  name: 'Minimal test',
  nodes: [
    { id: 'step_1', type: 'trigger', subtype: 'keyword', value: 'WFTEST' },
    { id: 'step_2', type: 'action', subtype: 'message', value: 'Workflow test successful' },
  ],
};

// The shape "Create with AI" produces for the refund request: ask for the
// order ID (reminding after 5 minutes), ask the reason, then either confirm,
// tag and hand to support, or explain it is not eligible. The eligible branch
// ends in a handoff, which is what lets the ineligible reply follow it without
// being sent to an eligible customer too.
const REFUND = {
  name: 'Refund Request Workflow',
  nodes: [
    { id: 'step_1', type: 'trigger', subtype: 'keyword', value: 'REFUND, RETURN, MONEY BACK' },
    { id: 'step_2', type: 'action', subtype: 'message', value: 'Sure, I can help with your refund request. Please provide your order ID.' },
    { id: 'step_3', type: 'action', subtype: 'wait_reply', value: 'order_id', remindAfter: '5 min', reminder: 'Just a reminder — please send your order ID so we can look into your refund.' },
    { id: 'step_4', type: 'action', subtype: 'message', value: 'Thanks! Could you tell us the reason for the refund?' },
    { id: 'step_5', type: 'action', subtype: 'wait_reply', value: 'refund_reason' },
    { id: 'step_6', type: 'condition', subtype: 'contains', value: 'wrong', skipIfFalse: 3 },
    { id: 'step_7', type: 'action', subtype: 'message', value: 'Your refund request has been received. Our support team will take it from here.' },
    { id: 'step_8', type: 'action', subtype: 'tag', value: 'Refund Requested' },
    { id: 'step_9', type: 'action', subtype: 'agent', value: 'Support' },
    { id: 'step_10', type: 'action', subtype: 'message', value: 'Sorry, this reason is not eligible for a refund. For help, contact support@example.com.' },
  ],
};

test.beforeEach(() => resetDb());

// ── A, D, E, F, G: the minimal workflow ─────────────────────────────────────

test('an active workflow replies to a matching WhatsApp message through the send step', async () => {
  addWorkflow(MINIMAL);

  const replies = await customerSends('wftest please');

  assert.deepEqual(replies, ['Workflow test successful']);
  const conversation = conversationOf('ws_A');
  const contact = contactOf('ws_A');
  assert.ok(contact, 'the sender became a contact in the number\'s workspace');
  assert.equal(contact.phoneNumber, CUSTOMER);
  assert.equal(sent[0].conversationId, conversation.id);
  assert.equal(sent[0].waNumberId, 'wa_A');
  assert.equal(sent[0].toPhone, CUSTOMER);

  const [run] = runs();
  assert.equal(run.status, 'COMPLETED');
  assert.equal(run.conversationId, conversation.id);
  assert.equal(run.contactId, contact.id);
  assert.equal(run.triggerMessage, 'wftest please');
});

test('B: an inactive workflow does not run', async () => {
  addWorkflow({ ...MINIMAL, isActive: false });
  assert.deepEqual(await customerSends('WFTEST'), []);
  assert.equal(runs().length, 0);
});

test('C: a workflow needs no intent rule — its own trigger starts it before intent matching is consulted', async () => {
  addWorkflow(MINIMAL);
  await customerSends('WFTEST');
  assert.equal(runs().length, 1);
  assert.equal(intentRuleQueries, 0, 'intent rules are not read when a workflow already claimed the message');
});

test('R: workflows are read from the database on every message, active ones only — nothing is held in memory', async () => {
  addWorkflow(MINIMAL);
  await customerSends('WFTEST');
  assert.ok(workflowQueries.some((w) => w.workspaceId === 'ws_A' && w.isActive === true));

  // A "restart": the workflow row is replaced by a fresh copy, as it would be
  // read back after the server comes up again.
  db.workflows = db.workflows.map((w) => structuredClone(w));
  assert.deepEqual(await customerSends('WFTEST again'), ['Workflow test successful']);
});

// ── The refund workflow end to end ─────────────────────────────────────────

test('refund, eligible: asks for the order ID, then the reason, then confirms, tags and hands to support', async () => {
  addWorkflow(REFUND);

  assert.deepEqual(await customerSends('Hi, I want to request a refund for my order.'),
    ['Sure, I can help with your refund request. Please provide your order ID.']);
  const [run] = runs();
  assert.equal(run.status, 'WAITING');
  assert.deepEqual(scheduled, [{ kind: 'remind', runId: run.id, cursor: 2, ms: 5 * 60_000 }],
    'J: the 5-minute reminder is scheduled while waiting for the order ID');

  assert.deepEqual(await customerSends('My order ID is ORD12345.'),
    ['Thanks! Could you tell us the reason for the refund?']);
  assert.equal(db.runs.get(run.id).variables.order_id, 'My order ID is ORD12345.');

  assert.deepEqual(await customerSends('I received the wrong product.'),
    ['Your refund request has been received. Our support team will take it from here.']);

  const done = db.runs.get(run.id);
  assert.equal(done.status, 'COMPLETED');
  assert.ok(contactOf('ws_A').tags.includes('Refund Requested'), 'K: tag added');
  const conversation = conversationOf('ws_A');
  assert.equal(conversation.assignedToUserId, 'u_support', 'L: assigned to support');
  assert.ok(conversation.humanHandoffAt, 'L: handed off');
  // Step 10 (action index 8) is the ineligible reply, after the handoff.
  assert.equal(done.trace.find((t) => t.step === 8)?.result, 'skipped',
    'the ineligible reply after the handoff is skipped, not sent');
  assert.equal(runs().length, 1, 'the replies continued the same run instead of starting new ones');
});

test('refund, not eligible: explains and gives support contact, no tag, no assignment', async () => {
  addWorkflow(REFUND);

  await customerSends('I want a refund');
  await customerSends('ORD999');
  assert.deepEqual(await customerSends('I just changed my mind'),
    ['Sorry, this reason is not eligible for a refund. For help, contact support@example.com.']);

  assert.equal(runs()[0].status, 'COMPLETED');
  assert.ok(!contactOf('ws_A').tags.includes('Refund Requested'));
  assert.equal(conversationOf('ws_A').assignedToUserId, null);
  assert.equal(conversationOf('ws_A').humanHandoffAt, null);
});

test('J: the reminder goes out if the customer has not answered, and not once they have', async () => {
  addWorkflow(REFUND);
  await customerSends('refund');
  const run = runs()[0];

  const first = await engine.sendReplyReminder(run.id, 2);
  assert.equal(first.sent, true);
  assert.equal(sent.at(-1).body, 'Just a reminder — please send your order ID so we can look into your refund.');
  assert.equal((await engine.sendReplyReminder(run.id, 2)).sent, false, 'reminded once only');

  await customerSends('ORD1');
  const before = sent.length;
  assert.equal((await engine.sendReplyReminder(run.id, 2)).sent, false, 'a stale reminder after the answer does nothing');
  assert.equal(sent.length, before);
});

test('J: a delay step parks the run and the resume sends the rest', async () => {
  addWorkflow({
    name: 'Delay',
    nodes: [
      { type: 'trigger', subtype: 'keyword', value: 'LATER' },
      { type: 'action', subtype: 'message', value: 'Got it.' },
      { type: 'action', subtype: 'delay', value: '5 min' },
      { type: 'action', subtype: 'message', value: 'Following up as promised.' },
    ],
  });

  assert.deepEqual(await customerSends('later'), ['Got it.']);
  const run = runs()[0];
  assert.equal(run.status, 'WAITING');
  assert.deepEqual(scheduled, [{ kind: 'resume', runId: run.id, cursor: 2, ms: 300_000 }]);

  await engine.advanceRun(run.id);
  assert.equal(sent.at(-1).body, 'Following up as promised.');
  assert.equal(db.runs.get(run.id).status, 'COMPLETED');
});

// ── Trigger matching for the messages customers actually send ──────────────

test('the refund keywords match the ways customers ask', () => {
  const keywords = REFUND.nodes[0].value;
  for (const message of [
    'Hi, I want to request a refund for my order.',
    'refund',
    'I want a refund',
    'I need to return my order',
    'Can I get my money back?',
  ]) {
    assert.equal(engine.triggerFires({ subtype: 'keyword', value: keywords }, { messageBody: message }), true, message);
  }
  assert.equal(keywordMatches(keywords, 'Where is my parcel?'), false);
});

// ── M, N: duplicates and tenants ────────────────────────────────────────────

test('M: a redelivered webhook does not start a second run or reply twice', async () => {
  addWorkflow(MINIMAL);
  await customerSends('WFTEST', { messageId: 'wamid.same' });
  await customerSends('WFTEST', { messageId: 'wamid.same' });
  assert.equal(runs().length, 1);
  assert.equal(sent.length, 1);
});

test('N: a message to another workspace\'s number never runs this workspace\'s workflow', async () => {
  addWorkflow(MINIMAL); // belongs to ws_A
  assert.deepEqual(await customerSends('WFTEST', { phoneNumberId: 'PN_B' }), []);
  assert.equal(runs().length, 0);
  assert.equal(conversationOf('ws_B').waNumberId, 'wa_B');
  assert.equal(conversationOf('ws_A'), undefined);
});

test('N: a message to an unknown number is dropped before anything is stored', async () => {
  addWorkflow(MINIMAL);
  assert.deepEqual(await customerSends('WFTEST', { phoneNumberId: 'PN_UNKNOWN' }), []);
  assert.equal(db.messages.length, 0);
});

// ── O, P: broken workflows and failures are visible ─────────────────────────

test('O: malformed workflows are skipped without breaking the message or other workflows', async () => {
  addWorkflow({ name: 'No nodes', nodes: null });
  addWorkflow({ name: 'No trigger', nodes: [{ type: 'action', subtype: 'message', value: 'never' }] });
  addWorkflow({ name: 'Empty keyword', nodes: [{ type: 'trigger', subtype: 'keyword', value: '' }, { type: 'action', subtype: 'message', value: 'never' }] });
  addWorkflow(MINIMAL);

  assert.deepEqual(await customerSends('WFTEST'), ['Workflow test successful']);
  assert.equal(db.messages.length, 1);
});

test('P: a reply WhatsApp refused leaves the run FAILED with the reason, not COMPLETED', async () => {
  addWorkflow(MINIMAL);
  sendFails = true;
  await customerSends('WFTEST');
  const [run] = runs();
  assert.equal(run.status, 'FAILED');
  assert.match(run.error, /Step 1 \(message\)/);
});

test('P: a run does not wait for the answer to a question that was never delivered', async () => {
  addWorkflow(REFUND);
  sendFails = true;
  await customerSends('refund');
  const [run] = runs();
  assert.equal(run.status, 'FAILED');
  assert.match(run.error, /not delivered/);
  assert.equal(scheduled.length, 0);
});

// ── Other automations sharing the message ───────────────────────────────────

test('a matching workflow outranks the refund escalation rule; without one the rule still hands off', async () => {
  // ws_A has escalationRules.refund on. With the workflow in place the
  // workflow answers and the thread stays automated.
  addWorkflow(REFUND);
  await customerSends('I want a refund');
  assert.equal(conversationOf('ws_A').humanHandoffAt, null);

  resetDb();
  assert.deepEqual(await customerSends('I want a refund'), []);
  assert.ok(conversationOf('ws_A').humanHandoffAt, 'no workflow claimed it, so the escalation rule did');
});

test('a conversation already handed to a person runs no workflow', async () => {
  addWorkflow(MINIMAL);
  await customerSends('hello');
  conversationOf('ws_A').humanHandoffAt = new Date();
  assert.deepEqual(await customerSends('WFTEST'), []);
  assert.equal(runs().length, 0);
});

// ── Q: what Create with AI saves actually runs ──────────────────────────────

const REFUND_PROMPT = "When a customer sends a message asking for a refund, first acknowledge their request and ask for their order ID. After they provide the order ID, ask them to confirm the reason for the refund. If the reason is eligible for a refund, tell the customer that the request has been received, add a 'Refund Requested' tag to the contact, and assign the conversation to the support team. If the reason is not eligible, explain that the refund cannot be processed and provide the support contact information. If the customer does not provide the order ID, send a reminder after 5 minutes.";

test('Q: a generated workflow whose model fell back to HELP still fires on the refund request', async () => {
  const preview = generator.cleanWorkflowPreview({
    name: 'Refund Request Workflow',
    nodes: [
      { type: 'trigger', subtype: 'keyword', value: 'HELP' },
      { type: 'action', subtype: 'message', value: 'Sure, I can help with your refund request. Please provide your order ID.' },
      { type: 'action', subtype: 'wait_reply', value: 'order_id', remindAfter: '5 min', reminder: 'Just checking in — could you send your order ID?' },
    ],
  }, REFUND_PROMPT);

  assert.equal(preview.nodes[0].value, 'REFUND, RETURN, MONEY BACK');
  assert.equal(preview.nodes[2].remindAfter, '5 min');
  addWorkflow(preview);
  assert.deepEqual(await customerSends('Hi, I want to request a refund for my order.'),
    ['Sure, I can help with your refund request. Please provide your order ID.']);
  assert.equal(scheduled[0]?.kind, 'remind');
});

test('Q: the built-in generator (no model available) fires on the refund request too', async () => {
  const preview = generator.fallbackWorkflowPreview(REFUND_PROMPT);
  addWorkflow(preview);
  const replies = await customerSends('Hi, I want to request a refund for my order.');
  assert.equal(replies.length, 1);
  assert.match(replies[0], /refund/i);
});
