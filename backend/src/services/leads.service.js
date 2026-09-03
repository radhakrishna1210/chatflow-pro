import { prisma } from '../lib/prisma.js';
import { isValidPhone, normalizePhone } from './contacts.service.js';
import { computeLeadScore } from './leadScoring.service.js';
import { validateCrmCustomFields } from './customFields.service.js';
import { emitCrmEvent } from './workflowCrm.service.js';
import { scopeFilter } from './recordScope.service.js';
import { awardXp, unlockAchievement } from './gamification.service.js';

const LEAD_INCLUDE = {
  contact: { select: { id: true, name: true, phoneNumber: true, email: true, tags: true, optedOut: true } },
  owner: { select: { id: true, name: true, email: true } },
};

// `user` carries the caller's identity and role. Record visibility is applied
// here rather than in the controller so every path — list, get, and the
// exports that reuse them — is scoped by the same rule.
export async function listLeads(workspaceId, { status = '', ownerUserId = '', search = '', sort = 'score' } = {}, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const where = {
    workspaceId,
    ...scope,
    ...(status ? { status } : {}),
    ...(ownerUserId ? { ownerUserId } : {}),
    ...(search ? {
      contact: {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phoneNumber: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      },
    } : {}),
  };
  const orderBy = sort === 'newest' ? { createdAt: 'desc' } : [{ score: 'desc' }, { createdAt: 'desc' }];
  const [data, total] = await Promise.all([
    prisma.lead.findMany({ where, include: LEAD_INCLUDE, orderBy }),
    prisma.lead.count({ where }),
  ]);
  return { data, total };
}

export async function getLead(workspaceId, id, user = null) {
  // An out-of-scope lead returns the same 404 as a non-existent one. A 403
  // would confirm the record exists and let someone map a colleague's pipeline
  // by walking ids.
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const lead = await prisma.lead.findFirst({
    where: { id, workspaceId, ...scope },
    include: {
      ...LEAD_INCLUDE,
      deals: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!lead) { const e = new Error('Lead not found'); e.status = 404; throw e; }
  return lead;
}

// Accepts either an existing contactId, or name+phoneNumber to create the
// contact first. The contact is the single source of truth for identity — a
// lead never carries its own copy of name/phone.
export async function createLead(workspaceId, body) {
  let contactId = body.contactId;

  if (!contactId) {
    if (!isValidPhone(body.phoneNumber)) {
      const e = new Error('phoneNumber must contain 7–15 digits'); e.status = 400; throw e;
    }
    const phoneNumber = normalizePhone(body.phoneNumber);
    const existing = await prisma.contact.findFirst({ where: { workspaceId, phoneNumber } });
    contactId = existing
      ? existing.id
      : (await prisma.contact.create({
          data: { workspaceId, name: body.name || phoneNumber, phoneNumber, email: body.email || null, tags: [] },
        })).id;
  } else {
    const contact = await prisma.contact.findFirst({ where: { id: contactId, workspaceId }, select: { id: true } });
    if (!contact) { const e = new Error('Contact not found'); e.status = 404; throw e; }
  }

  const duplicate = await prisma.lead.findUnique({ where: { contactId }, select: { id: true } });
  if (duplicate) { const e = new Error('This contact is already a lead'); e.status = 409; throw e; }

  const { score, factors, computedAt } = await computeLeadScore(workspaceId, contactId);

  const lead = await prisma.lead.create({
    data: {
      workspaceId,
      contactId,
      source: body.source ?? null,
      ownerUserId: body.ownerUserId ?? null,
      notes: body.notes ?? null,
      score,
      scoreFactors: factors,
      scoreComputedAt: computedAt,
    },
    include: LEAD_INCLUDE,
  });

  // Fire-and-forget: an automation must never delay or fail the write that
  // triggered it.
  emitCrmEvent(workspaceId, 'lead_created', { leadId: lead.id, contactId, score });
  return lead;
}

// `updates` arrives pre-whitelisted by the strict update validator, so
// workspaceId/score/convertedDealId cannot be mass-assigned.
export async function updateLead(workspaceId, id, updates, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const lead = await prisma.lead.findFirst({ where: { id, workspaceId, ...scope }, select: { id: true, status: true, customFields: true } });
  if (!lead) { const e = new Error('Lead not found'); e.status = 404; throw e; }

  const data = { ...updates };
  // Custom fields are validated against the workspace's definitions and merged
  // over what is already stored, so a partial update cannot wipe the rest.
  const customFields = await validateCrmCustomFields(workspaceId, 'lead', updates.customFields, lead.customFields);
  if (customFields === undefined) delete data.customFields;
  else data.customFields = customFields;

  const updated = await prisma.lead.update({ where: { id }, data, include: LEAD_INCLUDE });

  if (updates.status === 'QUALIFIED' && lead.status !== 'QUALIFIED' && updated.ownerUserId) {
    awardXp(workspaceId, updated.ownerUserId, 'qualified_lead', { recordType: 'lead', recordId: id })
      .then(() => unlockAchievement(workspaceId, updated.ownerUserId, 'first_qualified'))
      .catch((e) => console.error('[Gamification] award failed:', e.message));
  }

  if (updates.status && updates.status !== lead.status) {
    emitCrmEvent(workspaceId, 'lead_status_changed', {
      leadId: id, contactId: updated.contactId, status: updates.status, previousStatus: lead.status,
    });
  }
  return updated;
}

export async function deleteLead(workspaceId, id, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const lead = await prisma.lead.findFirst({ where: { id, workspaceId, ...scope }, select: { id: true } });
  if (!lead) { const e = new Error('Lead not found'); e.status = 404; throw e; }
  await prisma.lead.delete({ where: { id } });
}

export async function recalculateScore(workspaceId, id, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const lead = await prisma.lead.findFirst({ where: { id, workspaceId, ...scope }, select: { id: true, contactId: true, score: true } });
  if (!lead) { const e = new Error('Lead not found'); e.status = 404; throw e; }
  const { score, factors, computedAt } = await computeLeadScore(workspaceId, lead.contactId);

  const updated = await prisma.lead.update({
    where: { id },
    data: { score, scoreFactors: factors, scoreComputedAt: computedAt },
    include: LEAD_INCLUDE,
  });

  // The previous score travels with the event so a threshold trigger fires on
  // the crossing rather than on every rescore above the line.
  if (score !== lead.score) {
    emitCrmEvent(workspaceId, 'lead_score_changed', {
      leadId: id, contactId: lead.contactId, score, previousScore: lead.score,
    });
  }
  return updated;
}

// Transactional by design: a conversion that created a Deal but failed to mark
// the Lead converted would let the same lead be converted twice.
export async function convertLead(workspaceId, id, body, userId) {
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findFirst({ where: { id, workspaceId } });
    if (!lead) { const e = new Error('Lead not found'); e.status = 404; throw e; }
    if (lead.status === 'CONVERTED' || lead.convertedDealId) {
      const e = new Error('Lead has already been converted'); e.status = 409; throw e;
    }

    const stage = body.stage || 'QUALIFICATION';
    const deal = await tx.deal.create({
      data: {
        workspaceId,
        leadId: lead.id,
        contactId: lead.contactId,
        title: body.title,
        value: body.value ?? null,
        currency: body.currency || 'INR',
        stage,
        ownerUserId: body.ownerUserId ?? lead.ownerUserId ?? null,
        expectedCloseDate: body.expectedCloseDate ?? null,
      },
    });

    await tx.dealStageHistory.create({
      data: { workspaceId, dealId: deal.id, fromStage: null, toStage: stage, changedByUserId: userId ?? null },
    });

    await tx.lead.update({
      where: { id: lead.id },
      data: { status: 'CONVERTED', convertedAt: new Date(), convertedDealId: deal.id },
    });

    return deal;
  });
}
