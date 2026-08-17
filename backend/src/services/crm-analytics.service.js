import { prisma } from '../lib/prisma.js';

const CLOSED_STAGES = ['CLOSED_WON', 'CLOSED_LOST'];
const MONTHS_ON_CHART = 6;

const toNumber = (v) => Number(v || 0);

// Buckets rows into the last six calendar months by the given date field.
// Rows outside the window are ignored rather than silently folded into the
// first bucket, which would overstate the oldest month.
function bucketByMonth(rows, dateField, now) {
  const buckets = [];
  const index = new Map();
  for (let i = MONTHS_ON_CHART - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const bucket = { month: d.toLocaleString('en-US', { month: 'short' }), total: 0 };
    index.set(key, bucket);
    buckets.push(bucket);
  }
  for (const row of rows) {
    const d = row[dateField];
    if (!d) continue;
    const bucket = index.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (bucket) bucket.total += toNumber(row.value);
  }
  return buckets;
}

export async function getCrmAnalytics(workspaceId, { userId } = {}) {
  const baseWhere = { workspaceId };
  if (userId) baseWhere.ownerUserId = userId;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOf90d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const startOfChart = new Date(now.getFullYear(), now.getMonth() - (MONTHS_ON_CHART - 1), 1);

  const openWhere = { ...baseWhere, stage: { notIn: CLOSED_STAGES } };

  // Aggregates are computed in the database. Loading every open deal to sum it
  // in JS put the whole pipeline through the API process on each dashboard
  // load, which is the one thing a summary screen must not do.
  const [
    closedWonThisMonth,
    openByStage,
    closed90d,
    createdInWindow,
    wonInWindow,
    topOpenDeals,
    activities,
    stageChanges,
  ] = await Promise.all([
    prisma.deal.aggregate({
      where: { ...baseWhere, stage: 'CLOSED_WON', closedAt: { gte: startOfMonth } },
      _sum: { value: true },
    }),
    prisma.deal.groupBy({
      by: ['stage'],
      where: openWhere,
      _sum: { value: true },
      _count: { _all: true },
    }),
    prisma.deal.groupBy({
      by: ['stage'],
      where: { ...baseWhere, stage: { in: CLOSED_STAGES }, closedAt: { gte: startOf90d } },
      _sum: { value: true },
      _count: { _all: true },
    }),
    prisma.deal.findMany({
      where: { ...baseWhere, createdAt: { gte: startOfChart } },
      select: { value: true, createdAt: true },
    }),
    prisma.deal.findMany({
      where: { ...baseWhere, stage: 'CLOSED_WON', closedAt: { gte: startOfChart } },
      select: { value: true, closedAt: true },
    }),
    prisma.deal.findMany({
      where: openWhere,
      select: {
        id: true,
        title: true,
        stage: true,
        value: true,
        createdAt: true,
        contact: { select: { name: true } },
      },
      orderBy: { value: { sort: 'desc', nulls: 'last' } },
      take: 5,
    }),
    prisma.crmActivity.findMany({
      where: { workspaceId, ...(userId ? { createdByUserId: userId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        createdByUser: { select: { name: true } },
        deal: { select: { title: true, contact: { select: { name: true } } } },
      },
    }),
    prisma.dealStageHistory.findMany({
      where: { workspaceId, ...(userId ? { changedByUserId: userId } : {}) },
      orderBy: { changedAt: 'desc' },
      take: 10,
      include: {
        changedByUser: { select: { name: true } },
        deal: { select: { title: true, contact: { select: { name: true } } } },
      },
    }),
  ]);

  const openPipelineTotal = openByStage.reduce((sum, g) => sum + toNumber(g._sum.value), 0);

  const wonGroup = closed90d.find((g) => g.stage === 'CLOSED_WON');
  const wonCount = wonGroup?._count._all ?? 0;
  const closedCount = closed90d.reduce((sum, g) => sum + g._count._all, 0);
  const winRate90d = closedCount > 0 ? (wonCount / closedCount) * 100 : 0;
  const averageDeal90d = wonCount > 0 ? toNumber(wonGroup._sum.value) / wonCount : 0;

  const newPipelineBuckets = bucketByMonth(createdInWindow, 'createdAt', now);
  const closedWonBuckets = bucketByMonth(wonInWindow, 'closedAt', now);
  const pipelineVsWon = newPipelineBuckets.map((bucket, i) => ({
    month: bucket.month,
    newPipeline: bucket.total,
    closedWon: closedWonBuckets[i].total,
  }));

  const openPipelineByStage = openByStage.map((g) => ({
    stage: g.stage,
    count: g._count._all,
    value: toNumber(g._sum.value),
  }));

  const dealsInProgress = topOpenDeals.map((d) => ({
    id: d.id,
    title: d.title,
    company: d.contact?.name || 'Unknown',
    ageDays: Math.floor((now.getTime() - d.createdAt.getTime()) / 86400000),
    stage: d.stage,
    value: toNumber(d.value),
  }));

  const ACTIVITY_LABELS = {
    NOTE: 'Left a note',
    CALL: 'Logged a call',
    EMAIL: 'Sent an email',
    MEETING: 'Logged a meeting',
  };

  const recentActivity = [
    ...activities.map((a) => ({
      id: `act_${a.id}`,
      activity: ACTIVITY_LABELS[a.type] || 'Logged an activity',
      details: a.content,
      company: a.deal?.contact?.name || '-',
      deal: a.deal?.title || '-',
      who: a.createdByUser?.name || 'Unknown',
      when: a.createdAt,
      type: 'activity',
    })),
    ...stageChanges.map((s) => ({
      id: `stage_${s.id}`,
      activity: 'Stage changed',
      details: `${s.fromStage || 'New'} → ${s.toStage}`,
      company: s.deal?.contact?.name || '-',
      deal: s.deal?.title || '-',
      who: s.changedByUser?.name || 'Unknown',
      when: s.changedAt,
      type: 'stage_change',
    })),
  ]
    .sort((a, b) => b.when.getTime() - a.when.getTime())
    .slice(0, 10);

  return {
    kpis: {
      closedWonMonthly: toNumber(closedWonThisMonth._sum.value),
      openPipelineTotal,
      winRate90d: parseFloat(winRate90d.toFixed(1)),
      averageDeal90d,
    },
    charts: {
      pipelineVsWon,
      openPipelineByStage,
    },
    dealsInProgress,
    recentActivity,
  };
}
