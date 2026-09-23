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

// What a generated workflow may use: the conversation steps the engine runs.
// `missed` is left out on purpose — nothing delivers a missed-call event to the
// engine, so a workflow built on it would save, look fine and never fire.
const ALLOWED_TRIGGER_SUBTYPES = new Set(['keyword', 'welcome']);
const ALLOWED_ACTION_SUBTYPES = new Set(['message', 'buttons', 'wait_reply', 'delay', 'tag', 'agent']);
const ALLOWED_CONDITION_SUBTYPES = new Set(['contains', 'equals', 'is_new_contact', 'has_tag']);
const CONDITION_NEEDS_VALUE = new Set(['contains', 'equals', 'has_tag']);
const MAX_PREVIEW_STEPS = 16;
// The builder's "otherwise skip" dropdown offers 1–5.
const MAX_SKIP = 5;
const DELAY_RE = /^\s*\d+(\.\d+)?\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)?\s*$/i;

const DEFAULT_REPLY = 'Thanks for reaching out. Our team will help you shortly.';

function createStep(index, type, subtype, value) {
  return {
    id: `step_${index}`,
    type,
    subtype,
    value: String(value || '').trim(),
  };
}

// Turns whatever the model returned into steps the engine will actually run.
//
// Anything it cannot place is dropped rather than coerced: this used to turn
// every non-trigger step into an action and every unknown subtype into
// "message", so a condition such as `contains "yes"` was saved as a step that
// *sent the customer the word "yes"*.
function cleanWorkflowPreview(raw, prompt) {
  const name = String(raw?.name || '').trim().slice(0, 80) || 'AI Generated Workflow';
  const source = Array.isArray(raw?.nodes) ? raw.nodes : Array.isArray(raw?.steps) ? raw.steps : [];
  const text = (v) => String(v ?? '').trim();

  const rawTrigger = source.find((n) => n?.type === 'trigger');
  let triggerSubtype = text(rawTrigger?.subtype).toLowerCase();
  if (!ALLOWED_TRIGGER_SUBTYPES.has(triggerSubtype)) triggerSubtype = 'keyword';
  const trigger = {
    type: 'trigger',
    subtype: triggerSubtype,
    value: triggerSubtype === 'keyword' ? (text(rawTrigger?.value) || inferKeyword(prompt)).toUpperCase() : '',
  };

  const steps = [];
  for (const node of source) {
    if (!node || node.type === 'trigger') continue;
    const subtype = text(node.subtype).toLowerCase();
    const value = text(node.value);

    if (node.type === 'condition' || ALLOWED_CONDITION_SUBTYPES.has(subtype)) {
      if (!ALLOWED_CONDITION_SUBTYPES.has(subtype)) continue;
      if (CONDITION_NEEDS_VALUE.has(subtype) && !value) continue;
      const skip = Math.floor(Number(node.skipIfFalse ?? node.skip ?? 1));
      steps.push({ type: 'condition', subtype, value, skipIfFalse: Number.isFinite(skip) && skip > 0 ? skip : 1 });
      continue;
    }

    if (subtype === 'buttons') {
      const parts = value.split('|').map((p) => p.trim()).filter(Boolean);
      const options = Array.isArray(node.options) ? node.options.map(text).filter(Boolean) : parts.slice(1);
      if (parts[0] && options.length > 0) {
        steps.push({ type: 'action', subtype: 'buttons', value: [parts[0], ...options.slice(0, 10)].join(' | ') });
      } else if (parts[0]) {
        steps.push({ type: 'action', subtype: 'message', value: parts[0] });
      }
      continue;
    }
    if (subtype === 'wait_reply') {
      steps.push({ type: 'action', subtype, value });
      continue;
    }
    if (subtype === 'delay') {
      steps.push({ type: 'action', subtype, value: DELAY_RE.test(value) ? value : '5 min' });
      continue;
    }
    if (subtype === 'agent') {
      steps.push({ type: 'action', subtype, value });
      continue;
    }
    if (ALLOWED_ACTION_SUBTYPES.has(subtype)) {
      if (value) steps.push({ type: 'action', subtype, value });
      continue;
    }
    // A message under another name ("send_message", "reply"). Kept narrow on
    // purpose: "send_email" carries an address, not something to say.
    if (value && /^(send_?)?(message|text|reply|msg|whatsapp)$/.test(subtype)) {
      steps.push({ type: 'action', subtype: 'message', value });
    }
  }

  // Buttons followed straight by a condition would test the *trigger* message,
  // not the customer's choice — the run must stop and wait for the tap first.
  for (let i = 0; i < steps.length - 1; i += 1) {
    if (steps[i].subtype === 'buttons' && steps[i + 1].type === 'condition') {
      steps.splice(i + 1, 0, { type: 'action', subtype: 'wait_reply', value: '' });
    }
  }

  // A condition with nothing after it guards nothing.
  while (steps.length && steps.at(-1).type === 'condition') steps.pop();
  if (!steps.some((s) => s.type === 'action' && s.subtype !== 'wait_reply' && s.subtype !== 'delay')) {
    steps.push({ type: 'action', subtype: 'message', value: DEFAULT_REPLY });
  }

  const kept = steps.slice(0, MAX_PREVIEW_STEPS - 1);
  // A skip count must stay inside the workflow, or "otherwise skip 4" at the
  // second-to-last step silently means "otherwise stop".
  kept.forEach((s, i) => {
    if (s.type === 'condition') s.skipIfFalse = Math.max(1, Math.min(s.skipIfFalse, MAX_SKIP, kept.length - i - 1));
  });

  return {
    name,
    nodes: [trigger, ...kept].map((step, index) => ({ id: `step_${index + 1}`, ...step })),
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
  const raw = String(keyword || '').trim();
  if (!raw) return false;
  const candidates = raw.split(/[\n,]+/).map((k) => k.trim()).filter(Boolean);
  if (candidates.length === 0) return false;

  const msg = String(messageBody || '');
  return candidates.some((candidate) => {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(candidate)}(?![\\p{L}\\p{N}_])`, 'iu');
    return pattern.test(msg);
  });
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

  const systemPrompt = `Convert a plain-English WhatsApp automation request into a chat workflow. Return JSON only, no markdown:
{"name":"short workflow name","nodes":[ ...steps in order... ],"edges":[]}

The steps run top to bottom in a WhatsApp chat with one customer.

Trigger (exactly one, first):
- {"type":"trigger","subtype":"keyword","value":"ORDER, TRACK, DELIVERY"}  fires when the customer's message contains any of the comma-separated words. Give 2-4 words/short phrases customers would really type.
- {"type":"trigger","subtype":"welcome","value":""}  fires on a brand-new contact's first message.

Actions:
- {"type":"action","subtype":"message","value":"text"}  send a message. {{name}} inserts the customer's name; {{order_id}} inserts a reply saved earlier.
- {"type":"action","subtype":"buttons","value":"Question? | Option A | Option B | Option C"}  send tappable options. Max 3 options (up to 10 becomes a list); each option at most 20 characters.
- {"type":"action","subtype":"wait_reply","value":"order_id"}  pause until the customer replies. value (optional) saves the reply as a variable. Put one after every question or buttons step whose answer matters.
- {"type":"action","subtype":"delay","value":"5 min"}  wait a fixed time ("30 min", "2 hours", "1 day").
- {"type":"action","subtype":"tag","value":"VIP"}  tag the contact.
- {"type":"action","subtype":"agent","value":""}  hand the chat to a human on the team. No automated messages follow, so put it last.

Conditions (branching): {"type":"condition","subtype":"equals|contains|has_tag|is_new_contact","value":"...","skipIfFalse":N}
Checks the latest customer message (after a wait_reply, that is their reply). If false, the next N steps are skipped. To branch on a button choice, use one "equals" condition per option, each followed by that option's steps, with skipIfFalse = the number of steps in that branch.

Example — "ask if they want to track an order or talk to support":
[{"type":"trigger","subtype":"keyword","value":"HELP, SUPPORT"},
 {"type":"action","subtype":"buttons","value":"Hi {{name}}! How can we help? | Track my order | Talk to support"},
 {"type":"action","subtype":"wait_reply","value":""},
 {"type":"condition","subtype":"equals","value":"Track my order","skipIfFalse":3},
 {"type":"action","subtype":"message","value":"Please send your order ID."},
 {"type":"action","subtype":"wait_reply","value":"order_id"},
 {"type":"action","subtype":"message","value":"Thanks! We're checking order {{order_id}} and will update you shortly."},
 {"type":"condition","subtype":"equals","value":"Talk to support","skipIfFalse":2},
 {"type":"action","subtype":"message","value":"Connecting you to our team now."},
 {"type":"action","subtype":"agent","value":""}]

Rules:
- Use only the subtypes above. At most 15 steps after the trigger.
- Keep messages short and friendly, written for WhatsApp.
- When the request asks the customer something, wait for the answer before acting on it.
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

export const __testing = { cleanWorkflowPreview };
