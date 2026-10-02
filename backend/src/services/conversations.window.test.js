import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// The inbox's free-form send paths and the 24-hour window. The database is an
// in-memory stub and the Meta send, credit ledger and token decryption are
// faked, so nothing here reaches the network.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;
// lib/meta.js and lib/encryption.js validate config/env on import; these are
// placeholders only, never used to reach anything.
for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY']) process.env[key] ||= 'x'.repeat(32);
for (const key of ['META_APP_ID', 'META_APP_SECRET', 'META_BUSINESS_ID', 'META_WABA_ID', 'META_SYSTEM_USER_ID',
  'META_SYSTEM_USER_TOKEN', 'META_DISPLAY_NAME', 'META_WEBHOOK_VERIFY_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
  process.env[key] ||= 'test';
}
process.env.ADMIN_EMAIL ||= 'admin@example.test';

const sends = [];
let decryptFails = false;
const credits = { consumed: 0, released: 0 };

const realMeta = await import('../lib/meta.js');
mock.module('../lib/meta.js', {
  namedExports: {
    ...realMeta,
    sendTextMessage: async (phoneNumberId, token, to, body) => {
      sends.push({ to, body });
      return { messages: [{ id: `wamid.${sends.length}` }] };
    },
  },
});

const realEncryption = await import('../lib/encryption.js');
mock.module('../lib/encryption.js', {
  namedExports: {
    ...realEncryption,
    decrypt: () => {
      if (decryptFails) throw new Error('bad decrypt');
      return 'token';
    },
  },
});

const realSubscription = await import('./subscription.service.js');
mock.module('./subscription.service.js', {
  namedExports: {
    ...realSubscription,
    consumeMessageCredit: async () => { credits.consumed += 1; return { ok: true, source: 'QUOTA' }; },
    releaseMessageCredit: async () => { credits.released += 1; },
  },
});

const { prisma } = await import('../lib/prisma.js');

let conversation;
const conversationUpdates = [];

prisma.conversation.findFirst = async () => structuredClone(conversation);
prisma.conversation.findUnique = async () => ({ lastInboundAt: conversation.lastInboundAt });
prisma.conversation.update = async ({ data }) => { conversationUpdates.push(data); return { ...conversation, ...data }; };
prisma.optOut.findFirst = async () => null;
prisma.optOut.findUnique = async () => null;
prisma.contact.findFirst = async () => null;
prisma.message.create = async ({ data }) => ({ id: 'msg_1', ...data });

const { sendMessage, listConversations } = await import('./conversations.service.js');

function reset(lastInboundAt) {
  sends.length = 0;
  conversationUpdates.length = 0;
  credits.consumed = 0;
  credits.released = 0;
  decryptFails = false;
  conversation = {
    id: 'conv_1',
    workspaceId: 'ws_1',
    contactId: 'ct_1',
    lastInboundAt,
    humanHandoffAt: null,
    contact: { id: 'ct_1', phoneNumber: '919800000001', optedOut: false },
    waNumber: { id: 'wa_1', metaPhoneNumberId: 'PN_1', encryptedAccessToken: 'enc' },
  };
}

test('a free-form reply inside the window is sent and does not move lastInboundAt', async () => {
  const inbound = new Date(Date.now() - 60 * 60 * 1000);
  reset(inbound);

  await sendMessage('ws_1', 'conv_1', 'u_1', { body: 'hello' });

  assert.equal(sends.length, 1);
  assert.equal(conversationUpdates.length, 1);
  assert.equal('lastInboundAt' in conversationUpdates[0], false);
});

test('a free-form reply outside the window is refused locally and never reopens it', async () => {
  reset(new Date(Date.now() - 25 * 60 * 60 * 1000));

  await assert.rejects(
    sendMessage('ws_1', 'conv_1', 'u_1', { body: 'hello' }),
    (err) => err.status === 409 && err.code === 'OUTSIDE_24H_WINDOW',
  );
  assert.equal(sends.length, 0);
  assert.equal(credits.consumed, 0);
  assert.equal(conversationUpdates.some((d) => 'lastInboundAt' in d), false);
});

test('a contact who never messaged cannot be sent a free-form reply', async () => {
  reset(null);

  await assert.rejects(
    sendMessage('ws_1', 'conv_1', 'u_1', { body: 'hello' }),
    (err) => err.code === 'OUTSIDE_24H_WINDOW',
  );
  assert.equal(sends.length, 0);
});

test('a token that cannot be decrypted fails before a credit is consumed', async () => {
  reset(new Date());
  decryptFails = true;

  await assert.rejects(sendMessage('ws_1', 'conv_1', 'u_1', { body: 'hello' }));
  assert.equal(credits.consumed, 0);
  assert.equal(sends.length, 0);
});

test('the inbox list pages by keyset cursor and applies views in the query', async () => {
  const rows = [
    { id: 'c3', lastMessageAt: new Date('2026-10-02T10:00:00Z') },
    { id: 'c2', lastMessageAt: new Date('2026-10-02T09:00:00Z') },
    { id: 'c1', lastMessageAt: new Date('2026-10-02T08:00:00Z') },
  ];
  const seen = [];
  prisma.conversation.findMany = async (args) => { seen.push(args); return rows.slice(0, args.take); };
  prisma.conversation.count = async () => 3;

  const first = await listConversations('ws_1', { limit: 2, view: 'mine', userId: 'u_1' });
  assert.deepEqual(first.data.map((c) => c.id), ['c3', 'c2']);
  assert.ok(first.nextCursor);
  assert.equal(first.total, 3);
  assert.deepEqual(seen[0].where.AND, [{ assignedToUserId: 'u_1' }]);

  await listConversations('ws_1', { limit: 2, cursor: first.nextCursor });
  const bound = seen[1].where.AND[0].OR;
  assert.deepEqual(bound[0], { lastMessageAt: { lt: rows[1].lastMessageAt } });
  assert.deepEqual(bound[1], { lastMessageAt: rows[1].lastMessageAt, id: { lt: 'c2' } });
  assert.equal(seen[1].skip, 0);

  const last = await listConversations('ws_1', { limit: 5 });
  assert.equal(last.nextCursor, null);
});
