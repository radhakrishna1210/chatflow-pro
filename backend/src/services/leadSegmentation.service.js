import { prisma } from '../lib/prisma.js';
import { computeLeadScore } from './leadScoring.service.js';
import { emitCrmEvent } from './workflowCrm.service.js';

const DAY_MS = 86_400_000;

const HIGH_INTENT_KEYWORDS = [
  'demo', 'pricing', 'buy', 'purchase', 'enterprise', 'urgent',
  'immediate', 'quote', 'custom', 'contact sales', 'talk to sales', 'hire',
];

const LOW_INTENT_KEYWORDS = [
  'just browsing', 'general', 'info', 'student', 'research', 'other',
];

/**
 * Pure evaluator for lead category and explainability reasons.
 *
 * @param {Object} signals
 * @returns {{ category: 'HOT'|'WARM'|'COLD', reasons: string[], score: number }}
 */
export function evaluateLeadCategory(signals) {
  const {
    score = 0,
    source = '',
    submissions = [],
    inboundMessageCount = 0,
    daysSinceLastInbound = null,
    hasOpenConversation = false,
    optedOut = false,
  } = signals ?? {};

  const reasons = [];

  // Opted out contact automatically defaults to COLD with clear reason
  if (optedOut) {
    return {
      category: 'COLD',
      reasons: [
        'Contact has opted out of messaging — classified as COLD prospect.',
        `Lead Score: ${score}`,
      ],
      score,
    };
  }

  // 1. Evaluate Score
  let scoreTier = 'Low';
  if (score >= 60) scoreTier = 'High';
  else if (score >= 30) scoreTier = 'Moderate';

  reasons.push(`Lead Score: ${score}/100 (${scoreTier})`);

  // 2. Evaluate Form Answers / Intent
  let formIntent = 'None';
  let matchedFormAnswer = null;

  if (submissions && submissions.length > 0) {
    for (const sub of submissions) {
      if (!sub.answers || typeof sub.answers !== 'object') continue;
      const valuesStr = Object.values(sub.answers).join(' ').toLowerCase();

      if (HIGH_INTENT_KEYWORDS.some((kw) => valuesStr.includes(kw))) {
        formIntent = 'High';
        matchedFormAnswer = Object.entries(sub.answers)
          .find(([_, v]) => HIGH_INTENT_KEYWORDS.some((kw) => String(v).toLowerCase().includes(kw)))?.[1];
        break;
      } else if (LOW_INTENT_KEYWORDS.some((kw) => valuesStr.includes(kw))) {
        formIntent = 'Low';
      } else if (formIntent === 'None') {
        formIntent = 'Moderate';
      }
    }
  }

  if (formIntent !== 'None') {
    if (formIntent === 'High') {
      reasons.push(`Form Intent: High${matchedFormAnswer ? ` (Answer: "${matchedFormAnswer}")` : ''}`);
    } else if (formIntent === 'Moderate') {
      reasons.push('Form Intent: Moderate (Submitted lead form)');
    } else {
      reasons.push('Form Intent: Low (General inquiry answers)');
    }
  } else {
    reasons.push('Form Intent: No form submission recorded');
  }

  // 3. Evaluate Engagement / Customer Replies
  const hasRecentReply = daysSinceLastInbound != null && daysSinceLastInbound <= 7;
  const hasCustomerReplied = inboundMessageCount > 0;

  if (hasCustomerReplied) {
    let replyText = `${inboundMessageCount} inbound reply${inboundMessageCount > 1 ? 'ies' : ''}`;
    if (daysSinceLastInbound != null) {
      replyText += ` (last reply ${daysSinceLastInbound === 0 ? 'today' : `${daysSinceLastInbound} day(s) ago`})`;
    }
    reasons.push(`Customer Engagement: ${replyText}`);
  } else {
    reasons.push('Customer Engagement: No inbound replies received');
  }

  if (hasOpenConversation) {
    reasons.push('Active Conversation: Open sales thread');
  }

  // 4. Evaluate Source
  const cleanSource = (source || 'Direct / Unknown').trim();
  const lowerSource = cleanSource.toLowerCase();
  const isHighIntentSource = ['website', 'demo', 'form', 'google', 'ads', 'inbound'].some((kw) => lowerSource.includes(kw));

  reasons.push(`Lead Source: ${cleanSource}${isHighIntentSource ? ' (High-intent channel)' : ''}`);

  // 5. Deterministic Category Decision Rules
  let category = 'COLD';

  const isHighIntentForm = formIntent === 'High';
  const isModerateIntentForm = formIntent === 'Moderate';

  if (
    score >= 60 ||
    (score >= 35 && (isHighIntentForm || hasRecentReply)) ||
    (isHighIntentForm && hasCustomerReplied)
  ) {
    category = 'HOT';
  } else if (
    score >= 25 ||
    isHighIntentForm ||
    isModerateIntentForm ||
    hasCustomerReplied ||
    isHighIntentSource
  ) {
    category = 'WARM';
  } else {
    category = 'COLD';
  }

  return { category, reasons, score };
}

/**
 * Computes and persists lead category for a specific lead in a workspace.
 */
export async function computeLeadCategory(workspaceId, leadId) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, workspaceId },
    include: {
      contact: true,
      LeadFormSubmission: {
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    },
  });

  if (!lead) {
    const e = new Error('Lead not found'); e.status = 404; throw e;
  }

  // Re-compute lead score to ensure recency
  const scoreResult = await computeLeadScore(workspaceId, lead.contactId);

  // Fetch inbound message stats for contact
  const [lastInbound, inboundCount, openConversation] = await Promise.all([
    prisma.message.findFirst({
      where: { direction: 'INBOUND', conversation: { contactId: lead.contactId, workspaceId } },
      orderBy: { sentAt: 'desc' },
      select: { sentAt: true },
    }),
    prisma.message.count({
      where: { direction: 'INBOUND', conversation: { contactId: lead.contactId, workspaceId } },
    }),
    prisma.conversation.findFirst({
      where: { contactId: lead.contactId, workspaceId, status: { in: ['OPEN', 'PENDING'] } },
      select: { id: true },
    }),
  ]);

  const now = Date.now();
  const daysSinceLastInbound = lastInbound
    ? Math.floor((now - lastInbound.sentAt.getTime()) / DAY_MS)
    : null;

  const { category, reasons, score } = evaluateLeadCategory({
    score: scoreResult.score,
    source: lead.source,
    submissions: lead.LeadFormSubmission,
    inboundMessageCount: inboundCount,
    daysSinceLastInbound,
    hasOpenConversation: Boolean(openConversation),
    optedOut: lead.contact.optedOut,
  });

  // Persist updated score & category
  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: {
      score,
      scoreFactors: scoreResult.factors,
      scoreComputedAt: scoreResult.computedAt,
      category,
      categoryReasons: reasons,
      categoryComputedAt: new Date(),
    },
    include: {
      contact: { select: { id: true, name: true, phoneNumber: true, email: true, optedOut: true } },
      owner: { select: { id: true, name: true, email: true } },
    },
  });

  if (lead.category !== category) {
    emitCrmEvent(workspaceId, 'lead_category_changed', {
      leadId,
      contactId: lead.contactId,
      category,
      previousCategory: lead.category,
    });
  }

  return updated;
}

/**
 * Recalculates lead category for all active leads in a workspace.
 */
export async function recalculateAllLeadCategories(workspaceId) {
  const leads = await prisma.lead.findMany({
    where: { workspaceId },
    select: { id: true },
  });

  const results = [];
  for (const lead of leads) {
    try {
      const res = await computeLeadCategory(workspaceId, lead.id);
      results.push(res);
    } catch (err) {
      console.error(`[LeadSegmentation] Failed to compute category for lead ${lead.id}:`, err.message);
    }
  }

  return { total: leads.length, updated: results.length };
}
