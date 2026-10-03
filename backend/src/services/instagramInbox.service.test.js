import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Instagram DMs reach the inbox and the automation (CF-224). Every collaborator
// that decides or sends is faked; what is under test is the routing: what gets
// stored, which step answers, and what is left alone.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';

const replies = [];
let profile = { name: 'Riya', username: 'riya.k' };
mock.module('./instagram.service.js', {
  namedExports: {
    deliverInstagramReply: async (args) => { replies.push(args); return { ok: true, message: { id: `out_${replies.length}` } }; },
    fetchInstagramProfile: async () => profile,
  },
});
let trigger = null;
mock.module('./automation.service.js', { namedExports: { findMatchingTrigger: async (ws, text) => (trigger && text.toLowerCase().includes(trigger.keyword.toLowerCase()) ? trigger : null) } });
let agentReply = null;
const agentCalls = [];
mock.module('./aiAgent.service.js', {
  namedExports: {
    matchIntent: async () => null,
    generateAgentReply: async (ws, text, opts) => { agentCalls.push({ text, opts }); return agentReply; },
  },
});
const workflowCalls = [];
let workflowReplies = false;
let resumedRun = null;
const resumeCalls = [];
mock.module('./workflowEngine.service.js', {
  namedExports: {
    resumeAwaitingRun: async (ws, conv, text) => { resumeCalls.push(text); return resumedRun; },
    findMatchingWorkflows: async () => [],
    runWorkflowsForInbound: async (ws, ctx) => { workflowCalls.push(ctx); return workflowReplies ? [{ id: 'run_1' }] : []; },
    runWillSendMessage: () => workflowReplies,
  },
});
mock.module('./optout.service.js', { namedExports: { matchOptOutKeyword: (t) => (/^\s*stop\W*$/i.test(t) ? 'STOP' : null) } });
mock.module('./businessHours.service.js', { namedExports: { isWithinBusinessHours: () => true } });
const escalations = [];
mock.module('./intentRouting.service.js', {
  namedExports: {
    escalationMatch: (text) => (/refund/i.test(text) ? { rule: 'refund', reason: 'Refund requested', reasonCode: 'escalation_rule:refund' } : null),
    escalationRulesApply: (ws) => ws?.aiAgentEnabled === true,
    escalateToHuman: async (args) => { escalations.push(args); },
  },
});
const webhooks = [];
mock.module('./outgoingWebhook.service.js', { namedExports: { emitWebhook: (ws, name, payload) => { webhooks.push({ name, payload }); } } });
mock.module('./notification.service.js', { namedExports: { notifyWorkspace: async () => {} } });
let transcript = null;
mock.module('./inboundMedia.service.js', { namedExports: { transcribeVoiceNote: async () => ({ text: transcript, reason: transcript ? undefined : 'not_configured' }) } });
const fetched = [];
mock.module('../lib/safeUrl.js', {
  namedExports: {
    safeRequest: async (url) => { fetched.push(url); return { status: 200, headers: { 'content-type': 'audio/mp4' }, data: Buffer.from('m4a-bytes') }; },
  },
});

const { prisma } = await import('../lib/prisma.js');
const { setStorage } = await import('../lib/storage/index.js');
const objects = new Map();
setStorage({
  driver: 'memory', objectStore: true,
  put: async (key, buf) => { objects.set(key, buf); return { key, size: buf.length }; },
  get: async () => null, getBuffer: async () => null, head: async () => null, delete: async () => {}, signedUrl: async () => null, describe: () => 'memory',
});
const {
  handleInstagramMessage, parseInstagramEvent, instagramPlaceholderPhone,
} = await import('./instagramInbox.service.js');
// instagram.service.js is faked above, so the Quickflow matcher is a stand-in.
const pickFlow = (flows, source, text) => flows.find((f) => f.source === source && text.toUpperCase().includes(f.keyword));

let db;
let seq = 0;
const nid = (p) => `${p}_${++seq}`;
function reset() {
  db = { contacts: [], conversations: [], messages: [], workspace: { autoWelcomeEnabled: false, aiAgentEnabled: false, escalationRules: {} } };
  replies.length = 0; agentCalls.length = 0; workflowCalls.length = 0; escalations.length = 0; webhooks.length = 0; fetched.length = 0;
  objects.clear();
  resumedRun = null; resumeCalls.length = 0;
  trigger = null; agentReply = null; workflowReplies = false; transcript = null; profile = { name: 'Riya', username: 'riya.k' };
}

prisma.contact.findFirst = async ({ where }) => db.contacts.find((c) => c.workspaceId === where.workspaceId && c.instagramUserId === where.instagramUserId) ?? null;
prisma.contact.create = async ({ data }) => {
  if (db.contacts.some((c) => c.workspaceId === data.workspaceId && c.phoneNumber === data.phoneNumber)) {
    throw Object.assign(new Error('unique'), { code: 'P2002' });
  }
  const row = { id: nid('ct'), optedOut: false, ...data };
  db.contacts.push(row);
  return row;
};
prisma.contact.update = async ({ where, data }) => Object.assign(db.contacts.find((c) => c.id === where.id), data);
prisma.conversation.findFirst = async ({ where }) => db.conversations.find((c) => c.workspaceId === where.workspaceId
  && c.contactId === where.contactId && c.channel === where.channel) ?? null;
prisma.conversation.create = async ({ data }) => {
  const row = { id: nid('conv'), humanHandoffAt: null, unreadCount: 0, lastMessageAt: new Date(), ...data };
  db.conversations.push(row);
  return row;
};
prisma.conversation.update = async ({ where, data }) => {
  const row = db.conversations.find((c) => c.id === where.id);
  for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === 'object' && 'increment' in v ? (row[k] ?? 0) + v.increment : v;
  return row;
};
prisma.message.create = async ({ data }) => {
  if (data.metaMessageId && db.messages.some((m) => m.metaMessageId === data.metaMessageId)) {
    throw Object.assign(new Error('unique'), { code: 'P2002' });
  }
  const row = { id: nid('msg'), ...data };
  db.messages.push(row);
  return row;
};
prisma.message.update = async ({ where, data }) => Object.assign(db.messages.find((m) => m.id === where.id), data);
prisma.workspace.findUnique = async () => db.workspace;
// No person has replied in these threads (automationPause.service.js).
prisma.message.findFirst = async () => null;
const flowHits = [];
prisma.instagramFlow.update = async ({ where }) => { flowHits.push(where.id); return {}; };

const ACCOUNT = '17841400000000001';
const SENDER = '6123456789012345';
const dm = (message, extra = {}) => ({
  sender: { id: SENDER }, recipient: { id: ACCOUNT }, timestamp: Date.now(),
  message: { mid: `aWdf_${++seq}`, ...message }, ...extra,
});
const run = (event, flows = []) => handleInstagramMessage({ workspaceId: 'ws_1', accountId: ACCOUNT, event, flows, pickFlow });

test('a first DM creates an Instagram contact and thread, lands in the inbox, and a keyword trigger answers it', async () => {
  reset();
  trigger = { keyword: 'price', responseTemplate: 'Prices start at 499.' };
  const out = await run(dm({ text: 'What is the price?' }));

  assert.equal(out.step, 'trigger');
  const [contact] = db.contacts;
  assert.equal(contact.instagramUserId, SENDER);
  assert.equal(contact.name, 'Riya');
  assert.equal(contact.instagramUsername, 'riya.k');
  assert.match(contact.phoneNumber, /^ig:[a-j]+$/, 'no digits: no phone check accepts it');
  const [conversation] = db.conversations;
  assert.equal(conversation.channel, 'INSTAGRAM');
  assert.equal(conversation.waNumberId, null);
  assert.equal(conversation.unreadCount, 1);
  assert.ok(conversation.lastInboundAt instanceof Date, 'opens the 24-hour window');
  const [message] = db.messages;
  assert.equal(message.direction, 'INBOUND');
  assert.equal(message.body, 'What is the price?');
  assert.deepEqual(replies, [{ conversationId: conversation.id, body: 'Prices start at 499.', options: undefined }]);
  assert.equal(webhooks[0].payload.channel, 'instagram');
});

test('a Quickflow keyword wins over the general triggers, and is counted — after the workflows had their turn', async () => {
  reset();
  flowHits.length = 0;
  trigger = { keyword: 'price', responseTemplate: 'general' };
  const out = await run(dm({ text: 'price list please' }), [{ id: 'flow_1', source: 'dm', keyword: 'PRICE', responseTemplate: 'Here is our price list' }]);
  assert.equal(out.step, 'quickflow');
  assert.equal(replies[0].body, 'Here is our price list');
  assert.deepEqual(flowHits, ['flow_1']);
  assert.equal(workflowCalls.length, 1, 'workflows are consulted before Quickflows (WF-IN-15)');
});

test('echoes, our own account, deletions and reactions are not customer messages', async () => {
  reset();
  await run(dm({ text: 'sent by us', is_echo: true }));
  await run({ ...dm({ text: 'self' }), sender: { id: ACCOUNT } });
  await run(dm({ is_deleted: true }));
  await run({ sender: { id: SENDER }, reaction: { action: 'react', emoji: 'x' } });
  assert.equal(db.messages.length, 0);
  assert.equal(replies.length, 0);
});

test('a redelivered DM is stored and answered once', async () => {
  reset();
  trigger = { keyword: 'hi', responseTemplate: 'Hello!' };
  const event = dm({ text: 'hi' });
  await run(event);
  const again = await run(event);
  assert.equal(again.step, 'duplicate');
  assert.equal(db.messages.length, 1);
  assert.equal(replies.length, 1);
});

test('nothing matched: the deployed AI agent answers, with the conversation for context', async () => {
  reset();
  agentReply = 'We open at 10am.';
  const out = await run(dm({ text: 'when do you open tomorrow' }));
  assert.equal(out.step, 'agent');
  assert.equal(agentCalls[0].opts.conversationId, db.conversations[0].id);
  assert.equal(replies[0].body, 'We open at 10am.');
});

test('the AI agent producing no reply leaves the DM for the inbox — it does not hand the thread off (WF-IN-4)', async () => {
  reset();
  db.workspace.aiAgentEnabled = true;
  const out = await run(dm({ text: 'something unusual' }));
  assert.equal(out.step, 'unanswered');
  assert.equal(escalations.length, 0);
  assert.equal(db.conversations[0].humanHandoffAt, null);
  assert.equal(replies.length, 0);
});

test('a workflow that will reply keeps the triggers and agent quiet', async () => {
  reset();
  workflowReplies = true;
  trigger = { keyword: 'hi', responseTemplate: 'should not send' };
  const out = await run(dm({ text: 'hi there' }));
  assert.equal(out.step, 'workflow');
  assert.equal(workflowCalls[0].event, 'message');
  assert.equal(workflowCalls[0].isNewContact, true);
  assert.equal(replies.length, 0);
});

test('escalation rules (agent deployed) and a human takeover stop the automation', async () => {
  reset();
  db.workspace.aiAgentEnabled = true;
  agentReply = 'bot';
  assert.equal((await run(dm({ text: 'I want a refund' }))).step, 'escalated');
  assert.equal(escalations[0].reason, 'Refund requested');

  db.conversations[0].humanHandoffAt = new Date();
  const out = await run(dm({ text: 'hello?' }));
  assert.equal(out.step, 'human');
  assert.equal(db.messages.length, 2, 'still stored for the inbox');
  assert.equal(replies.length, 0);
});

test('STOP flags the contact and sends nothing', async () => {
  reset();
  agentReply = 'bot';
  const out = await run(dm({ text: 'STOP' }));
  assert.equal(out.step, 'optout');
  assert.equal(db.contacts[0].optedOut, true);
  assert.equal(replies.length, 0);
});

test('an Instagram voice note is archived and transcribed into the automation', async () => {
  reset();
  transcript = 'what is the price';
  trigger = { keyword: 'price', responseTemplate: 'Prices start at 499.' };
  const out = await run(dm({ attachments: [{ type: 'audio', payload: { url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1' } }] }));
  assert.equal(out.step, 'trigger');
  const [message] = db.messages;
  assert.equal(message.type, 'AUDIO');
  assert.equal(message.transcript, 'what is the price');
  assert.equal(message.body, 'what is the price');
  assert.equal(message.mediaStorageKey, `workspaces/ws_1/messages/${message.id}`);
  assert.ok(objects.has(message.mediaStorageKey));
});

test('without a transcript a voice note is a media event, never matched as text', async () => {
  reset();
  trigger = { keyword: 'voice', responseTemplate: 'should not send' };
  agentReply = 'should not send either';
  const out = await run(dm({ attachments: [{ type: 'audio', payload: { url: 'https://lookaside.fbsbx.com/x' } }] }));
  assert.equal(out.step, 'unanswered');
  assert.equal(workflowCalls[0].event, 'media');
  assert.equal(workflowCalls[0].mediaType, 'audio');
  assert.equal(agentCalls.length, 0);
  assert.equal(replies.length, 0);
});

test('attachments off Instagram\'s CDNs are not fetched', async () => {
  reset();
  await run(dm({ attachments: [{ type: 'image', payload: { url: 'https://evil.example.com/a.jpg' } }] }));
  assert.equal(fetched.length, 0);
  assert.equal(db.messages[0].type, 'IMAGE');
  assert.equal(db.messages[0].body, '[photo]');
});

test('parse: shares and story replies', () => {
  assert.equal(parseInstagramEvent(dm({ attachments: [{ type: 'share', payload: { url: 'https://instagram.com/p/1' } }] }), ACCOUNT).body, '[shared post]');
  assert.equal(parseInstagramEvent(dm({ text: 'love it', reply_to: { story: { id: 's1' } } }), ACCOUNT).storyReply, true);
  assert.equal(parseInstagramEvent({ sender: { id: SENDER }, read: { mid: 'x' } }, ACCOUNT), null);
});

test('placeholder phone is stable, unique per IGSID and digit-free', () => {
  assert.equal(instagramPlaceholderPhone('1234567890'), 'ig:bcdefghija');
  assert.notEqual(instagramPlaceholderPhone('12'), instagramPlaceholderPhone('21'));
});

// ── WF-IN-15: Quickflows no longer run ahead of workflows ──────────────────

const CATCH_ALL = { id: 'flow_all', source: 'dm', keyword: '', responseTemplate: 'Thanks for your DM!' };

test('a catch-all Quickflow does not swallow the answer to a waiting workflow question', async () => {
  reset();
  resumedRun = { id: 'run_wait', status: 'COMPLETED' };
  workflowReplies = true;
  const out = await run(dm({ text: 'Order 4411' }), [CATCH_ALL]);
  assert.equal(out.step, 'workflow');
  assert.deepEqual(resumeCalls, ['Order 4411'], 'the waiting run got the reply first');
  assert.equal(replies.length, 0, 'the catch-all did not answer over it');
});

test('a catch-all Quickflow does not swallow a workflow trigger', async () => {
  reset();
  workflowReplies = true;
  const out = await run(dm({ text: 'MENU' }), [CATCH_ALL]);
  assert.equal(out.step, 'workflow');
  assert.equal(workflowCalls.length, 1);
  assert.equal(replies.length, 0);
});

test('the catch-all Quickflow comes after keyword triggers, and still answers what nothing else did', async () => {
  reset();
  trigger = { keyword: 'price', responseTemplate: 'Prices start at 499.' };
  assert.equal((await run(dm({ text: 'price?' }), [CATCH_ALL])).step, 'trigger');
  assert.equal(replies.at(-1).body, 'Prices start at 499.');

  agentReply = 'the agent would answer';
  const out = await run(dm({ text: 'random chatter' }), [CATCH_ALL]);
  assert.equal(out.step, 'quickflow');
  assert.equal(replies.at(-1).body, 'Thanks for your DM!');
  assert.equal(agentCalls.length, 0, 'the catch-all keeps its old precedence over the AI agent');
});

test('escalation rules do nothing on Instagram while no AI agent is deployed (WF-IN-3)', async () => {
  reset();
  db.workspace.escalationRules = { refund: true };
  const out = await run(dm({ text: 'I want a refund' }));
  assert.notEqual(out.step, 'escalated');
  assert.equal(escalations.length, 0);
});

test('a photo with text: the text is the customer\'s words and reaches the triggers (WF-IN-8)', async () => {
  reset();
  trigger = { keyword: 'order', responseTemplate: 'Order desk here.' };
  const out = await run(dm({ text: 'ORDER 77 arrived broken', attachments: [{ type: 'image', payload: { url: 'https://evil.example.com/a.jpg' } }] }));
  assert.equal(out.step, 'trigger');
  assert.equal(workflowCalls[0].event, 'message');
  assert.equal(workflowCalls[0].mediaType, 'image');
});

test('a photo with no text does not answer a waiting workflow question', async () => {
  reset();
  resumedRun = { id: 'run_wait', status: 'WAITING' };
  await run(dm({ attachments: [{ type: 'image', payload: { url: 'https://evil.example.com/a.jpg' } }] }));
  assert.deepEqual(resumeCalls, [], 'not resumed with "[photo]"');
  assert.equal(workflowCalls[0].event, 'media');
});

test('a handoff with no reply from a person for HANDOFF_TTL_HOURS lapses, and automation answers again (WF-IN-1)', async () => {
  reset();
  trigger = { keyword: 'hi', responseTemplate: 'Hello!' };
  await run(dm({ text: 'hi' }));
  db.conversations[0].humanHandoffAt = new Date(Date.now() - 25 * 3_600_000);
  const out = await run(dm({ text: 'hi again' }));
  assert.equal(out.step, 'trigger');
  assert.equal(db.conversations[0].humanHandoffAt, null);
});
