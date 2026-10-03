import { prisma } from '../lib/prisma.js';
import { listWindow } from '../lib/paging.js';
import { resolveCrmReferences } from './crmReferences.js';
import { autoGenerateOutcomeTask } from './crmCustomization.service.js';
import { activityScopeFilter, assertInScope, withScope } from './recordScope.service.js';

// Visits and video calls are both stored as MEETING; which one it was lives in
// the engagement meta written by createActivity. Rows logged before the meta
// existed have no marker and count as video calls, which is also how the list
// labels them.
const VISIT_MARKER = '"engagementType":"Visit"';
const isVisit = { content: { contains: VISIT_MARKER } };

const ACTIVITY_INCLUDE = {
  createdByUser: {
    select: {
      id: true,
      name: true,
      email: true,
      teamMemberships: {
        include: {
          team: { select: { id: true, name: true } },
        },
      },
    },
  },
  lead: {
    select: {
      id: true,
      status: true,
      source: true,
      score: true,
      category: true,
      contact: {
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          email: true,
        },
      },
    },
  },
  deal: {
    select: {
      id: true,
      title: true,
      stage: true,
      value: true,
      currency: true,
    },
  },
  contact: {
    select: {
      id: true,
      name: true,
      email: true,
      phoneNumber: true,
    },
  },
};

const DEAL_TIMELINE_MAX = 1000;

export async function listActivities(workspaceId, {
  leadId,
  dealId,
  contactId,
  type,
  search,
  ownerUserId,
  status,
  limit = 200,
  page = 1,
} = {}, user = null) {
  // `limit` arrives from the query string and was not capped (CF-048).
  ({ take: limit } = listWindow({ limit }, { defaultLimit: 200, maxLimit: 1000 }));
  page = Math.max(Number.parseInt(page, 10) || 1, 1);
  const scope = user ? await activityScopeFilter(workspaceId, user) : {};
  const where = { workspaceId };
  if (leadId) where.leadId = leadId;
  if (dealId) where.dealId = dealId;
  if (contactId) where.contactId = contactId;
  if (ownerUserId) where.createdByUserId = ownerUserId;

  if (type && type !== 'ALL') {
    const t = type.toUpperCase();
    if (['CALL', 'MEETING', 'NOTE', 'EMAIL'].includes(t)) {
      where.type = t;
    } else if (t === 'VIDEO_CALL') {
      where.type = 'MEETING';
      where.NOT = isVisit;
    } else if (t === 'MESSAGES') {
      where.type = { in: ['EMAIL', 'NOTE'] };
    } else if (t === 'VISITS') {
      where.type = 'MEETING';
      where.content = isVisit.content;
    }
  }

  if (search) {
    where.OR = [
      { content: { contains: search, mode: 'insensitive' } },
      { contact: { name: { contains: search, mode: 'insensitive' } } },
      { contact: { phoneNumber: { contains: search } } },
      { lead: { contact: { name: { contains: search, mode: 'insensitive' } } } },
      { lead: { contact: { phoneNumber: { contains: search } } } },
      { createdByUser: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }

  // If fetching strictly for a single deal and not general engagements list, keep stage history timeline merge
  if (dealId && !leadId && !contactId && !type && !search) {
    // The stage history is the deal's own, so it is shown only for a deal the
    // caller may open.
    if (user) await assertInScope(workspaceId, user, 'deal', dealId);
    const [activities, stageHistory] = await Promise.all([
      // One deal's timeline: the newest DEAL_TIMELINE_MAX of each kind.
      prisma.crmActivity.findMany({
        where: withScope(where, scope),
        include: ACTIVITY_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: DEAL_TIMELINE_MAX,
      }),
      prisma.dealStageHistory.findMany({
        where: { workspaceId, dealId },
        include: { changedByUser: { select: { id: true, name: true } } },
        orderBy: { changedAt: 'desc' },
        take: DEAL_TIMELINE_MAX,
      }),
    ]);

    const unifiedFeed = [
      ...activities.map(a => ({ ...a, feedType: 'ACTIVITY' })),
      ...stageHistory.map(h => ({
        id: h.id,
        feedType: 'STAGE_CHANGE',
        fromStage: h.fromStageKey || h.fromStage,
        toStage: h.toStageKey || h.toStage,
        createdAt: h.changedAt,
        createdByUser: h.changedByUser,
      }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return { data: unifiedFeed, total: unifiedFeed.length };
  }

  const scopedWhere = withScope(where, scope);
  const [activities, total, allCounts, visits] = await Promise.all([
    prisma.crmActivity.findMany({
      where: scopedWhere,
      include: ACTIVITY_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.crmActivity.count({ where: scopedWhere }),
    prisma.crmActivity.groupBy({
      by: ['type'],
      where: withScope({ workspaceId }, scope),
      _count: { _all: true },
    }),
    prisma.crmActivity.count({ where: withScope({ workspaceId, type: 'MEETING', ...isVisit }, scope) }),
  ]);

  const typeCounts = {
    ALL: 0,
    CALL: 0,
    VIDEO_CALL: 0,
    MESSAGES: 0,
    VISITS: 0,
    NOTE: 0,
  };

  for (const g of allCounts) {
    typeCounts[g.type] = g._count._all;
    typeCounts.ALL += g._count._all;
  }
  typeCounts.VISITS = visits;
  typeCounts.VIDEO_CALL = Math.max(0, (typeCounts.MEETING || 0) - visits);
  typeCounts.MESSAGES = (typeCounts.EMAIL || 0) + (typeCounts.NOTE || 0);

  // Enrich for the Engagements Table View
  const enriched = activities.map((act) => {
    let parsedMeta = null;
    let cleanContent = act.content || '';
    try {
      if (cleanContent.startsWith('{') && cleanContent.endsWith('}')) {
        parsedMeta = JSON.parse(cleanContent);
        cleanContent = parsedMeta.notes || parsedMeta.content || cleanContent;
      }
    } catch { /* not JSON after all: keep the raw text as the content */ }

    const leadContact = act.lead?.contact || act.contact;
    const leadName = leadContact?.name || leadContact?.phoneNumber || 'Lead Contact';
    const leadSource = act.lead?.source || parsedMeta?.source || null;
    const leadStage = act.deal?.stage
      ? `${act.deal.stage} Deal`
      : act.lead?.status === 'QUALIFIED'
      ? 'Qualified Leads'
      : 'Opportunity Lead';

    const engagementType = parsedMeta?.engagementType || (act.type === 'MEETING' ? 'Video Call' : act.type === 'CALL' ? 'Call' : act.type === 'EMAIL' ? 'Message' : 'Note');
    const engagementStatus = parsedMeta?.status || 'Logged';
    const teamName = act.createdByUser?.teamMemberships?.[0]?.team?.name || null;

    return {
      ...act,
      content: cleanContent,
      leadName,
      leadContact,
      leadSource,
      leadStage,
      engagementType,
      engagementStatus,
      teamName,
      meta: parsedMeta,
    };
  });

  return {
    data: enriched,
    total,
    counts: typeCounts,
  };
}

export async function createActivity(workspaceId, body, userId) {
  const refs = await resolveCrmReferences(workspaceId, body);

  let rawType = body.type || 'NOTE';
  if (body.engagementType === 'Call') rawType = 'CALL';
  else if (body.engagementType === 'Video Call') rawType = 'MEETING';
  else if (body.engagementType === 'Visit') rawType = 'MEETING';
  else if (body.engagementType === 'Message') rawType = 'EMAIL';
  else if (body.engagementType === 'Note') rawType = 'NOTE';

  // Structured engagement payload. Duration alone does not switch to JSON: the
  // Log interaction modal already writes it into its plain-text content.
  let content = body.content || '';
  if (body.engagementType || body.status || body.notes) {
    const meta = {
      engagementType: body.engagementType || body.type,
      status: body.status || 'Completed',
      duration: body.duration || null,
      notes: body.notes || body.content || '',
      source: body.source || body.leadSource || null,
    };
    content = JSON.stringify(meta);
  }

  const activity = await prisma.crmActivity.create({
    data: {
      workspaceId,
      type: rawType,
      content,
      createdByUserId: userId,
      leadId: refs.leadId ?? null,
      dealId: refs.dealId ?? null,
      contactId: refs.contactId ?? null,
    },
    include: ACTIVITY_INCLUDE,
  });

  const outcomeMatch = body.content?.match(/Outcome:\s*([^|]+)/i);
  const outcome = body.outcome || outcomeMatch?.[1]?.trim() || null;
  const sentimentMatch = body.content?.match(/Sentiment:\s*([^|]+)/i);
  const sentiment = body.sentiment || sentimentMatch?.[1]?.trim() || null;

  if (outcome && (rawType === 'CALL' || rawType === 'MEETING')) {
    await autoGenerateOutcomeTask(workspaceId, {
      type: rawType,
      outcome,
      sentiment,
      leadId: refs.leadId ?? null,
      dealId: refs.dealId ?? null,
      contactId: refs.contactId ?? null,
      userId,
    }).catch((e) => console.error('[createActivity] autoGenerateOutcomeTask error:', e.message));
  }

  return activity;
}


export async function deleteActivity(workspaceId, id, user = null) {
  const scope = user ? await activityScopeFilter(workspaceId, user) : {};
  const activity = await prisma.crmActivity.findFirst({ where: withScope({ id, workspaceId }, scope), select: { id: true } });
  if (!activity) { const e = new Error('Activity not found'); e.status = 404; throw e; }
  await prisma.crmActivity.delete({ where: { id } });
}
