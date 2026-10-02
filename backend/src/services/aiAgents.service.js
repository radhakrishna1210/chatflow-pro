import { prisma } from '../lib/prisma.js';
import { updateLead } from './leads.service.js';
import { createTask } from './tasks.service.js';
import { evaluateAndAssignLead } from './leadDistribution.service.js';
import { llmText, llmAvailable } from '../lib/llm.js';
import { escalateToHuman } from './intentRouting.service.js';
import { deployAgent, undeployAgent } from './aiAgent.service.js';

// Starter agents shown until a workspace saves its own. Deliberately
// business-neutral: they are offered to every tenant, whatever it sells.
const DEFAULT_AGENTS = [
  {
    id: 'agent_customer_support',
    name: 'Customer Support Agent',
    role: 'AGENT',
    description: 'Answers common customer questions and hands anything it cannot resolve to a person.',
    purpose: 'Give quick, accurate answers to customer questions about orders, services and policies, using only the business\'s own information.',
    systemPrompt: `You are the customer support agent for this business. Answer politely, clearly and briefly using only the information you have been given. If a customer is unhappy, asks about a refund or complaint, or asks for a person, offer to hand the conversation to the team. Never invent prices, policies or delivery dates.`,
    guidelines: ['g_no_invented_facts', 'g_polite_tone', 'g_escalate'],
    actions: ['crm.escalate_human', 'crm.create_task'],
    knowledgeTypes: ['FAQ'],
    isDefault: true,
    enabled: true,
  },
  {
    id: 'agent_lead_qualification',
    name: 'Lead Qualification Agent',
    role: 'AGENT',
    description: 'Welcomes new enquiries, asks a few qualifying questions and routes promising leads to the sales team.',
    purpose: 'Engage new inbound enquiries, understand what the customer needs and their timeline, and pass qualified leads to sales.',
    systemPrompt: `You are the lead qualification agent for this business. Greet new enquiries warmly and ask, one at a time, what they are looking for, roughly when they need it, and how best to reach them. When they are a good fit, thank them and offer to set up a call with the team.`,
    guidelines: ['g_capture_contact', 'g_polite_tone'],
    actions: ['crm.qualify_lead', 'crm.assign_rep', 'crm.book_meeting'],
    knowledgeTypes: ['FAQ', 'PRODUCT_INFO'],
    isDefault: true,
    enabled: true,
  },
  {
    id: 'agent_product_info',
    name: 'Product Information Agent',
    role: 'AGENT',
    description: 'Explains products and services from the knowledge base without making promises it cannot keep.',
    purpose: 'Answer general questions about products, services, pricing and process strictly from the provided information.',
    systemPrompt: `You are the product information agent for this business. Answer questions about products, services and how things work strictly from the information provided. If you do not know, say so and offer to connect the customer with the team.`,
    guidelines: ['g_no_invented_facts', 'g_capture_contact'],
    actions: ['crm.book_meeting'],
    knowledgeTypes: ['PRODUCT_INFO'],
    isDefault: true,
    enabled: true,
  },
];

// Pre-defined guidelines catalog
const DEFAULT_GUIDELINES = [
  { id: 'g_no_invented_facts', title: 'Stick to the Facts Provided', description: 'Only state prices, policies, dates and product details that appear in the business\'s own information; say so when something is not known.', category: 'COMPLIANCE', severity: 'HIGH' },
  { id: 'g_polite_tone', title: 'Brand Voice', description: 'Maintain a professional, friendly and concise tone at all times.', category: 'BRAND', severity: 'MEDIUM' },
  { id: 'g_escalate', title: 'Escalate Complaints and Refunds', description: 'Complaints, refund requests, account or payment problems and requests for a person are handed to the team.', category: 'ESCALATION', severity: 'CRITICAL' },
  { id: 'g_capture_contact', title: 'Inbound Contact Capture', description: 'Confirm the best way to reach the customer before scheduling a call or sending documents.', category: 'OPERATIONS', severity: 'MEDIUM' },
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
      enabled: data.enabled !== false,
      isDefault: false,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    };
  });
}

// The author recorded on the SavedView row. The controllers always pass the
// acting user; without one the row is attributed to one of this workspace's
// admins — never to a user from another tenant.
async function resolveUserId(workspaceId, explicitUserId) {
  if (explicitUserId) return explicitUserId;
  const admin = await prisma.workspaceMember.findFirst({
    where: { workspaceId, role: 'ADMIN' },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true },
  });
  if (admin?.userId) return admin.userId;
  throw httpError(400, 'A workspace user is required to save this.');
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
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
          enabled: merged.enabled,
        },
        isShared: true,
        createdByUserId: validUserId,
      },
    });
    return { ...merged, id: created.id, isDefault: false };
  }

  const existing = await prisma.savedView.findFirst({
    where: { id: agentId, workspaceId, entity: 'ai_agent' },
  });
  if (!existing) {
    throw httpError(404, 'Agent not found');
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

// Every id an action receives comes from the caller, so each one is resolved
// inside this workspace before anything is written against it.
async function scopedLead(workspaceId, leadId) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId }, select: { id: true, contactId: true } });
  if (!lead) throw httpError(404, 'Lead not found');
  return lead;
}

async function scopedContactId(workspaceId, contactId) {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, workspaceId }, select: { id: true } });
  if (!contact) throw httpError(404, 'Contact not found');
  return contact.id;
}

/**
 * Execute an AI Action Tool against the CRM
 */
export async function executeAction(workspaceId, actionId, params = {}, user = null) {
  const { leadId, contactId, conversationId, assignedToUserId, note, dueInDays, title } = params;

  switch (actionId) {
    case 'crm.qualify_lead': {
      if (!leadId) throw httpError(400, 'leadId is required to qualify lead');
      // updateLead resolves the lead inside this workspace (and the acting
      // user's record scope), so a foreign id is a 404 here.
      const updated = await updateLead(workspaceId, leadId, {
        status: 'QUALIFIED',
        score: 85,
        category: 'HOT',
      }, user);
      await prisma.crmActivity.create({
        data: {
          workspaceId,
          leadId: updated.id,
          contactId: updated.contactId,
          createdByUserId: user?.id ?? null,
          type: 'NOTE',
          content: `[AI Agent Action] Automatically qualified lead based on screening criteria. Score adjusted to 85 (HOT).`,
        },
      });
      return { success: true, lead: updated };
    }

    case 'crm.assign_rep': {
      if (!leadId) throw httpError(400, 'leadId is required to assign rep');
      const lead = await scopedLead(workspaceId, leadId);
      const assigned = await evaluateAndAssignLead(workspaceId, lead.id);
      return { success: true, assignment: assigned };
    }

    case 'crm.create_task': {
      // createTask checks that the lead, contact and assignee belong to this
      // workspace before writing.
      const task = await createTask(workspaceId, {
        title: title || 'Follow up with qualified prospect',
        description: note || 'AI Agent scheduled follow up based on customer interest',
        dueDate: new Date(Date.now() + (dueInDays || 1) * 86400000).toISOString(),
        leadId,
        contactId,
        assignedToUserId,
      }, user?.id);
      return { success: true, task };
    }

    case 'crm.book_meeting': {
      if (!leadId) throw httpError(400, 'leadId is required');
      const lead = await scopedLead(workspaceId, leadId);
      const activityContactId = contactId ? await scopedContactId(workspaceId, contactId) : lead.contactId;
      const act = await prisma.crmActivity.create({
        data: {
          workspaceId,
          leadId: lead.id,
          contactId: activityContactId,
          createdByUserId: user?.id ?? null,
          type: 'MEETING',
          content: `[AI Meeting Booked] ${note || 'Introductory consultation scheduled with partner team.'}`,
        },
      });
      return { success: true, activity: act };
    }

    case 'crm.escalate_human': {
      if (!conversationId && !contactId) throw httpError(400, 'conversationId or contactId is required');
      const conversation = await prisma.conversation.findFirst({
        where: conversationId ? { id: conversationId, workspaceId } : { contactId, workspaceId },
        orderBy: { lastMessageAt: 'desc' },
        select: { id: true, contact: { select: { id: true, name: true, phoneNumber: true } } },
      });
      if (!conversation) throw httpError(404, 'Conversation not found');
      // The same handoff the live WhatsApp agent uses: reopens the thread
      // unassigned, stops automation on it and notifies the workspace.
      await escalateToHuman({
        workspaceId,
        conversationId: conversation.id,
        contact: conversation.contact,
        reason: note || 'Escalated by an AI agent action',
      });
      return { success: true, conversationId: conversation.id, message: 'Conversation handed to a human in the inbox' };
    }

    default:
      throw httpError(400, `Unknown action: ${actionId}`);
  }
}

/**
 * Channel deployments.
 *
 * WhatsApp is the only channel an agent from this page can actually answer on:
 * the live WhatsApp AI agent is the workspace's aiAgent* configuration, and
 * this page can apply a saved agent's persona to it and deploy/undeploy it
 * through the same service the WhatsApp AI Agent page uses. Website-widget and
 * Instagram toggles used to be listed here too, but nothing ever read them, so
 * they are not offered.
 */
export const CHANNEL_KEYS = ['whatsapp'];

/**
 * List channels with their real deployment state
 */
export async function listChannels(workspaceId) {
  const [saved, agents, ws, connectedNumbers] = await Promise.all([
    prisma.savedView.findFirst({ where: { workspaceId, entity: 'ai_channel_bot', name: 'whatsapp' } }),
    listAgents(workspaceId),
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { aiAgentEnabled: true, aiAgentName: true, aiAgentDeployedAt: true },
    }),
    prisma.waNumber.count({ where: { workspaceId } }),
  ]);

  const filters = saved && typeof saved.filters === 'object' && saved.filters !== null ? saved.filters : {};
  const assigned = agents.find((a) => a.id === filters.assignedAgentId) || null;
  const deployed = ws?.aiAgentEnabled === true;

  let status = 'Not deployed';
  if (connectedNumbers === 0) status = 'No WhatsApp number connected';
  else if (deployed) status = 'Live';

  return [{
    channelKey: 'whatsapp',
    channel: 'WhatsApp',
    icon: 'phone',
    assignedAgentId: assigned?.id ?? null,
    assignedAgent: assigned?.name ?? null,
    // The persona the live bot is actually using, which may have been edited on
    // the WhatsApp AI Agent page since an agent was applied here.
    liveAgentName: ws?.aiAgentName || null,
    enabled: deployed,
    deployedAt: ws?.aiAgentDeployedAt ?? null,
    connectedNumbers,
    live: deployed && connectedNumbers > 0,
    status,
  }];
}

/**
 * Apply an agent to the WhatsApp channel and/or deploy or undeploy it
 */
export async function updateChannel(workspaceId, channelKey, updates, userId) {
  if (!CHANNEL_KEYS.includes(channelKey)) throw httpError(404, 'Unknown channel');

  if (updates.assignedAgentId !== undefined) {
    const agents = await listAgents(workspaceId);
    const assigned = agents.find((a) => a.id === updates.assignedAgentId);
    if (!assigned) throw httpError(404, 'Agent not found');

    const existing = await prisma.savedView.findFirst({
      where: { workspaceId, entity: 'ai_channel_bot', name: channelKey },
    });
    const filters = { channelKey, assignedAgentId: assigned.id, updatedAt: new Date().toISOString() };
    if (existing) {
      await prisma.savedView.update({ where: { id: existing.id }, data: { filters } });
    } else {
      await prisma.savedView.create({
        data: {
          workspaceId,
          entity: 'ai_channel_bot',
          name: channelKey,
          filters,
          isShared: true,
          createdByUserId: await resolveUserId(workspaceId, userId),
        },
      });
    }

    // Applying an agent replaces the live bot's name and persona prompt — the
    // UI says so. Purpose, instructions, knowledge and guardrails stay as they
    // are on the WhatsApp AI Agent page.
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        aiAgentName: assigned.name.slice(0, 80),
        aiAgentPrompt: String(assigned.systemPrompt || '').slice(0, 4000),
      },
    });
  }

  // Same checks as the WhatsApp AI Agent page's Deploy button (prompt present,
  // LLM configured) — flipping aiAgentEnabled directly skipped them.
  if (updates.enabled === true) await deployAgent(workspaceId);
  else if (updates.enabled === false) await undeployAgent(workspaceId);

  const [channel] = await listChannels(workspaceId);
  return { success: true, channel };
}

/**
 * Test an agent's reply with the configured LLM.
 *
 * Without a provider, or when the model returns nothing, this says so
 * ({ ok: false, reason }) instead of returning canned text — a scripted reply
 * here looked exactly like a working agent. No CRM actions are run or implied:
 * the test lab only shows what the agent would say.
 */
export async function testAgent(workspaceId, agentId, userMessage) {
  const agents = await listAgents(workspaceId);
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) throw httpError(404, 'Agent not found');

  const base = { agentId: agent.id, agentName: agent.name, timestamp: new Date().toISOString() };
  if (!llmAvailable()) {
    return { ...base, ok: false, reply: null, reason: 'No LLM provider is configured (set GEMINI_API_KEY), so the agent cannot generate replies.' };
  }

  const guidelines = await listGuidelines(workspaceId);
  const chosen = Array.isArray(agent.guidelines) && agent.guidelines.length
    ? guidelines.filter((g) => agent.guidelines.includes(g.id))
    : guidelines.slice(0, 3);
  const guidelinesSummary = chosen.map((g) => `- ${g.title}: ${g.description}`).join('\n');
  const system = `${agent.systemPrompt || 'You are a helpful customer conversation agent.'}
${guidelinesSummary ? `\nGUIDELINES:\n${guidelinesSummary}\n` : ''}
Tone: professional, helpful, concise (1-3 sentences). Do not invent facts.`;

  const reply = await llmText(String(userMessage || ''), system);
  if (!reply || !reply.trim()) {
    return { ...base, ok: false, reply: null, reason: 'The model did not return a reply. Try again.' };
  }
  return { ...base, ok: true, reply: reply.trim() };
}
