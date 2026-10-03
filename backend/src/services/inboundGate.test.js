import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// The layers in front of the workflow engine (WF-IN-*): opt-in/opt-out, human
// handoff, control words, forms, escalation rules, the AI fallback, contact
// lookup, retries and the suppression record. The audit found the trigger
// engine matched correctly and these layers swallowed the message instead,
// often permanently for a contact. Each test here is one of those repros,
// asserting the corrected behaviour.
//
// Real webhook.service + workflowEngine + forms + opt-out + intent routing,
// against an in-memory Prisma; the Meta send is captured (and stored as an
// OUTBOUND message, as the real one is). The database URL points at a closed
// port so a query this file forgot to fake fails loudly.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';
delete process.env.HANDOFF_TTL_HOURS;

const sent = [];
let sendFails = false;
// Both send entry points record the same way: the workflow engine sends
// through deliverAutomatedReply (it needs the refusal code), the rest of the
// pipeline through sendAutomatedReply.
async function recordSend(args) {
  if (sendFails) return null;
  sent.push(args);
  // eslint-disable-next-line no-use-before-define
  const row = { id: `out_${sent.length}`, conversationId: args.conversationId, direction: 'OUTBOUND', body: args.body, senderUserId: null, createdAt: new Date(), sentAt: new Date() };
  // eslint-disable-next-line no-use-before-define
  db.messages.push(row);
  return row;
}
mock.module('./outbound.service.js', {
  namedExports: {
    sendAutomatedReply: recordSend,
    deliverAutomatedReply: async (args) => {
      const message = await recordSend(args);
      return message ? { ok: true, message } : { ok: false, code: 'META_REJECTED', detail: 'refused' };
    },
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

mock.module('./inboundMedia.service.js', {
  namedExports: {
    processInboundMedia: async () => ({ transcript: null }),
    archiveInboundMedia: async () => null,
    transcribeVoiceNote: async () => null,
    archiveOutboundMedia: async () => null,
    getMessageMedia: async () => null,
  },
});

const notifications = [];
mock.module('./notification.service.js', {
  namedExports: {
    notifyWorkspace: async (ws, n) => { notifications.push(n); },
    notifyWorkspaceGrouped: async (ws, n) => { notifications.push(n); },
    notifyUser: async () => {},
    listNotifications: async () => [],
    getUnreadCount: async () => 0,
    markRead: async () => {},
    markAllRead: async () => {},
  },
});

const { Prisma } = await import('@prisma/client');
const { prisma } = await import('../lib/prisma.js');

let db;
let seq = 0;
const id = (p) => `${p}_${++seq}`;
const clone = (v) => (v == null ? v : structuredClone(v));

function resetDb() {
  db = {
    waNumbers: [{ id: 'wa_A', workspaceId: 'ws_A', metaPhoneNumberId: 'PN_A', phoneNumber: '+10000000001' }],
    workspaces: {
      ws_A: { id: 'ws_A', aiAgentEnabled: false, autoWelcomeEnabled: false, escalationRules: null, intentMatchingEnabled: true },
    },
    planFeatures: { automation: true, workflows: true },
    contacts: [],
    conversations: [],
    messages: [],
    workflows: [],
    triggers: [],
    intentRules: [],
    runs: new Map(),
    forms: [],
    formSubs: [],
    optOuts: [],
    workspaceFindThrowsOnce: false,
  };
  sent.length = 0;
  notifications.length = 0;
  sendFails = false;
  delete process.env.HANDOFF_TTL_HOURS;
}

function applyData(target, data) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && !(value instanceof Date) && 'increment' in value) target[key] = (target[key] ?? 0) + value.increment;
    else target[key] = value;
  }
  return target;
}
const statusMatches = (status, want) => (want == null ? true
  : typeof want === 'string' ? status === want
    : Array.isArray(want.in) ? want.in.includes(status) : true);
const after = (value, cond) => !cond?.gte || (value && new Date(value) >= new Date(cond.gte));

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
prisma.workspaceMember.findMany = async () => [{ workspaceId: 'ws_A', userId: 'u1', role: 'ADMIN', user: { id: 'u1', name: 'Owner', email: 'o@a.test' } }];
prisma.workspace.findUnique = async ({ where, select }) => {
  // Fails only the inbound pipeline's own workspace read (the one that loads
  // escalationRules) — a transient error after the message was stored.
  if (db.workspaceFindThrowsOnce && select?.escalationRules) {
    db.workspaceFindThrowsOnce = false;
    throw new Prisma.PrismaClientKnownRequestError('Timed out fetching a new connection from the connection pool', { code: 'P2024', clientVersion: 'x' });
  }
  return clone(db.workspaces[where.id] ?? null);
};
prisma.subscription.findUnique = async () => ({ status: 'ACTIVE', plan: { name: 'Plan', features: clone(db.planFeatures) } });

// Contacts.
prisma.contact.findFirst = async ({ where }) => {
  const phones = (where.OR ?? []).map((o) => o.phoneNumber);
  return clone(db.contacts.find((c) => c.workspaceId === where.workspaceId
    && (phones.length ? phones.includes(c.phoneNumber) : true)
    && (where.optedOut === undefined || c.optedOut === where.optedOut)) ?? null);
};
prisma.contact.findMany = async ({ where }) => clone(db.contacts.filter((c) => c.workspaceId === where.workspaceId
  && (!where.id?.in || where.id.in.includes(c.id))));
prisma.$queryRaw = async (strings, workspaceId, tail) => db.contacts
  .filter((c) => c.workspaceId === workspaceId && String(c.phoneNumber).replace(/\D/g, '').slice(-10) === tail)
  .map((c) => ({ id: c.id }));
prisma.contact.create = async ({ data }) => {
  const row = { id: id('ct'), tags: [], optedOut: false, createdAt: new Date(), ...data };
  db.contacts.push(row);
  return clone(row);
};
prisma.contact.findUnique = async ({ where }) => clone(db.contacts.find((c) => c.id === where.id) ?? null);
prisma.contact.update = async ({ where, data }) => clone(applyData(db.contacts.find((c) => c.id === where.id), data));
prisma.contact.updateMany = async ({ where, data }) => {
  const rows = db.contacts.filter((c) => c.workspaceId === where.workspaceId && (!where.phoneNumber?.in || where.phoneNumber.in.includes(c.phoneNumber)));
  rows.forEach((c) => applyData(c, data));
  return { count: rows.length };
};

// Conversations.
const withContact = (c) => c && { ...clone(c), contact: clone(db.contacts.find((x) => x.id === c.contactId)) };
prisma.conversation.findFirst = async ({ where }) => clone(db.conversations.find((c) => c.workspaceId === where.workspaceId
  && (where.id ? c.id === where.id : c.contactId === where.contactId && c.waNumberId === where.waNumberId)) ?? null);
prisma.conversation.create = async ({ data }) => {
  const row = { id: id('conv'), humanHandoffAt: null, handoffReason: null, assignedToUserId: null, unreadCount: 0, lastMessageAt: new Date(), ...data };
  db.conversations.push(row);
  return clone(row);
};
prisma.conversation.findUnique = async ({ where }) => withContact(db.conversations.find((c) => c.id === where.id) ?? null);
prisma.conversation.update = async ({ where, data }) => clone(applyData(db.conversations.find((c) => c.id === where.id), data));

// Messages.
function messageMatches(m, where = {}) {
  if (where.direction && m.direction !== where.direction) return false;
  if (where.conversationId && m.conversationId !== where.conversationId) return false;
  if (where.id?.not && m.id === where.id.not) return false;
  if (where.senderUserId && 'not' in where.senderUserId && m.senderUserId == null) return false;
  if (where.body && m.body !== where.body) return false;
  if (!after(m.createdAt, where.createdAt) || !after(m.sentAt, where.sentAt)) return false;
  if (where.conversation) {
    const c = db.conversations.find((x) => x.id === m.conversationId);
    if (!c || c.workspaceId !== where.conversation.workspaceId || c.contactId !== where.conversation.contactId) return false;
  }
  return true;
}
prisma.message.create = async ({ data }) => {
  if (data.metaMessageId && db.messages.some((m) => m.metaMessageId === data.metaMessageId)) {
    throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  }
  const row = { id: id('msg'), createdAt: new Date(), automationProcessedAt: null, ...data };
  db.messages.push(row);
  return clone(row);
};
prisma.message.findUnique = async ({ where }) => clone(db.messages.find((m) => m.metaMessageId === where.metaMessageId) ?? null);
prisma.message.findFirst = async ({ where }) => clone(db.messages
  .filter((m) => messageMatches(m, where))
  .sort((a, b) => new Date(b.sentAt ?? b.createdAt) - new Date(a.sentAt ?? a.createdAt))[0] ?? null);
prisma.message.count = async ({ where }) => db.messages.filter((m) => messageMatches(m, where)).length;
prisma.message.findMany = async ({ where }) => clone(db.messages.filter((m) => messageMatches(m, where)));
prisma.message.update = async ({ where, data }) => clone(applyData(db.messages.find((m) => m.id === where.id), data));

// Workflows and runs.
prisma.workflow.findMany = async ({ where }) => clone(db.workflows.filter((w) => w.workspaceId === where.workspaceId
  && (where.isActive === undefined || w.isActive === where.isActive)));
prisma.workflow.findFirst = async ({ where }) => clone(db.workflows.find((w) => w.workspaceId === where.workspaceId && w.isActive
  && where.OR.some((o) => (o.id && o.id === w.id) || (typeof o.name === 'string' && o.name === w.name))) ?? null);
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
  && (!where.workflowId || r.workflowId === where.workflowId)
  && statusMatches(r.status, where.status)
  && (!where.error?.startsWith || String(r.error ?? '').startsWith(where.error.startsWith))
  && after(r.startedAt, where.startedAt));
prisma.workflowRun.findMany = async ({ where }) => clone(runFilter(where).sort((a, b) => b.startedAt - a.startedAt));
prisma.workflowRun.findFirst = async ({ where }) => clone(runFilter(where).sort((a, b) => b.startedAt - a.startedAt)[0] ?? null);
prisma.workflowRun.count = async ({ where }) => runFilter(where).length;
const { updateManyRuns } = await import('./workflowRunStore.testutil.js');
prisma.workflowRun.updateMany = async (args) => updateManyRuns(() => db.runs.values(), args);

// Keyword triggers and intent rules.
prisma.automationTrigger.findMany = async () => clone(db.triggers);
prisma.automationTrigger.findFirst = async ({ where }) => clone(db.triggers.find((t) => t.id === where.id) ?? null);
prisma.intentRule.findMany = async () => clone(db.intentRules);

// Forms.
const withForm = (s) => s && { ...clone(s), form: clone(db.forms.find((f) => f.id === s.formId) ?? s.form ?? null) };
prisma.whatsappFormSubmission.findFirst = async ({ where }) => withForm(db.formSubs
  .filter((s) => s.conversationId === where.conversationId && s.completed === where.completed)
  .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null);
prisma.whatsappFormSubmission.count = async ({ where }) => db.formSubs.filter((s) => s.conversationId === where.conversationId && s.completed === where.completed).length;
prisma.whatsappFormSubmission.update = async ({ where, data }) => {
  const row = db.formSubs.find((s) => s.id === where.id);
  applyData(row, data);
  if (!('updatedAt' in data)) row.updatedAt = new Date();
  return clone(row);
};
prisma.whatsappForm.findMany = async ({ where }) => clone(db.forms.filter((f) => f.workspaceId === where.workspaceId && f.status === where.status));

// Opt-outs.
prisma.optOut.upsert = async ({ where, create, update }) => {
  const key = where.workspaceId_phoneNumber;
  const found = db.optOuts.find((o) => o.workspaceId === key.workspaceId && o.phoneNumber === key.phoneNumber);
  if (found) return clone(Object.assign(found, update));
  const row = { id: id('opt'), ...create };
  db.optOuts.push(row);
  return clone(row);
};
prisma.optOut.findUnique = async ({ where }) => clone(db.optOuts.find((o) => o.phoneNumber === where.workspaceId_phoneNumber.phoneNumber) ?? null);
prisma.optOut.findMany = async ({ where }) => clone(db.optOuts.filter((o) => o.workspaceId === where.workspaceId
  && (!where.phoneNumber || o.phoneNumber === where.phoneNumber) && (where.active === undefined || o.active === where.active)));
prisma.optOut.updateMany = async ({ where, data }) => {
  const rows = db.optOuts.filter((o) => where.id.in.includes(o.id) && (where.active === undefined || o.active === where.active));
  rows.forEach((o) => Object.assign(o, data));
  return { count: rows.length };
};

const { processWebhook } = await import('./webhook.service.js');
const { processWebhookJob } = await import('../workers/webhook.worker.js');
const { splitWebhook } = await import('./webhookEvents.js');

// ── helpers ────────────────────────────────────────────────────────────────
const CUSTOMER = '919800000001';
function envelope(message, { messageId } = {}) {
  return {
    entry: [{
      id: 'waba_1',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'PN_A' },
          contacts: [{ profile: { name: 'Asha' }, wa_id: CUSTOMER }],
          messages: [{ from: CUSTOMER, id: messageId ?? `wamid.${++seq}`, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
        },
      }],
    }],
  };
}
const text = (body, opts) => envelope({ type: 'text', text: { body } }, opts);
const buttonTap = (title) => envelope({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: `b_${title}`, title } } });
const photo = (caption) => envelope({ type: 'image', image: { id: `media_${++seq}`, mime_type: 'image/jpeg', ...(caption ? { caption } : {}) } });
async function customerSends(payload) {
  const before = sent.length;
  await processWebhook(payload);
  return sent.slice(before).map((s) => s.body);
}
function addWorkflow(fields) {
  const wf = { id: id('wf'), workspaceId: 'ws_A', isActive: true, createdAt: new Date(), name: 'WF', edges: [], ...fields };
  db.workflows.push(wf);
  return wf;
}
const keywordWorkflow = (keyword, replyText = `${keyword} workflow reply`) => addWorkflow({
  name: `${keyword} flow`,
  nodes: [
    { id: 's1', type: 'trigger', subtype: 'keyword', value: keyword },
    { id: 's2', type: 'action', subtype: 'message', value: replyText },
  ],
});
const KEYWORD_WF = {
  name: 'Order help',
  nodes: [
    { id: 's1', type: 'trigger', subtype: 'keyword', value: 'ORDER' },
    { id: 's2', type: 'action', subtype: 'message', value: 'Workflow reply' },
  ],
};
// Asks a question with buttons and waits for the answer.
const QUESTION_WF = (options = 'Yes please | No thanks') => ({
  name: 'Question',
  nodes: [
    { id: 's1', type: 'trigger', subtype: 'keyword', value: 'DEMO' },
    { id: 's2', type: 'action', subtype: 'buttons', value: `Want a demo? | ${options}` },
    { id: 's3', type: 'action', subtype: 'wait_reply', value: 'choice' },
    { id: 's4', type: 'action', subtype: 'message', value: 'Got it: {{choice}}' },
  ],
});
// Asks a free-text question and waits.
const FREE_TEXT_WF = {
  name: 'Allergies',
  nodes: [
    { id: 's1', type: 'trigger', subtype: 'keyword', value: 'BOOK' },
    { id: 's2', type: 'action', subtype: 'message', value: 'Any allergies?' },
    { id: 's3', type: 'action', subtype: 'wait_reply', value: 'allergies' },
    { id: 's4', type: 'action', subtype: 'message', value: 'Noted: {{allergies}}' },
  ],
};
const runs = () => [...db.runs.values()];
const liveRuns = () => runs().filter((r) => r.status !== 'CANCELLED' || !String(r.error ?? '').startsWith('Not run:'));
const suppressions = () => runs().filter((r) => r.status === 'CANCELLED' && String(r.error ?? '').startsWith('Not run:'));
const conv = () => db.conversations[0];
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000);

test.beforeEach(() => resetDb());

// ── WF-IN-1: human handoff expires and records why ──────────────────────────

test('F1d: a workflow "agent" step pauses automation, which resumes once nobody has replied for HANDOFF_TTL_HOURS', async () => {
  addWorkflow({
    name: 'Handoff',
    nodes: [
      { id: 's1', type: 'trigger', subtype: 'keyword', value: 'ORDER' },
      { id: 's2', type: 'action', subtype: 'message', value: 'Connecting you' },
      { id: 's3', type: 'action', subtype: 'agent', value: '' },
    ],
  });
  assert.deepEqual(await customerSends(text('ORDER')), ['Connecting you']);
  assert.ok(conv().humanHandoffAt);

  // Within the hold: nothing runs, and the run history says why.
  assert.deepEqual(await customerSends(text('ORDER')), []);
  assert.equal(liveRuns().length, 1);
  assert.equal(suppressions().length, 1);
  assert.match(suppressions()[0].error, /Not run: a person is handling this chat \(a workflow assigned it to an agent\)/);

  // A day later with no reply from the person: the workflow fires again.
  conv().humanHandoffAt = hoursAgo(25);
  assert.deepEqual(await customerSends(text('ORDER')), ['Connecting you']);
  assert.equal(liveRuns().length, 2);
});

test('the hold is measured from the last message a person sent, not only from the handoff', async () => {
  keywordWorkflow('ORDER');
  await customerSends(text('hello'));
  conv().humanHandoffAt = hoursAgo(30);
  db.messages.push({ id: 'human_1', conversationId: conv().id, direction: 'OUTBOUND', senderUserId: 'u1', body: 'Hi, Priya here', createdAt: hoursAgo(2), sentAt: hoursAgo(2) });
  assert.deepEqual(await customerSends(text('ORDER')), [], 'a person replied 2h ago — still theirs');
  assert.ok(conv().humanHandoffAt);
});

test('HANDOFF_TTL_HOURS sets the hold', async () => {
  keywordWorkflow('ORDER');
  await customerSends(text('hello'));
  process.env.HANDOFF_TTL_HOURS = '2';
  conv().humanHandoffAt = hoursAgo(3);
  assert.deepEqual(await customerSends(text('ORDER')), ['ORDER workflow reply']);
});

test('a CLOSED (or RESOLVED) conversation the customer writes to again starts afresh, handoff cleared', async () => {
  keywordWorkflow('ORDER');
  await customerSends(text('hello'));
  Object.assign(conv(), { humanHandoffAt: new Date(), handoffReason: 'customer_asked_human', status: 'CLOSED' });
  assert.deepEqual(await customerSends(text('ORDER')), ['ORDER workflow reply']);
  assert.equal(conv().humanHandoffAt, null);
  assert.equal(conv().handoffReason, null);
  assert.equal(conv().status, 'OPEN');
});

test('the reason for a handoff is recorded: an explicit "talk to a human"', async () => {
  await customerSends(text('I want to talk to a human'));
  assert.ok(conv().humanHandoffAt);
  assert.equal(conv().handoffReason, 'customer_asked_human');
});

test('suppression records are throttled to one per conversation and workflow per hour', async () => {
  keywordWorkflow('ORDER');
  await customerSends(text('hello'));
  conv().humanHandoffAt = new Date();
  await customerSends(text('ORDER'));
  await customerSends(text('ORDER'));
  await customerSends(text('ORDER again'));
  assert.equal(suppressions().length, 1);
  assert.equal(suppressions()[0].triggerMessage, 'ORDER');
});

test('nothing is recorded when no workflow would have matched anyway', async () => {
  keywordWorkflow('ORDER');
  await customerSends(text('hello'));
  conv().humanHandoffAt = new Date();
  await customerSends(text('just chatting'));
  assert.equal(runs().length, 0);
});

// ── WF-IN-2: "agent" with nothing running does not escalate ────────────────

test('F1b: the bare word "agent" with no flow running reaches an AGENT keyword workflow instead of handing off', async () => {
  keywordWorkflow('AGENT', 'Our agents are available 9-5');
  assert.deepEqual(await customerSends(text('agent')), ['Our agents are available 9-5']);
  assert.equal(conv().humanHandoffAt, null);
});

test('"operate" is not "operator", and "customer care" alone does not hand off with nothing running', async () => {
  keywordWorkflow('ORDER');
  await customerSends(text('operate'));
  await customerSends(text('customer care'));
  assert.equal(conv().humanHandoffAt, null);
  assert.deepEqual(await customerSends(text('ORDER')), ['ORDER workflow reply']);
});

test('an explicit request for a person hands off with nothing running', async () => {
  await customerSends(text('speak to agent please'));
  assert.ok(conv().humanHandoffAt);
});

test('"agent" while a form is open is a request for a person', async () => {
  await customerSends(text('hello'));
  db.forms.push({ id: 'form_1', workspaceId: 'ws_A', status: 'Active', schema: [{ key: 'email', label: 'Your email?', type: 'email', options: [] }] });
  db.formSubs.push({ id: 'sub_1', formId: 'form_1', conversationId: conv().id, completed: false, cursor: 0, answers: {}, createdAt: new Date(), updatedAt: new Date() });
  await customerSends(text('agent'));
  assert.ok(conv().humanHandoffAt);
  assert.equal(db.formSubs[0].completed, true);
});

// ── WF-IN-3: escalation rules only with an AI agent deployed, after triggers ─

test('F1a: escalation rules saved on the AI Agent screen do nothing while no agent is deployed', async () => {
  db.workspaces.ws_A.escalationRules = { refund: true, negativeSentiment: true, asksForHuman: true, highIntent: false };
  keywordWorkflow('ORDER');
  await customerSends(text('this app is useless'));
  assert.equal(conv().humanHandoffAt, null);
  assert.deepEqual(await customerSends(text('ORDER')), ['ORDER workflow reply']);
});

test('with an agent deployed, a keyword trigger still answers before the escalation rules', async () => {
  Object.assign(db.workspaces.ws_A, { aiAgentEnabled: true, escalationRules: { refund: true } });
  db.triggers.push({ id: 'tr_1', workspaceId: 'ws_A', keyword: 'refund', responseTemplate: 'Refunds take 5 days.', isActive: true });
  assert.deepEqual(await customerSends(text('refund')), ['Refunds take 5 days.']);
  assert.equal(conv().humanHandoffAt, null);

  // Nothing else claims it: the agent's rule hands off, with the rule named.
  assert.deepEqual(await customerSends(text('I want my money back')), []);
  assert.ok(conv().humanHandoffAt);
  assert.equal(conv().handoffReason, 'escalation_rule:refund');
});

// ── WF-IN-4: the AI agent producing nothing does not hand off ───────────────

test('F1c: an AI agent that produces no reply (no key / provider 503) leaves the message unanswered and does not pause automation', async () => {
  db.workspaces.ws_A.aiAgentEnabled = true;
  db.planFeatures.campaignAi = true;
  keywordWorkflow('ORDER');
  const logs = [];
  const original = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  try {
    await customerSends(text('what are your prices'));
  } finally {
    console.log = original;
  }
  assert.equal(conv().humanHandoffAt, null);
  assert.ok(logs.some((l) => /no LLM provider is configured/.test(l)), 'the log names the real cause');
  assert.deepEqual(await customerSends(text('ORDER')), ['ORDER workflow reply']);
});

test('the silence log names the plan gate, not "no AI agent is deployed", when the plan lacks campaignAi', async () => {
  db.workspaces.ws_A.aiAgentEnabled = true;
  const { env } = await import('../config/env.js');
  const savedKey = env.GEMINI_API_KEY;
  env.GEMINI_API_KEY = 'test-key'; // the provider is configured; the plan is what is missing
  const logs = [];
  const original = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  try {
    await customerSends(text('what are your prices'));
  } finally {
    console.log = original;
    env.GEMINI_API_KEY = savedKey;
  }
  assert.ok(logs.some((l) => /plan does not include the campaignAi feature/.test(l)), logs.filter((l) => /Nothing answered/.test(l)).join('\n'));
  assert.ok(!logs.some((l) => /no AI agent is deployed/.test(l)));
});

// ── WF-IN-5: control words do not cancel a run waiting for an answer ───────

for (const answer of ['None', 'Gone', 'Dona', 'Complete', 'Done', 'cancel']) {
  test(`a waiting workflow gets "${answer}" as its answer — the run is resumed, not cancelled`, async () => {
    addWorkflow(FREE_TEXT_WF);
    assert.deepEqual(await customerSends(text('BOOK')), ['Any allergies?']);
    assert.deepEqual(await customerSends(text(answer)), [`Noted: ${answer}`]);
    assert.equal(liveRuns()[0].status, 'COMPLETED');
  });
}

test('a button titled "Agent" answers the question it belongs to', async () => {
  addWorkflow(QUESTION_WF('Sales | Agent'));
  await customerSends(text('DEMO'));
  assert.deepEqual(await customerSends(buttonTap('Agent')), ['Got it: Agent']);
  assert.equal(conv().humanHandoffAt, null);
});

test('an explicit "stop this" while a run waits cancels it and says so', async () => {
  addWorkflow(FREE_TEXT_WF);
  await customerSends(text('BOOK'));
  const replies = await customerSends(text('stop this'));
  assert.equal(replies.length, 1);
  assert.match(replies[0], /cancelled/i);
  assert.equal(liveRuns()[0].status, 'CANCELLED');
});

test('an explicit "talk to a human" while a run waits hands off and cancels the run', async () => {
  addWorkflow(FREE_TEXT_WF);
  await customerSends(text('BOOK'));
  await customerSends(text('talk to a human'));
  assert.ok(conv().humanHandoffAt);
  assert.equal(liveRuns()[0].status, 'CANCELLED');
});

// ── WF-IN-6: opt-out narrowed, buttons never opt out, START opts back in ───

test('F2a: tapping a workflow button "No thanks" answers the question and opts nobody out', async () => {
  addWorkflow(QUESTION_WF());
  await customerSends(text('DEMO'));
  assert.deepEqual(await customerSends(buttonTap('No thanks')), ['Got it: No thanks']);
  assert.equal(db.optOuts.length, 0);
  assert.equal(liveRuns()[0].status, 'COMPLETED');
});

test('F2b: "Remove" reaches a REMOVE keyword workflow instead of opting the contact out', async () => {
  keywordWorkflow('REMOVE', 'Which item should we remove?');
  assert.deepEqual(await customerSends(text('Remove')), ['Which item should we remove?']);
  assert.equal(db.optOuts.length, 0);
});

for (const word of ['end', 'quit', 'cancel', 'no thanks']) {
  test(`typing "${word}" with nothing running is an ordinary message, not an opt-out`, async () => {
    await customerSends(text(word));
    assert.equal(db.optOuts.length, 0);
    assert.notEqual(db.contacts[0].optedOut, true);
  });
}

test('STOP opts out (and the notification says how to opt back in)', async () => {
  assert.deepEqual(await customerSends(text('STOP')), []);
  assert.equal(db.optOuts.length, 1);
  assert.equal(db.optOuts[0].keyword, 'stop');
  assert.equal(db.contacts[0].optedOut, true);
  assert.match(notifications.at(-1).body, /START/);
});

test('STOP while a flow is open ends the flow first; a second STOP opts out', async () => {
  addWorkflow(FREE_TEXT_WF);
  await customerSends(text('BOOK'));
  const replies = await customerSends(text('stop'));
  assert.equal(replies.length, 1);
  assert.match(replies[0], /reply STOP again/);
  assert.equal(liveRuns()[0].status, 'CANCELLED');
  assert.equal(db.optOuts.length, 0);

  await customerSends(text('STOP'));
  assert.equal(db.optOuts.length, 1);
});

test('START from an opted-out contact opts them back in and confirms — the confirmation is sent', async () => {
  await customerSends(text('STOP'));
  assert.equal(db.contacts[0].optedOut, true);
  const replies = await customerSends(text('START'));
  assert.equal(replies.length, 1);
  assert.match(replies[0], /subscribed again/);
  assert.equal(db.contacts[0].optedOut, false);
  assert.equal(db.contacts[0].optInSource, 'whatsapp_start');
  assert.ok(db.contacts[0].optInAt instanceof Date);
  assert.equal(db.optOuts[0].active, false);
});

test('"start" from a contact who never opted out is an ordinary message (a START workflow can answer it)', async () => {
  keywordWorkflow('START', 'Welcome aboard');
  assert.deepEqual(await customerSends(text('start')), ['Welcome aboard']);
  assert.equal(db.contacts[0].optInSource, undefined);
});

// ── WF-IN-7: abandoned forms let go ─────────────────────────────────────────

function openForm({ status = 'Active', ageMs = 0, updatedAgoMs = ageMs } = {}) {
  db.forms.push({ id: 'form_1', workspaceId: 'ws_A', status, completionMessage: 'Thanks!', schema: [{ key: 'size', label: 'Pick a size', type: 'choice', options: ['Small', 'Large'], required: true }] });
  db.formSubs.push({
    id: 'sub_1', workspaceId: 'ws_A', formId: 'form_1', conversationId: conv().id, completed: false, cursor: 0, answers: {},
    createdAt: new Date(Date.now() - ageMs), updatedAt: new Date(Date.now() - updatedAgoMs),
  });
}

test('F3: a 90-day-old submission of a paused form no longer captures messages; the workflow runs', async () => {
  keywordWorkflow('ORDER');
  await customerSends(text('hello'));
  openForm({ status: 'Paused', ageMs: 90 * 86_400_000 });
  assert.deepEqual(await customerSends(text('ORDER')), ['ORDER workflow reply']);
  assert.ok(db.formSubs[0].abandonedAt, 'marked abandoned');
  assert.equal(db.formSubs[0].completed, true);
});

test('an Active form left unanswered for more than a day is abandoned', async () => {
  keywordWorkflow('ORDER');
  await customerSends(text('hello'));
  openForm({ ageMs: 25 * 3_600_000 });
  assert.deepEqual(await customerSends(text('ORDER')), ['ORDER workflow reply']);
  assert.ok(db.formSubs[0].abandonedAt);
});

test('a fresh form keeps the conversation: an off-option answer is re-asked', async () => {
  keywordWorkflow('ORDER');
  await customerSends(text('hello'));
  openForm({ ageMs: 60_000 });
  assert.deepEqual(await customerSends(text('ORDER')), ['Please reply with one of: Small, Large']);
  assert.equal(db.formSubs[0].completed, false);
});

test('a form idle for over 10 minutes lets go of a message an active workflow answers — and is recorded', async () => {
  keywordWorkflow('ORDER');
  await customerSends(text('hello'));
  openForm({ ageMs: 15 * 60_000 });
  assert.deepEqual(await customerSends(text('ORDER')), ['ORDER workflow reply']);
  assert.ok(db.formSubs[0].abandonedAt);

  // …but not one nothing would answer: that is still the form's.
  db.formSubs.length = 0;
  openForm({ ageMs: 15 * 60_000 });
  assert.deepEqual(await customerSends(text('medium')), ['Please reply with one of: Small, Large']);
});

test('a message captured by an open form that a workflow would have matched is recorded as not run', async () => {
  keywordWorkflow('SMALL');
  await customerSends(text('hello'));
  openForm({ ageMs: 60_000 });
  assert.deepEqual(await customerSends(text('Small')), ['Thanks!']);
  assert.equal(suppressions().length, 1);
  assert.match(suppressions()[0].error, /WhatsApp form/);
});

// ── WF-IN-8: captions count; placeholders never match keywords ─────────────

test('F5: a photo captioned "ORDER 123 arrived damaged" fires the ORDER keyword workflow', async () => {
  addWorkflow(KEYWORD_WF);
  assert.deepEqual(await customerSends(photo('ORDER 123 arrived damaged')), ['Workflow reply']);
});

test('a photo with no caption still fires a media workflow; its placeholder never matches a keyword', async () => {
  keywordWorkflow('PHOTO');
  addWorkflow({ name: 'Media', nodes: [
    { id: 's1', type: 'trigger', subtype: 'media', value: 'image' },
    { id: 's2', type: 'action', subtype: 'message', value: 'Thanks for the picture' },
  ] });
  assert.deepEqual(await customerSends(photo()), ['Thanks for the picture']);
});

test('K3: a catalog order stored as "[unsupported message: order]" does not fire the ORDER keyword workflow', async () => {
  addWorkflow(KEYWORD_WF);
  assert.deepEqual(await customerSends(envelope({ type: 'order', order: { catalog_id: 'c1' } })), []);
  assert.equal(runs().length, 0);
});

test('a shared location is not matched as text either', async () => {
  keywordWorkflow('LOCATION');
  assert.deepEqual(await customerSends(envelope({ type: 'location', location: { latitude: 1, longitude: 2 } })), []);
  assert.equal(runs().length, 0);
});

// ── WF-IN-9: media does not answer a "wait for reply" step with "[photo]" ──

test('a photo sent while a run waits for a reply keeps it waiting; a captioned one answers with the caption', async () => {
  addWorkflow(FREE_TEXT_WF);
  await customerSends(text('BOOK'));
  assert.deepEqual(await customerSends(photo()), []);
  const [run] = liveRuns();
  assert.equal(db.runs.get(run.id).status, 'WAITING');

  assert.deepEqual(await customerSends(photo('peanuts')), ['Noted: peanuts']);
  assert.equal(db.runs.get(run.id).status, 'COMPLETED');
});

// ── WF-IN-10: welcome on a contact's first inbound message ─────────────────

const WELCOME_WF = { name: 'Welcome', nodes: [
  { id: 's1', type: 'trigger', subtype: 'welcome', value: '' },
  { id: 's2', type: 'action', subtype: 'message', value: 'Welcome!' },
] };

test('F6: an imported contact\'s first message gets the welcome workflow; the second does not', async () => {
  addWorkflow(WELCOME_WF);
  db.contacts.push({ id: 'ct_imported', workspaceId: 'ws_A', phoneNumber: `+${CUSTOMER}`, name: 'Imported', tags: [], createdAt: hoursAgo(500) });
  assert.deepEqual(await customerSends(text('hi')), ['Welcome!']);
  assert.notDeepEqual(await customerSends(text('hi')), ['Welcome!']);
});

test('a campaign recipient (outbound only so far) is welcomed on their first reply', async () => {
  addWorkflow(WELCOME_WF);
  db.contacts.push({ id: 'ct_c', workspaceId: 'ws_A', phoneNumber: `+${CUSTOMER}`, name: 'Recipient', tags: [] });
  db.conversations.push({ id: 'conv_c', workspaceId: 'ws_A', contactId: 'ct_c', waNumberId: 'wa_A', status: 'OPEN', humanHandoffAt: null, lastMessageAt: hoursAgo(5) });
  db.messages.push({ id: 'camp_msg', conversationId: 'conv_c', direction: 'OUTBOUND', body: 'Big sale!', createdAt: hoursAgo(5), sentAt: hoursAgo(5) });
  assert.deepEqual(await customerSends(text('tell me more')), ['Welcome!']);
});

// ── WF-IN-11: legacy phone spellings ───────────────────────────────────────

test('F8: a contact stored as "+91 98000 00001" is found on inbound — no duplicate, not treated as new', async () => {
  addWorkflow({ name: 'Welcome', nodes: [
    { id: 's1', type: 'trigger', subtype: 'welcome', value: '' },
    { id: 's2', type: 'action', subtype: 'message', value: 'Welcome, new customer!' },
  ] });
  db.contacts.push({ id: 'ct_legacy', workspaceId: 'ws_A', phoneNumber: '+91 98000 00001', name: 'Existing VIP', tags: ['VIP'] });
  db.conversations.push({ id: 'conv_legacy', workspaceId: 'ws_A', contactId: 'ct_legacy', waNumberId: 'wa_A', status: 'OPEN', humanHandoffAt: null, lastMessageAt: hoursAgo(1) });
  db.messages.push({ id: 'old_in', conversationId: 'conv_legacy', direction: 'INBOUND', body: 'earlier', createdAt: hoursAgo(1), sentAt: hoursAgo(1) });
  const replies = await customerSends(text('hi again'));
  assert.equal(db.contacts.length, 1, 'no duplicate contact');
  assert.ok(db.messages.some((m) => m.body === 'hi again' && m.conversationId === 'conv_legacy'), 'stored on the existing thread');
  assert.notDeepEqual(replies, ['Welcome, new customer!']);
});

test('a number stored with dashes in another workspace is not matched across workspaces', async () => {
  db.contacts.push({ id: 'ct_other', workspaceId: 'ws_B', phoneNumber: '+91-98000-00001', name: 'Other tenant', tags: [] });
  await customerSends(text('hi'));
  assert.equal(db.contacts.filter((c) => c.workspaceId === 'ws_A').length, 1);
  assert.equal(db.contacts.find((c) => c.workspaceId === 'ws_A').phoneNumber, `+${CUSTOMER}`);
});

// ── WF-IN-12: a retry after the message is stored keeps the automation ─────

test('F4: a transient error after the message is stored — the retry runs the workflow', async () => {
  addWorkflow(KEYWORD_WF);
  const payload = text('ORDER');
  db.workspaceFindThrowsOnce = true;
  await assert.rejects(processWebhook(payload), /connection pool/);
  assert.equal(db.messages.length, 1);
  assert.equal(db.messages[0].automationProcessedAt, null);

  await processWebhook(payload);
  assert.deepEqual(sent.map((s) => s.body), ['Workflow reply']);
  assert.ok(db.messages.find((m) => m.direction === 'INBOUND').automationProcessedAt, 'marked once the pipeline finished');
  assert.equal(conv().unreadCount, 1, 'counted once');

  // A later redelivery of the same message is a plain duplicate.
  await processWebhook(payload);
  assert.equal(sent.length, 1);
});

test('a retry whose first attempt already replied does not reply again', async () => {
  keywordWorkflow('ORDER');
  const payload = text('ORDER', { messageId: 'wamid.retry.1' });
  await customerSends(payload);
  assert.equal(sent.length, 1);
  // The first attempt crashed after the send, before the marker was written.
  db.messages.find((m) => m.metaMessageId === 'wamid.retry.1').automationProcessedAt = null;
  await processWebhook(payload);
  assert.equal(sent.length, 1);
  assert.equal(liveRuns().length, 1);
});

test('a stored message older than an hour is not resumed', async () => {
  keywordWorkflow('ORDER');
  const payload = text('ORDER', { messageId: 'wamid.old.1' });
  await customerSends(text('hello'));
  db.messages.push({ id: 'old', conversationId: conv().id, direction: 'INBOUND', metaMessageId: 'wamid.old.1', body: 'ORDER', createdAt: hoursAgo(2), sentAt: hoursAgo(2), automationProcessedAt: null });
  const before = sent.length;
  await processWebhook(payload);
  assert.equal(sent.length, before);
});

test('two deliveries of one message processed concurrently under the worker lock send one reply', async () => {
  keywordWorkflow('ORDER');
  const locks = new Map();
  const lockClient = {
    set: async (key, token, px, ttl, nx) => {
      assert.equal(nx, 'NX');
      if (locks.has(key)) return null;
      locks.set(key, token);
      return 'OK';
    },
    eval: async (script, n, key, token) => { if (locks.get(key) === token) locks.delete(key); return 1; },
  };
  const [unit] = splitWebhook(text('ORDER', { messageId: 'wamid.dup.1' }));
  await Promise.all([
    processWebhookJob({ data: unit }, { lockClient }),
    processWebhookJob({ data: unit }, { lockClient }),
  ]);
  assert.deepEqual(sent.map((s) => s.body), ['ORDER workflow reply']);
  assert.equal(liveRuns().length, 1);
  assert.equal(db.messages.filter((m) => m.direction === 'INBOUND').length, 1);
});

// ── WF-IN-14: intent rules route on every plan ─────────────────────────────

test('an intent rule that runs a workflow works on a plan without campaignAi', async () => {
  db.planFeatures = { automation: true, workflows: true, campaignAi: false };
  const wf = addWorkflow({ name: 'Track order', nodes: [
    { id: 's1', type: 'trigger', subtype: 'keyword', value: 'TRACKXYZ' },
    { id: 's2', type: 'action', subtype: 'message', value: 'Your parcel is on its way' },
  ] });
  db.intentRules.push({ id: 'ir_1', workspaceId: 'ws_A', name: 'Tracking', isActive: true, actionType: 'workflow', actionTarget: wf.id, phrases: ['where is my parcel'] });
  assert.deepEqual(await customerSends(text('where is my parcel')), ['Your parcel is on its way']);
});
