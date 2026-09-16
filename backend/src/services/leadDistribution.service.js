import { prisma } from '../lib/prisma.js';
import { emitCrmEvent } from './workflowCrm.service.js';

const RULES_VIEW_NAME = '__SYSTEM_LEAD_DISTRIBUTION_RULES__';
const ENTITY_TYPE = 'lead_distribution_rules';

/**
 * Get configured lead distribution rules for a workspace.
 */
export async function getDistributionRules(workspaceId) {
  const record = await prisma.savedView.findFirst({
    where: { workspaceId, entity: ENTITY_TYPE, name: RULES_VIEW_NAME },
  });
  if (!record || !record.filters) {
    return {
      enabled: false,
      rules: [],
      roundRobinIndex: 0,
    };
  }
  const data = record.filters;
  return {
    enabled: Boolean(data.enabled),
    rules: Array.isArray(data.rules) ? data.rules : [],
    roundRobinIndex: Number(data.roundRobinIndex) || 0,
  };
}

/**
 * Save or update distribution rules for a workspace.
 */
export async function saveDistributionRules(workspaceId, { enabled = true, rules = [] } = {}) {
  const existing = await prisma.savedView.findFirst({
    where: { workspaceId, entity: ENTITY_TYPE, name: RULES_VIEW_NAME },
  });

  const payload = {
    enabled: Boolean(enabled),
    rules: Array.isArray(rules) ? rules : [],
    roundRobinIndex: existing?.filters?.roundRobinIndex || 0,
  };

  if (existing) {
    await prisma.savedView.update({
      where: { id: existing.id },
      data: { filters: payload },
    });
  } else {
    await prisma.savedView.create({
      data: {
        workspaceId,
        entity: ENTITY_TYPE,
        name: RULES_VIEW_NAME,
        filters: payload,
        isShared: true,
      },
    });
  }

  return payload;
}

/**
 * Evaluates rules against a lead and assigns the lead if matched.
 */
export async function evaluateAndAssignLead(workspaceId, leadId) {
  const config = await getDistributionRules(workspaceId);
  if (!config.enabled || !config.rules || config.rules.length === 0) {
    return { assigned: false, reason: 'Distribution disabled or no rules configured' };
  }

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, workspaceId },
    include: {
      contact: true,
      LeadFormSubmission: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  if (!lead) {
    return { assigned: false, reason: 'Lead not found' };
  }

  // Find the first matching enabled rule
  const matchedRule = config.rules.find((rule) => {
    if (!rule.enabled) return false;
    const cond = rule.conditions || {};

    // Category match
    if (cond.category && cond.category !== 'ANY' && lead.category !== cond.category) {
      return false;
    }

    // Source match (case-insensitive substring)
    if (cond.source && cond.source.trim()) {
      const src = (lead.source || '').toLowerCase();
      const targetSrc = cond.source.trim().toLowerCase();
      if (!src.includes(targetSrc)) return false;
    }

    // Score thresholds
    if (cond.minScore !== undefined && cond.minScore !== null && cond.minScore !== '') {
      if (lead.score < Number(cond.minScore)) return false;
    }
    if (cond.maxScore !== undefined && cond.maxScore !== null && cond.maxScore !== '') {
      if (lead.score > Number(cond.maxScore)) return false;
    }

    // Form answer match (JSON text search)
    if (cond.formAnswerContains && cond.formAnswerContains.trim()) {
      const term = cond.formAnswerContains.trim().toLowerCase();
      const submission = lead.LeadFormSubmission?.[0];
      const answersStr = submission ? JSON.stringify(submission.answers).toLowerCase() : '';
      if (!answersStr.includes(term)) return false;
    }

    return true;
  });

  if (!matchedRule) {
    return { assigned: false, reason: 'No matching distribution rule' };
  }

  let assignedUserId = null;
  const assignment = matchedRule.assignment || {};

  if (assignment.type === 'USER' && assignment.userId) {
    // Verify user belongs to workspace
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: assignment.userId },
      include: { user: true },
    });
    if (member) {
      assignedUserId = member.userId;
    }
  } else if (assignment.type === 'ROUND_ROBIN') {
    // Determine candidate pool: either explicit poolUserIds or all workspace members
    let candidateIds = Array.isArray(assignment.poolUserIds) && assignment.poolUserIds.length > 0
      ? assignment.poolUserIds
      : [];

    if (candidateIds.length === 0) {
      const members = await prisma.workspaceMember.findMany({
        where: { workspaceId },
        select: { userId: true },
      });
      candidateIds = members.map((m) => m.userId);
    }

    if (candidateIds.length > 0) {
      const idx = config.roundRobinIndex % candidateIds.length;
      assignedUserId = candidateIds[idx];

      // Advance round robin counter
      const nextIndex = (idx + 1) % candidateIds.length;
      const record = await prisma.savedView.findFirst({
        where: { workspaceId, entity: ENTITY_TYPE, name: RULES_VIEW_NAME },
      });
      if (record) {
        await prisma.savedView.update({
          where: { id: record.id },
          data: {
            filters: {
              ...config,
              roundRobinIndex: nextIndex,
            },
          },
        });
      }
    }
  }

  if (!assignedUserId) {
    return { assigned: false, reason: 'Could not resolve valid assignee from rule' };
  }

  // Update lead owner
  const updatedLead = await prisma.lead.update({
    where: { id: leadId },
    data: { ownerUserId: assignedUserId },
    include: {
      owner: { select: { id: true, name: true, email: true } },
    },
  });

  // Log activity
  await prisma.crmActivity.create({
    data: {
      workspaceId,
      type: 'NOTE',
      content: `Auto-assigned via distribution rule: "${matchedRule.name}" to ${updatedLead.owner?.name || updatedLead.owner?.email || 'sales rep'}`,
      leadId: lead.id,
      contactId: lead.contactId,
    },
  }).catch(() => {});

  emitCrmEvent(workspaceId, 'lead_assigned', {
    leadId: lead.id,
    contactId: lead.contactId,
    ownerUserId: assignedUserId,
    ruleName: matchedRule.name,
  });

  return {
    assigned: true,
    leadId: lead.id,
    ownerUserId: assignedUserId,
    ownerName: updatedLead.owner?.name,
    ruleName: matchedRule.name,
  };
}

/**
 * Distribute a batch of leads (or all unassigned leads if empty).
 */
export async function autoDistributeBatch(workspaceId, leadIds = []) {
  const where = { workspaceId };
  if (Array.isArray(leadIds) && leadIds.length > 0) {
    where.id = { in: leadIds };
  } else {
    where.ownerUserId = null; // Unassigned leads
  }

  const leads = await prisma.lead.findMany({
    where,
    select: { id: true },
    take: 100,
  });

  const results = [];
  let assignedCount = 0;

  for (const l of leads) {
    const res = await evaluateAndAssignLead(workspaceId, l.id);
    if (res.assigned) assignedCount++;
    results.push(res);
  }

  return {
    totalEvaluated: leads.length,
    assignedCount,
    results,
  };
}
