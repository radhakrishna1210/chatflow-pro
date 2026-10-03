import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Automated replies (keyword/welcome/OOO/AI/form/workflow/sequence sends) are
// metered through the same consumeMessageCredit as an inbox reply, refunded
// when Meta rejects the send, and never sent when the quota and wallet are
// exhausted. Everything but the edges is real: billing, Meta, opt-out and the
// window state are replaced, and the database is an in-memory stub.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';

const calls = { consume: [], release: [], meta: [] };
let creditResult = { ok: true, source: 'QUOTA' };
let metaFails = null;
let windowOpen = true;
let optedOut = false;

mock.module('./subscription.service.js', {
  namedExports: {
    consumeMessageCredit: async (workspaceId, opts) => { calls.consume.push({ workspaceId, ...opts }); return creditResult; },
    releaseMessageCredit: async (workspaceId, opts) => { calls.release.push({ workspaceId, ...opts }); return { released: true }; },
  },
});
mock.module('../lib/meta.js', {
  namedExports: {
    INTERACTIVE_LIMITS: { buttonCount: 3, rowCount: 10, buttonTitleChars: 20, rowTitleChars: 24 },
    sendTextMessage: async (...args) => {
      calls.meta.push(args);
      if (metaFails) throw metaFails;
      return { messages: [{ id: `wamid.${calls.meta.length}` }] };
    },
    sendButtonMessage: async () => ({ messages: [{ id: 'wamid.btn' }] }),
    sendListMessage: async () => ({ messages: [{ id: 'wamid.list' }] }),
  },
});
mock.module('../lib/encryption.js', { namedExports: { decrypt: () => 'token' } });
mock.module('./optout.service.js', { namedExports: { isOptedOut: async () => optedOut } });
mock.module('./messagingWindow.js', {
  namedExports: {
    WINDOW_MS: 86_400_000,
    getWindowState: async () => (windowOpen
      ? { open: true, lastInboundAt: new Date() }
      : { open: false, lastInboundAt: null }),
  },
});

const igReplies = [];
mock.module('./instagram.service.js', {
  namedExports: {
    deliverInstagramReply: async (a) => { igReplies.push(a); return { ok: true, message: { id: 'ig_out' } }; },
  },
});

const { prisma } = await import('../lib/prisma.js');
const { deliverAutomatedReply, sendAutomatedReply } = await import('./outbound.service.js');

const messages = [];
prisma.waNumber.findUnique = async ({ where }) => (where.id === 'wa_1'
  ? { id: 'wa_1', workspaceId: 'ws_1', metaPhoneNumberId: 'pn_1', encryptedAccessToken: 'x' }
  : null);
prisma.waNumber.updateMany = async () => ({ count: 1 });
prisma.message.create = async ({ data }) => { const m = { id: `m_${messages.length + 1}`, ...data }; messages.push(m); return m; };
prisma.conversation.update = async () => ({});

const args = { conversationId: 'conv_1', waNumberId: 'wa_1', toPhone: '+911234567890', body: 'Hello' };

function reset() {
  calls.consume.length = 0; calls.release.length = 0; calls.meta.length = 0; messages.length = 0;
  creditResult = { ok: true, source: 'QUOTA' }; metaFails = null; windowOpen = true; optedOut = false;
}

test('a successful automated reply consumes one credit and stores a SENT message', async () => {
  reset();
  const out = await deliverAutomatedReply(args);
  assert.equal(out.ok, true);
  assert.equal(calls.consume.length, 1);
  assert.equal(calls.consume[0].workspaceId, 'ws_1');
  assert.equal(calls.consume[0].prepaid ?? false, false, 'automated replies are not prepaid');
  assert.equal(calls.release.length, 0);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].status, 'SENT');
  assert.equal(messages[0].metaMessageId, 'wamid.1');
});

test('an exhausted quota and wallet blocks the send before Meta is called', async () => {
  reset();
  creditResult = { ok: false, code: 'QUOTA_AND_WALLET_EXHAUSTED' };
  const out = await deliverAutomatedReply(args);
  assert.deepEqual([out.ok, out.code], [false, 'NO_CREDIT']);
  assert.equal(calls.meta.length, 0, 'nothing may be sent without a credit');
  assert.equal(messages.length, 0);
  assert.equal(await sendAutomatedReply(args), null, 'the legacy wrapper still reports null');
});

test('a billing error fails closed', async () => {
  reset();
  creditResult = null;
  const out = await deliverAutomatedReply(args);
  assert.equal(out.code, 'NO_CREDIT');
  assert.equal(calls.meta.length, 0);
});

test('a Meta rejection refunds the credit and is never stored as delivered', async () => {
  reset();
  creditResult = { ok: true, source: 'WALLET', amount: 0.8 };
  metaFails = Object.assign(new Error('Request failed'), { response: { data: { error: { code: 131026, message: 'Undeliverable' } } } });
  const out = await deliverAutomatedReply(args);
  assert.deepEqual([out.ok, out.code], [false, 'META_REJECTED']);
  assert.equal(calls.release.length, 1);
  assert.deepEqual([calls.release[0].source, calls.release[0].amount], ['WALLET', 0.8]);
  assert.equal(messages.length, 0, 'without recordFailure nothing is written');
});

test('recordFailure stores the rejected send as FAILED with the reason', async () => {
  reset();
  metaFails = Object.assign(new Error('Request failed'), { response: { data: { error: { code: 131047, message: 'Re-engagement message' } } } });
  const out = await deliverAutomatedReply({ ...args, recordFailure: true });
  assert.equal(out.ok, false);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].status, 'FAILED');
  assert.equal(messages[0].errorCode, 131047);
  assert.match(messages[0].errorMessage, /Re-engagement/);
  assert.equal(messages[0].metaMessageId, undefined);
});

test('a closed window or an opt-out is refused without taking a credit', async () => {
  reset();
  windowOpen = false;
  assert.equal((await deliverAutomatedReply(args)).code, 'WINDOW_CLOSED');
  windowOpen = true;
  optedOut = true;
  assert.equal((await deliverAutomatedReply(args)).code, 'OPTED_OUT');
  assert.equal(calls.consume.length, 0);
  assert.equal(calls.meta.length, 0);
});

test('a missing number is reported, not thrown', async () => {
  reset();
  const out = await deliverAutomatedReply({ ...args, waNumberId: 'nope' });
  assert.equal(out.code, 'NO_NUMBER');
  assert.equal(calls.consume.length, 0);
});

test('an Instagram thread (no WhatsApp number) is answered through Instagram', async () => {
  reset();
  igReplies.length = 0;
  prisma.conversation.findUnique = async ({ where }) => (where.id === 'conv_ig' ? { channel: 'INSTAGRAM' } : null);
  const out = await deliverAutomatedReply({ conversationId: 'conv_ig', waNumberId: null, toPhone: 'ig:abc', body: 'Hi', options: ['A', 'B'] });
  assert.equal(out.ok, true);
  assert.deepEqual(igReplies[0], { conversationId: 'conv_ig', body: 'Hi', options: ['A', 'B'], reason: 'Automated reply', recordFailure: false });
  assert.equal(calls.meta.length, 0, 'nothing went to WhatsApp');
  assert.equal(calls.consume.length, 0, 'Instagram meters its own send');
});
