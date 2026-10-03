import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Replies into an Instagram thread follow the WhatsApp rules: opt-out, the
// 24-hour window, one metered credit that is refunded when Instagram refuses,
// and a stored message. Instagram's API, billing and the window are faked.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';

const posts = [];
let postFails = null;
mock.module('axios', {
  defaultExport: {
    post: async (url, body, opts) => {
      posts.push({ url, body, opts });
      if (postFails) throw postFails;
      return { data: { recipient_id: body.recipient?.id, message_id: `ig_mid_${posts.length}` } };
    },
    get: async () => ({ data: {} }),
  },
});
const credits = { consume: [], release: [] };
let creditResult = { ok: true, source: 'QUOTA' };
mock.module('./subscription.service.js', {
  namedExports: {
    consumeMessageCredit: async (ws, opts) => { credits.consume.push({ ws, ...opts }); return creditResult; },
    releaseMessageCredit: async (ws, opts) => { credits.release.push({ ws, ...opts }); },
  },
});
let windowOpen = true;
mock.module('./messagingWindow.js', { namedExports: { getWindowState: async () => ({ open: windowOpen }) } });
mock.module('../lib/encryption.js', { namedExports: { encrypt: (v) => v, decrypt: () => 'IGAA-token' } });
mock.module('./instagramInbox.service.js', { namedExports: { handleInstagramMessage: async () => ({}) } });

const { prisma } = await import('../lib/prisma.js');
const { deliverInstagramReply } = await import('./instagram.service.js');

let conversation;
const created = [];
prisma.conversation.findUnique = async ({ where }) => (conversation?.id === where.id ? structuredClone(conversation) : null);
prisma.conversation.update = async () => ({});
prisma.workspace.findUnique = async () => ({ instagramAccessToken: 'enc', instagramUserId: '1784' });
prisma.message.create = async ({ data }) => { const m = { id: `m_${created.length + 1}`, ...data }; created.push(m); return m; };

function reset() {
  posts.length = 0; created.length = 0; credits.consume.length = 0; credits.release.length = 0;
  postFails = null; creditResult = { ok: true, source: 'QUOTA' }; windowOpen = true;
  conversation = {
    id: 'conv_ig', workspaceId: 'ws_1', channel: 'INSTAGRAM',
    contact: { id: 'ct_1', instagramUserId: '6123', optedOut: false },
  };
}

test('a reply is metered, sent to graph.instagram.com with the user token, and stored', async () => {
  reset();
  const out = await deliverInstagramReply({ conversationId: 'conv_ig', body: 'Hello!' });
  assert.equal(out.ok, true);
  assert.equal(credits.consume.length, 1);
  assert.equal(credits.consume[0].reason, 'Instagram automated reply');
  assert.match(posts[0].url, /^https:\/\/graph\.instagram\.com\/v[\d.]+\/me\/messages$/);
  assert.equal(posts[0].opts.headers.Authorization, 'Bearer IGAA-token');
  assert.deepEqual(posts[0].body, { recipient: { id: '6123' }, message: { text: 'Hello!' } });
  assert.equal(created[0].metaMessageId, 'ig_mid_1');
  assert.equal(created[0].direction, 'OUTBOUND');
});

test('options go out as quick replies (max 13, titles cut to 20 chars)', async () => {
  reset();
  const options = Array.from({ length: 15 }, (_, i) => `Option number ${i + 1} is long`);
  await deliverInstagramReply({ conversationId: 'conv_ig', body: 'Pick one', options });
  const qr = posts[0].body.message.quick_replies;
  assert.equal(qr.length, 13);
  assert.equal(qr[0].title.length, 20);
  assert.equal(qr[0].content_type, 'text');
});

test('outside the 24-hour window nothing is charged or sent', async () => {
  reset();
  windowOpen = false;
  const out = await deliverInstagramReply({ conversationId: 'conv_ig', body: 'late' });
  assert.equal(out.code, 'WINDOW_CLOSED');
  assert.equal(credits.consume.length, 0);
  assert.equal(posts.length, 0);
});

test('an opted-out contact or a non-Instagram thread is refused before billing', async () => {
  reset();
  conversation.contact.optedOut = true;
  assert.equal((await deliverInstagramReply({ conversationId: 'conv_ig', body: 'x' })).code, 'OPTED_OUT');
  reset();
  conversation.channel = 'WHATSAPP';
  assert.equal((await deliverInstagramReply({ conversationId: 'conv_ig', body: 'x' })).code, 'NOT_INSTAGRAM');
  assert.equal(credits.consume.length, 0);
});

test('no credit, no send', async () => {
  reset();
  creditResult = { ok: false, code: 'QUOTA_AND_WALLET_EXHAUSTED' };
  const out = await deliverInstagramReply({ conversationId: 'conv_ig', body: 'x' });
  assert.equal(out.code, 'NO_CREDIT');
  assert.equal(posts.length, 0);
});

test('Instagram refusing the send refunds the credit and can record the failure', async () => {
  reset();
  postFails = Object.assign(new Error('Request failed'), { response: { data: { error: { code: 10, message: 'Outside of allowed window' } } } });
  const out = await deliverInstagramReply({ conversationId: 'conv_ig', body: 'x', recordFailure: true });
  assert.equal(out.code, 'IG_REJECTED');
  assert.equal(credits.release.length, 1);
  assert.equal(created[0].status, 'FAILED');
  assert.equal(created[0].errorCode, 10);
});
