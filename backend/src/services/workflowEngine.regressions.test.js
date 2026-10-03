import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Regression tests for the workflow-engine audit (WF-EN-*): each one was a
// repro that failed against the engine as it was, and asserts the behaviour a
// customer should get. Real engine, in-memory WorkflowRun store (the harness
// of workflowEngine.claim.test.js); the outbound send, the queue and the
// template send are captured.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';

const sent = [];
let onSend = null;
let sendOutcome = null; // null → delivered
const creditNotices = [];
mock.module('./outbound.service.js', {
  namedExports: {
    deliverAutomatedReply: async (args) => {
      if (sendOutcome) return sendOutcome;
      sent.push(args.body);
      if (onSend) await onSend(args);
      return { ok: true, message: { id: `msg_${sent.length}` } };
    },
    sendAutomatedReply: async () => { throw new Error('the engine reads the outcome, not the legacy wrapper'); },
    noteAutomatedCreditRefusal: async (ws, code) => { creditNotices.push({ ws, code }); return true; },
  },
});
const queued = [];
mock.module('../queues/workflow.queue.js', {
  namedExports: {
    enqueueWorkflowResume: async (runId, cursor, delay) => { queued.push({ kind: 'resume', runId, cursor, delay }); },
    enqueueReplyReminder: async (runId, cursor, delay) => { queued.push({ kind: 'remind', runId, cursor, delay }); },
  },
});
const templateSends = [];
let templateThrows = null;
mock.module('./conversations.service.js', {
  namedExports: {
    sendTemplateMessage: async (...args) => {
      templateSends.push(args);
      if (templateThrows) throw templateThrows;
      return { id: 'tmsg', metaMessageId: 'wamid.x' };
    },
  },
});

const { prisma } = await import('../lib/prisma.js');
const engine = await import('./workflowEngine.service.js');
const crm = await import('./workflowCrm.service.js');
const { subscribeRealtime } = await import('../lib/realtimeBus.js');
const { updateManyRuns, matchRunWhere } = await import('./workflowRunStore.testutil.js');

const WS = 'ws_reg';
const CONV = 'conv_reg';
const contact = { id: 'ct_1', name: 'Asha', phoneNumber: '+919800000000', tags: [], createdAt: new Date(0) };
const runs = new Map();
const convUpdates = [];
let templates = [];
let workflows = [];
let conversations = [];
let leads = [];
let waNumbers = [];

prisma.conversation.findUnique = async ({ where }) => {
  const c = conversations.find((x) => x.id === where.id);
  return c ? { humanHandoffAt: null, contact, ...c } : null;
};
prisma.conversation.findFirst = async ({ where }) => conversations
  .find((c) => c.workspaceId === where.workspaceId && c.contactId === where.contactId
    && (!where.waNumberId || where.waNumberId?.not === null ? c.waNumberId : c.waNumberId === where.waNumberId)) ?? null;
prisma.conversation.create = async ({ data }) => {
  const row = { id: `conv_new_${conversations.length + 1}`, channel: 'WHATSAPP', ...data };
  conversations.push(row);
  return { id: row.id };
};
prisma.conversation.update = async (args) => { convUpdates.push(args); return {}; };
prisma.contact.findFirst = async ({ where }) => (where.id === contact.id ? contact : null);
prisma.contact.findUnique = async ({ where }) => (where.id === contact.id ? contact : null);
prisma.waNumber.findFirst = async () => waNumbers[0] ?? null;
prisma.lead.findFirst = async ({ where }) => leads.find((l) => l.contactId === where.contactId && (!where.id || l.id === where.id)) ?? null;
prisma.workspaceMember.findMany = async () => [{ userId: 'u1', role: 'ADMIN', user: { id: 'u1', name: 'Admin', email: 'a@x.io' } }];
prisma.template.findFirst = async ({ where }) => templates.find((t) => {
  if (where.id) return t.id === where.id;
  if (where.status && t.status !== where.status) return false;
  return (where.OR ?? []).some((o) => (typeof o.name === 'string' ? o.name === t.name : o.name?.equals?.toLowerCase() === t.name.toLowerCase()));
}) ?? null;
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
prisma.workflow.findMany = async () => workflows;

const wf = (trigger, nodes, id = 'wf_1', extra = {}) => ({ id, name: 'Audit', workspaceId: WS, isActive: true, createdAt: new Date(), nodes: [trigger, ...nodes], ...extra });
const keyword = (v) => ({ type: 'trigger', subtype: 'keyword', value: v });
const start = (nodes) => engine.startRun(wf(keyword('HI'), nodes), { workspaceId: WS, conversationId: CONV, contactId: contact.id, triggerMessage: 'HI' });
const tpl = (name, body, extra = {}) => ({ id: `tpl_${name}`, name, status: 'APPROVED', workspaceId: WS, components: [{ type: 'BODY', text: body }], ...extra });
const quiet = () => { const log = console.log; const err = console.error; console.log = () => {}; console.error = () => {}; return () => { console.log = log; console.error = err; }; };
const reset = () => {
  sent.length = 0; queued.length = 0; runs.clear(); onSend = null; sendOutcome = null; templateSends.length = 0; templateThrows = null;
  convUpdates.length = 0; workflows = []; templates = []; leads = []; creditNotices.length = 0;
  conversations = [{ id: CONV, workspaceId: WS, waNumberId: 'wa_1', contactId: contact.id, channel: 'WHATSAPP' }];
  waNumbers = [{ id: 'wa_1' }];
};
const row = (id) => runs.get(id);
test.beforeEach(reset);

// ── WF-EN-1: CRM-triggered runs reach the customer's WhatsApp thread ─────────

test('WF-EN-1: a CRM-triggered workflow runs on the contact\'s existing WhatsApp conversation', async () => {
  workflows = [wf({ type: 'trigger', subtype: 'lead_created' }, [{ type: 'action', subtype: 'message', value: 'Welcome {{name}}!' }])];
  const restore = quiet();
  try {
    const [run] = await crm.runWorkflowsForCrmEvent(WS, 'lead_created', { leadId: 'lead_1', contactId: contact.id });
    assert.equal(run.conversationId, CONV);
    assert.equal(run.status, 'COMPLETED');
    assert.deepEqual(sent, ['Welcome Asha!']);
  } finally { restore(); }
});

test('WF-EN-1: with no conversation yet, one is started on the workspace\'s number; templates go out', async () => {
  conversations = [];
  templates = [tpl('lead_welcome', 'Hello there')];
  workflows = [wf({ type: 'trigger', subtype: 'lead_created' }, [{ type: 'action', subtype: 'template', value: 'lead_welcome' }])];
  const restore = quiet();
  try {
    const [run] = await crm.runWorkflowsForCrmEvent(WS, 'lead_created', { leadId: 'lead_1', contactId: contact.id });
    assert.equal(conversations.length, 1, 'a WhatsApp conversation was started');
    assert.equal(conversations[0].waNumberId, 'wa_1');
    assert.equal(run.conversationId, conversations[0].id);
    assert.equal(templateSends.length, 1);
    assert.equal(templateSends[0][1], conversations[0].id);
    assert.equal(run.status, 'COMPLETED');
  } finally { restore(); }
});

test('WF-EN-1/2: a CRM workflow that cannot reach anyone is FAILED with the reason, not COMPLETED', async () => {
  conversations = [];
  waNumbers = [];
  workflows = [wf({ type: 'trigger', subtype: 'lead_created' }, [
    { type: 'action', subtype: 'message', value: 'Hi {{name}}' },
    { type: 'action', subtype: 'buttons', value: 'Want a demo? | Yes | No' },
  ])];
  const restore = quiet();
  try {
    const [run] = await crm.runWorkflowsForCrmEvent(WS, 'lead_created', { leadId: 'lead_1', contactId: contact.id });
    assert.equal(run.conversationId, null);
    assert.equal(run.status, 'FAILED');
    assert.deepEqual(run.trace.map((t) => t.result), ['failed', 'failed']);
    assert.match(run.error, /No WhatsApp conversation with this contact/);
    assert.equal(sent.length, 0);
  } finally { restore(); }
});

test('WF-EN-1: a CRM workflow with no customer-facing step does not open a conversation', async () => {
  conversations = [];
  workflows = [wf({ type: 'trigger', subtype: 'lead_created' }, [{ type: 'action', subtype: 'tag', value: 'new-lead' }])];
  prisma.contact.update = async () => ({});
  const restore = quiet();
  try {
    const [run] = await crm.runWorkflowsForCrmEvent(WS, 'lead_created', { leadId: 'lead_1', contactId: contact.id });
    assert.equal(run.conversationId, null);
    assert.equal(conversations.length, 0);
  } finally { restore(); }
});

test('WF-EN-1: a message-triggered run gets the contact\'s lead, so lead steps act on it', async () => {
  leads = [{ id: 'lead_9', contactId: contact.id }];
  const restore = quiet();
  try {
    const run = await start([{ type: 'action', subtype: 'owner', value: 'Admin' }]);
    assert.equal(run.leadId, 'lead_9');
  } finally { restore(); }
  // A workflow without lead steps does not look one up.
  leads = [];
  const restore2 = quiet();
  try {
    const plain = await start([{ type: 'action', subtype: 'message', value: 'hi' }]);
    assert.equal(plain.leadId, null);
  } finally { restore2(); }
});

// ── WF-EN-2/3: failures are failures, with the real reason ──────────────────

test('WF-EN-3: a refused send records outbound\'s reason, not "Meta rejected or window closed"', async () => {
  const cases = [
    [{ ok: false, code: 'NO_CREDIT', detail: 'Message quota and wallet balance exhausted' }, /quota and wallet balance are exhausted/],
    [{ ok: false, code: 'OPTED_OUT', detail: 'Recipient opted out' }, /opted out/],
    [{ ok: false, code: 'WINDOW_CLOSED', detail: 'x' }, /24-hour customer service window is closed/],
    [{ ok: false, code: 'NO_NUMBER', detail: 'x' }, /no connected WhatsApp number/],
    [{ ok: false, code: 'SUBSCRIPTION_INACTIVE', detail: 'x' }, /subscription is not active/],
    [{ ok: false, code: 'META_REJECTED', detail: '(#131026) Message undeliverable' }, /WhatsApp \(Meta\) rejected the send: \(#131026\) Message undeliverable/],
  ];
  const restore = quiet();
  try {
    for (const [outcome, reason] of cases) {
      runs.clear();
      sendOutcome = outcome;
      const run = await start([{ type: 'action', subtype: 'message', value: 'Hello' }]);
      assert.equal(run.status, 'FAILED', outcome.code);
      assert.match(run.trace[0].detail, reason, outcome.code);
      assert.match(run.error, reason, outcome.code);
      assert.doesNotMatch(run.error, /Meta rejected the send or 24-hour/);
    }
  } finally { restore(); }
});

test('WF-EN-2: a message step with nothing to send fails instead of being skipped', async () => {
  const restore = quiet();
  try {
    const run = await start([{ type: 'action', subtype: 'message', value: '{{unknown_token}}' }]);
    assert.equal(run.trace[0].result, 'failed');
    assert.equal(run.status, 'FAILED');
  } finally { restore(); }
});

test('WF-EN-2: steps skipped on purpose (a handoff, a false condition) still complete the run', async () => {
  const restore = quiet();
  try {
    const run = await start([
      { type: 'condition', subtype: 'contains', value: 'never', skipIfFalse: 1 },
      { type: 'action', subtype: 'message', value: 'guarded' },
      { type: 'action', subtype: 'agent', value: '' },
      { type: 'action', subtype: 'message', value: 'after the handoff' },
    ]);
    assert.equal(run.status, 'COMPLETED');
    assert.deepEqual(sent, []);
  } finally { restore(); }
});

test('WF-EN-2: the reminder trace names the real reason too', async () => {
  const restore = quiet();
  try {
    const run = await start([
      { type: 'action', subtype: 'message', value: 'Your order id?' },
      { type: 'action', subtype: 'wait_reply', value: 'order', reminder: 'Still there?', remindAfter: '5 min' },
    ]);
    sendOutcome = { ok: false, code: 'NO_CREDIT', detail: 'x' };
    const out = await engine.sendReplyReminder(run.id, 2);
    assert.equal(out.sent, false);
    assert.match(row(run.id).trace.at(-1).detail, /quota and wallet balance are exhausted/);
  } finally { restore(); }
});

// ── C3 / WF-EN-5: template step values ──────────────────────────────────────

test('C3: a template step fills {{n}} from params rendered like a message (collected answers included)', async () => {
  templates = [tpl('order_update', 'Hi {{1}}, order {{2}} ships soon')];
  const restore = quiet();
  try {
    await start([
      { type: 'action', subtype: 'message', value: 'Your order id?' },
      { type: 'action', subtype: 'wait_reply', value: 'order_id' },
      { type: 'action', subtype: 'template', value: 'order_update', params: ['{{name}}', '{{order_id}}'] },
    ]);
    await engine.resumeAwaitingRun(WS, CONV, 'ORD-991');
    assert.equal(templateSends.length, 1);
    const opts = templateSends[0][3];
    assert.deepEqual(opts.variables, ['Asha', 'ORD-991']);
    assert.equal(opts.strictVariables, true, 'the send never falls back to approval samples');
  } finally { restore(); }
});

test('C3: {{2}} without a value fails the step — the approval sample is never used', async () => {
  templates = [tpl('order_update', 'Hi {{1}}, order {{2}} ships on {{3}}', { components: [{ type: 'BODY', text: 'Hi {{1}}, order {{2}} ships on {{3}}', example: { body_text: [['John', 'ORD-12345', '12 Jan']] } }] })];
  const restore = quiet();
  try {
    const none = await start([{ type: 'action', subtype: 'template', value: 'order_update' }]);
    assert.equal(templateSends.length, 0);
    assert.equal(none.status, 'FAILED');
    assert.match(none.trace[0].detail, /3 placeholders .* no values/);

    runs.clear();
    const short = await start([{ type: 'action', subtype: 'template', value: 'order_update', params: ['{{name}}', 'A-1'] }]);
    assert.equal(templateSends.length, 0);
    assert.match(short.trace[0].detail, /needs 3 values but the step gives 2/);

    runs.clear();
    const empty = await start([{ type: 'action', subtype: 'template', value: 'order_update', params: ['{{name}}', '{{missing}}', 'x'] }]);
    assert.match(empty.trace[0].detail, /\{\{2\}\} .* empty after filling in variables/);
    assert.equal(templateSends.length, 0);
  } finally { restore(); }
});

test('C3: with no params at all, {{1}} alone still defaults to the contact name (backward compatible)', async () => {
  templates = [tpl('hello', 'Hi {{1}}!')];
  const restore = quiet();
  try {
    const run = await start([{ type: 'action', subtype: 'template', value: 'hello' }]);
    assert.equal(run.status, 'COMPLETED');
    assert.deepEqual(templateSends[0][3].variables, ['Asha']);
  } finally { restore(); }
});

test('C3: templateId wins over the name; an unapproved template fails clearly', async () => {
  templates = [tpl('promo', 'Body'), { ...tpl('promo', 'Body'), id: 'tpl_hindi', language: 'hi' }, { ...tpl('draft', 'x'), status: 'PENDING' }];
  const restore = quiet();
  try {
    await start([{ type: 'action', subtype: 'template', value: 'promo', templateId: 'tpl_hindi' }]);
    assert.equal(templateSends[0][3].templateId, 'tpl_hindi');

    runs.clear();
    const pending = await start([{ type: 'action', subtype: 'template', value: 'draft' }]);
    assert.match(pending.trace[0].detail, /is pending, not approved/);
    assert.equal(pending.status, 'FAILED');
  } finally { restore(); }
});

// ── WF-EN-7: a failed template step does not abort the run ──────────────────

test('WF-EN-7: a failed template send is a failed step; the handoff after it still runs', async () => {
  templates = [tpl('order_update', 'Your order is on its way')];
  templateThrows = Object.assign(new Error('Message quota and wallet balance exhausted — recharge your wallet or upgrade your plan'), { status: 403, code: 'QUOTA_AND_WALLET_EXHAUSTED' });
  const restore = quiet();
  try {
    const run = await start([
      { type: 'action', subtype: 'template', value: 'order_update' },
      { type: 'action', subtype: 'agent', value: '' },
    ]);
    assert.ok(convUpdates.some((u) => u.data?.assignedToUserId), 'the handoff ran');
    assert.equal(run.status, 'FAILED');
    assert.match(run.trace[0].detail, /quota and wallet balance are exhausted/);
    assert.deepEqual(creditNotices, [{ ws: WS, code: 'QUOTA_AND_WALLET_EXHAUSTED' }], 'WF-EN-4: the workspace is told');
  } finally { restore(); }
});

// ── WF-EN-13: no message → template heuristic ───────────────────────────────

test('WF-EN-13: a "Send message" step whose text equals an approved template name is sent as text', async () => {
  templates = [tpl('Thank you', 'Thanks {{1}}')];
  const restore = quiet();
  try {
    await start([{ type: 'action', subtype: 'message', value: 'Thank you' }]);
    assert.deepEqual(sent, ['Thank you']);
    assert.equal(templateSends.length, 0);
  } finally { restore(); }
});

// ── WF-EN-8: no parallel runs of one workflow on one conversation ───────────

test('WF-EN-8: re-sending the trigger while the workflow is parked on a delay does not start a second run', async () => {
  workflows = [wf(keyword('price'), [
    { type: 'action', subtype: 'message', value: 'Here is our price list' },
    { type: 'action', subtype: 'delay', value: '10 min' },
    { type: 'action', subtype: 'message', value: 'Did that help?' },
  ])];
  const ctx = { event: 'message', messageBody: 'price', conversationId: CONV, contactId: contact.id };
  const restore = quiet();
  try {
    const [first] = await engine.runWorkflowsForInbound(WS, ctx);
    const [again] = await engine.runWorkflowsForInbound(WS, ctx);
    const active = [...runs.values()].filter((r) => ['RUNNING', 'WAITING'].includes(r.status));
    assert.equal(active.length, 1);
    assert.equal(again.id, first.id, 'the live run is reported, so the inbound fallbacks stay quiet');
    assert.equal(engine.runWillSendMessage(again), true);
    assert.deepEqual(sent, ['Here is our price list']);
  } finally { restore(); }
});

test('WF-EN-8: once the earlier run has finished, the trigger starts a new run', async () => {
  workflows = [wf(keyword('price'), [{ type: 'action', subtype: 'message', value: 'Prices' }])];
  const ctx = { event: 'message', messageBody: 'price', conversationId: CONV, contactId: contact.id };
  const restore = quiet();
  try {
    await engine.runWorkflowsForInbound(WS, ctx);
    await engine.runWorkflowsForInbound(WS, ctx);
    assert.equal(runs.size, 2);
    assert.deepEqual(sent, ['Prices', 'Prices']);
  } finally { restore(); }
});

// ── WF-EN-10: a reply cannot skip a delay ───────────────────────────────────

test('WF-EN-10: advanceRun given a reply on a run parked on a delay leaves it parked', async () => {
  const restore = quiet();
  try {
    const run = await start([
      { type: 'action', subtype: 'delay', value: '2 hours' },
      { type: 'action', subtype: 'message', value: 'two hours later' },
    ]);
    assert.equal(run.status, 'WAITING');
    const after = await engine.advanceRun(run.id, { reply: 'thanks' });
    assert.equal(after.status, 'WAITING');
    assert.deepEqual(sent, []);
  } finally { restore(); }
});

// ── WF-EN-9: a send outliving the lease is not repeated ─────────────────────

test('WF-EN-9: a send that outlives the run lease is not sent again by the recovery pass', async () => {
  let first = true;
  onSend = async () => {
    if (!first) return;
    first = false;
    const id = [...runs.keys()][0];
    row(id).resumeAt = new Date(Date.now() - 1000); // the lease ran out mid-send
    await engine.advanceRun(id);
  };
  const restore = quiet();
  try {
    await start([{ type: 'action', subtype: 'message', value: 'Your OTP is 4411' }]);
    assert.equal(sent.filter((s) => s === 'Your OTP is 4411').length, 1);
  } finally { restore(); }
});

// ── Media answers ───────────────────────────────────────────────────────────

test('a photo sent in answer to a named wait is not stored as "[photo]"; the run keeps waiting for text', async () => {
  const restore = quiet();
  try {
    const run = await start([
      { type: 'action', subtype: 'message', value: 'What is your order id?' },
      { type: 'action', subtype: 'wait_reply', value: 'order_id' },
      { type: 'action', subtype: 'message', value: 'Thanks, checking order {{order_id}}' },
    ]);
    const held = await engine.resumeAwaitingRun(WS, CONV, '[photo]');
    assert.equal(held.status, 'WAITING');
    assert.equal(row(run.id).variables.order_id, undefined);
    await engine.resumeAwaitingRun(WS, CONV, 'ORD-7');
    assert.equal(row(run.id).variables.order_id, 'ORD-7');
    assert.equal(sent.at(-1), 'Thanks, checking order ORD-7');
  } finally { restore(); }
});

// ── WF-EN-11: runs from before resumeAt existed are recovered ───────────────

test('WF-EN-11: a delay run with a NULL resumeAt is resumed by the sweep', async () => {
  const restore = quiet();
  try {
    const run = await start([
      { type: 'action', subtype: 'delay', value: '1 hour' },
      { type: 'action', subtype: 'message', value: 'follow-up' },
    ]);
    row(run.id).resumeAt = null;
    queued.length = 0;
    const summary = await engine.sweepDueRuns({ now: new Date(Date.now() + 2 * 3_600_000) });
    assert.equal(summary.resumed, 1);
    assert.deepEqual(queued.map((q) => [q.kind, q.runId]), [['resume', run.id]]);
  } finally { restore(); }
});

test('WF-EN-11: a reply wait with a NULL resumeAt is closed by the sweep once its 24 hours are up', async () => {
  const restore = quiet();
  try {
    const run = await start([
      { type: 'action', subtype: 'message', value: 'Q?' },
      { type: 'action', subtype: 'wait_reply', value: 'a' },
    ]);
    row(run.id).resumeAt = null;
    const summary = await engine.sweepDueRuns({ now: new Date(Date.now() + 25 * 3_600_000) });
    assert.equal(summary.expired, 1);
    assert.equal(row(run.id).status, 'CANCELLED');
  } finally { restore(); }
});

test('WF-EN-11: a just-created RUNNING run without a lease is not swept from under its first pass', async () => {
  runs.set('run_fresh', { id: 'run_fresh', workspaceId: WS, status: 'RUNNING', resumeAt: null, version: 0, cursor: 0, startedAt: new Date(), nodes: [], trace: [] });
  const summary = await engine.sweepDueRuns({ now: new Date(), enqueueResume: async () => {}, enqueueReminder: async () => {} });
  assert.equal(summary.due, 0);
});

// ── WF-EN-12: duplicate clipped titles ──────────────────────────────────────

test('WF-EN-12: a tap on a de-duplicated clipped title maps back to the option it was made from', async () => {
  const { uniqueTitles } = await import('../lib/meta.js');
  const options = ['Talk to support team (billing)', 'Talk to support team (technical)'];
  const shown = uniqueTitles(options, 20);
  assert.equal(new Set(shown).size, 2);
  assert.equal(engine.resolveReply(shown[0], options), options[0]);
  assert.equal(engine.resolveReply(shown[1], options), options[1]);
});

// ── WF-EN-14: precedence ────────────────────────────────────────────────────

test('WF-EN-14: the longest MATCHED keyword wins, then the most recently updated workflow', () => {
  const kw = (id, value, updatedAt) => ({ id, name: id, isActive: true, updatedAt: new Date(updatedAt), nodes: [keyword(value), { type: 'action', subtype: 'message', value: id }] });
  const list = [
    kw('hand_built', 'PRICE LIST', 1),
    kw('ai_built', 'HELP, SUPPORT, PRICE, COST', 2),
    kw('order_v1', 'ORDER', 3),
    kw('order_v2', 'ORDER', 4),
  ];
  const winner = (msg) => engine.rankMatches(list, { messageBody: msg, event: 'message' })[0]?.id;
  assert.equal(winner('can you send the price list'), 'hand_built');
  assert.equal(winner('what does it cost'), 'ai_built');
  assert.equal(winner('where is my order'), 'order_v2');
});

// ── C4: realtime ────────────────────────────────────────────────────────────

test('C4: a run publishes workflow.run when it starts and when it finishes', async () => {
  const seen = [];
  const off = subscribeRealtime((e) => { if (e.type === 'workflow.run' && e.data.workflowId === 'wf_rt') seen.push(e); });
  const restore = quiet();
  try {
    const run = await engine.startRun(wf(keyword('HI'), [{ type: 'action', subtype: 'message', value: 'x' }], 'wf_rt'), { workspaceId: WS, conversationId: CONV, contactId: contact.id, triggerMessage: 'HI' });
    // Coalesced per workflow: the first event goes at once, the latest at the end of the window.
    await new Promise((r) => setTimeout(r, 1100));
    assert.deepEqual(seen.map((e) => [e.ws, e.data.workflowId, e.data.runId, e.data.status]), [
      [WS, 'wf_rt', run.id, 'RUNNING'],
      [WS, 'wf_rt', run.id, 'COMPLETED'],
    ]);
  } finally { off(); restore(); }
});
