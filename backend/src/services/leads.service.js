import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { listWindow } from '../lib/paging.js';
import { resolveContactPhone, findContactByPhone } from './contacts.service.js';
import { computeLeadScore } from './leadScoring.service.js';
import { computeLeadCategory } from './leadSegmentation.service.js';
import { validateCrmCustomFields } from './customFields.service.js';
import { emitCrmEvent, emitCrmEvents } from './crmEvents.service.js';
import { scopeFilter, withScope } from './recordScope.service.js';
import { assertRecordReferences } from './crmReferences.js';
import { awardXp, unlockAchievement, earnsQualifiedLead } from './gamification.service.js';
import { evaluateAndAssignLead } from './leadDistribution.service.js';
import {
  PRISMA_LEAD_STATUSES, evaluateProspectingCriteria, loadLeadIntakeRules, prepareLeadIntake,
  leadStatusWrite, resolveLeadSource, resolveLeadTags, assertRequiredFields,
} from './leadIntake.service.js';
import { assertKnownStage } from './pipelineStages.service.js';
import { assertContactCapacity } from './subscription.service.js';

// Lifecycle, sources, tags and prospecting rules live in leadIntake.service.js
// so every intake path applies the same ones; re-exported for existing callers.
export { PRISMA_LEAD_STATUSES, evaluateProspectingCriteria };

const LEAD_INCLUDE = {
  contact: { select: { id: true, name: true, phoneNumber: true, email: true, tags: true, optedOut: true } },
  owner: { select: { id: true, name: true, email: true } },
};

// `user` carries the caller's identity and role. Record visibility is applied
// here rather than in the controller so every path — list, get, and the
// exports that reuse them — is scoped by the same rule.
export async function listLeads(workspaceId, { category = '', status = '', source = '', tag = '', ownerUserId = '', search = '', sort = 'score', preset = '', awaitingTask = false, uncontacted = false, limit, offset } = {}, user = null) {
  // Optional paging; the default covers a normal workspace's whole list (CF-048).
  const { take, skip } = listWindow({ limit, offset });
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const filters = {
    workspaceId,
    ...(category ? { category } : {}),
    ...(ownerUserId ? { ownerUserId } : {}),
    ...(source ? { source } : {}),
    ...(tag ? { contact: { tags: { has: tag } } } : {}),
    ...(search && String(search).trim() ? {
      contact: {
        OR: (() => {
          const q = String(search).trim();
          const tokens = q.split(/\s+/).filter(Boolean);
          const digits = q.replace(/\D/g, '');
          const conditions = [
            { name: { contains: q, mode: 'insensitive' } },
            { phoneNumber: { contains: q } },
            { email: { contains: q, mode: 'insensitive' } },
          ];
          for (const token of tokens) {
            conditions.push({ name: { contains: token, mode: 'insensitive' } });
            conditions.push({ email: { contains: token, mode: 'insensitive' } });
          }
          if (digits.length >= 3) {
            conditions.push({ phoneNumber: { contains: digits } });
          }
          return conditions;
        })(),
      },
    } : {}),
  };

  if (status) {
    if (PRISMA_LEAD_STATUSES.has(status)) {
      filters.OR = [
        { status, customFields: { equals: null } },
        { customFields: { path: ['statusKey'], equals: status } },
        { status, customFields: { path: ['statusKey'], equals: null } },
      ];
    } else {
      filters.customFields = { path: ['statusKey'], equals: status };
    }
  }

  if (preset === 'my' && user?.id) {
    filters.ownerUserId = user.id;
  } else if (preset === 'hot') {
    filters.category = 'HOT';
  } else if (preset === 'warm') {
    filters.category = 'WARM';
  } else if (preset === 'cold') {
    filters.category = 'COLD';
  } else if (preset === 'awaiting_task' || awaitingTask) {
    filters.tasks = { none: { status: 'PENDING' } };
  } else if (preset === 'uncontacted' || uncontacted) {
    filters.crmActivities = { none: {} };
  } else if (preset === 'opted_out') {
    filters.contact = { ...(filters.contact || {}), optedOut: true };
  }

  // Scope goes in last and under AND: the status filter above sets `OR`,
  // which used to overwrite the scope fragment and list every lead.
  const where = withScope(filters, scope);

  const orderBy = sort === 'newest'
    ? [{ createdAt: 'desc' }, { id: 'desc' }]
    : [{ score: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }];
  const [data, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: {
        ...LEAD_INCLUDE,
        tasks: {
          where: { status: 'PENDING' },
          orderBy: { dueDate: 'asc' },
          take: 1,
          select: { id: true, title: true, dueDate: true, status: true },
        },
        crmActivities: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, type: true, createdAt: true, content: true },
        },
        _count: {
          select: { tasks: true, crmActivities: true, deals: true },
        },
      },
      orderBy,
      skip,
      take,
    }),
    prisma.lead.count({ where }),
  ]);
  return {
    data: data.map((l) => ({
      ...l,
      status: l.customFields?.statusKey || l.status,
    })),
    total,
    limit: take,
    offset: skip,
  };
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
      tasks: { orderBy: { dueDate: 'asc' } },
      crmActivities: {
        include: { createdByUser: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      },
      LeadFormSubmission: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, answers: true, createdAt: true, form: { select: { name: true, slug: true } } },
      },
    },
  });
  if (!lead) { const e = new Error('Lead not found'); e.status = 404; throw e; }
  return { ...lead, status: lead.customFields?.statusKey || lead.status };
}

// Accepts either an existing contactId, or name+phoneNumber to create the
// contact first. The contact is the single source of truth for identity — a
// lead never carries its own copy of name/phone.
//
// Lifecycle, source, tags and prospecting rules are applied by
// prepareLeadIntake in strict mode: someone is filling in the form, so a value
// outside the workspace configuration is a 400 they can correct.
export async function createLead(workspaceId, body, actorUserId = null) {
  let contactId = body.contactId;
  await assertRecordReferences(workspaceId, { ownerUserId: body.ownerUserId });
  const rules = await loadLeadIntakeRules(workspaceId);

  let contact = null;
  if (contactId) {
    contact = await prisma.contact.findFirst({ where: { id: contactId, workspaceId }, select: { id: true, email: true, phoneNumber: true, tags: true } });
    if (!contact) { const e = new Error('Contact not found'); e.status = 404; throw e; }
  }

  const prospecting = body.prospecting || {};
  const intake = prepareLeadIntake(rules, {
    status: body.status,
    source: body.source,
    tags: body.tags,
    existingTags: contact?.tags,
    phone: contact?.phoneNumber || body.phoneNumber,
    email: body.email || contact?.email,
    company: body.company ?? prospecting.company ?? null,
    budget: body.budget ?? prospecting.budget ?? null,
    companySize: body.companySize ?? prospecting.companySize ?? null,
    industry: body.industry ?? prospecting.industry ?? null,
    answers: body.checklistAnswers ?? body.qualificationAnswers ?? prospecting.answers ?? {},
    customFields: body.customFields,
  }, { strict: true });

  let tags;
  if (!contact) {
    const { phoneNumber, country } = await resolveContactPhone(workspaceId, body.phoneNumber);
    const existing = await findContactByPhone(workspaceId, phoneNumber, { country });
    if (existing) {
      contactId = existing.id;
      tags = await mergeContactTags(existing, intake.tags);
    } else {
      await assertContactCapacity(workspaceId);
      tags = intake.tags;
      contactId = (await prisma.contact.create({
        data: { workspaceId, name: body.name || phoneNumber, phoneNumber, email: body.email || null, tags },
      })).id;
    }
  } else {
    tags = await mergeContactTags(contact, intake.tags);
  }

  const duplicate = await prisma.lead.findUnique({ where: { contactId }, select: { id: true } });
  if (duplicate) { const e = new Error('This contact is already a lead'); e.status = 409; throw e; }

  const { score, factors, computedAt } = await computeLeadScore(workspaceId, contactId);

  const lead = await prisma.lead.create({
    data: {
      workspaceId,
      contactId,
      status: intake.status,
      source: intake.source,
      ownerUserId: body.ownerUserId ?? null,
      notes: body.notes ?? null,
      customFields: Object.keys(intake.customFields).length > 0 ? intake.customFields : null,
      score,
      scoreFactors: factors,
      scoreComputedAt: computedAt,
    },
    include: LEAD_INCLUDE,
  });

  // Compute automatic lead category (HOT / WARM / COLD)
  const categorizedLead = await computeLeadCategory(workspaceId, lead.id).catch(() => lead);

  // If not assigned explicitly, run automatic lead distribution rules
  if (!lead.ownerUserId) {
    const distResult = await evaluateAndAssignLead(workspaceId, lead.id).catch((err) => { console.warn(`[Leads] Lead distribution failed for ${lead.id}:`, err.message); return null; });
    if (distResult?.assigned) {
      categorizedLead.ownerUserId = distResult.ownerUserId;
      categorizedLead.owner = { id: distResult.ownerUserId, name: distResult.ownerName, email: '' };
    }
  }

  // Fire-and-forget: an automation must never delay or fail the write that
  // triggered it.
  emitCrmEvent(workspaceId, 'lead_created', { leadId: lead.id, contactId, score });
  if (actorUserId) {
    unlockAchievement(workspaceId, actorUserId, 'first_lead')
      .catch((e) => console.error('[Gamification] achievement failed:', e.message));
  }
  return {
    ...categorizedLead,
    contact: { ...lead.contact, ...categorizedLead.contact, tags },
    customFields: lead.customFields,
    status: lead.customFields?.statusKey || categorizedLead.status,
  };
}

// New lead tags are added to the contact's own; replacing them would wipe tags
// set from Contacts, segments or automations.
async function mergeContactTags(contact, tags) {
  const current = contact.tags || [];
  const merged = [...new Set([...current, ...tags])];
  if (merged.length !== current.length) {
    await prisma.contact.update({ where: { id: contact.id }, data: { tags: merged } });
  }
  return merged;
}

// `updates` arrives pre-whitelisted by the strict update validator, so
// workspaceId/score/convertedDealId cannot be mass-assigned. Status, source,
// tags and company go through the same workspace rules as createLead.
export async function updateLead(workspaceId, id, updates, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const lead = await prisma.lead.findFirst({
    where: { id, workspaceId, ...scope },
    select: { id: true, status: true, customFields: true, contactId: true, ownerUserId: true, createdAt: true },
  });
  if (!lead) { const e = new Error('Lead not found'); e.status = 404; throw e; }
  await assertRecordReferences(workspaceId, { ownerUserId: updates.ownerUserId });

  const touchesProspecting = updates.prospecting || updates.budget !== undefined || updates.companySize !== undefined
    || updates.industry !== undefined || updates.company !== undefined || updates.qualificationAnswers || updates.checklistAnswers;
  const touchesRules = touchesProspecting || updates.status || updates.source !== undefined || Array.isArray(updates.tags);
  const rules = touchesRules ? await loadLeadIntakeRules(workspaceId) : null;

  // Tags live on the Contact. The edit sends the full list; only tags the
  // contact does not already carry are checked against Lead Tags.
  if (Array.isArray(updates.tags)) {
    const contact = await prisma.contact.findFirst({ where: { id: lead.contactId, workspaceId }, select: { tags: true } });
    const { tags } = resolveLeadTags(rules, updates.tags, { strict: true, existing: contact?.tags });
    await prisma.contact.update({
      where: { id: lead.contactId },
      data: { tags },
    });
  }

  const data = { ...updates };
  delete data.tags;
  delete data.prospecting;
  delete data.budget;
  delete data.companySize;
  delete data.industry;
  // Lead has no company column; it is kept with the prospecting details.
  delete data.company;
  delete data.qualificationAnswers;
  delete data.checklistAnswers;

  if (updates.source !== undefined) {
    data.source = resolveLeadSource(rules, updates.source, { strict: true }).source;
  }

  // Custom fields handling
  let customFields = await validateCrmCustomFields(workspaceId, 'lead', updates.customFields, lead.customFields);
  if (customFields === undefined) {
    customFields = typeof lead.customFields === 'object' && lead.customFields !== null ? { ...lead.customFields } : {};
  } else {
    customFields = typeof customFields === 'object' && customFields !== null ? { ...customFields } : {};
  }

  // Lifecycle status: a configured stage, stored in the enum or as statusKey.
  if (updates.status) {
    const { data: statusData } = leadStatusWrite(rules, updates.status, customFields, { strict: true });
    data.status = statusData.status;
    customFields = statusData.customFields || {};
  }

  // Handle Prospecting evaluation on update
  if (touchesProspecting) {
    const existingProspecting = customFields.prospecting || {};
    const pick = (key) => (updates[key] !== undefined ? updates[key]
      : (updates.prospecting?.[key] !== undefined ? updates.prospecting[key] : existingProspecting[key]));
    const prospectingInfo = {
      budget: pick('budget'),
      companySize: pick('companySize'),
      industry: pick('industry'),
      company: pick('company') ?? null,
      answers: updates.checklistAnswers || updates.qualificationAnswers || updates.prospecting?.answers || existingProspecting.answers || {},
    };
    // A company the prospecting criteria require cannot be cleared by an edit.
    if (updates.company !== undefined || updates.prospecting?.company !== undefined) {
      assertRequiredFields({ criteria: { requireCompany: rules?.criteria?.requireCompany } }, { company: prospectingInfo.company });
    }
    customFields.prospecting = prospectingInfo;
    customFields.qualification = evaluateProspectingCriteria(rules?.criteria, prospectingInfo);
  }

  data.customFields = Object.keys(customFields).length > 0 ? customFields : null;

  const updated = await prisma.lead.update({ where: { id }, data, include: LEAD_INCLUDE });

  const effectiveStatus = updated.customFields?.statusKey || updated.status;
  const previousEffectiveStatus = lead.customFields?.statusKey || lead.status;

  if (effectiveStatus === 'QUALIFIED' && previousEffectiveStatus !== 'QUALIFIED' && updated.ownerUserId && earnsQualifiedLead(lead)) {
    awardXp(workspaceId, updated.ownerUserId, 'qualified_lead', { recordType: 'lead', recordId: id })
      .then(() => unlockAchievement(workspaceId, updated.ownerUserId, 'first_qualified'))
      .catch((e) => console.error('[Gamification] award failed:', e.message));
  }

  if (effectiveStatus !== previousEffectiveStatus) {
    emitCrmEvent(workspaceId, 'lead_status_changed', {
      leadId: id, contactId: updated.contactId, status: effectiveStatus, previousStatus: previousEffectiveStatus,
    });
  }
  return {
    ...updated,
    status: effectiveStatus,
  };
}

export async function deleteLead(workspaceId, id, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const lead = await prisma.lead.findFirst({ where: { id, workspaceId, ...scope }, select: { id: true, contactId: true } });
  if (!lead) { const e = new Error('Lead not found'); e.status = 404; throw e; }
  await prisma.lead.delete({ where: { id } });
  emitCrmEvent(workspaceId, 'lead_deleted', { leadId: id, contactId: lead.contactId });
}

export async function deleteLeads(workspaceId, ids = [], user = null) {
  if (!Array.isArray(ids) || ids.length === 0) {
    const e = new Error('At least one lead ID is required'); e.status = 400; throw e;
  }
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const leads = await prisma.lead.findMany({
    where: { id: { in: ids }, workspaceId, ...scope },
    select: { id: true, contactId: true },
  });
  if (leads.length === 0) {
    return { count: 0 };
  }
  const leadIds = leads.map(l => l.id);
  const result = await prisma.lead.deleteMany({
    where: { id: { in: leadIds }, workspaceId },
  });
  for (const l of leads) {
    emitCrmEvent(workspaceId, 'lead_deleted', { leadId: l.id, contactId: l.contactId });
  }
  return { count: result.count };
}

export async function recalculateScore(workspaceId, id, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const lead = await prisma.lead.findFirst({ where: { id, workspaceId, ...scope }, select: { id: true } });
  if (!lead) { const e = new Error('Lead not found'); e.status = 404; throw e; }
  // Rescores, recategorises and — when the score moved — raises
  // lead_score_changed with the previous score, so a threshold trigger fires
  // on the crossing rather than on every rescore above the line.
  return computeLeadCategory(workspaceId, id);
}

// Transactional by design: a conversion that created a Deal but failed to mark
// the Lead converted would let the same lead be converted twice.
//
// The lead is claimed with a conditional update before the deal is created:
// two concurrent converts (a double click, the UI racing a workflow) used to
// both pass a plain "already converted?" read and create two deals. The second
// now blocks on the row, re-checks the condition and matches nothing.
export async function convertLead(workspaceId, id, body, userId, user = null) {
  await assertKnownStage(workspaceId, body.stage || 'QUALIFICATION');
  await assertRecordReferences(workspaceId, { ownerUserId: body.ownerUserId });
  const scope = user ? await scopeFilter(workspaceId, user) : {};

  const { deal: converted, lead: original } = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findFirst({ where: withScope({ id, workspaceId }, scope) });
    if (!lead) { const e = new Error('Lead not found'); e.status = 404; throw e; }

    const claim = { status: 'CONVERTED', convertedAt: new Date() };
    // A custom lifecycle key would otherwise keep overriding CONVERTED as the
    // lead's effective status.
    if (lead.customFields?.statusKey) {
      const { statusKey, ...rest } = lead.customFields;
      claim.customFields = Object.keys(rest).length > 0 ? rest : Prisma.DbNull;
    }
    const claimed = await tx.lead.updateMany({
      where: { id: lead.id, workspaceId, convertedDealId: null, status: { not: 'CONVERTED' } },
      data: claim,
    });
    if (claimed.count === 0) {
      const e = new Error('Lead has already been converted'); e.status = 409; throw e;
    }

    const stage = body.stage || 'QUALIFICATION';
    const isCustomStage = !['QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'].includes(stage);
    const dbStage = isCustomStage ? 'QUALIFICATION' : stage;
    const customFields = isCustomStage ? { stageKey: stage } : {};

    const deal = await tx.deal.create({
      data: {
        workspaceId,
        leadId: lead.id,
        contactId: lead.contactId,
        title: body.title,
        value: body.value ?? null,
        currency: body.currency || 'INR',
        stage: dbStage,
        customFields,
        ownerUserId: body.ownerUserId ?? lead.ownerUserId ?? null,
        expectedCloseDate: body.expectedCloseDate ?? null,
      },
    });

    const toStageDb = ['QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'].includes(stage) ? stage : 'QUALIFICATION';
    await tx.dealStageHistory.create({
      data: {
        workspaceId,
        dealId: deal.id,
        fromStage: null,
        toStage: toStageDb,
        fromStageKey: null,
        toStageKey: stage,
        changedByUserId: userId ?? null,
      },
    });

    await tx.lead.update({ where: { id: lead.id }, data: { convertedDealId: deal.id } });

    return { deal: { ...deal, stage }, lead };
  });

  emitCrmEvent(workspaceId, 'lead_status_changed', {
    leadId: original.id,
    contactId: original.contactId,
    status: 'CONVERTED',
    previousStatus: original.customFields?.statusKey || original.status,
  });
  // The deal starts life in a stage, which is a stage change as far as a
  // "deal enters stage" workflow is concerned.
  emitCrmEvent(workspaceId, 'deal_stage_changed', {
    dealId: converted.id,
    leadId: original.id,
    contactId: original.contactId,
    stage: converted.stage,
    previousStage: null,
  });
  return converted;
}

export async function bulkAssignLeads(workspaceId, ids = [], ownerUserId = null, user = null) {
  if (!Array.isArray(ids) || ids.length === 0) {
    const e = new Error('At least one lead ID is required'); e.status = 400; throw e;
  }
  await assertRecordReferences(workspaceId, { ownerUserId });
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const res = await prisma.lead.updateMany({
    where: { id: { in: ids }, workspaceId, ...scope },
    data: { ownerUserId: ownerUserId || null },
  });
  return { count: res.count };
}

// Custom lifecycle keys live in customFields.statusKey (the DB enum only knows
// the built-ins), so each lead is written individually the same way updateLead
// does it rather than with one updateMany. The status must be a lifecycle stage.
export async function bulkUpdateStatus(workspaceId, ids = [], status, user = null) {
  if (!Array.isArray(ids) || ids.length === 0 || !status) {
    const e = new Error('Lead IDs and status are required'); e.status = 400; throw e;
  }
  const rules = await loadLeadIntakeRules(workspaceId);
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const leads = await prisma.lead.findMany({
    where: { id: { in: ids }, workspaceId, ...scope },
    select: { id: true, status: true, customFields: true, contactId: true },
  });
  const changed = [];
  const writes = [];
  for (const lead of leads) {
    const previousStatus = lead.customFields?.statusKey || lead.status;
    const { resolved, data } = leadStatusWrite(rules, status, lead.customFields, { strict: true });
    writes.push(prisma.lead.update({ where: { id: lead.id }, data }));
    if (previousStatus !== resolved.key) changed.push({ lead, previousStatus, status: resolved.key });
  }
  if (writes.length) await prisma.$transaction(writes);
  // One event batch: the workspace's CRM workflows are looked up once and only
  // leads a workflow listens for go on, a few at a time. One fire-and-forget
  // look-up per lead exhausted the connection pool on a large selection.
  emitCrmEvents(workspaceId, 'lead_status_changed', changed.map(({ lead, previousStatus, status: next }) => ({
    leadId: lead.id, contactId: lead.contactId, status: next, previousStatus,
  })));
  return { count: leads.length };
}

export async function bulkUpdateCategory(workspaceId, ids = [], category, user = null) {
  if (!Array.isArray(ids) || ids.length === 0 || !category) {
    const e = new Error('Lead IDs and category are required'); e.status = 400; throw e;
  }
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const res = await prisma.lead.updateMany({
    where: { id: { in: ids }, workspaceId, ...scope },
    data: { category },
  });
  return { count: res.count };
}

// Task has no priority column; the chosen priority is kept in the description,
// the same way stage-transition auto-tasks record theirs.
export async function bulkCreateTask(workspaceId, ids = [], { title, dueDate = null, priority = null } = {}, user = null) {
  if (!Array.isArray(ids) || ids.length === 0 || !title) {
    const e = new Error('Lead IDs and task title are required'); e.status = 400; throw e;
  }
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const leads = await prisma.lead.findMany({
    where: { id: { in: ids }, workspaceId, ...scope },
    select: { id: true, contactId: true, ownerUserId: true },
  });
  if (leads.length === 0) return { count: 0 };
  const res = await prisma.task.createMany({
    data: leads.map((l) => ({
      workspaceId,
      title,
      description: priority ? `[Priority: ${priority}]` : null,
      dueDate: dueDate ? new Date(dueDate) : null,
      leadId: l.id,
      contactId: l.contactId,
      assignedToUserId: l.ownerUserId || user?.id || null,
    })),
  });
  return { count: res.count };
}
