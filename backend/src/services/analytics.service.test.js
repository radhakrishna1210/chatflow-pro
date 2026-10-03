import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// The analytics maths against canned query results: which population each
// figure is drawn from, and which day a message lands on.

const calls = [];
let fixtures = {};

const fakePrisma = {
  workspace: { findUnique: async () => ({ timezone: fixtures.timezone ?? 'Asia/Kolkata' }) },
  workspaceMember: { findMany: async () => fixtures.members ?? [] },
  message: {
    count: async () => fixtures.messagesSent ?? 0,
    groupBy: async (args) => { calls.push(['message.groupBy', args]); return fixtures.messageGroups?.(args) ?? []; },
  },
  campaign: {
    count: async () => 0,
    findMany: async () => [],
    groupBy: async (args) => { calls.push(['campaign.groupBy', args]); return fixtures.campaignGroups ?? []; },
    findFirst: async (args) => {
      calls.push(['campaign.findFirst', args]);
      return args.where.status === 'DRAFT' ? fixtures.latestDraft ?? null : fixtures.nextScheduled ?? null;
    },
  },
  waNumber: {
    count: async (args) => { calls.push(['waNumber.count', args]); return args.where.status ? fixtures.activeNumbers ?? 0 : fixtures.numbers ?? 0; },
    findFirst: async (args) => { calls.push(['waNumber.findFirst', args]); return fixtures.primaryNumber ?? null; },
  },
  contact: {
    count: async ({ where }) => {
      if (where.optedOut) return fixtures.optOuts ?? 0;
      if (where.createdAt) return fixtures.newContacts ?? 0;
      return fixtures.totalContacts ?? 0;
    },
  },
  campaignRecipient: {
    groupBy: async () => fixtures.statusGroups ?? [],
    findMany: async (args) => { calls.push(['campaignRecipient.findMany', args]); return fixtures.recipients ?? []; },
  },
  campaignAiSession: { count: async () => fixtures.aiSessions ?? 0 },
  conversation: {
    count: async (args) => { calls.push(['conversation.count', args]); return fixtures.openConversations ?? 0; },
    aggregate: async (args) => { calls.push(['conversation.aggregate', args]); return { _sum: { unreadCount: fixtures.unread ?? null } }; },
    findMany: async ({ where }) => (where.id ? fixtures.conversationContacts ?? [] : fixtures.conversations ?? []),
  },
};

let analytics;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: fakePrisma } });
  analytics = await import('./analytics.service.js');
});

test.beforeEach(() => { fixtures = {}; calls.length = 0; });

test('opt-out rate is over the whole contact base, never above 100%', async () => {
  fixtures = { totalContacts: 1000, newContacts: 2, optOuts: 10 };
  const out = await analytics.getOverview('w1', 7);
  assert.equal(out.totalContacts, 1000);
  assert.equal(out.newContacts, 2);
  assert.equal(out.optOutRate, 1);
  assert.equal(out.timeZone, 'Asia/Kolkata');
});

test('chats handled counts conversations, not messages', async () => {
  fixtures = {
    members: [{ userId: 'u1', user: { name: 'Asha' } }, { userId: 'u2', user: { name: 'Ben' } }],
    messageGroups: () => [
      { senderUserId: 'u1', conversationId: 'c1', _count: { _all: 40 } },
      { senderUserId: 'u1', conversationId: 'c2', _count: { _all: 2 } },
      { senderUserId: 'u2', conversationId: 'c3', _count: { _all: 1 } },
    ],
  };
  const out = await analytics.getAgentStats('w1', 7);
  assert.deepEqual(out.map((a) => [a.name, a.chatsHandled, a.messagesSent]), [['Asha', 2, 42], ['Ben', 1, 1]]);
  const [, args] = calls.find(([name]) => name === 'message.groupBy');
  assert.deepEqual(args.by, ['senderUserId', 'conversationId']);
  assert.equal(args.where.direction, 'OUTBOUND');
});

test('delivery buckets use the workspace calendar day', async () => {
  const now = new Date();
  fixtures = {
    timezone: 'Asia/Kolkata',
    recipients: [
      { status: 'DELIVERED', sentAt: now, deliveredAt: now },
      { status: 'FAILED', sentAt: now, deliveredAt: null },
    ],
  };
  const days = await analytics.getDeliveryStats('w1', 7);
  const today = days[days.length - 1];
  assert.equal(today.iso, new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now));
  assert.equal(today.sent, 1, 'a failed attempt is not a send');
  assert.equal(today.delivered, 1);
  assert.equal(today.rate, 100);
});

test('the performance funnel is one population and replies follow the send', async () => {
  const t0 = new Date(Date.now() - 3 * 3600_000);
  const before = new Date(t0.getTime() - 3600_000);
  const after = new Date(t0.getTime() + 3600_000);
  fixtures = {
    recipients: [
      { contactId: 'k1', status: 'READ', sentAt: t0, readAt: after },
      { contactId: 'k2', status: 'DELIVERED', sentAt: t0, readAt: null },
      { contactId: 'k3', status: 'SENT', sentAt: t0, readAt: null },
    ],
    messageGroups: () => [
      { conversationId: 'cv1', _max: { sentAt: after } },   // k1 replied after the send
      { conversationId: 'cv2', _max: { sentAt: before } },  // k2 wrote before it: not a reply
      { conversationId: 'cv9', _max: { sentAt: after } },   // organic traffic, not a recipient
    ],
    conversationContacts: [
      { id: 'cv1', contactId: 'k1' }, { id: 'cv2', contactId: 'k2' }, { id: 'cv9', contactId: 'k9' },
    ],
    conversations: [
      { id: 'a', status: 'RESOLVED', messages: [{ senderUserId: null }] },
      { id: 'b', status: 'RESOLVED', messages: [{ senderUserId: 'u1' }, { senderUserId: null }] },
      { id: 'c', status: 'RESOLVED', messages: [] },
      { id: 'd', status: 'OPEN', messages: [] },
    ],
  };
  const out = await analytics.getPerformance('w1', 14);
  const byLabel = Object.fromEntries(out.funnel.map((s) => [s.label, s.value]));
  assert.equal(byLabel.Sent, 3);
  assert.equal(byLabel.Delivered, 2);
  assert.equal(byLabel.Read, 1);
  assert.equal(byLabel.Replied, 1);
  assert.ok(byLabel.Replied <= byLabel.Delivered);
  assert.equal(out.resolution.byAi.count, 1);
  assert.equal(out.resolution.byHuman.count, 1);
  assert.equal(out.resolution.noReply.count, 1);
  assert.equal(out.resolution.open.count, 1);
  const [, args] = calls.find(([name]) => name === 'campaignRecipient.findMany');
  assert.deepEqual(args.where.status, { in: ['SENT', 'DELIVERED', 'READ'] });
});

test('home stats are counts scoped to the workspace, not lists', async () => {
  fixtures = {
    numbers: 2, activeNumbers: 1,
    primaryNumber: { id: 'n1', phoneNumber: '+911', displayName: 'Shop', status: 'ACTIVE', quality: 'GREEN' },
    campaignGroups: [
      { status: 'DRAFT', _count: { _all: 25 } },
      { status: 'RUNNING', _count: { _all: 1 } },
      { status: 'SCHEDULED', _count: { _all: 2 } },
      { status: 'COMPLETED', _count: { _all: 40 } },
    ],
    latestDraft: { id: 'c-old', name: 'Old draft' },
    nextScheduled: { id: 'c-s', name: 'Soon', scheduledAt: new Date() },
    openConversations: 7, unread: 12, totalContacts: 1500,
  };
  const out = await analytics.getHomeStats('w1');
  assert.deepEqual(out.numbers, { total: 2, active: 1, primary: fixtures.primaryNumber });
  assert.equal(out.campaigns.total, 68);
  assert.equal(out.campaigns.active, 3);
  assert.equal(out.campaigns.byStatus.DRAFT, 25);
  assert.equal(out.campaigns.latestDraft.id, 'c-old');
  assert.equal(out.campaigns.nextScheduled.id, 'c-s');
  assert.deepEqual(out.conversations, { open: 7, unread: 12 });
  assert.deepEqual(out.contacts, { total: 1500 });
  // Every query is pinned to the caller's workspace and none fetches a list.
  for (const [name, args] of calls) assert.equal(args.where.workspaceId, 'w1', name);
  assert.ok(!calls.some(([name]) => name.endsWith('findMany')));
  // The draft is found by query, so one older than the newest page still is.
  const draftQuery = calls.find(([name, args]) => name === 'campaign.findFirst' && args.where.status === 'DRAFT');
  assert.ok(draftQuery);
});

test('home stats on an empty workspace are zeros and nulls', async () => {
  const out = await analytics.getHomeStats('w1');
  assert.deepEqual(out, {
    numbers: { total: 0, active: 0, primary: null },
    campaigns: { total: 0, byStatus: {}, active: 0, latestDraft: null, nextScheduled: null },
    conversations: { open: 0, unread: 0 },
    contacts: { total: 0 },
  });
});
