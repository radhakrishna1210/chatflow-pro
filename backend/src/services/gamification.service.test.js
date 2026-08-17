import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import {
  awardXp, unlockAchievement, levelFor, computeStreak, getProfile, leaderboard,
  XP_RULES, LEVELS,
} from './gamification.service.js';

// ─── Anti-spam: the whole point of the design ──────────────────────────────

test('nothing rewards message or campaign volume', () => {
  // §59. On a platform billed per WhatsApp message, XP for "messages sent"
  // would literally pay people to burn the customer's wallet.
  const kinds = Object.keys(XP_RULES).join(' ');
  for (const forbidden of ['message', 'sent', 'campaign', 'broadcast', 'contact_created', 'login']) {
    assert.ok(!kinds.includes(forbidden), `"${forbidden}" must not be a reward — it is volume, not outcome`);
  }
  // Everything that does pay is a completed outcome.
  assert.deepEqual(
    Object.keys(XP_RULES).sort(),
    ['accepted_quote', 'cleared_overdue', 'qualified_lead', 'resolved_ticket', 'won_deal'],
  );
});

test('closing a deal is worth more than clearing a task', () => {
  assert.ok(XP_RULES.won_deal.points > XP_RULES.cleared_overdue.points);
});

// ─── Levels and streaks (pure) ─────────────────────────────────────────────

test('levels rise with XP and report progress within the band', () => {
  assert.equal(levelFor(0).name, 'Explorer');
  assert.equal(levelFor(0).level, 1);
  assert.equal(levelFor(150).name, 'Operator');
  assert.equal(levelFor(5000).name, 'Rainmaker');

  // Progress is within the current band, not overall — a level-5 user should
  // not stare at a bar that barely moves.
  const mid = levelFor(200); // Operator spans 100–300
  assert.equal(mid.progress, 50);
  assert.equal(mid.nextLevelAt, 300);

  // Top level has nothing above it.
  assert.equal(levelFor(9999).nextLevelAt, null);
  assert.equal(levelFor(9999).progress, 100);
});

test('level names avoid anything embarrassing to have on a work screen', () => {
  // §60 asks for tasteful naming explicitly.
  for (const l of LEVELS) {
    assert.ok(/^[A-Z][a-z]+$/.test(l.name), `"${l.name}" should be a single plain word`);
  }
});

test('a streak counts consecutive days and forgives one miss', () => {
  const day = (n) => new Date(Date.now() - n * 86400000);

  // Today, yesterday, the day before.
  assert.equal(computeStreak([day(0), day(1), day(2)]).current, 3);

  // A gap at day 2 is forgiven once (§61 asks for grace), so the run continues.
  const withGap = computeStreak([day(0), day(1), day(3)]);
  assert.equal(withGap.current, 3);
  assert.equal(withGap.graceUsed, true);

  // Two gaps ends it.
  assert.equal(computeStreak([day(0), day(4)]).current, 1);

  // Not having earned anything *today* is not a broken streak — the day is
  // not over yet.
  assert.equal(computeStreak([day(1), day(2)]).current, 2);

  assert.equal(computeStreak([]).current, 0);
});

// ─── Awards (database) ─────────────────────────────────────────────────────

let dbAvailable = false;
let workspaceId;
let userId;

test.before(async () => {
  try { await prisma.$connect(); dbAvailable = true; } catch { return; }
  const stamp = Date.now();
  workspaceId = (await prisma.workspace.create({ data: { name: `test-xp-${stamp}` } })).id;
  userId = (await prisma.user.create({ data: { name: 'Player', email: `xp-${stamp}@example.test` } })).id;
  await prisma.workspaceMember.create({ data: { userId, workspaceId, role: 'ADMIN' } });
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

test('the same outcome cannot be paid twice', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const first = await awardXp(workspaceId, userId, 'won_deal', { recordType: 'deal', recordId: 'deal-1' });
  assert.equal(first.awarded, true);
  assert.equal(first.points, XP_RULES.won_deal.points);

  // Re-closing the same deal must not farm points.
  const second = await awardXp(workspaceId, userId, 'won_deal', { recordType: 'deal', recordId: 'deal-1' });
  assert.equal(second.awarded, false);
  assert.match(second.reason, /Already awarded/);

  const total = await prisma.xpEvent.aggregate({ where: { workspaceId, userId }, _sum: { points: true } });
  assert.equal(total._sum.points, XP_RULES.won_deal.points);
});

test('a different record of the same kind does pay', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const r = await awardXp(workspaceId, userId, 'won_deal', { recordType: 'deal', recordId: 'deal-2' });
  assert.equal(r.awarded, true);
});

test('an unknown award kind is ignored rather than inventing points', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const r = await awardXp(workspaceId, userId, 'sent_a_message', { recordId: 'x' });
  assert.equal(r.awarded, false);
});

test('an achievement unlocks once and stays unlocked', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  assert.equal((await unlockAchievement(workspaceId, userId, 'first_win')).unlocked, true);
  assert.equal((await unlockAchievement(workspaceId, userId, 'first_win')).unlocked, false);
  assert.equal(await prisma.achievement.count({ where: { userId, key: 'first_win' } }), 1);

  // An unknown key is refused rather than stored.
  assert.equal((await unlockAchievement(workspaceId, userId, 'made_up')).unlocked, false);
});

test('the profile explains the score rather than just stating it', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const profile = await getProfile(workspaceId, userId);

  assert.equal(profile.xp, XP_RULES.won_deal.points * 2);
  assert.ok(profile.name);
  assert.ok(Array.isArray(profile.recent) && profile.recent.length > 0, 'the ledger is what makes the score explainable');
  assert.ok(profile.recent.every((r) => r.label && r.points), 'each entry says what it was for');
  assert.ok(Array.isArray(profile.missions) && profile.missions.length > 0);
  assert.ok(profile.achievements.some((a) => a.key === 'first_win' && a.unlocked));
  assert.ok(profile.achievements.some((a) => !a.unlocked), 'locked achievements are still listed as goals');
});

test('missions are tied to real work, not to logging in', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const profile = await getProfile(workspaceId, userId);
  const titles = profile.missions.map((m) => m.title.toLowerCase()).join(' ');

  for (const lazy of ['log in', 'sign in', 'visit', 'open the app']) {
    assert.ok(!titles.includes(lazy), `"${lazy}" is attendance, not work`);
  }
  assert.ok(titles.includes('overdue'), 'clearing real backlog should be a mission');
});

test('the leaderboard reports standing without exposing pipeline value', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const board = await leaderboard(workspaceId);
  assert.ok(board.length >= 1);

  const entry = board[0];
  assert.deepEqual(Object.keys(entry).sort(), ['level', 'name', 'rank', 'userId', 'xp']);
  // §64: opt-in and privacy-aware. Money must not leak through the fun screen.
  for (const leaked of ['value', 'revenue', 'pipeline', 'deals']) {
    assert.equal(entry[leaked], undefined);
  }
});
