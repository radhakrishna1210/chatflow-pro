import { prisma } from '../lib/prisma.js';

// Gamification.
//
// The governing constraint, from §59: reward *outcomes*, never activity volume.
// On a platform that bills per WhatsApp message, XP for "messages sent" would
// literally pay people to burn the customer's wallet. So nothing here counts
// sends, campaigns launched, or records created — only work that reached a
// useful end state.
//
// Every award is idempotent by construction: a deterministic dedupeKey means
// reopening and re-closing a deal cannot farm points.

export const XP_RULES = {
  qualified_lead:  { points: 10, label: 'Qualified a lead' },
  won_deal:        { points: 50, label: 'Closed a deal' },
  cleared_overdue: { points: 5,  label: 'Cleared an overdue task' },
  accepted_quote:  { points: 25, label: 'Got a quote accepted' },
  resolved_ticket: { points: 8,  label: 'Resolved a ticket' },
};

// Thresholds rise steeply enough that a level means something, and the names
// avoid anything a working adult would be embarrassed to have on screen (§60).
export const LEVELS = [
  { level: 1, name: 'Explorer',   from: 0 },
  { level: 2, name: 'Operator',   from: 100 },
  { level: 3, name: 'Builder',    from: 300 },
  { level: 4, name: 'Strategist', from: 700 },
  { level: 5, name: 'Closer',     from: 1500 },
  { level: 6, name: 'Rainmaker',  from: 3000 },
];

export const ACHIEVEMENTS = [
  { key: 'first_lead',      label: 'First Lead',        detail: 'Created your first lead.' },
  { key: 'first_qualified', label: 'First Qualified',   detail: 'Qualified a lead.' },
  { key: 'first_deal',      label: 'First Opportunity', detail: 'Opened your first deal.' },
  { key: 'first_win',       label: 'First Win',         detail: 'Closed a deal.' },
  { key: 'inbox_zero',      label: 'Nothing Overdue',   detail: 'Cleared every overdue task.' },
  { key: 'ten_wins',        label: 'Ten Wins',          detail: 'Closed ten deals.' },
];

export function levelFor(totalXp) {
  const current = [...LEVELS].reverse().find((l) => totalXp >= l.from) ?? LEVELS[0];
  const next = LEVELS.find((l) => l.from > totalXp) ?? null;
  return {
    level: current.level,
    name: current.name,
    xp: totalXp,
    nextLevelAt: next?.from ?? null,
    // Progress within the current band, not overall — otherwise a level-5 user
    // sees a bar that barely moves.
    progress: next ? Math.round(((totalXp - current.from) / (next.from - current.from)) * 100) : 100,
  };
}

/**
 * Records an award. Safe to call repeatedly: the unique (userId, dedupeKey)
 * makes a repeat a no-op rather than a second payment.
 */
export async function awardXp(workspaceId, userId, kind, { recordType = null, recordId = null } = {}) {
  const rule = XP_RULES[kind];
  if (!rule || !userId) return { awarded: false, reason: 'Unknown award or no user' };

  const dedupeKey = recordId ? `${kind}:${recordId}` : kind;

  try {
    const event = await prisma.xpEvent.create({
      data: { workspaceId, userId, kind, points: rule.points, dedupeKey, recordType, recordId },
    });
    return { awarded: true, points: event.points, kind };
  } catch (err) {
    // P2002 is the unique constraint: already paid for this exact outcome.
    if (err.code === 'P2002') return { awarded: false, reason: 'Already awarded' };
    throw err;
  }
}

export async function unlockAchievement(workspaceId, userId, key) {
  if (!ACHIEVEMENTS.some((a) => a.key === key) || !userId) return { unlocked: false };
  try {
    await prisma.achievement.create({ data: { workspaceId, userId, key } });
    return { unlocked: true, key };
  } catch (err) {
    if (err.code === 'P2002') return { unlocked: false, reason: 'Already unlocked' };
    throw err;
  }
}

// Consecutive days, counting back from today, on which this user earned
// anything. A grace day is allowed (§61: "provide grace periods") so a single
// day off does not erase weeks of consistency — punishing that is how a streak
// becomes a reason to log in and do something pointless.
export function computeStreak(dates, now = new Date()) {
  if (!dates.length) return { current: 0, graceUsed: false };

  const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
  const days = new Set(dates.map(dayKey));

  let current = 0;
  let graceUsed = false;
  const cursor = new Date(now);

  for (let i = 0; i < 365; i += 1) {
    const key = dayKey(cursor);
    if (days.has(key)) {
      current += 1;
    } else if (i === 0) {
      // Today not yet earned is not a broken streak — the day is not over.
    } else if (!graceUsed) {
      graceUsed = true;
    } else {
      break;
    }
    cursor.setDate(cursor.getDate() - 1);
  }

  return { current, graceUsed };
}

// Daily missions, tied to real work rather than to logging in (§62). Each is
// derived from live counts, so completing one requires actually doing it.
export async function dailyMissions(workspaceId, userId) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [overdue, staleDeals, newLeads, clearedToday] = await Promise.all([
    prisma.task.count({ where: { workspaceId, assignedToUserId: userId, status: 'PENDING', dueDate: { lt: new Date() } } }),
    prisma.deal.count({
      where: {
        workspaceId, ownerUserId: userId,
        stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
        tasks: { none: { status: 'PENDING' } },
      },
    }),
    prisma.lead.count({ where: { workspaceId, ownerUserId: userId, status: 'NEW' } }),
    prisma.xpEvent.count({ where: { workspaceId, userId, kind: 'cleared_overdue', createdAt: { gte: startOfDay } } }),
  ]);

  return [
    {
      key: 'clear_overdue',
      title: 'Clear your overdue tasks',
      detail: overdue === 0 ? 'Nothing overdue — done.' : `${overdue} still overdue.`,
      done: overdue === 0,
      progress: overdue === 0 ? 100 : Math.min(99, Math.round((clearedToday / (clearedToday + overdue)) * 100) || 0),
    },
    {
      key: 'next_steps',
      title: 'Add a next step to 3 stalled deals',
      detail: staleDeals === 0 ? 'Every deal has a next step.' : `${staleDeals} deal(s) with nothing scheduled.`,
      done: staleDeals === 0,
      progress: staleDeals === 0 ? 100 : Math.max(0, Math.round(((3 - Math.min(staleDeals, 3)) / 3) * 100)),
    },
    {
      key: 'qualify',
      title: 'Work through your new leads',
      detail: newLeads === 0 ? 'No new leads waiting.' : `${newLeads} lead(s) still marked New.`,
      done: newLeads === 0,
      progress: newLeads === 0 ? 100 : 0,
    },
  ];
}

export async function getProfile(workspaceId, userId) {
  const [events, achievements, recent] = await Promise.all([
    prisma.xpEvent.aggregate({ where: { workspaceId, userId }, _sum: { points: true } }),
    prisma.achievement.findMany({ where: { workspaceId, userId }, orderBy: { unlockedAt: 'desc' } }),
    prisma.xpEvent.findMany({
      where: { workspaceId, userId },
      select: { kind: true, points: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
  ]);

  const totalXp = events._sum.points ?? 0;
  const unlocked = new Set(achievements.map((a) => a.key));

  return {
    ...levelFor(totalXp),
    streak: computeStreak(recent.map((r) => r.createdAt)),
    achievements: ACHIEVEMENTS.map((a) => ({
      ...a,
      unlocked: unlocked.has(a.key),
      unlockedAt: achievements.find((x) => x.key === a.key)?.unlockedAt ?? null,
    })),
    missions: await dailyMissions(workspaceId, userId),
    recent: recent.slice(0, 10).map((r) => ({
      kind: r.kind, points: r.points, label: XP_RULES[r.kind]?.label ?? r.kind, at: r.createdAt,
    })),
  };
}

/**
 * Optional leaderboard (§64). Off unless asked for, and it reports only what a
 * colleague could already see — name and points, never pipeline value.
 */
export async function leaderboard(workspaceId, { limit = 10 } = {}) {
  const grouped = await prisma.xpEvent.groupBy({
    by: ['userId'],
    where: { workspaceId },
    _sum: { points: true },
    orderBy: { _sum: { points: 'desc' } },
    take: Math.min(limit, 50),
  });

  const users = await prisma.user.findMany({
    where: { id: { in: grouped.map((g) => g.userId) } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  return grouped.map((g, i) => ({
    rank: i + 1,
    userId: g.userId,
    name: byId.get(g.userId)?.name || byId.get(g.userId)?.email || 'Unknown',
    xp: g._sum.points ?? 0,
    level: levelFor(g._sum.points ?? 0).name,
  }));
}
