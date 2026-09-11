import { prisma } from '../lib/prisma.js';
import { resolveCrmReferences } from './crmReferences.js';

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
} = {}) {
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
    } else if (t === 'MESSAGES') {
      where.type = { in: ['EMAIL', 'NOTE'] };
    } else if (t === 'VISITS') {
      where.type = 'MEETING';
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
    const [activities, stageHistory] = await Promise.all([
      prisma.crmActivity.findMany({
        where,
        include: ACTIVITY_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.dealStageHistory.findMany({
        where: { workspaceId, dealId },
        include: { changedByUser: { select: { id: true, name: true } } },
        orderBy: { changedAt: 'desc' },
      }),
    ]);

    const unifiedFeed = [
      ...activities.map(a => ({ ...a, feedType: 'ACTIVITY' })),
      ...stageHistory.map(h => ({
        id: h.id,
        feedType: 'STAGE_CHANGE',
        fromStage: h.fromStage,
        toStage: h.toStage,
        createdAt: h.changedAt,
        createdByUser: h.changedByUser,
      }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return { data: unifiedFeed, total: unifiedFeed.length };
  }

  const [activities, total, allCounts] = await Promise.all([
    prisma.crmActivity.findMany({
      where,
      include: ACTIVITY_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.crmActivity.count({ where }),
    prisma.crmActivity.groupBy({
      by: ['type'],
      where: { workspaceId },
      _count: { _all: true },
    }),
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
  typeCounts.VIDEO_CALL = typeCounts.MEETING || 0;
  typeCounts.MESSAGES = (typeCounts.EMAIL || 0) + (typeCounts.NOTE || 0);
  typeCounts.VISITS = typeCounts.MEETING || 0;

  // Enrich for the Engagements Table View
  const enriched = activities.map((act) => {
    let parsedMeta = null;
    let cleanContent = act.content || '';
    try {
      if (cleanContent.startsWith('{') && cleanContent.endsWith('}')) {
        parsedMeta = JSON.parse(cleanContent);
        cleanContent = parsedMeta.notes || parsedMeta.content || cleanContent;
      }
    } catch {}

    const leadContact = act.lead?.contact || act.contact;
    const leadName = leadContact?.name || leadContact?.phoneNumber || 'Lead Contact';
    const leadSource = act.lead?.source || parsedMeta?.source || (act.type === 'CALL' ? 'Incoming' : 'INSTAGRAM');
    const leadStage = act.deal?.stage
      ? `${act.deal.stage} Deal`
      : act.lead?.status === 'QUALIFIED'
      ? 'Qualified Leads'
      : 'Opportunity Lead';

    const engagementType = parsedMeta?.engagementType || (act.type === 'MEETING' ? 'Video Call' : act.type === 'CALL' ? 'Call' : act.type === 'EMAIL' ? 'Message' : 'Note');
    const engagementStatus = parsedMeta?.status || (act.type === 'CALL' ? 'Completed' : 'Active');
    const teamName = act.createdByUser?.teamMemberships?.[0]?.team?.name || 'Enterprise Growth Team';

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

  // Support structured engagement payload
  let content = body.content || '';
  if (body.engagementType || body.status || body.duration || body.notes) {
    const meta = {
      engagementType: body.engagementType || body.type,
      status: body.status || 'Completed',
      duration: body.duration || null,
      notes: body.notes || body.content || '',
      source: body.source || body.leadSource || null,
    };
    content = JSON.stringify(meta);
  }

  return prisma.crmActivity.create({
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
}


export async function deleteActivity(workspaceId, id) {
  const activity = await prisma.crmActivity.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!activity) { const e = new Error('Activity not found'); e.status = 404; throw e; }
  await prisma.crmActivity.delete({ where: { id } });
}
