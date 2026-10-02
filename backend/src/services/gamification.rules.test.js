import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Award gating and the leaderboard switch, against an in-memory prisma
// stand-in. The point is that creating a record cannot by itself pay out.

let settingsRow;
let deleted;

const fakePrisma = {
  savedView: {
    findFirst: async () => settingsRow,
    update: async ({ data }) => { settingsRow = { ...settingsRow, ...data }; },
    create: async ({ data }) => { settingsRow = { id: 's1', ...data }; },
  },
  xpEvent: {
    deleteMany: async ({ where }) => { deleted.push(where); return { count: 1 }; },
    groupBy: async () => [],
  },
  user: { findMany: async () => [] },
};

let g;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: fakePrisma } });
  g = await import('./gamification.service.js');
});

test.beforeEach(() => {
  settingsRow = null;
  deleted = [];
});

const now = new Date('2026-10-02T12:00:00Z');
const hoursAgo = (h) => new Date(now.getTime() - h * 3600_000);

test('a task created already past due does not earn cleared_overdue', () => {
  assert.equal(g.earnsClearedOverdue({ createdAt: hoursAgo(1), dueDate: new Date('2020-01-01') }, now), false);
});

test('a task that fell overdue after creation earns cleared_overdue', () => {
  assert.equal(g.earnsClearedOverdue({ createdAt: hoursAgo(72), dueDate: hoursAgo(24) }, now), true);
  assert.equal(g.earnsClearedOverdue({ createdAt: hoursAgo(72), dueDate: new Date(now.getTime() + 3600_000) }, now), false);
});

test('a won deal pays only with a value and after a day', () => {
  assert.equal(g.earnsWonDeal({ value: 0, createdAt: hoursAgo(48) }, now), false);
  assert.equal(g.earnsWonDeal({ value: 5000, createdAt: hoursAgo(1) }, now), false);
  assert.equal(g.earnsWonDeal({ value: '5000', createdAt: hoursAgo(48) }, now), true);
});

test('a freshly created lead does not pay for qualification', () => {
  assert.equal(g.earnsQualifiedLead({ createdAt: hoursAgo(1) }, now), false);
  assert.equal(g.earnsQualifiedLead({ createdAt: hoursAgo(30) }, now), true);
});

test('every listed achievement key is one the code can unlock', () => {
  assert.deepEqual(
    g.ACHIEVEMENTS.map((a) => a.key).sort(),
    ['first_deal', 'first_lead', 'first_qualified', 'first_win', 'inbox_zero', 'ten_wins'],
  );
});

test('revoking removes the award for that record only', async () => {
  await g.revokeXp('ws1', 'won_deal', 'deal1');
  assert.deepEqual(deleted, [{ workspaceId: 'ws1', dedupeKey: 'won_deal:deal1' }]);
});

test('the leaderboard is off until an admin turns it on', async () => {
  await assert.rejects(() => g.leaderboard('ws1'), (e) => e.status === 403);
  await g.saveSettings('ws1', { leaderboardEnabled: true });
  assert.deepEqual(await g.getSettings('ws1'), { leaderboardEnabled: true });
  assert.deepEqual(await g.leaderboard('ws1'), []);
});
