import test from 'node:test';
import assert from 'node:assert/strict';

// An inbox thread is read a page at a time (CF-048): the newest messages,
// oldest-first, with `hasMore`; `before` (a message id) reads the page older
// than that message, which is how the inbox's "Load earlier messages" walks
// back through a long thread. The database is an in-memory stub.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;
for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY']) process.env[key] ||= 'x'.repeat(32);
for (const key of ['META_APP_ID', 'META_APP_SECRET', 'META_BUSINESS_ID', 'META_WABA_ID', 'META_SYSTEM_USER_ID',
  'META_SYSTEM_USER_TOKEN', 'META_DISPLAY_NAME', 'META_WEBHOOK_VERIFY_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
  process.env[key] ||= 'test';
}
process.env.ADMIN_EMAIL ||= 'admin@example.test';

const { prisma } = await import('../lib/prisma.js');

const state = { messages: [], unreadResets: 0 };
const time = (d) => new Date(d).getTime();

// Just the where-clauses getMessages builds: conversationId, id, and the
// cursor's OR of { sentAt: { lt } } / { sentAt, id: { lt } }.
function matches(m, where = {}) {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return v.some((w) => matches(m, w));
    if (v && typeof v === 'object' && !(v instanceof Date) && 'lt' in v) {
      return k === 'sentAt' ? time(m.sentAt) < time(v.lt) : m[k] < v.lt;
    }
    if (v instanceof Date) return time(m[k]) === time(v);
    return m[k] === v;
  });
}

prisma.conversation.findFirst = async ({ where }) => (where.id === 'conv_1' && where.workspaceId === 'ws_1'
  ? { id: 'conv_1', workspaceId: 'ws_1', unreadCount: 0, lastInboundAt: null, humanHandoffAt: null }
  : null);
prisma.conversation.update = async () => { state.unreadResets += 1; return {}; };
prisma.message.findFirst = async ({ where }) => {
  const m = state.messages.find((row) => matches(row, where));
  return m ? { id: m.id, sentAt: m.sentAt } : null;
};
prisma.message.findMany = async ({ where, take }) => state.messages
  .filter((m) => matches(m, where))
  // orderBy [{ sentAt: 'desc' }, { id: 'desc' }]
  .sort((a, b) => time(b.sentAt) - time(a.sentAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
  .slice(0, take);

const { getMessages } = await import('./conversations.service.js');

function seed(n, { sameSecond = false } = {}) {
  state.unreadResets = 0;
  const start = Date.UTC(2026, 0, 1);
  state.messages = Array.from({ length: n }, (_, i) => ({
    id: `m${String(i).padStart(4, '0')}`,
    conversationId: i % 7 === 6 ? 'conv_other' : 'conv_1',
    sentAt: new Date(sameSecond ? start : start + i * 1000),
  }));
}
const ids = (r) => r.messages.map((m) => m.id);

test('a thread returns its newest page oldest-first, with hasMore', async () => {
  seed(30);
  const r = await getMessages('ws_1', 'conv_1', { limit: 5 });
  assert.deepEqual(ids(r), ['m0024', 'm0025', 'm0026', 'm0028', 'm0029']);
  assert.equal(r.hasMore, true);
  assert.equal(state.unreadResets, 1);
});

test('before walks back through the whole thread without gaps or repeats', async () => {
  seed(30);
  const expected = state.messages.filter((m) => m.conversationId === 'conv_1').map((m) => m.id);
  let page = await getMessages('ws_1', 'conv_1', { limit: 4 });
  const seen = [...ids(page)];
  while (page.hasMore) {
    page = await getMessages('ws_1', 'conv_1', { limit: 4, before: page.messages[0].id });
    seen.unshift(...ids(page));
  }
  assert.deepEqual(seen, expected);
  // Only the first read opened the thread; history reads leave unread alone.
  assert.equal(state.unreadResets, 1);
});

test('messages sharing a timestamp are paged by id, not skipped', async () => {
  seed(12, { sameSecond: true });
  const expected = state.messages.filter((m) => m.conversationId === 'conv_1').map((m) => m.id);
  let page = await getMessages('ws_1', 'conv_1', { limit: 3 });
  const seen = [...ids(page)];
  while (page.hasMore) {
    page = await getMessages('ws_1', 'conv_1', { limit: 3, before: page.messages[0].id });
    seen.unshift(...ids(page));
  }
  assert.deepEqual(seen, expected);
});

test('a cursor from another conversation, or an unknown one, is refused', async () => {
  seed(30);
  await assert.rejects(getMessages('ws_1', 'conv_1', { before: 'm0006' }), (e) => e.status === 400);
  await assert.rejects(getMessages('ws_1', 'conv_1', { before: 'nope' }), (e) => e.status === 400);
});

test('another workspace cannot read the thread', async () => {
  seed(5);
  await assert.rejects(getMessages('ws_2', 'conv_1', {}), (e) => e.status === 404);
});
