import { prisma } from '../lib/prisma.js';
import { computeWorkspaceDealHealth, computeDealHealth } from './dealHealth.service.js';
import { validateCrmCustomFields } from './customFields.service.js';
import { scopeFilter } from './recordScope.service.js';
import { emitCrmEvent } from './workflowCrm.service.js';
import { awardXp, unlockAchievement } from './gamification.service.js';

const CLOSED_STAGES = ['CLOSED_WON', 'CLOSED_LOST'];

const DEAL_INCLUDE = {
  contact: { select: { id: true, name: true, phoneNumber: true, email: true } },
  owner: { select: { id: true, name: true, email: true } },
  lead: { select: { id: true, status: true, score: true } },
};

export async function listDeals(workspaceId, { stage = '', ownerUserId = '' } = {}, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const where = {
    workspaceId,
    ...scope,
    ...(stage ? { stage } : {}),
    ...(ownerUserId ? { ownerUserId } : {}),
  };
  // Health for the whole board is computed in one fixed set of queries rather
  // than per card, so adding it to the list costs a constant amount.
  const [data, total, health] = await Promise.all([
    prisma.deal.findMany({ where, include: DEAL_INCLUDE, orderBy: { updatedAt: 'desc' } }),
    prisma.deal.count({ where }),
    computeWorkspaceDealHealth(workspaceId, { ownerUserId: ownerUserId || undefined }),
  ]);
  return {
    data: data.map((deal) => ({ ...deal, health: health.get(deal.id) ?? null })),
    total,
  };
}

export async function getDeal(workspaceId, id, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const deal = await prisma.deal.findFirst({
    where: { id, workspaceId, ...scope },
    include: {
      ...DEAL_INCLUDE,
      stageHistory: {
        orderBy: { changedAt: 'asc' },
        include: { changedByUser: { select: { id: true, name: true } } },
      },
    },
  });
  if (!deal) { const e = new Error('Deal not found'); e.status = 404; throw e; }
  return { ...deal, health: await computeDealHealth(workspaceId, id) };
}

export async function createDeal(workspaceId, body, userId) {
  const contact = await prisma.contact.findFirst({ where: { id: body.contactId, workspaceId }, select: { id: true } });
  if (!contact) { const e = new Error('Contact not found'); e.status = 404; throw e; }

  if (body.leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: body.leadId, workspaceId }, select: { id: true } });
    if (!lead) { const e = new Error('Lead not found'); e.status = 404; throw e; }
  }

  const stage = body.stage || 'QUALIFICATION';
  return prisma.$transaction(async (tx) => {
    const deal = await tx.deal.create({
      data: {
        workspaceId,
        contactId: body.contactId,
        leadId: body.leadId ?? null,
        title: body.title,
        value: body.value ?? null,
        currency: body.currency || 'INR',
        stage,
        ownerUserId: body.ownerUserId ?? null,
        expectedCloseDate: body.expectedCloseDate ?? null,
        closedAt: CLOSED_STAGES.includes(stage) ? new Date() : null,
      },
      include: DEAL_INCLUDE,
    });
    await tx.dealStageHistory.create({
      data: { workspaceId, dealId: deal.id, fromStage: null, toStage: stage, changedByUserId: userId ?? null },
    });
    return deal;
  });
}

// Stage is deliberately not updatable here — it moves only through
// updateDealStage(), which is what guarantees every move lands in the history.
export async function updateDeal(workspaceId, id, updates, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const deal = await prisma.deal.findFirst({ where: { id, workspaceId, ...scope }, select: { id: true, customFields: true } });
  if (!deal) { const e = new Error('Deal not found'); e.status = 404; throw e; }

  const data = { ...updates };
  const customFields = await validateCrmCustomFields(workspaceId, 'deal', updates.customFields, deal.customFields);
  if (customFields === undefined) delete data.customFields;
  else data.customFields = customFields;

  return prisma.deal.update({ where: { id }, data, include: DEAL_INCLUDE });
}

export async function deleteDeal(workspaceId, id, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const deal = await prisma.deal.findFirst({ where: { id, workspaceId, ...scope }, select: { id: true } });
  if (!deal) { const e = new Error('Deal not found'); e.status = 404; throw e; }
  await prisma.deal.delete({ where: { id } });
}

// One row of stage history per move, written in the same transaction as the
// move itself — the pipeline board's drag/drop is only auditable if a stage
// change can never be recorded without its history entry.
export async function updateDealStage(workspaceId, id, { stage, lostReason }, userId, user = null) {
  // Scope is resolved before the transaction: a member must not be able to
  // move a deal they cannot see.
  const scope = user ? await scopeFilter(workspaceId, user) : {};

  const updated = await prisma.$transaction(async (tx) => {
    const deal = await tx.deal.findFirst({ where: { id, workspaceId, ...scope } });
    if (!deal) { const e = new Error('Deal not found'); e.status = 404; throw e; }

    const updated = await tx.deal.update({
      where: { id },
      data: {
        stage,
        closedAt: CLOSED_STAGES.includes(stage) ? (deal.closedAt ?? new Date()) : null,
        lostReason: stage === 'CLOSED_LOST' ? (lostReason ?? deal.lostReason ?? null) : null,
      },
      include: DEAL_INCLUDE,
    });

    await tx.dealStageHistory.create({
      data: { workspaceId, dealId: id, fromStage: deal.stage, toStage: stage, changedByUserId: userId ?? null },
    });

    return { ...updated, previousStage: deal.stage };
  });

  // Rewarded on the outcome, not the activity: only entering CLOSED_WON pays,
  // and the dedupe key means re-closing the same deal cannot farm points.
  if (stage === 'CLOSED_WON' && updated.previousStage !== 'CLOSED_WON' && updated.ownerUserId) {
    awardXp(workspaceId, updated.ownerUserId, 'won_deal', { recordType: 'deal', recordId: id })
      .then(() => unlockAchievement(workspaceId, updated.ownerUserId, 'first_win'))
      .catch((e) => console.error('[Gamification] award failed:', e.message));
  }

  // Emitted after the transaction commits, so a workflow can never observe a
  // stage change that later rolled back.
  if (updated.previousStage !== stage) {
    emitCrmEvent(workspaceId, 'deal_stage_changed', {
      dealId: id,
      leadId: updated.leadId ?? null,
      contactId: updated.contactId,
      stage,
      previousStage: updated.previousStage,
    });
  }

  return updated;
}
