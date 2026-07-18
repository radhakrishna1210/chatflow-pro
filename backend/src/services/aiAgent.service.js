import { prisma } from '../lib/prisma.js';
import { llmText, llmAvailable } from '../lib/llm.js';

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

export async function updateAgentConfig(workspaceId, updates) {
  const data = {};
  if (typeof updates.name === 'string') data.aiAgentName = updates.name.slice(0, 80);
  if (typeof updates.systemPrompt === 'string') data.aiAgentPrompt = updates.systemPrompt.slice(0, 4000);
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
export async function generateAgentReply(workspaceId, messageBody, { contactName } = {}) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { aiAgentEnabled: true, aiAgentName: true, aiAgentPrompt: true, aiAgentKnowledge: true },
  });
  if (!ws?.aiAgentEnabled) return null;
  if (!llmAvailable()) return null;

  const system = [
    ws.aiAgentPrompt,
    ws.aiAgentKnowledge ? `\nKnowledge base you may use to answer:\n${ws.aiAgentKnowledge}` : '',
    `\nRules: Reply in 1-3 short sentences suitable for WhatsApp. If you don't know, say you'll connect them to a human. Never invent order numbers, prices, or policies not in the knowledge base.`,
  ].join('');
  const prompt = `${contactName ? `Customer (${contactName})` : 'Customer'}: ${messageBody}\n\n${ws.aiAgentName}:`;

  const reply = await llmText(prompt, system);
  if (!reply) return null;
  return reply.replace(/^["']|["']$/g, '').trim().slice(0, 900);
}

// Preview endpoint for the UI "test" button — runs the agent against a sample
// message without needing a real inbound webhook.
export async function testAgent(workspaceId, sampleMessage) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { aiAgentPrompt: true, aiAgentKnowledge: true, aiAgentName: true },
  });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  if (!llmAvailable()) {
    return { ok: false, reason: 'No LLM provider configured (set GEMINI_API_KEY).', reply: null };
  }
  const system = [
    ws.aiAgentPrompt || 'You are a helpful support agent.',
    ws.aiAgentKnowledge ? `\nKnowledge base:\n${ws.aiAgentKnowledge}` : '',
    `\nReply in 1-3 short sentences.`,
  ].join('');
  const reply = await llmText(`Customer: ${sampleMessage}\n\n${ws.aiAgentName || 'Assistant'}:`, system);
  return reply
    ? { ok: true, reply: reply.replace(/^["']|["']$/g, '').trim() }
    : { ok: false, reason: 'The model did not return a reply. Try again.', reply: null };
}
