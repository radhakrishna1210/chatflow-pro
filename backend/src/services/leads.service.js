import { prisma } from '../lib/prisma.js';
import { isValidPhone, normalizePhone } from './contacts.service.js';
import { computeLeadScore } from './leadScoring.service.js';
import { computeLeadCategory } from './leadSegmentation.service.js';
import { validateCrmCustomFields } from './customFields.service.js';
import { emitCrmEvent } from './workflowCrm.service.js';
import { scopeFilter } from './recordScope.service.js';
import { awardXp, unlockAchievement } from './gamification.service.js';
import { evaluateAndAssignLead } from './leadDistribution.service.js';
import { getSection } from './crmCustomization.service.js';

export const PRISMA_LEAD_STATUSES = new Set(['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED', 'LOST']);

/**
 * Pure evaluator for prospecting qualification criteria against lead attributes.
 */
export function evaluateProspectingCriteria(criteriaConfig, info = {}) {
  const {
    budget = null,
    companySize = null,
    industry = '',
    answers = {},
  } = info;

  const checks = [];
  let score = 0;
  let maxScore = 0;
  let allRequiredPassed = true;

  // 1. Budget check
  if (criteriaConfig?.minBudget != null && Number(criteriaConfig.minBudget) > 0) {
    maxScore += 25;
    const min = Number(criteriaConfig.minBudget);
    const leadBudget = budget != null && budget !== '' ? Number(budget) : null;
    const passed = leadBudget !== null && leadBudget >= min;
    if (!passed) allRequiredPassed = false;
    else score += 25;
    checks.push({
      key: 'minBudget',
      label: `Minimum Budget (${criteriaConfig.currency || 'USD'} ${min})`,
      required: true,
      passed,
      value: leadBudget != null ? `${criteriaConfig.currency || 'USD'} ${leadBudget}` : 'Not provided',
    });
  }

  // 2. Company size check
  if (criteriaConfig?.companySizeMin != null && Number(criteriaConfig.companySizeMin) > 0) {
    maxScore += 20;
    const min = Number(criteriaConfig.companySizeMin);
    const leadSize = companySize != null && companySize !== '' ? Number(companySize) : null;
    const passed = leadSize !== null && leadSize >= min;
    if (!passed) allRequiredPassed = false;
    else score += 20;
    checks.push({
      key: 'companySizeMin',
      label: `Minimum Company Size (${min} employees)`,
      required: true,
      passed,
      value: leadSize != null ? `${leadSize} employees` : 'Not provided',
    });
  }

  // 3. Target industries check
  if (Array.isArray(criteriaConfig?.targetIndustries) && criteriaConfig.targetIndustries.length > 0) {
    maxScore += 15;
    const leadInd = String(industry || '').trim().toLowerCase();
    const passed = Boolean(leadInd) && criteriaConfig.targetIndustries.some(
      (ti) => ti.toLowerCase() === leadInd || leadInd.includes(ti.toLowerCase()) || ti.toLowerCase().includes(leadInd)
    );
    if (passed) score += 15;
    checks.push({
      key: 'targetIndustries',
      label: 'Target Industry Match',
      required: false,
      passed,
      value: industry || 'Not specified',
    });
  }

  // 4. Checklist questions
  if (Array.isArray(criteriaConfig?.checklist) && criteriaConfig.checklist.length > 0) {
    for (const item of criteriaConfig.checklist) {
      const weight = Number(item.weight) || 10;
      maxScore += weight;
      const ans = Boolean(answers[item.id] ?? answers[item.question]);
      if (ans) {
        score += weight;
      } else if (item.required) {
        allRequiredPassed = false;
      }
      checks.push({
        key: item.id,
        label: item.question,
        required: Boolean(item.required),
        passed: ans,
        weight,
      });
    }
  }

  const finalScore = maxScore > 0 ? Math.round((score / maxScore) * 100) : 100;
  const isQualified = allRequiredPassed && (maxScore === 0 || finalScore >= 50);

  const criteriaChecks = {
    budget: checks.find((c) => c.key === 'minBudget')?.passed ?? true,
    companySize: checks.find((c) => c.key === 'companySizeMin')?.passed ?? true,
    industry: checks.find((c) => c.key === 'targetIndustries')?.passed ?? true,
  };

  return {
    score: finalScore,
    isQualified,
    status: isQualified ? 'QUALIFIED' : 'DISQUALIFIED',
    checks,
    criteriaChecks,
    evaluatedAt: new Date(),
  };
}

const LEAD_INCLUDE = {
  contact: { select: { id: true, name: true, phoneNumber: true, email: true, tags: true, optedOut: true } },
  owner: { select: { id: true, name: true, email: true } },
};

// `user` carries the caller's identity and role. Record visibility is applied
// here rather than in the controller so every path — list, get, and the
// exports that reuse them — is scoped by the same rule.
export async function listLeads(workspaceId, { category = '', status = '', source = '', tag = '', ownerUserId = '', search = '', sort = 'score', preset = '', awaitingTask = false, uncontacted = false } = {}, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const where = {
    workspaceId,
    ...scope,
    ...(category ? { category } : {}),
    ...(ownerUserId ? { ownerUserId } : {}),
    ...(source ? { source } : {}),
    ...(tag ? { contact: { tags: { has: tag } } } : {}),
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

  if (status) {
    if (PRISMA_LEAD_STATUSES.has(status)) {
      where.OR = [
        { status, customFields: { equals: null } },
        { customFields: { path: ['statusKey'], equals: status } },
        { status, customFields: { path: ['statusKey'], equals: null } },
      ];
    } else {
      where.customFields = { path: ['statusKey'], equals: status };
    }
  }

  if (preset === 'my' && user?.id) {
    where.ownerUserId = user.id;
  } else if (preset === 'hot') {
    where.category = 'HOT';
  } else if (preset === 'warm') {
    where.category = 'WARM';
  } else if (preset === 'cold') {
    where.category = 'COLD';
  } else if (preset === 'awaiting_task' || awaitingTask) {
    where.tasks = { none: { status: 'PENDING' } };
  } else if (preset === 'uncontacted' || uncontacted) {
    where.crmActivities = { none: {} };
  } else if (preset === 'opted_out') {
    where.contact = { ...(where.contact || {}), optedOut: true };
  }

  const orderBy = sort === 'newest' ? { createdAt: 'desc' } : [{ score: 'desc' }, { createdAt: 'desc' }];
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
    }),
    prisma.lead.count({ where }),
  ]);
  return {
    data: data.map((l) => ({
      ...l,
      status: l.customFields?.statusKey || l.status,
    })),
    total,
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
export async function createLead(workspaceId, body) {
  let contactId = body.contactId;

  // 1. Prospecting criteria validation
  const criteriaConfig = await getSection(workspaceId, 'prospecting_criteria').catch(() => null);
  if (criteriaConfig?.requirePhone && !body.phoneNumber && !contactId) {
    const e = new Error('Phone number is required based on workspace prospecting criteria.');
    e.status = 400;
    throw e;
  }
  if (criteriaConfig?.requireEmail && !body.email && !contactId) {
    const e = new Error('Email is required based on workspace prospecting criteria.');
    e.status = 400;
    throw e;
  }
  if (criteriaConfig?.requireCompany && !body.company && !body.prospecting?.company) {
    const e = new Error('Company is required based on workspace prospecting criteria.');
    e.status = 400;
    throw e;
  }

  const initialTags = Array.isArray(body.tags) ? body.tags : [];

  if (!contactId) {
    if (!isValidPhone(body.phoneNumber)) {
      const e = new Error('phoneNumber must contain 7–15 digits'); e.status = 400; throw e;
    }
    const phoneNumber = normalizePhone(body.phoneNumber);
    const existing = await prisma.contact.findFirst({ where: { workspaceId, phoneNumber } });
    contactId = existing
      ? existing.id
      : (await prisma.contact.create({
          data: {
            workspaceId,
            name: body.name || phoneNumber,
            phoneNumber,
            email: body.email || null,
            tags: initialTags,
          },
        })).id;
  } else {
    const contact = await prisma.contact.findFirst({ where: { id: contactId, workspaceId }, select: { id: true, email: true, phoneNumber: true } });
    if (!contact) { const e = new Error('Contact not found'); e.status = 404; throw e; }
    if (criteriaConfig?.requireEmail && !contact.email && !body.email) {
      const e = new Error('Email is required based on workspace prospecting criteria.');
      e.status = 400;
      throw e;
    }
    if (initialTags.length > 0) {
      await prisma.contact.update({
        where: { id: contactId },
        data: { tags: initialTags },
      });
    }
  }

  const duplicate = await prisma.lead.findUnique({ where: { contactId }, select: { id: true } });
  if (duplicate) { const e = new Error('This contact is already a lead'); e.status = 409; throw e; }

  // 2. Lead Source validation
  let canonicalSource = body.source ?? null;
  if (canonicalSource) {
    const sourceConfig = await getSection(workspaceId, 'lead_sources').catch(() => null);
    const configuredSources = sourceConfig?.sources || [];
    if (configuredSources.length > 0) {
      const matched = configuredSources.find(
        (s) => s.key === canonicalSource || s.name?.toLowerCase() === canonicalSource.toLowerCase() || s.key?.toLowerCase() === canonicalSource.toLowerCase()
      );
      if (matched) {
        if (matched.isActive === false) {
          const e = new Error(`Lead source "${matched.name || canonicalSource}" is disabled and cannot be selected.`);
          e.status = 400;
          throw e;
        }
        canonicalSource = matched.key;
      } else {
        const e = new Error(`Invalid lead source "${canonicalSource}". Please select from configured lead sources.`);
        e.status = 400;
        throw e;
      }
    }
  }

  // 3. Status & Custom Lifecycle resolution
  const lifecycleConfig = await getSection(workspaceId, 'lead_lifecycle').catch(() => null);
  const defaultStageKey = lifecycleConfig?.stages?.find((s) => s.isDefault)?.key || 'NEW';
  const requestedStatus = body.status || defaultStageKey;
  const isPrismaStatus = PRISMA_LEAD_STATUSES.has(requestedStatus);
  const dbStatus = isPrismaStatus ? requestedStatus : 'NEW';

  // 4. Prospecting Criteria evaluation
  let customFields = typeof body.customFields === 'object' && body.customFields !== null ? { ...body.customFields } : {};
  if (!isPrismaStatus) {
    customFields.statusKey = requestedStatus;
  }

  const prospectingInfo = {
    budget: body.budget ?? body.prospecting?.budget ?? null,
    companySize: body.companySize ?? body.prospecting?.companySize ?? null,
    industry: body.industry ?? body.prospecting?.industry ?? null,
    answers: body.checklistAnswers ?? body.qualificationAnswers ?? body.prospecting?.answers ?? {},
  };
  const qualResult = evaluateProspectingCriteria(criteriaConfig, prospectingInfo);
  customFields.prospecting = prospectingInfo;
  customFields.qualification = qualResult;

  const { score, factors, computedAt } = await computeLeadScore(workspaceId, contactId);

  const lead = await prisma.lead.create({
    data: {
      workspaceId,
      contactId,
      status: dbStatus,
      source: canonicalSource,
      ownerUserId: body.ownerUserId ?? null,
      notes: body.notes ?? null,
      customFields: Object.keys(customFields).length > 0 ? customFields : null,
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
    const distResult = await evaluateAndAssignLead(workspaceId, lead.id).catch(() => null);
    if (distResult?.assigned) {
      categorizedLead.ownerUserId = distResult.ownerUserId;
      categorizedLead.owner = { id: distResult.ownerUserId, name: distResult.ownerName, email: '' };
    }
  }

  // Fire-and-forget: an automation must never delay or fail the write that
  // triggered it.
  emitCrmEvent(workspaceId, 'lead_created', { leadId: lead.id, contactId, score });
  return {
    ...categorizedLead,
    contact: { ...lead.contact, ...categorizedLead.contact, tags: initialTags ?? lead.contact?.tags ?? [] },
    customFields: lead.customFields,
    status: lead.customFields?.statusKey || categorizedLead.status,
  };
}

// `updates` arrives pre-whitelisted by the strict update validator, so
// workspaceId/score/convertedDealId cannot be mass-assigned.
export async function updateLead(workspaceId, id, updates, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const lead = await prisma.lead.findFirst({
    where: { id, workspaceId, ...scope },
    select: { id: true, status: true, customFields: true, contactId: true, ownerUserId: true },
  });
  if (!lead) { const e = new Error('Lead not found'); e.status = 404; throw e; }

  // Update tags on Contact if provided
  if (Array.isArray(updates.tags)) {
    await prisma.contact.update({
      where: { id: lead.contactId },
      data: { tags: updates.tags },
    });
  }

  const data = { ...updates };
  delete data.tags;
  delete data.prospecting;
  delete data.budget;
  delete data.companySize;
  delete data.industry;
  delete data.qualificationAnswers;
  delete data.checklistAnswers;

  // Custom fields handling
  let customFields = await validateCrmCustomFields(workspaceId, 'lead', updates.customFields, lead.customFields);
  if (customFields === undefined) {
    customFields = typeof lead.customFields === 'object' && lead.customFields !== null ? { ...lead.customFields } : {};
  } else {
    customFields = typeof customFields === 'object' && customFields !== null ? { ...customFields } : {};
  }

  // Handle custom lifecycle status
  if (updates.status) {
    const isPrismaStatus = PRISMA_LEAD_STATUSES.has(updates.status);
    if (isPrismaStatus) {
      data.status = updates.status;
      delete customFields.statusKey;
    } else {
      data.status = 'NEW';
      customFields.statusKey = updates.status;
    }
  }

  // Handle Prospecting evaluation on update
  if (updates.prospecting || updates.budget !== undefined || updates.companySize !== undefined || updates.industry !== undefined || updates.qualificationAnswers) {
    const criteriaConfig = await getSection(workspaceId, 'prospecting_criteria').catch(() => null);
    const existingProspecting = customFields.prospecting || {};
    const prospectingInfo = {
      budget: updates.budget !== undefined ? updates.budget : (updates.prospecting?.budget !== undefined ? updates.prospecting.budget : existingProspecting.budget),
      companySize: updates.companySize !== undefined ? updates.companySize : (updates.prospecting?.companySize !== undefined ? updates.prospecting.companySize : existingProspecting.companySize),
      industry: updates.industry !== undefined ? updates.industry : (updates.prospecting?.industry !== undefined ? updates.prospecting.industry : existingProspecting.industry),
      answers: updates.checklistAnswers || updates.qualificationAnswers || updates.prospecting?.answers || existingProspecting.answers || {},
    };
    const qualResult = evaluateProspectingCriteria(criteriaConfig, prospectingInfo);
    customFields.prospecting = prospectingInfo;
    customFields.qualification = qualResult;
  }

  data.customFields = Object.keys(customFields).length > 0 ? customFields : null;

  const updated = await prisma.lead.update({ where: { id }, data, include: LEAD_INCLUDE });

  const effectiveStatus = updated.customFields?.statusKey || updated.status;
  const previousEffectiveStatus = lead.customFields?.statusKey || lead.status;

  if (updates.status === 'QUALIFIED' && previousEffectiveStatus !== 'QUALIFIED' && updated.ownerUserId) {
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
  const lead = await prisma.lead.findFirst({ where: { id, workspaceId, ...scope }, select: { id: true, contactId: true, score: true } });
  if (!lead) { const e = new Error('Lead not found'); e.status = 404; throw e; }
  const { score, factors, computedAt } = await computeLeadScore(workspaceId, lead.contactId);

  const updated = await prisma.lead.update({
    where: { id },
    data: { score, scoreFactors: factors, scoreComputedAt: computedAt },
    include: LEAD_INCLUDE,
  });

  // Re-compute category after score recalculation
  const categorized = await computeLeadCategory(workspaceId, id).catch(() => updated);

  // The previous score travels with the event so a threshold trigger fires on
  // the crossing rather than on every rescore above the line.
  if (score !== lead.score) {
    emitCrmEvent(workspaceId, 'lead_score_changed', {
      leadId: id, contactId: lead.contactId, score, previousScore: lead.score,
    });
  }
  return categorized;
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
      data: { workspaceId, dealId: deal.id, fromStage: null, toStage: toStageDb, changedByUserId: userId ?? null },
    });

    await tx.lead.update({
      where: { id: lead.id },
      data: { status: 'CONVERTED', convertedAt: new Date(), convertedDealId: deal.id },
    });

    return { ...deal, stage };
  });
}

export async function bulkAssignLeads(workspaceId, ids = [], ownerUserId = null, user = null) {
  if (!Array.isArray(ids) || ids.length === 0) {
    const e = new Error('At least one lead ID is required'); e.status = 400; throw e;
  }
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const res = await prisma.lead.updateMany({
    where: { id: { in: ids }, workspaceId, ...scope },
    data: { ownerUserId: ownerUserId || null },
  });
  return { count: res.count };
}

export async function bulkUpdateStatus(workspaceId, ids = [], status, user = null) {
  if (!Array.isArray(ids) || ids.length === 0 || !status) {
    const e = new Error('Lead IDs and status are required'); e.status = 400; throw e;
  }
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const res = await prisma.lead.updateMany({
    where: { id: { in: ids }, workspaceId, ...scope },
    data: { status },
  });
  return { count: res.count };
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

export async function bulkCreateTask(workspaceId, ids = [], { title, dueDate = null, priority = 'NORMAL' } = {}, userId = null) {
  if (!Array.isArray(ids) || ids.length === 0 || !title) {
    const e = new Error('Lead IDs and task title are required'); e.status = 400; throw e;
  }
  const leads = await prisma.lead.findMany({
    where: { id: { in: ids }, workspaceId },
    select: { id: true, contactId: true, ownerUserId: true },
  });
  const createdTasks = [];
  for (const l of leads) {
    const task = await prisma.task.create({
      data: {
        workspaceId,
        title,
        dueDate: dueDate ? new Date(dueDate) : null,
        priority,
        leadId: l.id,
        contactId: l.contactId,
        assignedToUserId: l.ownerUserId || userId,
      },
    });
    createdTasks.push(task);
  }
  return { count: createdTasks.length };
}

