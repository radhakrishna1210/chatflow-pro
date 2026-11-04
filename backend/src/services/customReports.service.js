import { prisma } from '../lib/prisma.js';
import { scopeFilter } from './recordScope.service.js';
import { andWhere } from './crmReferences.js';

const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED', 'LOST'];
const LEAD_CATEGORIES = ['HOT', 'WARM', 'COLD'];
const DEAL_STAGES = ['QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];
const ACTIVITY_TYPES = ['NOTE', 'CALL', 'EMAIL', 'MEETING'];

// Report filters arrive as arbitrary JSON from the request body. Each one is
// reduced to a plain string (an object such as { not: null } would otherwise
// be handed to Prisma as an operator) and enum filters are checked, so a bad
// value is a 400 instead of a Prisma 500.
function cleanFilters(raw) {
  const f = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, 100) : '');
  const out = {
    category: str(f.category), status: str(f.status), ownerUserId: str(f.ownerUserId),
    source: str(f.source), stage: str(f.stage), type: str(f.type),
  };
  const check = (key, allowed) => {
    if (out[key] && out[key] !== 'ALL' && !allowed.includes(out[key])) {
      const e = new Error(`${key} must be one of: ${allowed.join(', ')}`); e.status = 400; throw e;
    }
  };
  check('category', LEAD_CATEGORIES);
  check('status', LEAD_STATUSES);
  check('stage', DEAL_STAGES);
  check('type', ACTIVITY_TYPES);
  for (const k of ['status', 'stage', 'type']) if (out[k] === 'ALL') out[k] = '';
  return out;
}

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
} = {}, user = null) {
  filters = cleanFilters(filters);
  // Reports aggregate the same records the lists show, so they are scoped the
  // same way — otherwise a member in TEAM/OWN mode read colleagues' pipeline
  // totals (by owner, by stage) through a report.
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const scoped = Object.keys(scope).length > 0;
  const now = new Date();
  let startDate = null;
  if (range === '7d') startDate = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  else if (range === '30d') startDate = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  else if (range === '90d') startDate = new Date(now.getTime() - 90 * 24 * 3600 * 1000);
  else if (range === 'this_month') startDate = new Date(now.getFullYear(), now.getMonth(), 1);

  if (entity === 'leads') {
    const where = {
      workspaceId,
      ...scope,
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
      ...scope,
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
      ...(scoped ? andWhere({ OR: [{ leadId: null }, { lead: scope }] }, { OR: [{ dealId: null }, { deal: scope }] }) : {}),
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
  if (typeof name !== 'string' || !name.trim()) {
    const e = new Error('Report name is required'); e.status = 400; throw e;
  }
  if (name.trim().length > 80) { const e = new Error('Report name must be 80 characters or fewer'); e.status = 400; throw e; }
  const safeConfig = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  if (JSON.stringify(safeConfig).length > 4000) {
    const e = new Error('Report configuration is too large'); e.status = 400; throw e;
  }
  config = {
    entity: ['leads', 'deals', 'activities'].includes(safeConfig.entity) ? safeConfig.entity : 'leads',
    metric: typeof safeConfig.metric === 'string' ? safeConfig.metric.slice(0, 30) : 'count',
    groupBy: typeof safeConfig.groupBy === 'string' ? safeConfig.groupBy.slice(0, 30) : 'source',
    chartType: typeof safeConfig.chartType === 'string' ? safeConfig.chartType.slice(0, 30) : 'bar',
    range: typeof safeConfig.range === 'string' ? safeConfig.range.slice(0, 20) : '30d',
    filters: cleanFilters(safeConfig.filters),
    ...(typeof safeConfig.description === 'string' ? { description: safeConfig.description.slice(0, 300) } : {}),
  };
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

export async function deleteSavedReport(workspaceId, id, userId, role = null) {
  // Only reports the caller can see can be found, and only the author (or an
  // admin) may delete one: any member could otherwise delete a colleague's
  // private report by id, or a shared report the team relies on.
  const report = await prisma.savedView.findFirst({
    where: { id, workspaceId, entity: REPORT_ENTITY_TYPE, OR: [{ createdByUserId: userId }, { isShared: true }] },
  });
  if (!report) { const e = new Error('Report not found'); e.status = 404; throw e; }
  if (report.createdByUserId !== userId && role !== 'ADMIN') {
    const e = new Error('Only the author or an admin can delete this report'); e.status = 403; throw e;
  }
  await prisma.savedView.delete({ where: { id } });
  return { ok: true };
}
