import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// A workflow holding a real back-and-forth on WhatsApp: ask with buttons, wait
// for the tap, branch on it, ask a follow-up, and use the answer in the next
// message. Before `wait_reply` the run ended as soon as the buttons went out
// and the customer's tap arrived as an unrelated message, so none of this
// could be expressed in one workflow — whether built by hand or by the AI.
//
// Runs the real engine against an in-memory store, with only the Meta send
// replaced so every message the customer would receive is captured.

const sent = [];
mock.module('./outbound.service.js', {
  namedExports: {
    sendAutomatedReply: async ({ body, options }) => {
      sent.push({ body, options: options ?? [] });
      return { id: `msg_${sent.length}` };
    },
  },
});

const { prisma } = await import('../lib/prisma.js');
const engine = await import('./workflowEngine.service.js');

const WS = 'ws_chat';
const CONV = 'conv_chat';
const contact = { id: 'ct_1', name: 'Asha', phoneNumber: '+919800000000', tags: [], createdAt: new Date(0) };
const runs = new Map();
let workflows = [];

prisma.workflow.findMany = async ({ where }) => workflows.filter((w) => w.workspaceId === where.workspaceId && w.isActive);
prisma.conversation.findUnique = async () => ({ id: CONV, waNumberId: 'wa_1', contactId: contact.id, contact });
prisma.template.findFirst = async () => null;
prisma.workflowRun.create = async ({ data }) => {
  const run = { id: `run_${runs.size + 1}`, startedAt: new Date(), variables: null, ...data };
  runs.set(run.id, run);
  return { ...run };
};
prisma.workflowRun.findUnique = async ({ where }) => (runs.has(where.id) ? { ...runs.get(where.id) } : null);
prisma.workflowRun.update = async ({ where, data }) => {
  const run = { ...runs.get(where.id), ...data };
  runs.set(where.id, run);
  return { ...run };
};
prisma.workflowRun.findMany = async ({ where }) => [...runs.values()]
  .filter((r) => r.conversationId === where.conversationId && r.status === where.status)
  .sort((a, b) => b.startedAt - a.startedAt)
  .map((r) => ({ ...r }));

// What the webhook does with each inbound message (webhook.service.js, step 1).
async function customerSays(text) {
  const before = sent.length;
  const resumed = await engine.resumeAwaitingRun(WS, CONV, text);
  const started = resumed ? [resumed] : await engine.runWorkflowsForInbound(WS, {
    event: 'message', messageBody: text, isNewContact: false, conversationId: CONV, contactId: contact.id,
  });
  return { replies: sent.slice(before), run: started[0] ?? null };
}

const SUPPORT_FLOW = {
  id: 'wf_support',
  workspaceId: WS,
  isActive: true,
  name: 'Support menu',
  nodes: [
    { type: 'trigger', subtype: 'keyword', value: 'HELP, SUPPORT' },
    { type: 'action', subtype: 'buttons', value: 'Hi {{name}}! How can we help? | Track my order | Talk to our support team' },
    { type: 'action', subtype: 'wait_reply', value: '' },
    { type: 'condition', subtype: 'equals', value: 'Track my order', skipIfFalse: 3 },
    { type: 'action', subtype: 'message', value: 'Please send your order ID.' },
    { type: 'action', subtype: 'wait_reply', value: 'Order ID' },
    { type: 'action', subtype: 'message', value: 'Thanks {{name}}! Checking order {{order_id}} now.' },
    { type: 'condition', subtype: 'equals', value: 'Talk to our support team', skipIfFalse: 1 },
    { type: 'action', subtype: 'message', value: 'Connecting you to the team.' },
  ],
};

const reset = () => { sent.length = 0; runs.clear(); workflows = [SUPPORT_FLOW]; };

test('a buttons → reply → follow-up question → personalised answer chat runs in one workflow', async () => {
  reset();

  const first = await customerSays('help please');
  assert.equal(first.replies.length, 1);
  assert.equal(first.replies[0].body, 'Hi Asha! How can we help?');
  assert.deepEqual(first.replies[0].options, ['Track my order', 'Talk to our support team']);
  assert.equal(first.run.status, 'WAITING');
  assert.equal(engine.isAwaitingReply(first.run), true);
  // The question already went out, so the inbox's fallbacks must stay quiet.
  assert.equal(engine.runWillSendMessage(first.run), true);

  const second = await customerSays('Track my order');
  assert.deepEqual(second.replies.map((r) => r.body), ['Please send your order ID.']);
  assert.equal(second.run.status, 'WAITING');

  // The order ID contains the trigger keyword on purpose: an answer belongs to
  // the run that asked, not to whichever workflow its words happen to match.
  const third = await customerSays('HELP-7781');
  assert.deepEqual(third.replies.map((r) => r.body), ['Thanks Asha! Checking order HELP-7781 now.']);
  assert.equal(third.run.status, 'COMPLETED');
  assert.equal(third.run.variables.order_id, 'HELP-7781');
  assert.equal(runs.size, 1, 'no second run was started by the keyword in the reply');
});

test('a tapped button clipped by WhatsApp still takes its branch', async () => {
  reset();
  await customerSays('support');
  // Meta returns a button title cut to 20 characters.
  const { replies, run } = await customerSays('Talk to our support team'.slice(0, 20));
  assert.deepEqual(replies.map((r) => r.body), ['Connecting you to the team.']);
  assert.equal(run.status, 'COMPLETED');
});

test('typing the option number answers the menu', async () => {
  reset();
  await customerSays('help');
  const { replies } = await customerSays('1');
  assert.deepEqual(replies.map((r) => r.body), ['Please send your order ID.']);
});

test('a reply matching no branch completes quietly and lets the other automations answer', async () => {
  reset();
  await customerSays('help');
  const { replies, run } = await customerSays('what are your opening hours?');
  assert.equal(replies.length, 0);
  assert.equal(run.status, 'COMPLETED');
  // The run's earlier buttons message must not count as answering this one.
  assert.equal(engine.runWillSendMessage(run), false);
});

test('once the flow is over, the next message starts fresh', async () => {
  reset();
  await customerSays('help');
  await customerSays('Talk to our support team');
  const { replies } = await customerSays('help again');
  assert.equal(replies[0].body, 'Hi Asha! How can we help?');
  assert.equal(runs.size, 2);
});

test('a reply after 24 hours does not resume the stale flow', async () => {
  reset();
  const { run } = await customerSays('help');
  const stored = runs.get(run.id);
  stored.variables.__awaitingReply.since = new Date(Date.now() - engine.REPLY_TIMEOUT_MS - 1000).toISOString();

  assert.equal(await engine.resumeAwaitingRun(WS, CONV, 'Track my order'), null);
  assert.equal(runs.get(run.id).status, 'COMPLETED');
  assert.equal(engine.isAwaitingReply(runs.get(run.id)), false);
});

test('a delay job firing on a run that is waiting for a reply does not skip the question', async () => {
  reset();
  const { run } = await customerSays('help');
  const after = await engine.advanceRun(run.id);
  assert.equal(after.status, 'WAITING');
  assert.equal(after.cursor, run.cursor);
  assert.equal(sent.length, 1);
});

test('a number typed to a later question is kept as the answer, not read as a menu option', async () => {
  reset();
  workflows = [{
    id: 'wf_booking', workspaceId: WS, isActive: true, name: 'Booking',
    nodes: [
      { type: 'trigger', subtype: 'keyword', value: 'BOOKTEST' },
      { type: 'action', subtype: 'buttons', value: 'What would you like? | Book a table | See the menu' },
      { type: 'action', subtype: 'wait_reply', value: '' },
      { type: 'condition', subtype: 'equals', value: 'Book a table', skipIfFalse: 3 },
      { type: 'action', subtype: 'message', value: 'How many people?' },
      { type: 'action', subtype: 'wait_reply', value: 'num_people' },
      { type: 'action', subtype: 'message', value: 'Booked for {{num_people}}.' },
      { type: 'condition', subtype: 'equals', value: 'See the menu', skipIfFalse: 1 },
      { type: 'action', subtype: 'message', value: 'Menu: https://example.com/menu' },
    ],
  }];
  await customerSays('booktest');
  await customerSays('1');
  // "2" answers "How many people?" — before, it still mapped to option 2 of
  // the earlier buttons and came out as "See the menu".
  const { replies, run } = await customerSays('2');
  assert.deepEqual(replies.map((r) => r.body), ['Booked for 2.']);
  assert.equal(run.variables.num_people, '2');
});

test('resolveReply maps taps, typed text and numbers back to the offered option', () => {
  const opts = ['Track my order', 'Talk to our support team'];
  assert.equal(engine.resolveReply('track MY order', opts), 'Track my order');
  assert.equal(engine.resolveReply('Talk to our support ', opts), 'Talk to our support team');
  assert.equal(engine.resolveReply('2', opts), 'Talk to our support team');
  assert.equal(engine.resolveReply('3', opts), '3');
  assert.equal(engine.resolveReply('anything', []), 'anything');
});
