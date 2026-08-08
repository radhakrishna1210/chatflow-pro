import { prisma } from '../lib/prisma.js';
import { llmText, llmAvailable } from '../lib/llm.js';
import { hasMeaningfulText } from '../lib/textValidation.js';
import {
  resolveCampaignContext, generateCampaignReply,
  loadBusinessContext, lastCampaignContextForConversation,
} from './campaignAi.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// AI Agent + AI Intent Matching
//
// Both features hook into the inbound-message handler (webhook.service.js):
//   1. Intent Matching — fuzzy-scores an inbound message against the
//      workspace's keyword triggers and returns the best one above a threshold,
//      even when there is no exact/contains match. Uses the LLM to classify
//      when available, and a deterministic token-overlap scorer otherwise, so
//      it works with or without a Gemini/Ollama key.
//   2. AI Agent — an LLM-backed fallback responder that answers free-form
//      questions using a configurable system prompt + knowledge base. Only
//      fires when it's been explicitly deployed AND no trigger/welcome/OOO reply
//      already applies.
// ─────────────────────────────────────────────────────────────────────────────

// ---- Config CRUD --------------------------------------------------------------

export async function getAgentConfig(workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      aiAgentEnabled: true, aiAgentName: true, aiAgentPrompt: true,
      aiAgentKnowledge: true, aiAgentModel: true, aiAgentDeployedAt: true,
      intentMatchingEnabled: true, intentMatchThreshold: true,
    },
  });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  return { ...ws, llmAvailable: llmAvailable() };
}

// Rejects emoji/symbol-only text using the same shared rule validators/index.js
// wraps into a Zod schema — this layer isn't behind a validate() Zod route
// yet, so it calls the plain predicate directly instead of duplicating a regex.
function assertMeaningfulIfPresent(value, label) {
  const trimmed = value.trim();
  if (trimmed && !hasMeaningfulText(trimmed)) {
    const e = new Error(`${label} must contain at least one letter`);
    e.status = 400;
    throw e;
  }
}

export async function updateAgentConfig(workspaceId, updates) {
  const data = {};
  if (typeof updates.name === 'string') {
    assertMeaningfulIfPresent(updates.name, 'Agent name');
    data.aiAgentName = updates.name.slice(0, 80);
  }
  if (typeof updates.systemPrompt === 'string') {
    assertMeaningfulIfPresent(updates.systemPrompt, 'System prompt');
    data.aiAgentPrompt = updates.systemPrompt.slice(0, 4000);
  }
  if (typeof updates.knowledge === 'string') data.aiAgentKnowledge = updates.knowledge.slice(0, 12000);
  if (typeof updates.model === 'string') data.aiAgentModel = updates.model.slice(0, 60);
  const ws = await prisma.workspace.update({ where: { id: workspaceId }, data, select: {
    aiAgentEnabled: true, aiAgentName: true, aiAgentPrompt: true, aiAgentKnowledge: true,
    aiAgentModel: true, aiAgentDeployedAt: true,
  }});
  return ws;
}

// Deploy = validate config, then flip enabled + stamp deployedAt. We refuse to
// "deploy" an agent with an empty prompt (that was the old fake behaviour).
export async function deployAgent(workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { aiAgentPrompt: true },
  });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  if (!ws.aiAgentPrompt || ws.aiAgentPrompt.trim().length < 10) {
    const e = new Error('Add a system prompt (at least 10 characters) before deploying the agent.');
    e.status = 400; throw e;
  }
  if (!llmAvailable()) {
    const e = new Error('No LLM provider is configured (set GEMINI_API_KEY). The agent cannot generate replies without one.');
    e.status = 400; throw e;
  }
  return prisma.workspace.update({
    where: { id: workspaceId },
    data: { aiAgentEnabled: true, aiAgentDeployedAt: new Date() },
    select: { aiAgentEnabled: true, aiAgentDeployedAt: true, aiAgentName: true },
  });
}

export async function undeployAgent(workspaceId) {
  return prisma.workspace.update({
    where: { id: workspaceId },
    data: { aiAgentEnabled: false },
    select: { aiAgentEnabled: true },
  });
}

export async function setIntentMatching(workspaceId, { enabled, threshold }) {
  const data = {};
  if (typeof enabled === 'boolean') data.intentMatchingEnabled = enabled;
  if (typeof threshold === 'number' && threshold >= 0 && threshold <= 1) data.intentMatchThreshold = threshold;
  return prisma.workspace.update({
    where: { id: workspaceId }, data,
    select: { intentMatchingEnabled: true, intentMatchThreshold: true },
  });
}

// ---- Agent directory ----------------------------------------------------------
//
// The agent is workspace-scoped configuration (aiAgent* on Workspace), so a
// workspace has exactly one and its id *is* the workspace id. Campaigns still
// store that id rather than a boolean, so the link keeps meaning something if a
// workspace ever gains a second agent — and so the campaign can be checked
// against the agent it actually names.

export async function listAgents(workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { aiAgentEnabled: true, aiAgentName: true, aiAgentPrompt: true, aiAgentModel: true, aiAgentDeployedAt: true },
  });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  return [{
    id: workspaceId,
    name: ws.aiAgentName,
    deployed: ws.aiAgentEnabled === true,
    deployedAt: ws.aiAgentDeployedAt,
    model: ws.aiAgentModel,
    hasPrompt: Boolean(ws.aiAgentPrompt?.trim()),
  }];
}

// Resolves an agent id supplied by a client. Never trusts it: an id that isn't
// this workspace's agent is rejected rather than silently coerced, which is
// what stops a campaign in one workspace naming another workspace's agent.
export async function getAgent(workspaceId, agentId) {
  const [agent] = await listAgents(workspaceId);
  if (agentId && agentId !== agent.id) {
    const e = new Error('That AI agent does not belong to this workspace'); e.status = 404; throw e;
  }
  return agent;
}

// Campaigns currently pointing at this workspace's agent, for the "Campaign
// Usage" panel on the agent page.
export async function listAgentCampaigns(workspaceId, agentId = null) {
  if (agentId) await getAgent(workspaceId, agentId);
  const campaigns = await prisma.campaign.findMany({
    where: { workspaceId, aiAgentEnabled: true, ...(agentId ? { aiAgentId: agentId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true, name: true, status: true, aiAgentCtaLabel: true, aiAgentId: true,
      totalContacts: true, launchedAt: true, createdAt: true,
    },
  });

  // How many people are talking to the agent about a campaign right now.
  const live = await prisma.campaignAiSession.groupBy({
    by: ['campaignId'],
    where: { workspaceId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
    _count: { _all: true },
  }).catch(() => []);
  const liveByCampaign = Object.fromEntries(live.map((row) => [row.campaignId, row._count._all]));

  return {
    total: campaigns.length,
    campaigns: campaigns.map((c) => ({ ...c, activeSessions: liveByCampaign[c.id] ?? 0 })),
  };
}

// ---- Intent matching ----------------------------------------------------------

const STOPWORDS = new Set(['the','a','an','is','are','to','of','for','and','or','i','you','my','me','we','it','this','that','can','do','please','hi','hello','hey','want','need']);

function tokenize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t && !STOPWORDS.has(t));
}

// Deterministic similarity: Jaccard token overlap + keyword-substring bonus.
// Returns 0..1. Used when no LLM is available.
function scoreOverlap(message, keyword) {
  const mTokens = new Set(tokenize(message));
  const kTokens = tokenize(keyword);
  if (kTokens.length === 0 || mTokens.size === 0) return 0;
  let hits = 0;
  for (const k of kTokens) if (mTokens.has(k)) hits++;
  const jaccard = hits / (mTokens.size + kTokens.length - hits);
  const substringBonus = String(message).toLowerCase().includes(String(keyword).toLowerCase()) ? 0.4 : 0;
  return Math.min(1, jaccard + substringBonus);
}

// Returns the best matching trigger for an inbound message, or null. Tries the
// LLM classifier first (when available) for real intent understanding, then
// falls back to the deterministic scorer.
export async function matchIntent(workspaceId, messageBody) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { intentMatchingEnabled: true, intentMatchThreshold: true },
  });
  if (!ws?.intentMatchingEnabled) return null;

  const triggers = await prisma.automationTrigger.findMany({ where: { workspaceId, isActive: true } });
  if (triggers.length === 0) return null;

  const threshold = ws.intentMatchThreshold ?? 0.6;

  // 1. LLM classifier — pick the best keyword or NONE.
  if (llmAvailable()) {
    const list = triggers.map((t, i) => `${i + 1}. ${t.keyword}`).join('\n');
    const system = `You route a customer's WhatsApp message to the single best-matching automation keyword. Reply with ONLY the number of the best match, or "0" if none fit well.`;
    const prompt = `Message: "${messageBody}"\n\nKeywords:\n${list}\n\nBest match number:`;
    const raw = await llmText(prompt, system);
    if (raw) {
      const n = parseInt(String(raw).match(/\d+/)?.[0] ?? '0', 10);
      if (n >= 1 && n <= triggers.length) {
        return { trigger: triggers[n - 1], score: 1, method: 'llm' };
      }
      if (n === 0) return null;
    }
  }

  // 2. Deterministic fallback.
  let best = null;
  for (const t of triggers) {
    const score = scoreOverlap(messageBody, t.keyword);
    if (!best || score > best.score) best = { trigger: t, score, method: 'overlap' };
  }
  if (best && best.score >= threshold) return best;
  return null;
}

// ---- AI Agent reply -----------------------------------------------------------

// Generates a free-form reply from the deployed agent, or null if the agent is
// not deployed / no LLM is available / generation fails. Keeps replies short.
export async function generateAgentReply(workspaceId, messageBody, { contactName, conversationId = null, waNumberId = null } = {}) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { aiAgentEnabled: true, aiAgentName: true, aiAgentPrompt: true, aiAgentKnowledge: true },
  });
  if (!ws?.aiAgentEnabled) return null;
  if (!llmAvailable()) return null;

  // Everything below is runtime context, read fresh from the database on every
  // message. None of it is stored in the agent's configuration: the system
  // prompt and knowledge base stay exactly what the workspace typed.
  //
  //   business  — who the customer is talking to, so "who sent this?" is
  //               answerable instead of being escalated to a human.
  //   context   — the campaign this conversation was last about, if any. The
  //               agent used to answer campaign follow-ups with no campaign in
  //               front of it once the session window closed.
  //   history   — the conversation so far, which is what makes a bare "yes"
  //               mean something. This call previously sent the current message
  //               alone.
  const [business, context, history] = await Promise.all([
    loadBusinessContext(workspaceId, waNumberId),
    lastCampaignContextForConversation(conversationId),
    recentConversationHistory(conversationId),
  ]);

  // Same generator as the campaign path, so both modes share one prompt, one
  // set of answer rules and one Gemini call — the only difference is whether
  // `context` is null.
  const agent = { name: ws.aiAgentName, prompt: ws.aiAgentPrompt, knowledge: ws.aiAgentKnowledge };
  return generateCampaignReply({ agent, context, business, messageBody, contactName, history });
}

// The tail of a conversation, oldest first. The inbound message being answered
// is already persisted by the webhook, so it is dropped here rather than being
// asked twice.
async function recentConversationHistory(conversationId, take = 12) {
  if (!conversationId) return [];
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { sentAt: 'desc' },
    take,
    select: { body: true, direction: true, sentAt: true },
  });
  return messages.reverse().slice(0, -1);
}


// Preview endpoint for the UI "test" button — runs the agent against a sample
// message without needing a real inbound webhook.
//
// `mode: 'campaign'` answers the way a customer who tapped that campaign's CTA
// would be answered: same prompt, same knowledge base, same campaign snapshot,
// same accuracy rules. That is the point — an admin has to be able to check the
// answers before spending money sending the campaign.
export async function testAgent(workspaceId, sampleMessage, { mode = 'general', campaignId = null } = {}) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { aiAgentPrompt: true, aiAgentKnowledge: true, aiAgentName: true },
  });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  if (!llmAvailable()) {
    return { ok: false, reason: 'No LLM provider configured (set GEMINI_API_KEY).', reply: null };
  }

  if (mode === 'campaign') {
    if (!campaignId) {
      const e = new Error('Select a campaign to test with campaign context'); e.status = 400; throw e;
    }
    // Scoped to the workspace, so a campaign id from another tenant resolves
    // to nothing rather than leaking its offer text.
    const context = await resolveCampaignContext({ workspaceId, campaignId });
    if (!context) { const e = new Error('Campaign not found'); e.status = 404; throw e; }

    // Same business identity the live agent answers with, so the test panel
    // reflects production rather than a thinner version of it.
    const business = await loadBusinessContext(workspaceId);
    const reply = await generateCampaignReply({
      agent: { name: ws.aiAgentName, prompt: ws.aiAgentPrompt, knowledge: ws.aiAgentKnowledge },
      context,
      business,
      messageBody: sampleMessage,
    });
    return reply
      ? { ok: true, reply, mode: 'campaign', context }
      : { ok: false, reason: 'The model did not return a reply. Try again.', reply: null, mode: 'campaign', context };
  }

  const system = [
    ws.aiAgentPrompt || 'You are a helpful support agent.',
    ws.aiAgentKnowledge ? `\nKnowledge base:\n${ws.aiAgentKnowledge}` : '',
    `\nReply in 1-3 short sentences.`,
  ].join('');
  const reply = await llmText(`Customer: ${sampleMessage}\n\n${ws.aiAgentName || 'Assistant'}:`, system);
  return reply
    ? { ok: true, reply: reply.replace(/^["']|["']$/g, '').trim(), mode: 'general' }
    : { ok: false, reason: 'The model did not return a reply. Try again.', reply: null, mode: 'general' };
}
