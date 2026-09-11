import { prisma } from '../lib/prisma.js';

const REPORT_ENTITY_TYPE = 'crm_custom_report';

export const PREBUILT_TEMPLATES = [
  {
    id: 'hot-leads-by-owner',
    name: 'Hot Leads by Sales Owner',
    description: 'Breakdown of high-intent HOT leads distributed across sales team members',
    entity: 'leads',
    metric: 'count',
    groupBy: 'owner',
    chartType: 'bar',
    filters: { category: 'HOT' },
  },
  {
    id: 'lead-source-performance',
    name: 'Lead Source Performance',
    description: 'Volume and distribution of leads acquired by lead acquisition channel',
    entity: 'leads',
    metric: 'count',
    groupBy: 'source',
    chartType: 'pie',
    filters: {},
  },
  {
    id: 'deal-pipeline-by-stage',
    name: 'Active Deal Pipeline Funnel',
    description: 'Total pipeline deal value across all active sales pipeline stages',
    entity: 'deals',
    metric: 'sum_value',
    groupBy: 'stage',
    chartType: 'funnel',
    filters: {},
  },
  {
    id: 'leads-by-status',
    name: 'Lead Status Distribution',
    description: 'Progress of leads across lifecycle statuses (New, Contacted, Qualified, etc.)',
    entity: 'leads',
    metric: 'count',
    groupBy: 'status',
    chartType: 'bar',
    filters: {},
  },
  {
    id: 'activity-by-type',
    name: 'Sales Engagement Activities',
    description: 'Log of sales touchpoints (Calls, Notes, Emails, Meetings) across the team',
    entity: 'activities',
    metric: 'count',
    groupBy: 'type',
    chartType: 'bar',
    filters: {},
  },
];

/**
 * Executes dynamic custom report query.
 */
export async function executeCustomReport(workspaceId, {
  entity = 'leads',
  metric = 'count',
  groupBy = 'source',
  filters = {},
  range = '30d',
} = {}) {
  const now = new Date();
  let startDate = null;
  if (range === '7d') startDate = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  else if (range === '30d') startDate = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  else if (range === '90d') startDate = new Date(now.getTime() - 90 * 24 * 3600 * 1000);
  else if (range === 'this_month') startDate = new Date(now.getFullYear(), now.getMonth(), 1);

  if (entity === 'leads') {
    const where = {
      workspaceId,
      ...(startDate ? { createdAt: { gte: startDate } } : {}),
      ...(filters.category && filters.category !== 'ALL' ? { category: filters.category } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.ownerUserId ? { ownerUserId: filters.ownerUserId } : {}),
      ...(filters.source ? { source: { contains: filters.source, mode: 'insensitive' } } : {}),
    };

    if (groupBy === 'owner') {
      const leads = await prisma.lead.findMany({
        where,
        select: {
          id: true,
          score: true,
          owner: { select: { id: true, name: true, email: true } },
        },
      });

      const map = new Map();
      for (const l of leads) {
        const key = l.owner?.name || l.owner?.email || 'Unassigned';
        const cur = map.get(key) || { key, label: key, count: 0, totalScore: 0 };
        cur.count++;
        cur.totalScore += l.score || 0;
        map.set(key, cur);
      }

      const rows = Array.from(map.values()).map((r) => ({
        label: r.label,
        value: metric === 'avg_score' ? (r.count > 0 ? Math.round(r.totalScore / r.count) : 0) : r.count,
        count: r.count,
      })).sort((a, b) => b.value - a.value);

      const total = rows.reduce((acc, r) => acc + r.value, 0);
      return { entity, metric, groupBy, rows, total, range };
    }

    if (groupBy === 'source') {
      const groups = await prisma.lead.groupBy({
        by: ['source'],
        where,
        _count: { _all: true },
        _avg: { score: true },
      });

      const rows = groups.map((g) => ({
        label: g.source || 'Direct / Unspecified',
        value: metric === 'avg_score' ? Math.round(g._avg.score || 0) : g._count._all,
        count: g._count._all,
      })).sort((a, b) => b.value - a.value);

      const total = rows.reduce((acc, r) => acc + r.value, 0);
      return { entity, metric, groupBy, rows, total, range };
    }

    if (groupBy === 'category') {
      const groups = await prisma.lead.groupBy({
        by: ['category'],
        where,
        _count: { _all: true },
        _avg: { score: true },
      });

      const rows = groups.map((g) => ({
        label: g.category || 'COLD',
        value: metric === 'avg_score' ? Math.round(g._avg.score || 0) : g._count._all,
        count: g._count._all,
      })).sort((a, b) => b.value - a.value);

      const total = rows.reduce((acc, r) => acc + r.value, 0);
      return { entity, metric, groupBy, rows, total, range };
    }

    // Default: groupBy === 'status'
    const groups = await prisma.lead.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      _avg: { score: true },
    });

    const rows = groups.map((g) => ({
      label: g.status,
      value: metric === 'avg_score' ? Math.round(g._avg.score || 0) : g._count._all,
      count: g._count._all,
    })).sort((a, b) => b.value - a.value);

    const total = rows.reduce((acc, r) => acc + r.value, 0);
    return { entity, metric, groupBy, rows, total, range };
  }

  if (entity === 'deals') {
    const where = {
      workspaceId,
      ...(startDate ? { createdAt: { gte: startDate } } : {}),
      ...(filters.stage ? { stage: filters.stage } : {}),
      ...(filters.ownerUserId ? { ownerUserId: filters.ownerUserId } : {}),
    };

    if (groupBy === 'owner') {
      const deals = await prisma.deal.findMany({
        where,
        select: {
          id: true,
          value: true,
          owner: { select: { id: true, name: true, email: true } },
        },
      });

      const map = new Map();
      for (const d of deals) {
        const key = d.owner?.name || d.owner?.email || 'Unassigned';
        const cur = map.get(key) || { key, label: key, count: 0, sumValue: 0 };
        cur.count++;
        cur.sumValue += Number(d.value || 0);
        map.set(key, cur);
      }

      const rows = Array.from(map.values()).map((r) => ({
        label: r.label,
        value: metric === 'sum_value' ? Math.round(r.sumValue) : r.count,
        count: r.count,
        sumValue: Math.round(r.sumValue),
      })).sort((a, b) => b.value - a.value);

      const total = rows.reduce((acc, r) => acc + r.value, 0);
      return { entity, metric, groupBy, rows, total, range };
    }

    // Default deal grouping: stage
    const groups = await prisma.deal.groupBy({
      by: ['stage'],
      where,
      _count: { _all: true },
      _sum: { value: true },
    });

    const rows = groups.map((g) => ({
      label: g.stage,
      value: metric === 'sum_value' ? Math.round(Number(g._sum.value || 0)) : g._count._all,
      count: g._count._all,
      sumValue: Math.round(Number(g._sum.value || 0)),
    })).sort((a, b) => b.value - a.value);

    const total = rows.reduce((acc, r) => acc + r.value, 0);
    return { entity, metric, groupBy, rows, total, range };
  }

  if (entity === 'activities') {
    const where = {
      workspaceId,
      ...(startDate ? { createdAt: { gte: startDate } } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.ownerUserId ? { createdByUserId: filters.ownerUserId } : {}),
    };

    const groups = await prisma.crmActivity.groupBy({
      by: ['type'],
      where,
      _count: { _all: true },
    });

    const rows = groups.map((g) => ({
      label: g.type,
      value: g._count._all,
      count: g._count._all,
    })).sort((a, b) => b.value - a.value);

    const total = rows.reduce((acc, r) => acc + r.value, 0);
    return { entity, metric, groupBy, rows, total, range };
  }

  return { entity, metric, groupBy, rows: [], total: 0, range };
}

/**
 * Saved Reports CRUD.
 */
export async function listSavedReports(workspaceId, userId) {
  const reports = await prisma.savedView.findMany({
    where: {
      workspaceId,
      entity: REPORT_ENTITY_TYPE,
      OR: [
        { createdByUserId: userId },
        { isShared: true },
      ],
    },
    include: {
      createdByUser: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    templates: PREBUILT_TEMPLATES,
    saved: reports.map((r) => ({
      id: r.id,
      name: r.name,
      config: r.filters,
      isShared: r.isShared,
      createdAt: r.createdAt,
      author: r.createdByUser?.name || r.createdByUser?.email,
    })),
  };
}

export async function saveCustomReport(workspaceId, { name, config, isShared = true } = {}, userId) {
  if (!name || !name.trim()) {
    const e = new Error('Report name is required'); e.status = 400; throw e;
  }
  const report = await prisma.savedView.create({
    data: {
      workspaceId,
      entity: REPORT_ENTITY_TYPE,
      name: name.trim(),
      filters: config || {},
      isShared: Boolean(isShared),
      createdByUserId: userId,
    },
  });
  return report;
}

export async function deleteSavedReport(workspaceId, id, userId) {
  const report = await prisma.savedView.findFirst({
    where: { id, workspaceId, entity: REPORT_ENTITY_TYPE },
  });
  if (!report) { const e = new Error('Report not found'); e.status = 404; throw e; }
  await prisma.savedView.delete({ where: { id } });
  return { ok: true };
}
