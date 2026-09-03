import { prisma } from '../lib/prisma.js';
import { resolveCrmReferences } from './crmReferences.js';

const ACTIVITY_INCLUDE = {
  createdByUser: { select: { id: true, name: true, email: true } },
  lead: { select: { id: true, status: true } },
  deal: { select: { id: true, title: true, stage: true } },
  contact: { select: { id: true, name: true, email: true } },
};

export async function listActivities(workspaceId, { leadId, dealId, contactId } = {}) {
  const where = { workspaceId };
  if (leadId) where.leadId = leadId;
  if (dealId) where.dealId = dealId;
  if (contactId) where.contactId = contactId;

  // We fetch normal notes/activities
  const activities = await prisma.crmActivity.findMany({
    where,
    include: ACTIVITY_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  // If fetching for a deal, we merge the DealStageHistory to create a unified timeline
  if (dealId && !leadId && !contactId) {
    const stageHistory = await prisma.dealStageHistory.findMany({
      where: { workspaceId, dealId },
      include: { changedByUser: { select: { id: true, name: true } } },
      orderBy: { changedAt: 'desc' },
    });

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

  return { data: activities, total: activities.length };
}

export async function createActivity(workspaceId, body, userId) {
  const refs = await resolveCrmReferences(workspaceId, body);

  return prisma.crmActivity.create({
    data: {
      workspaceId,
      type: body.type || 'NOTE',
      content: body.content,
      // Authorship is taken from the session, never the payload — otherwise a
      // note can be filed under someone else's name.
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
