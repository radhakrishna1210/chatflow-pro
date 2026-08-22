import { prisma } from '../lib/prisma.js';
import { extractDocumentText, truncateAtSentence } from '../lib/documentText.js';
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

// Escalation rules the agent understands. Stored as a JSON object rather than
// four booleans because the set grows: a new rule is a key here and a row in
// the UI, not a migration.
export const ESCALATION_RULES = [
  { id: 'refund',            label: 'Refund or complaint intent',  default: true  },
  { id: 'negativeSentiment', label: 'Negative sentiment detected', default: true  },
  { id: 'asksForHuman',      label: 'Customer asks for a human',   default: true  },
  { id: 'highIntent',        label: 'High purchase intent',        default: false },
];

const defaultEscalationRules = () =>
  Object.fromEntries(ESCALATION_RULES.map((r) => [r.id, r.default]));

const normaliseEscalationRules = (value) => {
  const base = defaultEscalationRules();
  if (!value || typeof value !== 'object') return base;
  for (const rule of ESCALATION_RULES) {
    if (typeof value[rule.id] === 'boolean') base[rule.id] = value[rule.id];
  }
  return base;
};

// How ready the agent is to answer, 0-100, with the reason it is not 100.
//
// Every component is something the operator can act on from this page, and the
// weights say what actually breaks an answer: an agent with no knowledge source
// invents things, an agent that is never deployed answers nobody. Purpose and
// instructions are polish by comparison.
function readiness({ ws, knowledgeSourceCount, intentRuleCount }) {
  const checks = [
    { id: 'identity',     label: 'Give the agent a name and a persona',        weight: 15, done: !!(ws.aiAgentName || '').trim() && (ws.aiAgentPrompt || '').trim().length > 30 },
    { id: 'purpose',      label: 'Describe what the agent is for',             weight: 10, done: (ws.aiAgentPurpose || '').trim().length > 10 },
    { id: 'knowledge',    label: 'Connect at least one knowledge source',      weight: 25, done: knowledgeSourceCount > 0 || (ws.aiAgentKnowledge || '').trim().length > 40 },
    { id: 'instructions', label: 'Add answering instructions',                 weight: 10, done: (ws.aiAgentInstructions || '').trim().length > 10 },
    { id: 'routing',      label: 'Add an intent so routing is not guesswork',  weight: 10, done: intentRuleCount > 0 },
    { id: 'escalation',   label: 'Choose when a human takes over',             weight: 10, done: ws.escalationRules != null },
    { id: 'safety',       label: 'State a safety guardrail',                   weight: 10, done: (ws.aiAgentSafetyNote || '').trim().length > 10 },
    { id: 'deployed',     label: 'Deploy the agent',                           weight: 10, done: ws.aiAgentEnabled === true },
  ];
  const score = checks.reduce((sum, c) => sum + (c.done ? c.weight : 0), 0);
  const next = checks.find((c) => !c.done) || null;
  return { score, nextStep: next ? next.label : null, checks };
}

// The columns that make up the agent's effective persona. Every call site that
// generates a reply selects exactly this set, so none of them can quietly miss
// one and start answering without the operator's safety rules.
export const AGENT_PROMPT_SELECT = {
  aiAgentName: true,
  aiAgentPrompt: true,
  aiAgentKnowledge: true,
  aiAgentPurpose: true,
  aiAgentInstructions: true,
  aiAgentSafetyNote: true,
  aiAgentLanguages: true,
};

// Folds the AI Agent page's sections into the one system prompt the model
// actually receives.
//
// The alternative — passing seven fields down to the generator — would have
// meant touching every call site and every prompt template. Composing here
// means the campaign path, the inbound path and the Test Lab all get the same
// agent, and a section added to the page later has one place to appear.
//
// Order matters: persona sets the voice, purpose sets the job, instructions
// constrain the form of the answer, and the guardrails come last so they read
// as the final word.
export function composeAgentPrompt(ws) {
  const parts = [];
  const persona = String(ws?.aiAgentPrompt || '').trim();
  parts.push(persona || 'You are a helpful customer support agent. Answer briefly and politely.');

  const purpose = String(ws?.aiAgentPurpose || '').trim();
  if (purpose) parts.push(`What you are for:\n${purpose}`);

  const instructions = String(ws?.aiAgentInstructions || '').trim();
  if (instructions) parts.push(`How to answer:\n${instructions}`);

  const languages = Array.isArray(ws?.aiAgentLanguages) ? ws.aiAgentLanguages.filter(Boolean) : [];
  if (languages.length) {
    parts.push(`Reply in the customer's own language. Languages this business supports: ${languages.join(', ')}.`);
  }

  const safety = String(ws?.aiAgentSafetyNote || '').trim();
  if (safety) parts.push(`Rules you must never break:\n${safety}`);

  return parts.join('\n\n');
}

export async function getAgentConfig(workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      aiAgentEnabled: true, aiAgentName: true, aiAgentPrompt: true,
      aiAgentKnowledge: true, aiAgentModel: true, aiAgentDeployedAt: true,
      intentMatchingEnabled: true, intentMatchThreshold: true,
      aiAgentPurpose: true, aiAgentInstructions: true, aiAgentSafetyNote: true,
      aiAgentLanguages: true, escalationThreshold: true, escalationRules: true,
    },
  });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }

  // Counted rather than fetched: the page loads knowledge sources from their
  // own endpoint, and this only needs to know whether there are any.
  const [knowledgeSourceCount, intentRuleCount] = await Promise.all([
    prisma.knowledgeSource.count({ where: { workspaceId } }),
    prisma.intentRule.count({ where: { workspaceId } }),
  ]);

  return {
    ...ws,
    aiAgentLanguages: Array.isArray(ws.aiAgentLanguages) ? ws.aiAgentLanguages : ['English'],
    escalationRules: normaliseEscalationRules(ws.escalationRules),
    llmAvailable: llmAvailable(),
    knowledgeSourceCount,
    intentRuleCount,
    readiness: readiness({ ws, knowledgeSourceCount, intentRuleCount }),
  };
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

  // The sections added alongside Identity. These are free prose handed to the
  // model, not commands it executes, so they are length-capped and otherwise
  // passed through. assertMeaningfulIfPresent is deliberately not applied here:
  // clearing a section back to empty is a valid edit, unlike clearing the
  // agent's name.
  if (typeof updates.purpose === 'string') data.aiAgentPurpose = updates.purpose.slice(0, 2000);
  if (typeof updates.instructions === 'string') data.aiAgentInstructions = updates.instructions.slice(0, 4000);
  if (typeof updates.safetyNote === 'string') data.aiAgentSafetyNote = updates.safetyNote.slice(0, 2000);
  if (Array.isArray(updates.languages)) {
    data.aiAgentLanguages = updates.languages
      .map((l) => String(l || '').trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 12);
  }
  if (updates.escalationThreshold !== undefined) {
    const n = Number(updates.escalationThreshold);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      const e = new Error('Escalation threshold must be between 0 and 1');
      e.status = 400;
      throw e;
    }
    data.escalationThreshold = n;
  }
  if (updates.escalationRules && typeof updates.escalationRules === 'object') {
    data.escalationRules = normaliseEscalationRules(updates.escalationRules);
  }

  await prisma.workspace.update({ where: { id: workspaceId }, data });
  // Re-read through getAgentConfig so the caller gets the recomputed readiness
  // score in the same response that saved the change. That score is the whole
  // feedback loop of the page, and a stale one is worse than none.
  return getAgentConfig(workspaceId);
}

// The knowledge base is one text column with a hard ceiling, so an uploaded
// document is appended to what is already there rather than replacing it — and
// when the result will not fit, it is cut at a sentence boundary and the caller
// is told exactly how much was dropped. Silently losing the back half of a
// price list is the one outcome worth going out of the way to avoid.
export const AGENT_KNOWLEDGE_LIMIT = 12000;

export async function appendKnowledgeDocument(workspaceId, { buffer, fileName, mimeType } = {}) {
  const { text, label } = await extractDocumentText({ buffer, fileName, mimeType });

  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { aiAgentKnowledge: true },
  });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }

  const existing = String(ws.aiAgentKnowledge || '').trim();
  // A heading keeps the agent's prompt readable once several documents have
  // been added, and tells the user which upload a passage came from.
  const block = `--- ${String(fileName || label).trim()} ---
${text}`;
  const combined = existing ? `${existing}

${block}` : block;

  const { text: stored, truncated, dropped } = truncateAtSentence(combined, AGENT_KNOWLEDGE_LIMIT);

  await prisma.workspace.update({ where: { id: workspaceId }, data: { aiAgentKnowledge: stored } });

  return {
    knowledge: stored,
    fileName: fileName || null,
    label,
    added: text.length,
    used: stored.length,
    limit: AGENT_KNOWLEDGE_LIMIT,
    truncated,
    dropped,
  };
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
export async function generateAgentReply(workspaceId, messageBody, { contactName, conversationId = null, waNumberId = null, intentHint = null } = {}) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { aiAgentEnabled: true, ...AGENT_PROMPT_SELECT },
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
  // An intent rule that routed here named what the customer is asking about.
  // Passing it on is the difference between the agent guessing the topic and
  // being told it — the operator wrote that rule precisely to say so.
  const prompt = intentHint
    ? `${composeAgentPrompt(ws)}

This message has been classified as being about: ${intentHint}. Answer on that basis.`
    : composeAgentPrompt(ws);

  const agent = { name: ws.aiAgentName, prompt, knowledge: ws.aiAgentKnowledge };
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
// ─── Grounding ───────────────────────────────────────────────────────────────
//
// The Test Lab shows, next to every answer, how much of that answer is
// traceable to material the agent was actually given.
//
// This is a measured quantity, not a model self-report. It is the share of the
// reply's distinctive content words that appear somewhere in the sources the
// agent was handed for this test. A reply built out of the campaign's own
// wording scores high; one the model produced from its own priors scores low —
// which is exactly the answer worth a second look before it reaches customers.
//
// It deliberately is not called "confidence". A model's confidence is its own
// opinion of itself; this is an external check on where the words came from.

// Words too common to be evidence of anything. Short enough to stay honest:
// the point is to drop filler, not to hand-tune the score.
const GROUNDING_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'as', 'that', 'this', 'these', 'those',
  'it', 'its', 'you', 'your', 'we', 'our', 'i', 'me', 'my', 'they', 'them', 'their', 'he', 'she',
  'can', 'will', 'would', 'should', 'could', 'may', 'might', 'do', 'does', 'did', 'have', 'has', 'had',
  'not', 'no', 'yes', 'so', 'than', 'then', 'there', 'here', 'what', 'when', 'where', 'which', 'who',
  'how', 'why', 'all', 'any', 'some', 'more', 'most', 'let', 'get', 'please', 'thanks', 'thank',
  'hi', 'hello', 'about', 'just', 'also', 'up', 'out', 'over', 'into', 'one', 'two',
]);

const contentWords = (text) => new Set(
  String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !GROUNDING_STOPWORDS.has(w)),
);

export function groundingScore(reply, sourceTexts) {
  const replyWords = contentWords(reply);
  if (replyWords.size === 0) return null;
  const haystack = contentWords(sourceTexts.filter(Boolean).join(' \n '));
  if (haystack.size === 0) return 0;
  let hits = 0;
  for (const w of replyWords) if (haystack.has(w)) hits += 1;
  return Math.round((hits / replyWords.size) * 100) / 100;
}

export async function testAgent(workspaceId, sampleMessage, { mode = 'general', campaignId = null } = {}) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: AGENT_PROMPT_SELECT,
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
      agent: { name: ws.aiAgentName, prompt: composeAgentPrompt(ws), knowledge: ws.aiAgentKnowledge },
      context,
      business,
      messageBody: sampleMessage,
    });
    if (!reply) {
      return { ok: false, reason: 'The model did not return a reply. Try again.', reply: null, mode: 'campaign', context };
    }
    // What the agent was actually handed, named the way the Test Lab labels it.
    // Reported rather than assumed: an empty knowledge base must not show up as
    // a source the answer could have come from.
    const contextText = [context.header, context.body, context.footer].filter(Boolean).join('\n');
    const sources = [{ kind: 'campaign', label: 'Campaign context' }];
    if ((ws.aiAgentKnowledge || '').trim()) sources.push({ kind: 'knowledge', label: 'Knowledge base' });
    if (business && Object.keys(business).length) sources.push({ kind: 'business', label: 'Business profile' });

    return {
      ok: true,
      reply,
      mode: 'campaign',
      context,
      sources,
      grounding: groundingScore(reply, [contextText, ws.aiAgentKnowledge, JSON.stringify(business || {})]),
    };
  }

  const system = [
    composeAgentPrompt(ws),
    ws.aiAgentKnowledge ? `\nKnowledge base:\n${ws.aiAgentKnowledge}` : '',
    `\nReply in 1-3 short sentences.`,
  ].join('');
  const reply = await llmText(`Customer: ${sampleMessage}\n\n${ws.aiAgentName || 'Assistant'}:`, system);
  if (!reply) {
    return { ok: false, reason: 'The model did not return a reply. Try again.', reply: null, mode: 'general' };
  }
  const clean = reply.replace(/^["']|["']$/g, '').trim();
  const sources = [];
  if ((ws.aiAgentKnowledge || '').trim()) sources.push({ kind: 'knowledge', label: 'Knowledge base' });
  if ((ws.aiAgentPrompt || '').trim()) sources.push({ kind: 'persona', label: 'Persona & instructions' });

  return {
    ok: true,
    reply: clean,
    mode: 'general',
    sources,
    grounding: groundingScore(clean, [ws.aiAgentKnowledge, ws.aiAgentPrompt]),
  };
}
