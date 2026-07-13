import { GoogleGenAI } from "@google/genai";
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';

// Lazily initialised: constructing the client at import time crashes startup
// when GEMINI_API_KEY is not configured (it's optional in the env schema).
let _ai = null;
function getAi() {
  if (!env.GEMINI_API_KEY) return null;
  if (!_ai) _ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
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

export async function createTrigger(workspaceId, { keyword, responseTemplate, isActive = true }) {
  return prisma.automationTrigger.create({ data: { workspaceId, keyword, responseTemplate, isActive } });
}

export async function updateTrigger(workspaceId, id, updates) {
  const trigger = await prisma.automationTrigger.findFirst({ where: { id, workspaceId } });
  if (!trigger) { const e = new Error('Trigger not found'); e.status = 404; throw e; }
  const data = {};
  if (updates.keyword !== undefined) data.keyword = updates.keyword;
  if (updates.responseTemplate !== undefined) data.responseTemplate = updates.responseTemplate;
  if (updates.isActive !== undefined) data.isActive = updates.isActive;
  return prisma.automationTrigger.update({ where: { id }, data });
}

export async function deleteTrigger(workspaceId, id) {
  const trigger = await prisma.automationTrigger.findFirst({ where: { id, workspaceId } });
  if (!trigger) { const e = new Error('Trigger not found'); e.status = 404; throw e; }
  await prisma.automationTrigger.delete({ where: { id } });
}

export async function findMatchingTrigger(workspaceId, messageBody) {
  const triggers = await prisma.automationTrigger.findMany({
    where: { workspaceId, isActive: true },
  });
  const lowerBody = messageBody.toLowerCase();
  return triggers.find((t) => lowerBody.includes(t.keyword.toLowerCase()));
}

export async function getBasicAutomations(workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      autoOooEnabled: true,
      autoWelcomeEnabled: true,
      autoDelayedEnabled: true,
    },
  });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  return ws;
}

export async function updateBasicAutomations(workspaceId, updates) {
  const data = {};
  if (updates.autoOooEnabled !== undefined) data.autoOooEnabled = updates.autoOooEnabled;
  if (updates.autoWelcomeEnabled !== undefined) data.autoWelcomeEnabled = updates.autoWelcomeEnabled;
  if (updates.autoDelayedEnabled !== undefined) data.autoDelayedEnabled = updates.autoDelayedEnabled;
  
  return prisma.workspace.update({
    where: { id: workspaceId },
    data,
    select: {
      autoOooEnabled: true,
      autoWelcomeEnabled: true,
      autoDelayedEnabled: true,
    },
  });
}

// Voice AI Settings
export async function getVoiceSettings(workspaceId) {
  return prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      voiceAiEnabled: true,
      voiceAiName: true,
      voiceAiPrompt: true,
      voiceAiPhone: true,
    },
  });
}

export async function updateVoiceSettings(workspaceId, updates) {
  const allowed = {};
  if (updates.voiceAiEnabled !== undefined) allowed.voiceAiEnabled = updates.voiceAiEnabled;
  if (updates.voiceAiName !== undefined) allowed.voiceAiName = updates.voiceAiName;
  if (updates.voiceAiPrompt !== undefined) allowed.voiceAiPrompt = updates.voiceAiPrompt;
  if (updates.voiceAiPhone !== undefined) allowed.voiceAiPhone = updates.voiceAiPhone;
  return prisma.workspace.update({
    where: { id: workspaceId },
    data: allowed,
    select: {
      voiceAiEnabled: true,
      voiceAiName: true,
      voiceAiPrompt: true,
      voiceAiPhone: true,
    },
  });
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

  if (!env.GEMINI_API_KEY) {
    return { ...fallbackWorkflowPreview(cleanPrompt), provider: 'fallback' };
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
      model: "gemini-2.5-flash",
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
    return { ...fallbackWorkflowPreview(cleanPrompt), provider: 'fallback' };
  }
}
