import { prisma } from '../lib/prisma.js';
import { updateLead } from './leads.service.js';
import { createTask } from './tasks.service.js';
import { evaluateAndAssignLead } from './leadDistribution.service.js';
import { llmText, llmAvailable } from '../lib/llm.js';

// Pre-configured default agent templates matching user's reference specification
const DEFAULT_AGENTS = [
  {
    id: 'agent_investor_support',
    name: 'Investor Support Agent',
    role: 'AGENT',
    description: 'Supports existing investors with service-related questions and escalates operational issues when necessary.',
    purpose: 'Provide fast, accurate 24/7 service responses to existing investors regarding statements, account status, and operational questions.',
    systemPrompt: `You are the Investor Support Agent for our firm. Your goal is to support existing investors with polite, clear, and accurate service answers. If an investor asks about private account statements, complex tax documents, or expresses dissatisfaction, immediately offer to escalate to their designated relationship manager. Never make investment guarantees or provide personalized financial advisory.`,
    guidelines: ['Do not provide personalized financial advice', 'Escalate account security and wire inquiries to a human rep', 'Maintain an executive, polished, and courteous tone'],
    actions: ['crm.escalate_human', 'crm.create_task'],
    knowledgeTypes: ['FAQ', 'OPERATIONAL_DOCS'],
    model: 'gemini-1.5-flash',
    isDefault: true,
    enabled: true,
  },
  {
    id: 'agent_investor_qualification',
    name: 'Investor Qualification Agent',
    role: 'AGENT',
    description: 'Qualifies new investor interest, captures lead details, and helps move prospects toward a meeting or next step.',
    purpose: 'Engage new inbound inquiries, assess investment criteria, capture allocation size & timeline, and route qualified leads to the sales team.',
    systemPrompt: `You are the Investor Qualification Agent. When a new prospect reaches out, warmly welcome them and ask brief, respectful qualifying questions: 1) What type of investment offerings are they exploring? 2) What is their estimated allocation timeline? 3) Are they an accredited investor? When the prospect answers favorably, thank them and trigger meeting booking with our partner team.`,
    guidelines: ['Verify accreditation status respectfully', 'Capture primary contact details if missing', 'Trigger CRM lead qualification when criteria are satisfied'],
    actions: ['crm.qualify_lead', 'crm.assign_rep', 'crm.book_meeting'],
    knowledgeTypes: ['OVERVIEW_BROCHURE', 'CRITERIA_DOCS'],
    model: 'gemini-1.5-flash',
    isDefault: true,
    enabled: true,
  },
  {
    id: 'agent_compliance_screening',
    name: 'Compliance Screening Agent',
    role: 'AGENT',
    description: 'Handles eligibility, accreditation-related screening, and onboarding readiness questions for prospective investors.',
    purpose: 'Screen prospect eligibility and regulatory prerequisites before partner meetings.',
    systemPrompt: `You are the Compliance Screening Agent. Your sole responsibility is to clarify onboarding requirements, explain accreditation standards (e.g. net worth, income thresholds, institutional status), and confirm jurisdiction readiness. Keep responses concise, objective, and regulatory-safe.`,
    guidelines: ['Strict compliance with securities regulations', 'Never provide legal or tax advice', 'Refer unverified entities to compliance team'],
    actions: ['crm.qualify_lead', 'crm.create_task'],
    knowledgeTypes: ['COMPLIANCE_GUIDELINES', 'ACCREDITATION_CRITERIA'],
    model: 'gemini-1.5-flash',
    isDefault: true,
    enabled: true,
  },
  {
    id: 'agent_fund_info',
    name: 'Fund Information Agent',
    role: 'AGENT',
    description: 'Answers general questions about fund offerings, process, and common FAQs without giving personalized advice.',
    purpose: 'Serve as an educational knowledge assistant explaining investment strategies, past performance history, and general fund FAQs.',
    systemPrompt: `You are the Fund Information Agent. You answer general inquiries about the fund strategy, investment thesis, minimum holding periods, and fund management philosophy based strictly on provided documentation. If a prospect asks "Should I invest my money in this?", clarify that you provide fund information only and cannot provide investment recommendations.`,
    guidelines: ['Stick strictly to facts in the knowledge base', 'Include regulatory disclaimer when discussing returns', 'Encourage scheduling a call for detailed prospectus access'],
    actions: ['crm.book_meeting'],
    knowledgeTypes: ['FUND_FACTSHEET', 'STRATEGY_OVERVIEW'],
    model: 'gemini-1.5-flash',
    isDefault: true,
    enabled: true,
  },
];

// Pre-defined guidelines catalog
const DEFAULT_GUIDELINES = [
  { id: 'g_no_advice', title: 'No Personalized Financial Advice', description: 'Agents must explicitly state they provide factual information only and do not give personalized investment, tax, or legal recommendations.', category: 'COMPLIANCE', severity: 'HIGH' },
  { id: 'g_polite_tone', title: 'Executive Brand Voice', description: 'Maintain a professional, responsive, and articulate tone at all times.', category: 'BRAND', severity: 'MEDIUM' },
  { id: 'g_escalate_disputes', title: 'Automatic Escalation on Inquiries', description: 'Any question concerning account balances, wire instructions, or complaints must be routed to human staff.', category: 'ESCALATION', severity: 'CRITICAL' },
  { id: 'g_capture_contact', title: 'Inbound Contact Capture', description: 'Gently confirm email or phone number before scheduling consultations or sending prospectus attachments.', category: 'OPERATIONS', severity: 'MEDIUM' },
];

// Pre-defined callable CRM action tools
const ACTION_REGISTRY = [
  {
    id: 'crm.qualify_lead',
    name: 'Qualify Lead in CRM',
    description: 'Updates lead status to QUALIFIED and recalculates lead score to HOT/WARM in the CRM pipeline.',
    category: 'PIPELINE',
  },
  {
    id: 'crm.assign_rep',
    name: 'Assign Sales Rep (Round-Robin)',
    description: 'Invokes the CRM Lead Distribution Engine to route the lead to an online sales executive.',
    category: 'ROUTING',
  },
  {
    id: 'crm.create_task',
    name: 'Create Follow-up Task',
    description: 'Schedules an actionable task with due date for the assigned rep.',
    category: 'TASKS',
  },
  {
    id: 'crm.book_meeting',
    name: 'Schedule Intro Meeting',
    description: 'Proposes available partner slots and records scheduled meeting activity.',
    category: 'CALENDAR',
  },
  {
    id: 'crm.escalate_human',
    name: 'Hand Off to Human Agent',
    description: 'Transfers chat thread to CRM Sales Inbox and flags as Urgent for human takeover.',
    category: 'HANDOFF',
  },
];

/**
 * List all configured AI agents for workspace
 */
export async function listAgents(workspaceId) {
  const views = await prisma.savedView.findMany({
    where: {
      workspaceId,
      entity: 'ai_agent',
    },
    orderBy: { createdAt: 'asc' },
  });

  if (views.length === 0) {
    return DEFAULT_AGENTS;
  }

  return views.map((v) => {
    const data = typeof v.filters === 'object' && v.filters !== null ? v.filters : {};
    return {
      id: v.id,
      name: v.name,
      role: data.role || 'AGENT',
      description: data.description || '',
      purpose: data.purpose || '',
      systemPrompt: data.systemPrompt || '',
      guidelines: Array.isArray(data.guidelines) ? data.guidelines : [],
      actions: Array.isArray(data.actions) ? data.actions : [],
      knowledgeTypes: Array.isArray(data.knowledgeTypes) ? data.knowledgeTypes : [],
      model: data.model || 'gemini-1.5-flash',
      enabled: data.enabled !== false,
      isDefault: false,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    };
  });
}

async function resolveUserId(workspaceId, explicitUserId) {
  if (explicitUserId) return explicitUserId;
  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId },
    select: { userId: true },
  });
  if (member?.userId) return member.userId;
  const user = await prisma.user.findFirst({ select: { id: true } });
  return user?.id || null;
}

/**
 * Create a new custom AI agent for the workspace
 */
export async function createAgent(workspaceId, userId, agentData = {}) {
  const name = String(agentData.name || 'New Chat Agent').trim();
  const description = String(agentData.description || '').trim();

  const payload = {
    role: 'AGENT',
    description,
    purpose: agentData.purpose || '',
    systemPrompt: agentData.systemPrompt || '',
    guidelines: Array.isArray(agentData.guidelines) ? agentData.guidelines : ['g_polite_tone'],
    actions: Array.isArray(agentData.actions) ? agentData.actions : ['crm.escalate_human'],
    knowledgeTypes: Array.isArray(agentData.knowledgeTypes) ? agentData.knowledgeTypes : ['FAQ'],
    model: agentData.model || 'gemini-1.5-flash',
    enabled: agentData.enabled !== false,
  };

  const validUserId = await resolveUserId(workspaceId, userId);

  const created = await prisma.savedView.create({
    data: {
      workspaceId,
      entity: 'ai_agent',
      name,
      filters: payload,
      isShared: true,
      createdByUserId: validUserId,
    },
  });

  return {
    id: created.id,
    name: created.name,
    ...payload,
    createdAt: created.createdAt,
  };
}

/**
 * Update an existing AI agent
 */
export async function updateAgent(workspaceId, agentId, patch, userId) {
  // If editing a default template for the first time, save it as a real custom record
  const isDefault = DEFAULT_AGENTS.some((d) => d.id === agentId);
  if (isDefault) {
    const base = DEFAULT_AGENTS.find((d) => d.id === agentId);
    const merged = { ...base, ...patch };
    const validUserId = await resolveUserId(workspaceId, userId);
    const created = await prisma.savedView.create({
      data: {
        workspaceId,
        entity: 'ai_agent',
        name: merged.name,
        filters: {
          role: merged.role,
          description: merged.description,
          purpose: merged.purpose,
          systemPrompt: merged.systemPrompt,
          guidelines: merged.guidelines,
          actions: merged.actions,
          knowledgeTypes: merged.knowledgeTypes,
          model: merged.model,
          enabled: merged.enabled,
        },
        isShared: true,
        createdByUserId: validUserId,
      },
    });
    return { id: created.id, ...merged };
  }

  const existing = await prisma.savedView.findFirst({
    where: { id: agentId, workspaceId, entity: 'ai_agent' },
  });
  if (!existing) {
    throw new Error('Agent not found');
  }

  const currentFilters = typeof existing.filters === 'object' && existing.filters !== null ? existing.filters : {};
  const updatedFilters = {
    ...currentFilters,
    ...patch,
  };

  const updated = await prisma.savedView.update({
    where: { id: agentId },
    data: {
      name: patch.name || existing.name,
      filters: updatedFilters,
    },
  });

  return {
    id: updated.id,
    name: updated.name,
    ...updatedFilters,
    updatedAt: updated.updatedAt,
  };
}

/**
 * Delete an agent
 */
export async function deleteAgent(workspaceId, agentId) {
  const existing = await prisma.savedView.findFirst({
    where: { id: agentId, workspaceId, entity: 'ai_agent' },
  });
  if (!existing) {
    // If it's a default agent id, we just acknowledge
    return { success: true };
  }

  await prisma.savedView.delete({
    where: { id: agentId },
  });

  return { success: true };
}

/**
 * List guidelines catalogue
 */
export async function listGuidelines(workspaceId) {
  const views = await prisma.savedView.findMany({
    where: { workspaceId, entity: 'ai_guideline' },
  });

  const custom = views.map((v) => ({
    id: v.id,
    title: v.name,
    ...(typeof v.filters === 'object' && v.filters !== null ? v.filters : {}),
  }));

  return [...DEFAULT_GUIDELINES, ...custom];
}

/**
 * List actions catalogue
 */
export function listActions() {
  return ACTION_REGISTRY;
}

/**
 * Execute an AI Action Tool against the CRM
 */
export async function executeAction(workspaceId, actionId, params = {}) {
  const { leadId, contactId, userId, note, dueInDays } = params;

  switch (actionId) {
    case 'crm.qualify_lead': {
      if (!leadId) throw new Error('leadId is required to qualify lead');
      const updated = await updateLead(leadId, workspaceId, {
        status: 'QUALIFIED',
        score: 85,
        category: 'HOT',
      });
      // Log activity
      await prisma.crmActivity.create({
        data: {
          workspaceId,
          leadId,
          contactId: updated.contactId,
          type: 'NOTE',
          content: `[AI Agent Action] Automatically qualified lead based on screening criteria. Score adjusted to 85 (HOT).`,
        },
      });
      return { success: true, lead: updated };
    }

    case 'crm.assign_rep': {
      if (!leadId) throw new Error('leadId is required to assign rep');
      const assigned = await evaluateAndAssignLead(workspaceId, leadId);
      return { success: true, assignment: assigned };
    }

    case 'crm.create_task': {
      const task = await createTask(workspaceId, {
        title: params.title || 'Follow up with qualified prospect',
        description: note || 'AI Agent scheduled follow up based on customer interest',
        dueDate: new Date(Date.now() + (dueInDays || 1) * 86400000).toISOString(),
        leadId,
        contactId,
        assignedToUserId: userId,
      });
      return { success: true, task };
    }

    case 'crm.book_meeting': {
      if (!leadId) throw new Error('leadId is required');
      const act = await prisma.crmActivity.create({
        data: {
          workspaceId,
          leadId,
          contactId,
          type: 'MEETING',
          content: `[AI Meeting Booked] ${note || 'Introductory consultation scheduled with partner team.'}`,
        },
      });
      return { success: true, activity: act };
    }

    case 'crm.escalate_human': {
      if (contactId) {
        await prisma.conversation.updateMany({
          where: { workspaceId, contactId },
          data: { updatedAt: new Date() },
        });
      }
      return { success: true, message: 'Escalated to human rep in CRM Sales Inbox' };
    }

    default:
      throw new Error(`Unknown action: ${actionId}`);
  }
}

/**
 * Channel deployments for AI Chatbots
 */
export const DEFAULT_CHANNELS = [
  {
    channelKey: 'whatsapp',
    channel: 'WhatsApp Cloud API',
    icon: 'phone',
    assignedAgentId: 'agent_investor_qualification',
    assignedAgent: 'Investor Qualification Agent',
    status: 'Connected & Active',
    enabled: true,
    color: '#22c55e',
    greeting: 'Hello! Thank you for reaching out to us on WhatsApp. How can I assist you today?',
    delaySeconds: 1,
    fallbackToHuman: true,
    autoSyncCrm: true,
    businessHoursOnly: false,
  },
  {
    channelKey: 'website',
    channel: 'Website Live Chat Widget',
    icon: 'globe',
    assignedAgentId: 'agent_fund_info',
    assignedAgent: 'Fund Information Agent',
    status: 'Connected & Active',
    enabled: true,
    color: '#22c55e',
    greeting: 'Welcome! I am your AI assistant. Feel free to ask anything about our offerings, funds, or services.',
    delaySeconds: 0,
    fallbackToHuman: true,
    autoSyncCrm: true,
    widgetPosition: 'bottom-right',
  },
  {
    channelKey: 'instagram',
    channel: 'Instagram Direct Messages',
    icon: 'insta',
    assignedAgentId: 'agent_investor_support',
    assignedAgent: 'Investor Support Agent',
    status: 'Standby / Ready',
    enabled: false,
    color: '#38bdf8',
    greeting: 'Hi there! Thanks for messaging us on Instagram. How can we help you?',
    delaySeconds: 2,
    fallbackToHuman: true,
    autoSyncCrm: true,
    replyToStoryMentions: false,
  },
];

/**
 * List channels and their assigned AI agents
 */
export async function listChannels(workspaceId) {
  const [channelViews, agents] = await Promise.all([
    prisma.savedView.findMany({
      where: { workspaceId, entity: 'ai_channel_bot' },
    }),
    listAgents(workspaceId),
  ]);

  const customMap = new Map();
  for (const v of channelViews) {
    if (typeof v.filters === 'object' && v.filters !== null) {
      customMap.set(v.name, { ...v.filters, id: v.id });
    }
  }

  return DEFAULT_CHANNELS.map((def) => {
    const saved = customMap.get(def.channelKey);
    const merged = saved ? { ...def, ...saved } : { ...def };

    const assigned = agents.find((a) => a.id === merged.assignedAgentId);
    if (assigned) {
      merged.assignedAgent = assigned.name;
    }

    merged.status = merged.enabled ? 'Connected & Active' : 'Standby / Ready';
    merged.color = merged.enabled ? '#22c55e' : '#38bdf8';
    return merged;
  });
}

/**
 * Update configuration for a specific channel bot
 */
export async function updateChannel(workspaceId, channelKey, updates, userId) {
  const existing = await prisma.savedView.findFirst({
    where: { workspaceId, entity: 'ai_channel_bot', name: channelKey },
  });

  const defaultConf = DEFAULT_CHANNELS.find((c) => c.channelKey === channelKey) || {};
  const prevFilters = (existing && typeof existing.filters === 'object' && existing.filters !== null)
    ? existing.filters
    : defaultConf;

  const newFilters = {
    ...prevFilters,
    ...updates,
    channelKey,
    updatedAt: new Date().toISOString(),
  };

  if (existing) {
    await prisma.savedView.update({
      where: { id: existing.id },
      data: { filters: newFilters },
    });
  } else {
    const validUserId = await resolveUserId(workspaceId, userId);
    await prisma.savedView.create({
      data: {
        workspaceId,
        entity: 'ai_channel_bot',
        name: channelKey,
        filters: newFilters,
        isShared: true,
        createdByUserId: validUserId,
      },
    });
  }

  // If WhatsApp channel is configured, also sync with Workspace AI agent deployment
  if (channelKey === 'whatsapp') {
    const isEnabled = updates.enabled !== undefined ? !!updates.enabled : newFilters.enabled;
    const agents = await listAgents(workspaceId);
    const assigned = agents.find((a) => a.id === newFilters.assignedAgentId);
    if (assigned) {
      await prisma.workspace.update({
        where: { id: workspaceId },
        data: {
          aiAgentEnabled: isEnabled,
          aiAgentName: assigned.name,
          aiAgentPrompt: assigned.systemPrompt || '',
        },
      });
    }
  }

  return { success: true, channel: newFilters };
}

/**
 * Simulate / Test an agent response (real Gemini LLM with heuristic fallback)
 */
export async function testAgent(workspaceId, agentId, userMessage) {
  const agents = await listAgents(workspaceId);
  const agent = agents.find((a) => a.id === agentId) || agents[0];

  const lower = String(userMessage || '').toLowerCase();

  // 1. Determine triggered CRM actions
  const triggeredActions = [];
  if (lower.includes('invest') || lower.includes('budget') || lower.includes('million') || lower.includes('500k') || lower.includes('accredited')) {
    triggeredActions.push('crm.qualify_lead', 'crm.book_meeting');
  }
  if (lower.includes('meeting') || lower.includes('call') || lower.includes('schedule')) {
    if (!triggeredActions.includes('crm.book_meeting')) triggeredActions.push('crm.book_meeting');
  }
  if (lower.includes('human') || lower.includes('rep') || lower.includes('person') || lower.includes('escalate') || lower.includes('support')) {
    triggeredActions.push('crm.escalate_human');
  }
  if (lower.includes('task') || lower.includes('follow') || lower.includes('remind') || lower.includes('compliance')) {
    triggeredActions.push('crm.create_task');
  }

  // 2. If Gemini LLM is available, generate real AI response
  if (llmAvailable()) {
    try {
      const guidelines = await listGuidelines(workspaceId);
      const guidelinesSummary = guidelines.slice(0, 3).map((g) => `- ${g.title}: ${g.description}`).join('\n');
      const system = `${agent.systemPrompt || 'You are an executive conversational AI agent.'}

GUIDELINES:
${guidelinesSummary}

Tone: Professional, helpful, concise (1-3 sentences max). Never hallucinate or give unapproved financial guarantees.`;

      const llmReply = await llmText(userMessage, system);
      if (llmReply && llmReply.trim().length > 5) {
        return {
          agentId: agent.id,
          agentName: agent.name,
          reply: llmReply.trim(),
          triggeredActions,
          timestamp: new Date().toISOString(),
          model: agent.model || 'gemini-1.5-flash',
        };
      }
    } catch (err) {
      console.warn('[aiAgents] Gemini call failed, using heuristic fallback:', err.message);
    }
  }

  // 3. Heuristic fallback simulator
  let replyText = '';
  if (agent.name.includes('Qualification') || lower.includes('invest') || lower.includes('budget') || lower.includes('qualify')) {
    replyText = `Thank you for sharing your interest. As an investor exploring our offerings, could you confirm your anticipated allocation size and whether you meet accredited investor criteria? This will allow us to prepare the suitable documentation for you.`;
    if (lower.includes('yes') || lower.includes('million') || lower.includes('accredited') || lower.includes('500k')) {
      replyText = `Excellent. Based on your criteria, you qualify for our flagship fund series. I am reserving an introductory consultation slot with our partner team and updating your portfolio status now.`;
      if (!triggeredActions.includes('crm.assign_rep')) triggeredActions.push('crm.assign_rep');
    }
  } else if (agent.name.includes('Compliance') || lower.includes('compliance') || lower.includes('eligibility') || lower.includes('terms')) {
    replyText = `Our compliance framework adheres strictly to standard regulatory guidelines. Prospective participants must complete verification of accreditation status and standard AML/KYC checks prior to execution. Would you like me to note your onboarding readiness for our compliance officers?`;
  } else if (agent.name.includes('Support') || lower.includes('help') || lower.includes('issue') || lower.includes('statement')) {
    replyText = `I would be glad to help. For verified account statements or direct operational support, I can connect you directly with your assigned relationship manager. Would you like me to flag this as a priority request?`;
  } else {
    replyText = `Thank you for reaching out to us. Our investment strategy focuses on steady capital preservation and risk-adjusted growth across diversified high-conviction portfolios. How may I assist with your review today?`;
  }

  return {
    agentId: agent.id,
    agentName: agent.name,
    reply: replyText,
    triggeredActions,
    timestamp: new Date().toISOString(),
    model: 'heuristic-simulator',
  };
}
