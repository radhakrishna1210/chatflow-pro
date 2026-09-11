import { prisma } from '../lib/prisma.js';
import { ensureStages, listStages, STAGE_KEYS, CLOSED_STAGES } from './pipelineStages.service.js';

export const CUSTOMIZATION_ENTITY = 'crm_customization';

export const DEFAULT_CUSTOMIZATIONS = {
  lead_lifecycle: {
    stages: [
      { key: 'NEW', label: 'New Lead', color: '#3b82f6', isDefault: true, isProtected: true, sortOrder: 0, description: 'Newly acquired lead awaiting qualification' },
      { key: 'CONTACTED', label: 'Contacted', color: '#f59e0b', isDefault: false, isProtected: false, sortOrder: 1, description: 'Outreach made via call, email, or chat' },
      { key: 'QUALIFIED', label: 'Qualified', color: '#10b981', isDefault: false, isProtected: false, sortOrder: 2, description: 'Meets qualification criteria and ready for deal conversion' },
      { key: 'UNQUALIFIED', label: 'Unqualified', color: '#ef4444', isDefault: false, isProtected: false, sortOrder: 3, description: 'Does not meet criteria or no interest' },
      { key: 'NURTURING', label: 'Nurturing', color: '#8b5cf6', isDefault: false, isProtected: false, sortOrder: 4, description: 'Future prospect; long-term drip follow up' },
    ],
  },

  prospecting_criteria: {
    minBudget: 1000,
    currency: 'USD',
    companySizeMin: 5,
    requirePhone: true,
    requireEmail: true,
    requireCompany: false,
    targetIndustries: [
      'Technology & SaaS',
      'Healthcare & Pharma',
      'Finance & Banking',
      'Manufacturing',
      'Retail & E-commerce',
      'Professional Services',
      'Education',
      'Real Estate',
    ],
    checklist: [
      { id: 'crit_1', question: 'Identified core business pain points and timeline?', required: true, weight: 25 },
      { id: 'crit_2', question: 'Confirmed available budget aligns with product pricing?', required: true, weight: 25 },
      { id: 'crit_3', question: 'In touch with key decision maker or budget owner?', required: true, weight: 30 },
      { id: 'crit_4', question: 'Evaluated competitive alternatives or current solution?', required: false, weight: 20 },
    ],
  },

  deal_mode: {
    mode: 'FLEXIBLE', // 'FLEXIBLE' | 'AUTOMATIC'
    description: 'Flexible mode allows moving deals freely. Automatic task-driven mode auto-generates mandatory follow-up tasks on each stage transition.',
    autoTaskConfig: {
      followUpDueDays: 2,
      defaultPriority: 'HIGH',
      notifyOwner: true,
      stageTaskTemplates: {
        QUALIFICATION: 'Conduct initial discovery call & verify qualification criteria',
        NEEDS_ANALYSIS: 'Prepare in-depth needs analysis and scope document',
        PROPOSAL: 'Present commercial proposal and confirm decision timeframe',
        NEGOTIATION: 'Finalize negotiation terms and redlines with stakeholders',
        CLOSED_WON: 'Execute contract handover and kick off customer onboarding',
        CLOSED_LOST: 'Log lost reason details and schedule 90-day re-engagement review',
      },
    },
  },

  lead_tags: {
    tags: [
      { id: 'ltag_1', name: 'High Value', color: '#10b981', category: 'Priority' },
      { id: 'ltag_2', name: 'Urgent Attention', color: '#ef4444', category: 'Priority' },
      { id: 'ltag_3', name: 'Enterprise', color: '#6366f1', category: 'Segment' },
      { id: 'ltag_4', name: 'Mid-Market', color: '#06b6d4', category: 'Segment' },
      { id: 'ltag_5', name: 'SMB', color: '#84cc16', category: 'Segment' },
      { id: 'ltag_6', name: 'Warm Inbound', color: '#f59e0b', category: 'Engagement' },
      { id: 'ltag_7', name: 'Referral', color: '#8b5cf6', category: 'Source' },
      { id: 'ltag_8', name: 'Decision Maker', color: '#ec4899', category: 'Persona' },
    ],
  },

  lead_sources: {
    sources: [
      { id: 'lsrc_1', key: 'WEBSITE', name: 'Website Form', category: 'Inbound', isActive: true, utmSource: 'website' },
      { id: 'lsrc_2', key: 'CHATBOT', name: 'AI Chatbot', category: 'Inbound', isActive: true, utmSource: 'chatbot' },
      { id: 'lsrc_3', key: 'LINKEDIN', name: 'LinkedIn Campaign', category: 'Social', isActive: true, utmSource: 'linkedin' },
      { id: 'lsrc_4', key: 'GOOGLE_ADS', name: 'Google Ads', category: 'Paid Search', isActive: true, utmSource: 'google' },
      { id: 'lsrc_5', key: 'REFERRAL', name: 'Customer Referral', category: 'Word of Mouth', isActive: true, utmSource: 'referral' },
      { id: 'lsrc_6', key: 'COLD_OUTREACH', name: 'Cold Outreach / Outbound', category: 'Outbound', isActive: true, utmSource: 'outreach' },
      { id: 'lsrc_7', key: 'EVENT', name: 'Conference / Event', category: 'Offline', isActive: true, utmSource: 'event' },
      { id: 'lsrc_8', key: 'OTHER', name: 'Other', category: 'General', isActive: true, utmSource: 'other' },
    ],
  },

  call_outcomes: {
    outcomes: [
      { id: 'call_1', name: 'Connected - Interested', sentiment: 'POSITIVE', icon: 'PhoneCall', sortOrder: 0, triggersFollowUp: true },
      { id: 'call_2', name: 'Connected - Demo Scheduled', sentiment: 'POSITIVE', icon: 'Calendar', sortOrder: 1, triggersFollowUp: true },
      { id: 'call_3', name: 'Connected - Callback Requested', sentiment: 'NEUTRAL', icon: 'Clock', sortOrder: 2, triggersFollowUp: true },
      { id: 'call_4', name: 'Left Voicemail', sentiment: 'NEUTRAL', icon: 'Voicemail', sortOrder: 3, triggersFollowUp: true },
      { id: 'call_5', name: 'No Answer / Ringing', sentiment: 'NEUTRAL', icon: 'PhoneMissed', sortOrder: 4, triggersFollowUp: true },
      { id: 'call_6', name: 'Connected - Not Interested', sentiment: 'NEGATIVE', icon: 'UserX', sortOrder: 5, triggersFollowUp: false },
      { id: 'call_7', name: 'Invalid / Wrong Number', sentiment: 'NEGATIVE', icon: 'PhoneOff', sortOrder: 6, triggersFollowUp: false },
      { id: 'call_8', name: 'Gatekeeper Blocked', sentiment: 'NEGATIVE', icon: 'ShieldAlert', sortOrder: 7, triggersFollowUp: true },
    ],
  },

  visit_outcomes: {
    outcomes: [
      { id: 'vis_1', name: 'Meeting Completed - Proposal Requested', sentiment: 'POSITIVE', sortOrder: 0, triggersFollowUp: true },
      { id: 'vis_2', name: 'Meeting Completed - Follow-up Needed', sentiment: 'POSITIVE', sortOrder: 1, triggersFollowUp: true },
      { id: 'vis_3', name: 'Decision Maker Not Present', sentiment: 'NEUTRAL', sortOrder: 2, triggersFollowUp: true },
      { id: 'vis_4', name: 'Client Rescheduled', sentiment: 'NEUTRAL', sortOrder: 3, triggersFollowUp: true },
      { id: 'vis_5', name: 'Meeting Completed - No Fit', sentiment: 'NEGATIVE', sortOrder: 4, triggersFollowUp: false },
      { id: 'vis_6', name: 'Client No-Show / Cancelled', sentiment: 'NEGATIVE', sortOrder: 5, triggersFollowUp: true },
    ],
  },

  deal_setup: {
    stages: [
      { key: 'QUALIFICATION', label: 'Qualification', probability: 10, color: '#3b82f6', slaDays: 5, sortOrder: 0, isActive: true },
      { key: 'NEEDS_ANALYSIS', label: 'Needs Analysis', probability: 25, color: '#06b6d4', slaDays: 7, sortOrder: 1, isActive: true },
      { key: 'PROPOSAL', label: 'Proposal', probability: 50, color: '#f59e0b', slaDays: 10, sortOrder: 2, isActive: true },
      { key: 'NEGOTIATION', label: 'Negotiation', probability: 75, color: '#8b5cf6', slaDays: 7, sortOrder: 3, isActive: true },
      { key: 'CLOSED_WON', label: 'Closed Won', probability: 100, color: '#10b981', slaDays: null, sortOrder: 4, isActive: true },
      { key: 'CLOSED_LOST', label: 'Closed Lost', probability: 0, color: '#ef4444', slaDays: null, sortOrder: 5, isActive: true },
    ],
  },

  ticket_customization: {
    stages: [
      { id: 'tstg_1', key: 'OPEN', label: 'Open', color: '#3b82f6', isDefault: true, sortOrder: 0 },
      { id: 'tstg_2', key: 'IN_PROGRESS', label: 'In Progress', color: '#f59e0b', isDefault: false, sortOrder: 1 },
      { id: 'tstg_3', key: 'WAITING_ON_CUSTOMER', label: 'Waiting on Customer', color: '#8b5cf6', isDefault: false, sortOrder: 2 },
      { id: 'tstg_4', key: 'RESOLVED', label: 'Resolved', color: '#10b981', isDefault: false, sortOrder: 3 },
      { id: 'tstg_5', key: 'CLOSED', label: 'Closed', color: '#6b7280', isDefault: false, sortOrder: 4 },
    ],
    categories: [
      { id: 'tcat_1', name: 'Technical Issue', slaHours: 8, priority: 'HIGH', color: '#ef4444', description: 'Product bugs, errors, or service interruptions' },
      { id: 'tcat_2', name: 'Billing & Payments', slaHours: 24, priority: 'MEDIUM', color: '#f59e0b', description: 'Invoicing, subscriptions, or refund inquiries' },
      { id: 'tcat_3', name: 'Account Access', slaHours: 4, priority: 'URGENT', color: '#ec4899', description: 'Login issues, 2FA reset, or credential lockout' },
      { id: 'tcat_4', name: 'Feature Request', slaHours: 72, priority: 'LOW', color: '#3b82f6', description: 'Customer feature suggestions and product enhancements' },
      { id: 'tcat_5', name: 'General Inquiry', slaHours: 48, priority: 'LOW', color: '#10b981', description: 'Standard inquiries and customer questions' },
    ],
  },

  document_categories: {
    categories: [
      {
        id: 'doc_1',
        name: 'Contracts & Legal',
        color: '#6366f1',
        subcategories: ['Master Services Agreement (MSA)', 'Non-Disclosure Agreement (NDA)', 'Service Level Agreement (SLA)', 'Statement of Work (SOW)'],
      },
      {
        id: 'doc_2',
        name: 'Proposals & Quotes',
        color: '#3b82f6',
        subcategories: ['Commercial Proposal', 'Price Quotation', 'RFP Response', 'Pitch Deck'],
      },
      {
        id: 'doc_3',
        name: 'Invoices & Billing',
        color: '#10b981',
        subcategories: ['Tax Invoice', 'Purchase Order (PO)', 'Payment Receipt', 'Credit Note'],
      },
      {
        id: 'doc_4',
        name: 'KYC & Identification',
        color: '#f59e0b',
        subcategories: ['Business Registration Certificate', 'Tax ID / PAN / GST', 'Authorized Signatory Proof', 'Bank Account Verification'],
      },
      {
        id: 'doc_5',
        name: 'Technical & Product',
        color: '#8b5cf6',
        subcategories: ['Architecture Diagram', 'Security Compliance / SOC2', 'Product Specification', 'Integration Guide'],
      },
    ],
  },
};

export const SECTION_KEYS = Object.keys(DEFAULT_CUSTOMIZATIONS);

function sectionViewName(sectionKey) {
  return `__CRM_CUSTOMIZATION_${sectionKey.toUpperCase()}__`;
}

/**
 * Get a specific customization section for a workspace.
 */
export async function getSection(workspaceId, sectionKey) {
  if (!DEFAULT_CUSTOMIZATIONS[sectionKey]) {
    const error = new Error(`Invalid customization section: ${sectionKey}`);
    error.status = 400;
    throw error;
  }

  const name = sectionViewName(sectionKey);
  const record = await prisma.savedView.findFirst({
    where: { workspaceId, entity: CUSTOMIZATION_ENTITY, name },
  });

  if (!record || !record.filters) {
    if (sectionKey === 'deal_setup') {
      return syncDealSetupWithPipelineStages(workspaceId, DEFAULT_CUSTOMIZATIONS.deal_setup);
    }
    return DEFAULT_CUSTOMIZATIONS[sectionKey];
  }

  if (sectionKey === 'deal_setup') {
    return syncDealSetupWithPipelineStages(workspaceId, record.filters);
  }

  return record.filters;
}

/**
 * Helper to keep deal_setup synchronized with PipelineStage table.
 */
async function syncDealSetupWithPipelineStages(workspaceId, dealSetupConfig) {
  try {
    const { data: dbStages } = await listStages(workspaceId);
    const configMap = new Map((dealSetupConfig?.stages || []).map((s) => [s.key, s]));
    const stages = dbStages.map((dbStage) => {
      const cfg = configMap.get(dbStage.key);
      return {
        key: dbStage.key,
        label: dbStage.label,
        probability: dbStage.probability,
        sortOrder: dbStage.sortOrder,
        isActive: dbStage.isActive,
        color: cfg?.color || (CLOSED_STAGES.includes(dbStage.key) ? (dbStage.key === 'CLOSED_WON' ? '#10b981' : '#ef4444') : '#3b82f6'),
        slaDays: cfg?.slaDays ?? (CLOSED_STAGES.includes(dbStage.key) ? null : 7),
      };
    });

    stages.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return { ...dealSetupConfig, stages };
  } catch (err) {
    console.error('[syncDealSetupWithPipelineStages] Failed:', err.message);
    return dealSetupConfig;
  }
}

/**
 * Get all 10 customization sections for a workspace.
 */
export async function getAllCustomizations(workspaceId) {
  const records = await prisma.savedView.findMany({
    where: { workspaceId, entity: CUSTOMIZATION_ENTITY },
  });

  const map = new Map();
  for (const r of records) {
    map.set(r.name, r.filters);
  }

  const result = {};
  for (const key of SECTION_KEYS) {
    const name = sectionViewName(key);
    result[key] = map.get(name) || DEFAULT_CUSTOMIZATIONS[key];
  }

  result.deal_setup = await syncDealSetupWithPipelineStages(workspaceId, result.deal_setup);

  return result;
}

const PRISMA_LEAD_STATUSES = new Set(['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED', 'LOST']);
const PRISMA_DEAL_STAGES = new Set(['QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST']);

/**
 * Check if an item can be safely deleted without breaking foreign key/usage constraints.
 */
export async function checkSafeDeletion(workspaceId, sectionKey, itemKeyOrId) {
  if (sectionKey === 'lead_lifecycle') {
    if (!PRISMA_LEAD_STATUSES.has(itemKeyOrId)) {
      return { safe: true };
    }
    const leadCount = await prisma.lead.count({
      where: { workspaceId, status: itemKeyOrId },
    });
    if (leadCount > 0) {
      return {
        safe: false,
        reason: `Cannot delete stage "${itemKeyOrId}" because ${leadCount} active lead(s) currently have this status. Reassign them first.`,
        count: leadCount,
      };
    }
  }

  if (sectionKey === 'lead_sources') {
    const leadCount = await prisma.lead.count({
      where: { workspaceId, source: itemKeyOrId },
    });
    if (leadCount > 0) {
      return {
        safe: false,
        reason: `Cannot delete source "${itemKeyOrId}" because ${leadCount} lead(s) are associated with it.`,
        count: leadCount,
      };
    }
  }

  if (sectionKey === 'deal_setup') {
    if (CLOSED_STAGES.includes(itemKeyOrId)) {
      return {
        safe: false,
        reason: `Stage "${itemKeyOrId}" is a terminal closed stage and cannot be removed.`,
      };
    }

    const conditions = [];
    if (PRISMA_DEAL_STAGES.has(itemKeyOrId)) {
      conditions.push({ stage: itemKeyOrId });
    }
    conditions.push({ customFields: { path: ['stageKey'], equals: itemKeyOrId } });

    const dealCount = await prisma.deal.count({
      where: {
        workspaceId,
        OR: conditions,
      },
    });

    if (dealCount > 0) {
      return {
        safe: false,
        reason: `Cannot delete deal stage "${itemKeyOrId}" because ${dealCount} deal(s) are currently in this stage. Reassign them first.`,
        count: dealCount,
      };
    }
  }

  return { safe: true };
}

/**
 * Update a specific customization section.
 */
export async function updateSection(workspaceId, sectionKey, data, userId = null) {
  if (!DEFAULT_CUSTOMIZATIONS[sectionKey]) {
    const error = new Error(`Invalid customization section: ${sectionKey}`);
    error.status = 400;
    throw error;
  }

  if (!data || typeof data !== 'object') {
    const error = new Error('Invalid section data format: payload must be an object');
    error.status = 400;
    throw error;
  }

  // Handle deal_setup synchronization with PipelineStage table if stages are modified
  if (sectionKey === 'deal_setup' && Array.isArray(data.stages)) {
    await ensureStages(workspaceId);
    const existingStages = await prisma.pipelineStage.findMany({ where: { workspaceId } });
    const existingMap = new Map(existingStages.map((s) => [s.key, s]));
    const submittedKeys = new Set(data.stages.map((s) => s.key));

    for (const s of data.stages) {
      const updates = {};
      if (s.label !== undefined) updates.label = s.label;
      if (s.probability !== undefined && !CLOSED_STAGES.includes(s.key)) {
        updates.probability = Math.min(100, Math.max(0, Number(s.probability) || 0));
      }
      if (s.sortOrder !== undefined) updates.sortOrder = Number(s.sortOrder);
      if (s.isActive !== undefined && !CLOSED_STAGES.includes(s.key)) {
        updates.isActive = Boolean(s.isActive);
      }

      if (existingMap.has(s.key)) {
        if (Object.keys(updates).length > 0) {
          await prisma.pipelineStage.update({
            where: { id: existingMap.get(s.key).id },
            data: updates,
          });
        }
      } else {
        // Create newly added pipeline stage
        await prisma.pipelineStage.create({
          data: {
            workspaceId,
            key: s.key,
            label: s.label || s.key,
            probability: s.probability !== undefined ? Math.min(100, Math.max(0, Number(s.probability) || 0)) : 50,
            sortOrder: s.sortOrder !== undefined ? Number(s.sortOrder) : existingStages.length,
            isActive: s.isActive !== undefined ? Boolean(s.isActive) : true,
          },
        });
      }
    }

    // Delete any removed non-terminal stages that are no longer in submitted stages
    for (const [key, dbStage] of existingMap.entries()) {
      if (!submittedKeys.has(key) && !CLOSED_STAGES.includes(key)) {
        await prisma.pipelineStage.delete({ where: { id: dbStage.id } }).catch(() => {});
      }
    }
  }

  const name = sectionViewName(sectionKey);
  const existing = await prisma.savedView.findFirst({
    where: { workspaceId, entity: CUSTOMIZATION_ENTITY, name },
  });

  let savedRecord;
  if (existing) {
    savedRecord = await prisma.savedView.update({
      where: { id: existing.id },
      data: {
        filters: data,
        createdByUserId: userId || existing.createdByUserId,
      },
    });
  } else {
    savedRecord = await prisma.savedView.create({
      data: {
        workspaceId,
        entity: CUSTOMIZATION_ENTITY,
        name,
        filters: data,
        isShared: true,
        createdByUserId: userId,
      },
    });
  }

  if (sectionKey === 'deal_setup') {
    return syncDealSetupWithPipelineStages(workspaceId, savedRecord.filters);
  }

  return savedRecord.filters;
}

/**
 * Reset a customization section back to system defaults.
 */
export async function resetSection(workspaceId, sectionKey) {
  if (!DEFAULT_CUSTOMIZATIONS[sectionKey]) {
    const error = new Error(`Invalid customization section: ${sectionKey}`);
    error.status = 400;
    throw error;
  }

  const name = sectionViewName(sectionKey);
  await prisma.savedView.deleteMany({
    where: { workspaceId, entity: CUSTOMIZATION_ENTITY, name },
  });

  if (sectionKey === 'deal_setup') {
    const { DEFAULT_STAGES } = await import('./pipelineStages.service.js');
    // Remove custom stages not in default stages
    await prisma.pipelineStage.deleteMany({
      where: { workspaceId, key: { notIn: STAGE_KEYS } },
    });
    // Restore default stages
    await prisma.$transaction(
      DEFAULT_STAGES.map((s) =>
        prisma.pipelineStage.updateMany({
          where: { workspaceId, key: s.key },
          data: { label: s.label, probability: s.probability, sortOrder: s.sortOrder, isActive: true },
        })
      )
    );
    return syncDealSetupWithPipelineStages(workspaceId, DEFAULT_CUSTOMIZATIONS.deal_setup);
  }

  return DEFAULT_CUSTOMIZATIONS[sectionKey];
}

/**
 * Helper to auto-generate a follow up Task when deal stage changes and Deal Mode is AUTOMATIC.
 */
export async function autoGenerateDealTaskOnStageChange(workspaceId, deal, newStage, userId = null) {
  try {
    const dealModeConfig = await getSection(workspaceId, 'deal_mode');
    if (dealModeConfig?.mode !== 'AUTOMATIC') {
      return null;
    }

    const { autoTaskConfig = {} } = dealModeConfig;
    const dueDays = Number(autoTaskConfig.followUpDueDays) || 2;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + dueDays);

    const templateText = autoTaskConfig.stageTaskTemplates?.[newStage]
      || `Follow up on deal "${deal.title || deal.name || 'Untitled'}" (Stage: ${newStage})`;

    const assigneeId = deal.ownerUserId || userId;

    const task = await prisma.task.create({
      data: {
        workspaceId,
        title: templateText,
        description: `Auto-generated follow-up task triggered by stage transition to ${newStage}.`,
        dueDate,
        assignedToUserId: assigneeId,
        dealId: deal.id,
        leadId: deal.leadId || null,
        contactId: deal.contactId || null,
      },
    });

    return task;
  } catch (err) {
    console.error('[autoGenerateDealTaskOnStageChange] Failed to generate task:', err.message);
    return null;
  }
}
