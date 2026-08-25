import { GoogleGenAI } from "@google/genai";
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { normalizeBusinessHours, mergeBusinessHours, isBusinessHoursEnabled, DEFAULT_BUSINESS_HOURS } from './businessHours.service.js';
import { detectUrl, analyseWebsite } from './websiteAnalysis.service.js';

// Lazily initialised: constructing the client at import time crashes startup
// when GEMINI_API_KEY is not configured (it's optional in the env schema).
let _ai = null;
let _aiKey = null;
function getAi() {
  const key = env.GEMINI_API_KEY;
  if (!key) return null;
  if (!_ai || _aiKey !== key) {
    _ai = new GoogleGenAI({ apiKey: key });
    _aiKey = key;
  }
  return _ai;
}

const ALLOWED_TRIGGER_SUBTYPES = new Set(['keyword', 'welcome', 'missed']);
const ALLOWED_ACTION_SUBTYPES = new Set(['message', 'delay', 'tag', 'agent']);

function createStep(index, type, subtype, value) {
  return {
    id: `step_${index}`,
    type,
    subtype,
    value: String(value || '').trim(),
  };
}

function cleanWorkflowPreview(raw, prompt) {
  const name = String(raw?.name || '').trim().slice(0, 80) || 'AI Generated Workflow';
  const sourceSteps = Array.isArray(raw?.nodes) ? raw.nodes : Array.isArray(raw?.steps) ? raw.steps : [];
  const steps = sourceSteps
    .map((step, index) => {
      const type = step?.type === 'trigger' ? 'trigger' : 'action';
      const subtype = String(step?.subtype || '').trim().toLowerCase();
      const allowed = type === 'trigger' ? ALLOWED_TRIGGER_SUBTYPES : ALLOWED_ACTION_SUBTYPES;
      const fallbackSubtype = type === 'trigger' ? 'keyword' : 'message';
      const safeSubtype = allowed.has(subtype) ? subtype : fallbackSubtype;
      const fallbackValue = type === 'trigger' ? inferKeyword(prompt) : 'Thanks for reaching out. Our team will help you shortly.';
      return createStep(index + 1, type, safeSubtype, step?.value || fallbackValue);
    })
    .filter((step) => step.value || step.subtype !== 'keyword');

  if (!steps.some((step) => step.type === 'trigger')) {
    steps.unshift(createStep(1, 'trigger', 'keyword', inferKeyword(prompt)));
  }
  if (!steps.some((step) => step.type === 'action')) {
    steps.push(createStep(steps.length + 1, 'action', 'message', 'Thanks for reaching out. Our team will help you shortly.'));
  }

  return {
    name,
    nodes: steps.slice(0, 8).map((step, index) => ({ ...step, id: `step_${index + 1}` })),
    edges: [],
  };
}

function inferKeyword(prompt) {
  const upper = String(prompt || '').toUpperCase();
  const pairs = [
    ['ORDER', ['ORDER', 'SHIP', 'DELIVERY', 'TRACK']],
    ['REFUND', ['REFUND', 'RETURN', 'CANCEL']],
    ['PRICE', ['PRICE', 'PRICING', 'COST', 'QUOTE']],
    ['DEMO', ['DEMO', 'BOOK', 'CALL', 'MEETING']],
    ['HELP', ['HELP', 'SUPPORT', 'ISSUE', 'PROBLEM']],
  ];
  const match = pairs.find(([, words]) => words.some((word) => upper.includes(word)));
  return match ? match[0] : 'HELP';
}

function fallbackWorkflowPreview(prompt) {
  const lower = String(prompt || '').toLowerCase();
  const keyword = inferKeyword(prompt);
  const name = lower.includes('refund')
    ? 'Refund Request Flow'
    : lower.includes('order') || lower.includes('delivery')
      ? 'Order Support Flow'
      : lower.includes('demo') || lower.includes('call')
        ? 'Demo Booking Flow'
        : 'AI Generated Workflow';

  const nodes = [
    createStep(1, 'trigger', lower.includes('new customer') || lower.includes('welcome') ? 'welcome' : 'keyword', keyword),
    createStep(2, 'action', 'message', lower.includes('refund')
      ? 'Thanks for contacting us about your refund. Please share your order ID and reason for return.'
      : lower.includes('demo') || lower.includes('call')
        ? 'Thanks for your interest. Please share your preferred date and time for a quick call.'
        : 'Thanks for reaching out. Please share a few details so we can help you faster.'),
  ];

  if (lower.includes('wait') || lower.includes('delay') || lower.includes('after')) {
    nodes.push(createStep(nodes.length + 1, 'action', 'delay', '5 min'));
  }
  if (lower.includes('agent') || lower.includes('human') || lower.includes('team')) {
    nodes.push(createStep(nodes.length + 1, 'action', 'agent', 'Support Team'));
  }
  if (lower.includes('tag') || lower.includes('lead') || lower.includes('vip')) {
    nodes.push(createStep(nodes.length + 1, 'action', 'tag', lower.includes('vip') ? 'VIP' : 'AI Lead'));
  }

  return { name, nodes, edges: [] };
}

function parseGeminiJson(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(jsonText);
}

export async function listTriggers(workspaceId) {
  return prisma.automationTrigger.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
}

// Normalized to uppercase so "hi"/"Hi"/"HI" are all treated as the same
// keyword for both duplicate detection and the unique DB constraint —
// matches the casing the frontend already sends.
const normalizeKeyword = (k) => String(k || '').trim().toUpperCase();

async function assertKeywordAvailable(workspaceId, keyword, excludeId) {
  const existing = await prisma.automationTrigger.findFirst({
    where: { workspaceId, keyword, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (existing) {
    const e = new Error('A trigger for this keyword already exists');
    e.status = 409;
    throw e;
  }
}

export async function createTrigger(workspaceId, { keyword, responseTemplate, isActive = true }) {
  const normalized = normalizeKeyword(keyword);
  await assertKeywordAvailable(workspaceId, normalized);
  try {
    return await prisma.automationTrigger.create({ data: { workspaceId, keyword: normalized, responseTemplate, isActive } });
  } catch (err) {
    // Defense in depth against a race between the check above and the insert.
    if (err.code === 'P2002') {
      const e = new Error('A trigger for this keyword already exists');
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

export async function updateTrigger(workspaceId, id, updates) {
  const trigger = await prisma.automationTrigger.findFirst({ where: { id, workspaceId } });
  if (!trigger) { const e = new Error('Trigger not found'); e.status = 404; throw e; }
  const data = {};
  if (updates.keyword !== undefined) {
    data.keyword = normalizeKeyword(updates.keyword);
    await assertKeywordAvailable(workspaceId, data.keyword, id);
  }
  if (updates.responseTemplate !== undefined) data.responseTemplate = updates.responseTemplate;
  if (updates.isActive !== undefined) data.isActive = updates.isActive;
  try {
    return await prisma.automationTrigger.update({ where: { id }, data });
  } catch (err) {
    if (err.code === 'P2002') {
      const e = new Error('A trigger for this keyword already exists');
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

export async function deleteTrigger(workspaceId, id) {
  const trigger = await prisma.automationTrigger.findFirst({ where: { id, workspaceId } });
  if (!trigger) { const e = new Error('Trigger not found'); e.status = 404; throw e; }
  await prisma.automationTrigger.delete({ where: { id } });
}

// Escapes a keyword for use inside a RegExp — keywords are user input and may
// contain ".", "+", "?" etc.
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole-word match. Plain `body.includes(keyword)` (the old behaviour) fired
// "HI" on "t-hi-s" and "ORDER" on "re-order-ed", so almost every message hit
// the first short keyword in the workspace. `\b` doesn't work for keywords
// with leading/trailing non-word characters, so the boundaries are asserted
// with lookarounds against the word-character class instead.
export function keywordMatches(keyword, messageBody) {
  const kw = String(keyword || '').trim();
  if (!kw) return false;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(kw)}(?![\\p{L}\\p{N}_])`, 'iu');
  return pattern.test(String(messageBody || ''));
}

export async function findMatchingTrigger(workspaceId, messageBody) {
  const triggers = await prisma.automationTrigger.findMany({
    where: { workspaceId, isActive: true },
  });
  // Longest keyword wins, then oldest — so "ORDER STATUS" beats "ORDER" and
  // the winner is stable instead of depending on row order.
  return triggers
    .filter((t) => keywordMatches(t.keyword, messageBody))
    .sort((a, b) => b.keyword.length - a.keyword.length || a.createdAt - b.createdAt)[0];
}

// The message bodies and working hours used to be hardcoded in
// webhook.service.js while this endpoint exposed only the three on/off flags —
// so the UI's "configure your greeting" and "set up your working hours" copy
// had nothing behind it. All of it is editable now.
const BASIC_AUTOMATION_FIELDS = {
  autoOooEnabled: true,
  autoWelcomeEnabled: true,
  autoDelayedEnabled: true,
  welcomeMessage: true,
  oooMessage: true,
  delayedMessage: true,
  delayedAfterMinutes: true,
  businessHours: true,
};

export async function getBasicAutomations(workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: BASIC_AUTOMATION_FIELDS,
  });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  return shapeBasicAutomations(ws);
}

// The stored blob carries both the schedule and the on/off switch; the API
// keeps exposing them as two fields.
function shapeBasicAutomations(ws) {
  const stored = ws.businessHours;
  return {
    ...ws,
    businessHours: stored && Array.isArray(stored.days) ? stored : DEFAULT_BUSINESS_HOURS,
    businessHoursEnabled: isBusinessHoursEnabled(stored),
  };
}

export async function updateBasicAutomations(workspaceId, updates) {
  const data = {};
  if (updates.autoOooEnabled !== undefined) data.autoOooEnabled = updates.autoOooEnabled;
  if (updates.autoWelcomeEnabled !== undefined) data.autoWelcomeEnabled = updates.autoWelcomeEnabled;
  if (updates.autoDelayedEnabled !== undefined) data.autoDelayedEnabled = updates.autoDelayedEnabled;
  if (updates.welcomeMessage !== undefined) data.welcomeMessage = updates.welcomeMessage;
  if (updates.oooMessage !== undefined) data.oooMessage = updates.oooMessage;
  if (updates.delayedMessage !== undefined) data.delayedMessage = updates.delayedMessage;
  if (updates.delayedAfterMinutes !== undefined) data.delayedAfterMinutes = updates.delayedAfterMinutes;
  // Schedule and on/off switch are edited independently — turning working hours
  // off must never discard the saved days (QA BUG-01).
  if (updates.businessHours !== undefined || updates.businessHoursEnabled !== undefined) {
    const current = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { businessHours: true },
    });
    if (!current) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
    // Validate an incoming schedule before merging so bad input still 400s.
    if (updates.businessHours) normalizeBusinessHours(updates.businessHours);
    data.businessHours = mergeBusinessHours(current.businessHours, {
      schedule: updates.businessHours,
      enabled: updates.businessHoursEnabled,
    });
  }

  const ws = await prisma.workspace.update({
    where: { id: workspaceId },
    data,
    select: BASIC_AUTOMATION_FIELDS,
  });
  return shapeBasicAutomations(ws);
}

// Voice AI Settings
const VOICE_FIELDS = {
  voiceAiEnabled: true,
  voiceAiName: true,
  voiceAiPrompt: true,
  // Where a call is transferred on human handoff.
  voiceAiPhone: true,
  // The number the AI receptionist actually answers on.
  voiceAiInboundPhone: true,
  voiceAiGreeting: true,
};

export async function getVoiceSettings(workspaceId) {
  return prisma.workspace.findUnique({ where: { id: workspaceId }, select: VOICE_FIELDS });
}

export async function updateVoiceSettings(workspaceId, updates) {
  const allowed = {};
  for (const key of Object.keys(VOICE_FIELDS)) {
    if (updates[key] !== undefined) allowed[key] = updates[key];
  }
  return prisma.workspace.update({ where: { id: workspaceId }, data: allowed, select: VOICE_FIELDS });
}

export async function generateWorkflowPreview(workspaceId, prompt) {
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) {
    const e = new Error('Workflow prompt is required');
    e.status = 400;
    throw e;
  }

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
  if (!workspace) {
    const e = new Error('Workspace not found');
    e.status = 404;
    throw e;
  }

  // A bare URL means "study this business and suggest workflows for it".
  // Anything else — including a description that merely mentions a domain —
  // keeps the original single-workflow behaviour untouched.
  const url = detectUrl(cleanPrompt);
  if (url) return analyseWebsite(url);

  if (!env.GEMINI_API_KEY) {
    return { ...fallbackWorkflowPreview(cleanPrompt), provider: 'fallback', fallbackReason: 'no_key' };
  }

  const systemPrompt = `Convert a plain-English WhatsApp automation request into JSON only.
Allowed step schema:
{"name":"short workflow name","nodes":[{"type":"trigger","subtype":"keyword|welcome|missed","value":"keyword or trigger value"},{"type":"action","subtype":"message|delay|tag|agent","value":"message, delay, tag, or agent"}],"edges":[]}
Rules:
- Return valid JSON only, no markdown.
- Include exactly one trigger as the first node.
- Use at most 6 nodes.
- Use concise customer-facing message text.
- If no clear trigger exists, use keyword HELP.`;

  try {
    const response = await getAi().models.generateContent({
      model: env.GEMINI_MODEL,
      contents: `${systemPrompt}\n\nUser request: ${cleanPrompt}`,
      config: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    });

    const text = response.text;

    return {
      ...cleanWorkflowPreview(parseGeminiJson(text), cleanPrompt),
      provider: "gemini",
    };
  } catch (err) {
    console.error('[Automation] Gemini workflow preview error:', err);
    return { ...fallbackWorkflowPreview(cleanPrompt), provider: 'fallback', fallbackReason: 'error' };
  }
}
