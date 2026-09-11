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

export async function getCrmAnalytics(workspaceId, { userId, range = '30d' } = {}) {
  const baseWhere = { workspaceId };
  if (userId) baseWhere.ownerUserId = userId;

  const now = new Date();
  let startDate = null;
  if (range === '7d') startDate = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  else if (range === '30d') startDate = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  else if (range === '90d') startDate = new Date(now.getTime() - 90 * 24 * 3600 * 1000);
  else if (range === 'this_month') startDate = new Date(now.getFullYear(), now.getMonth(), 1);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOf90d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const startOfChart = new Date(now.getFullYear(), now.getMonth() - (MONTHS_ON_CHART - 1), 1);

  const openWhere = { ...baseWhere, stage: { notIn: CLOSED_STAGES } };

  // Batch 1: Deal aggregates (3 queries)
  const [closedWonThisMonth, openByStage, closed90d] = await Promise.all([
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
  ]);

  // Batch 2: Deals timeline and top deals (3 queries)
  const [createdInWindow, wonInWindow, topOpenDeals] = await Promise.all([
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
  ]);

  // Batch 3: Feeds and leads (3 queries)
  const [activities, stageChanges, allLeadsForSource] = await Promise.all([
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
    prisma.lead.findMany({
      where: { workspaceId, ...(startDate ? { createdAt: { gte: startDate } } : {}) },
      select: {
        id: true,
        source: true,
        status: true,
        deals: {
          select: { id: true, stage: true, value: true },
        },
      },
    }),
  ]);

  // Derived lead counts without extra DB roundtrips
  const newLeadsCount = allLeadsForSource.length;
  const qualifiedLeadsCount = allLeadsForSource.filter(
    (l) => l.status === 'QUALIFIED' || l.status === 'CONVERTED'
  ).length;

  // Batch 4: Activity counts and tasks (4 queries)
  const [activityGroups, overdueTasks, dueTodayTasks, completedTasks] = await Promise.all([
    prisma.crmActivity.groupBy({
      by: ['type'],
      where: { workspaceId, ...(startDate ? { createdAt: { gte: startDate } } : {}) },
      _count: { _all: true },
    }),
    prisma.task.count({ where: { workspaceId, status: 'PENDING', dueDate: { lt: now } } }),
    prisma.task.count({
      where: {
        workspaceId,
        status: 'PENDING',
        dueDate: {
          gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          lt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
        },
      },
    }),
    prisma.task.count({ where: { workspaceId, status: 'COMPLETED', ...(startDate ? { completedAt: { gte: startDate } } : {}) } }),
  ]);

  const actCountMap = {};
  for (const g of activityGroups || []) {
    actCountMap[g.type] = g._count._all;
  }
  const callsCount = actCountMap.CALL || 0;
  const notesCount = actCountMap.NOTE || 0;
  const emailsCount = actCountMap.EMAIL || 0;
  const meetingsCount = actCountMap.MEETING || 0;

  // Lead Source Performance Breakdown
  const sourceMap = new Map();
  for (const l of allLeadsForSource || []) {
    const src = l.source || 'Direct';
    const cur = sourceMap.get(src) || {
      source: src,
      leads: 0,
      qualified: 0,
      deals: 0,
      won: 0,
      revenue: 0,
    };
    cur.leads++;
    if (l.status === 'QUALIFIED' || l.status === 'CONVERTED') {
      cur.qualified++;
    }
    for (const d of l.deals || []) {
      cur.deals++;
      if (d.stage === 'CLOSED_WON') {
        cur.won++;
        cur.revenue += toNumber(d.value);
      }
    }
    sourceMap.set(src, cur);
  }
  const leadSourcePerformance = Array.from(sourceMap.values()).sort((a, b) => b.leads - a.leads);

  const openDealsCount = openByStage.reduce((acc, s) => acc + (s._count?._all ?? 0), 0);
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

  const leadToDealConversionRate = newLeadsCount > 0 ? parseFloat(((qualifiedLeadsCount / newLeadsCount) * 100).toFixed(1)) : 0;

  return {
    kpis: {
      closedWonMonthly: toNumber(closedWonThisMonth._sum.value),
      openPipelineTotal,
      winRate90d: parseFloat(winRate90d.toFixed(1)),
      averageDeal90d,
      newLeads: newLeadsCount,
      qualifiedLeads: qualifiedLeadsCount,
      openDeals: openDealsCount,
      wonDeals: wonCount,
      conversionRate: leadToDealConversionRate,
    },
    charts: {
      pipelineVsWon,
      openPipelineByStage,
    },
    leadSourcePerformance,
    activityPerformance: {
      calls: callsCount,
      notes: notesCount,
      emails: emailsCount,
      meetings: meetingsCount,
      overdueTasks,
      dueTodayTasks,
      completedTasks,
    },
    dealsInProgress,
    recentActivity,
    range,
  };
}
