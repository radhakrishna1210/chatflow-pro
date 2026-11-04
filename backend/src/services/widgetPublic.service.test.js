import test from 'node:test';
import assert from 'node:assert/strict';

// The visitor-facing widget endpoints are anonymous. These pin down what an
// anonymous caller can and cannot make the server do.

const { prisma } = await import('../lib/prisma.js');
const pub = await import('./widgetPublic.service.js');

const sessions = new Map();
const events = [];
const inbox = [];
prisma.widgetSession.findUnique = async ({ where }) => (sessions.has(where.visitorKey) ? { ...sessions.get(where.visitorKey) } : null);
prisma.widgetSession.findFirst = async ({ where }) => [...sessions.values()].find((s) => s.visitorKey === where.visitorKey && s.widgetId === where.widgetId) ?? null;
prisma.widgetSession.create = async ({ data }) => { const row = { id: `s${sessions.size + 1}`, ...data }; sessions.set(row.visitorKey, row); return row; };
prisma.widgetSession.update = async ({ where, data }) => {
  const row = [...sessions.values()].find((s) => s.id === where.id);
  Object.assign(row, data);
  return row;
};
prisma.widgetEvent.create = async ({ data }) => { events.push(data); return data; };
prisma.conversation.findFirst = async () => ({ id: 'conv_w' });
prisma.conversation.update = async () => ({});
prisma.message.create = async ({ data }) => { inbox.push(data); return data; };

const widgetA = { id: 'wA', workspaceId: 'wsA', publicKey: 'cfp_a', type: 'AI_WHATSAPP', enabled: true, name: 'A', waNumberId: 'wa1', waNumber: { phoneNumber: '+919800000000' }, config: {} };
const widgetB = { ...widgetA, id: 'wB', workspaceId: 'wsB', publicKey: 'cfp_b' };

test('a browser-chosen visitor key is never honoured', async () => {
  sessions.clear();
  const s = await pub.loadSession(widgetA, 'test');
  assert.match(s.visitorKey, /^wv_[0-9a-f]{32}$/);
  assert.notEqual(s.visitorKey, 'test');
});

test("another widget's visitor key starts a fresh session instead of failing on the unique key", async () => {
  sessions.clear();
  const a = await pub.loadSession(widgetA, null);
  const b = await pub.loadSession(widgetB, a.visitorKey);
  assert.notEqual(b.visitorKey, a.visitorKey);
  assert.equal(b.widgetId, 'wB');
  const again = await pub.loadSession(widgetA, a.visitorKey);
  assert.equal(again.id, a.id, 'the owner widget still resumes its session');
});

test('oversized event meta is dropped, not stored', async () => {
  events.length = 0;
  await pub.recordEvent(widgetA, 'OPEN', { visitorKey: 'x'.repeat(5000), meta: { blob: 'y'.repeat(10_000) } });
  assert.equal(events[0].meta, null);
  assert.ok(events[0].visitorKey.length <= 64);
  await pub.recordEvent(widgetA, 'OPEN', { meta: { page: '/pricing' } });
  assert.deepEqual(events[1].meta, { page: '/pricing' });
});

test('repeating a handoff does not keep adding unread Inbox messages', async () => {
  sessions.clear(); inbox.length = 0;
  const s = await pub.loadSession(widgetA, null);
  sessions.get(s.visitorKey).contactId = 'ct_1';
  for (let i = 0; i < 5; i += 1) await pub.handoff(widgetA, { visitorKey: s.visitorKey });
  assert.equal(inbox.length, 1);
});
