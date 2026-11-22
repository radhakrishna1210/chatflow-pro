import { prisma } from '../lib/prisma.js';
import { llmJsonMetered, llmAvailable } from '../lib/llm.js';
import {
  normalizeBlueprint, normalizeItem, checkBlueprint, hasErrors, describeItem,
  hashItem, resolveNodes, templateComponents, refKey, MAX_ITEMS,
} from '../lib/agentBlueprint.js';
import { TRIGGERS, ACTIONS, CONDITIONS } from './workflowCompiler.service.js';
import { assertAiCredits, chargeAiCredits, getAiCredits } from './aiCredits.service.js';
import { createForm, updateForm } from './whatsappForms.service.js';
import { createWorkflow, updateWorkflow } from './workflow.service.js';
import { createTrigger, updateTrigger } from './automation.service.js';
import { createTemplate, updateTemplate } from './templates.service.js';
import { hasFeature } from './subscription.service.js';

// The onboarding agent: a person describes what they want in plain words, and
// the forms, workflows, auto-replies and templates that takes are built for
// them, already connected to each other.
//
// ── The one rule ────────────────────────────────────────────────────────────
//
// The model never writes to the workspace. It writes a blueprint
// (lib/agentBlueprint.js), which is checked, shown to the person, and edited —
// by hand or by asking the agent again — until they apply it. Only apply
// creates records, and it does so through the same services the Automation
// screens use, so an agent-built form or template is validated, submitted and
// limited exactly like a hand-built one.
//
// The earlier onboarding chat wrote rows directly from a model reply: its
// templates were never submitted to Meta, and its workflows went live the
// moment they were described. Both are what this design exists to rule out.

const FEATURE = 'onboarding_agent';
const MAX_PROMPT_CHARS = 4000;
const MAX_MESSAGES = 60;
// A whole setup comes back as one JSON answer, which takes far longer than the
// short replies lib/llm.js is tuned for.
const LLM_TIMEOUT_MS = 60_000;

const fail = (message, status = 400, extra = {}) => {
  const e = new Error(message);
  e.status = status;
  Object.assign(e, extra);
  throw e;
};

// ── What the model is told ──────────────────────────────────────────────────

const SYSTEM = `You set up WhatsApp automations for a business on Svann, a WhatsApp automation platform.
The owner tells you what they want in plain words. You design the complete setup as a blueprint.
You never activate anything: the owner reviews your blueprint and applies it.

Reply with ONE JSON object and nothing else:
{"reply": "<2-4 plain sentences to the owner: what you built or changed and anything they should check>",
 "title": "<3-6 word name for this setup>",
 "blueprint": {"summary": "<one sentence>", "items": [ ...items ]}}

If you truly cannot design anything without one missing fact, reply {"reply": "<one short question>"} with no blueprint.
Prefer a sensible default and say what you assumed over asking.

ITEMS (at most ${MAX_ITEMS}). Every item has a unique "key" (lowercase letters, digits, underscores).

1. Form — asks the customer questions one at a time and saves the answers.
{"key":"order_form","type":"form","name":"Order form","keyword":"ORDER",
 "completionMessage":"Thanks! We have your order.",
 "fields":[{"label":"What would you like?","type":"multi","options":["Tea","Coffee"],"required":true},
           {"label":"How many cups of tea?","type":"number","showIf":{"question":1,"option":"Tea"}}]}
 field types: text, email, phone, number, choice (pick one), multi (pick several). choice and multi need "options" (max 10).
 "showIf" asks a question only when an earlier choice/multi question (1-based "question" number) got that exact "option".
 "keyword" is what a customer types or taps to start the form. Leave it "" only when a workflow starts the form.

2. Workflow — one trigger, then steps that run top to bottom in a chat with one customer.
{"key":"welcome_flow","type":"workflow","name":"Welcome menu","nodes":[
  {"type":"trigger","subtype":"keyword","value":"HI, HELLO, HEY"},
  {"type":"action","subtype":"buttons","value":"Hi {{name}}! How can we help? | Place an order | Talk to us"},
  {"type":"action","subtype":"wait_reply"},
  {"type":"condition","subtype":"equals","value":"Place an order","skipIfFalse":1},
  {"type":"action","subtype":"form","value":"@order_form"},
  {"type":"condition","subtype":"equals","value":"Talk to us","skipIfFalse":2},
  {"type":"action","subtype":"message","value":"Connecting you to our team."},
  {"type":"action","subtype":"agent"}]}
 triggers: ${Object.keys(TRIGGERS).join(', ')}
 actions: ${Object.keys(ACTIONS).join(', ')}
 conditions: {"type":"condition","subtype":"<${Object.keys(CONDITIONS).join('|')}>","value":"...","skipIfFalse":N}
   A condition checks the customer's latest message; when false the next N steps are skipped.
 - keyword trigger value: the word(s) that start it, alternatives separated by commas ("PRICE, RATES").
 - welcome trigger: fires ONLY on a brand-new contact's very first message, whatever it says. No value.
   It never fires again for that person, so use it only when the owner clearly means first-time customers
   ("new customers", "first message", "when someone contacts us for the first time").
 - When the owner says "when someone says hi / hello / messages us / greets us", they mean anyone, new or
   returning. Use a keyword trigger with the usual greetings: "HI, HELLO, HEY, HII, NAMASTE" (add the greeting
   words of the owner's language). Returning customers saying "hi" must get the menu too.
 - message value: the text to send. {{name}} is the customer's name.
 - buttons value: "Question | Option A | Option B". At most 3 options, at most 20 characters each.
   To act on the choice: follow buttons with wait_reply, then one "equals" condition per option.
 - wait_reply: pauses for the customer's answer. Optional value names a variable, used later as {{that_name}}.
 - delay value: "30 minutes", "2 hours", "1 day".
 - tag value: a tag to put on the contact.
 - agent: hands the chat to a person. Nothing automated runs after it.
 - form value: "@<key of a form item>". Starts that form, which then asks its own questions.
   Nothing may run after it for that customer, so guard every later step with its own condition, as in the example.
 - template value: "@<key of a template item>" or the exact name of an existing approved template.
 - Use ONLY these subtypes. If the request needs something else (payments, catalogs, bookings in a calendar, sending emails), build what is possible and say plainly in "reply" what is not.

3. Auto-reply — a fixed answer to a keyword. Use it for simple questions (hours, address, price list).
{"key":"hours_reply","type":"auto_reply","keyword":"HOURS","response":"We are open 9am-6pm, Monday to Saturday."}

4. Template — a message Meta must approve (takes hours to days). Needed ONLY to message customers first:
 broadcasts, reminders, anything sent more than 24 hours after the customer last wrote. Replies inside a
 conversation never need one, so do not add a template unless the owner wants to message people first.
{"key":"offer_tpl","type":"template","name":"weekend_offer","category":"MARKETING","language":"en_US",
 "header":"Weekend offer","body":"Hi {{1}}, get 10% off this weekend.","footer":"Reply STOP to opt out",
 "buttons":["Place an order"],"examples":["Asha"]}
 name: lowercase letters, digits, underscores. category: MARKETING or UTILITY. body variables are {{1}}, {{2}}…
 with one sample value each in "examples". "buttons" are quick-reply labels (max 25 characters).

HOW THE PIECES CONNECT — get this right, it is the whole point:
- When a customer taps a button, the platform receives the button's label as a message.
- So every button label must either be handled by a wait_reply + conditions in the same workflow,
  or contain, as a whole word, the keyword of a form, workflow or auto-reply in this blueprint
  (the label "Place an order" starts whatever has the keyword "ORDER").
- Keywords match whole words, case-insensitively. No two items may share a keyword.
- For one incoming message only one thing runs: a form's keyword wins over a workflow's, which wins over an auto-reply's.
- Do not reuse keywords the business already has (listed below) unless the owner asks to replace them.

STYLE: write customer-facing text the way a friendly small business would — short, warm, clear. Use the
owner's language and their products, prices and names exactly as given. Never invent prices, addresses,
phone numbers or opening hours: if one is needed and was not given, write an obvious placeholder like
[your address] and mention it in "reply".

When a current blueprint is given, return the WHOLE updated blueprint. Keep every item and key the owner
did not ask to change exactly as it is.`;

function buildPrompt({ workspaceName, existing, blueprint, focus, history, message, issues }) {
  const lines = [];
  lines.push(`Business: ${workspaceName || 'not given'}`);

  const taken = [
    ...existing.forms.filter((f) => f.keyword).map((f) => `${f.keyword} (form "${f.name}")`),
    ...existing.workflows.filter((w) => w.keyword).map((w) => `${w.keyword} (workflow "${w.name}")`),
    ...existing.triggers.map((t) => `${t.keyword} (auto-reply)`),
  ];
  lines.push(`Keywords already in use: ${taken.length ? taken.slice(0, 60).join('; ') : 'none'}`);
  const approved = existing.templates.filter((t) => t.status === 'APPROVED').map((t) => t.name);
  lines.push(`Approved templates: ${approved.length ? approved.slice(0, 40).join(', ') : 'none'}`);
  const names = existing.forms.map((f) => f.name);
  if (names.length) lines.push(`Existing form names (do not reuse): ${names.slice(0, 40).join(', ')}`);

  if (blueprint?.items?.length) {
    lines.push('', 'Current blueprint:', JSON.stringify(blueprint));
  }
  if (history.length) {
    lines.push('', 'Conversation so far:');
    history.forEach((m) => lines.push(`${m.role === 'user' ? 'Owner' : 'You'}: ${m.text}`));
  }
  if (issues?.length) {
    lines.push('', 'Your last blueprint had these problems. Fix every one and return the whole blueprint:');
    issues.forEach((i) => lines.push(`- ${i.message}`));
  }
  if (focus) lines.push('', `The owner is asking about the item with key "${focus}". Change other items only if this change requires it.`);
  if (message) lines.push('', `Owner: ${message}`);
  return lines.join('\n');
}

// ── Reading the workspace ───────────────────────────────────────────────────

const appliedOf = (build) => (build.applied && typeof build.applied === 'object' ? build.applied : {});
const messagesOf = (build) => (Array.isArray(build.messages) ? build.messages : []);
const blueprintOf = (build) => normalizeBlueprint(build.blueprint);

// What the workspace already has, minus the records this build created — so a
// build never collides with its own earlier apply.
async function loadExisting(workspaceId, build = null) {
  const own = new Set(Object.values(build ? appliedOf(build) : {}).map((a) => a?.id).filter(Boolean));
  const [forms, workflows, triggers, templates] = await Promise.all([
    prisma.whatsappForm.findMany({ where: { workspaceId }, select: { id: true, name: true, keyword: true } }),
    prisma.workflow.findMany({ where: { workspaceId }, select: { id: true, name: true, nodes: true, isActive: true } }),
    prisma.automationTrigger.findMany({ where: { workspaceId }, select: { id: true, keyword: true } }),
    prisma.template.findMany({ where: { workspaceId, status: { not: 'DELETED' } }, select: { id: true, name: true, status: true } }),
  ]);
  return {
    forms: forms.filter((f) => !own.has(f.id)),
    workflows: workflows.filter((w) => !own.has(w.id)).map((w) => {
      const trigger = (Array.isArray(w.nodes) ? w.nodes : []).find((n) => n?.type === 'trigger');
      return { id: w.id, name: w.name, keyword: trigger?.subtype === 'keyword' ? String(trigger.value || '') : '' };
    }),
    triggers: triggers.filter((t) => !own.has(t.id)),
    templates: templates.filter((t) => !own.has(t.id)),
  };
}

async function findBuild(workspaceId, id) {
  const build = await prisma.agentBuild.findFirst({ where: { id, workspaceId } });
  if (!build) fail('That setup was not found.', 404);
  return build;
}

// The real records behind a build's items, so the screen shows what is
// actually live rather than what apply intended.
async function liveState(workspaceId, applied) {
  const ids = (type) => Object.values(applied).filter((a) => a?.type === type && a.id).map((a) => a.id);
  const [forms, workflows, triggers, templates] = await Promise.all([
    ids('form').length ? prisma.whatsappForm.findMany({ where: { workspaceId, id: { in: ids('form') } }, select: { id: true, status: true } }) : [],
    ids('workflow').length ? prisma.workflow.findMany({ where: { workspaceId, id: { in: ids('workflow') } }, select: { id: true, isActive: true } }) : [],
    ids('auto_reply').length ? prisma.automationTrigger.findMany({ where: { workspaceId, id: { in: ids('auto_reply') } }, select: { id: true, isActive: true } }) : [],
    ids('template').length ? prisma.template.findMany({ where: { workspaceId, id: { in: ids('template') } }, select: { id: true, status: true, rejectedReason: true } }) : [],
  ]);
  const byId = new Map();
  forms.forEach((f) => byId.set(f.id, { exists: true, on: f.status === 'Active', state: f.status === 'Active' ? 'On' : 'Draft' }));
  workflows.forEach((w) => byId.set(w.id, { exists: true, on: w.isActive, state: w.isActive ? 'On' : 'Off' }));
  triggers.forEach((t) => byId.set(t.id, { exists: true, on: t.isActive, state: t.isActive ? 'On' : 'Off' }));
  templates.forEach((t) => byId.set(t.id, {
    exists: t.status !== 'DELETED',
    on: t.status === 'APPROVED',
    state: t.status === 'APPROVED' ? 'Approved' : t.status === 'REJECTED' ? 'Rejected by Meta' : 'Waiting for Meta approval',
    ...(t.rejectedReason ? { reason: t.rejectedReason } : {}),
  }));
  return byId;
}

async function present(workspaceId, build, { existing, credits } = {}) {
  const applied = appliedOf(build);
  const [have, live] = await Promise.all([
    existing || loadExisting(workspaceId, build),
    liveState(workspaceId, applied),
  ]);
  const { blueprint, issues } = checkBlueprint(blueprintOf(build), have);

  const items = blueprint.items.map((item) => {
    const record = applied[item.key];
    const state = record?.id ? live.get(record.id) : null;
    return {
      ...item,
      description: describeItem(item, blueprint),
      issues: issues.filter((i) => i.itemKey === item.key),
      record: record?.id && state?.exists
        ? { id: record.id, ...state, upToDate: record.hash === hashItem(item), ...(record.note ? { note: record.note } : {}) }
        : null,
      ...(record?.error ? { applyError: record.error } : {}),
    };
  });

  const needsNumber = blueprint.items.some((i) => i.type === 'template');
  const numbers = needsNumber
    ? await prisma.waNumber.findMany({ where: { workspaceId }, select: { id: true, phoneNumber: true, displayName: true }, orderBy: { createdAt: 'asc' } })
    : [];

  return {
    id: build.id,
    title: build.title,
    prompt: build.prompt,
    status: build.status,
    summary: blueprint.summary,
    items,
    issues: issues.filter((i) => !i.itemKey),
    canApply: !hasErrors(issues) && blueprint.items.length > 0,
    hasUnappliedChanges: items.some((i) => !i.record || !i.record.upToDate),
    messages: messagesOf(build),
    creditsUsed: build.creditsUsed,
    numbers,
    appliedAt: build.appliedAt,
    createdAt: build.createdAt,
    updatedAt: build.updatedAt,
    ...(credits ? { credits } : {}),
  };
}

// ── Talking to the agent ────────────────────────────────────────────────────

async function ask(workspaceId, userId, buildId, promptArgs) {
  const prompt = buildPrompt(promptArgs);
  const readable = (r) => r?.data && typeof r.data === 'object' && !Array.isArray(r.data);

  let result = await llmJsonMetered(prompt, SYSTEM, { timeoutMs: LLM_TIMEOUT_MS });
  if (!result) fail('The assistant did not respond. Nothing was charged — please try again in a moment.', 503);

  // An answer that is not the JSON object asked for is useless to the person,
  // so it is retried once here rather than handed back as an error, and it is
  // never charged: seen on the live app from the lighter fallback model, which
  // answered at normal length but with JSON that would not parse.
  if (!readable(result)) {
    console.error(`[OnboardingAgent] Unreadable answer from ${result.usage?.model} for build ${buildId}: ${String(result.raw || '').slice(0, 400)}`);
    result = await llmJsonMetered(prompt, SYSTEM, { timeoutMs: LLM_TIMEOUT_MS });
    if (!readable(result)) {
      if (result) console.error(`[OnboardingAgent] Unreadable again from ${result.usage?.model}: ${String(result.raw || '').slice(0, 400)}`);
      fail('The assistant could not produce a usable answer just now. Nothing was charged — please try again in a moment.', 502);
    }
  }

  const charge = await chargeAiCredits(workspaceId, result.usage, { userId, feature: FEATURE, reference: buildId });
  return { data: result.data, credits: charge.credits };
}

// One turn: the owner's message in, the agent's reply and (usually) a new
// blueprint out. Returns the fields to save on the build.
async function turn(workspaceId, userId, build, message, { focus = null } = {}) {
  if (!llmAvailable()) fail('The assistant is not set up on this platform yet. You can still build automations by hand in the other tabs.', 503);
  await assertAiCredits(workspaceId, 1);

  const [existing, workspace] = await Promise.all([
    loadExisting(workspaceId, build),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
  ]);
  const current = blueprintOf(build);
  const history = messagesOf(build).slice(-8);
  const base = { workspaceName: workspace?.name, existing, blueprint: current, focus, history };

  let spent = 0;
  let { data, credits } = await ask(workspaceId, userId, build.id, { ...base, message });
  spent += credits;

  let reply = String(data.reply || '').trim().slice(0, 2000);
  let next = null;

  if (data.blueprint && Array.isArray(data.blueprint.items)) {
    let checked = checkBlueprint(normalizeBlueprint(data.blueprint), existing);

    // One repair round. The model is told exactly what does not connect and
    // asked to fix it; a second failure is shown to the person instead of
    // looping, since each round costs them credits.
    if (hasErrors(checked.issues)) {
      const canRepair = await getAiCredits(workspaceId).then((c) => c.available >= 1).catch(() => false);
      if (canRepair) {
        const repair = await ask(workspaceId, userId, build.id, {
          ...base,
          blueprint: checked.blueprint,
          history: [...history, { role: 'user', text: message }],
          message: null,
          issues: checked.issues.filter((i) => i.level === 'error'),
        }).catch(() => null);
        if (repair) {
          spent += repair.credits;
          if (repair.data?.blueprint && Array.isArray(repair.data.blueprint.items)) {
            const again = checkBlueprint(normalizeBlueprint(repair.data.blueprint), existing);
            const errorsIn = (c) => c.issues.filter((i) => i.level === 'error').length;
            if (errorsIn(again) < errorsIn(checked)) {
              checked = again;
              reply = String(repair.data.reply || reply).trim().slice(0, 2000);
            }
          }
        }
      }
    }
    next = checked.blueprint;
  }

  if (!reply) reply = next ? 'Here is the setup. Have a look and tell me what to change.' : 'Could you tell me a little more about what you want to set up?';

  const now = new Date().toISOString();
  const messages = [
    ...messagesOf(build),
    { role: 'user', text: message, at: now, ...(focus ? { itemKey: focus } : {}) },
    { role: 'agent', text: reply, at: now, credits: spent },
  ].slice(-MAX_MESSAGES);

  const title = String(data.title || '').trim().slice(0, 80);
  return {
    messages,
    creditsUsed: { increment: spent },
    ...(next ? { blueprint: next } : {}),
    ...(next && build.status === 'APPLIED' ? { status: 'CHANGED' } : {}),
    // The model names a setup once; a later turn does not rename it.
    ...(title && messagesOf(build).length === 0 ? { title } : {}),
  };
}

const cleanMessage = (raw) => {
  const message = String(raw ?? '').trim();
  if (!message) fail('Tell the assistant what you want to set up.');
  if (message.length > MAX_PROMPT_CHARS) fail(`Please keep it under ${MAX_PROMPT_CHARS} characters.`);
  return message;
};

export async function listBuilds(workspaceId) {
  const [builds, credits] = await Promise.all([
    prisma.agentBuild.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, status: true, creditsUsed: true, blueprint: true, updatedAt: true, createdAt: true },
    }),
    getAiCredits(workspaceId),
  ]);
  return {
    builds: builds.map(({ blueprint, ...b }) => ({ ...b, itemCount: Array.isArray(blueprint?.items) ? blueprint.items.length : 0 })),
    credits,
    llmAvailable: llmAvailable(),
  };
}

export async function getBuild(workspaceId, id) {
  const build = await findBuild(workspaceId, id);
  return present(workspaceId, build, { credits: await getAiCredits(workspaceId) });
}

export async function createBuild(workspaceId, userId, { prompt }) {
  const message = cleanMessage(prompt);
  const build = await prisma.agentBuild.create({
    data: { workspaceId, userId, prompt: message, title: message.slice(0, 60) },
  });
  try {
    const data = await turn(workspaceId, userId, build, message);
    const saved = await prisma.agentBuild.update({ where: { id: build.id }, data });
    return present(workspaceId, saved, { credits: await getAiCredits(workspaceId) });
  } catch (err) {
    // Nothing was designed, so there is nothing worth keeping in the list.
    await prisma.agentBuild.delete({ where: { id: build.id } }).catch(() => {});
    throw err;
  }
}

export async function sendMessage(workspaceId, userId, id, { message, itemKey }) {
  const build = await findBuild(workspaceId, id);
  const focus = itemKey && blueprintOf(build).items.some((i) => i.key === itemKey) ? itemKey : null;
  const data = await turn(workspaceId, userId, build, cleanMessage(message), { focus });
  const saved = await prisma.agentBuild.update({ where: { id: build.id }, data });
  return present(workspaceId, saved, { credits: await getAiCredits(workspaceId) });
}

// ── Editing by hand ─────────────────────────────────────────────────────────

async function saveBlueprint(workspaceId, build, blueprint) {
  const saved = await prisma.agentBuild.update({
    where: { id: build.id },
    data: { blueprint, ...(build.status === 'APPLIED' ? { status: 'CHANGED' } : {}) },
  });
  return present(workspaceId, saved);
}

// Replaces one item with the person's own version. It goes through the same
// normaliser as the model's output; problems are reported on the item rather
// than refused, so a half-finished edit can be saved and continued.
export async function updateItem(workspaceId, id, key, raw) {
  const build = await findBuild(workspaceId, id);
  const blueprint = blueprintOf(build);
  const index = blueprint.items.findIndex((i) => i.key === key);
  if (index === -1) fail('That item is not part of this setup.', 404);
  const item = normalizeItem({ ...(raw && typeof raw === 'object' ? raw : {}), type: blueprint.items[index].type });
  blueprint.items[index] = { key, ...item };
  return saveBlueprint(workspaceId, build, blueprint);
}

export async function removeItem(workspaceId, id, key) {
  const build = await findBuild(workspaceId, id);
  const blueprint = blueprintOf(build);
  if (!blueprint.items.some((i) => i.key === key)) fail('That item is not part of this setup.', 404);
  blueprint.items = blueprint.items.filter((i) => i.key !== key);
  return saveBlueprint(workspaceId, build, blueprint);
}

// ── Applying ────────────────────────────────────────────────────────────────

const APPLY_ORDER = { template: 0, form: 1, auto_reply: 2, workflow: 3 };
const NEEDS_FEATURE = { workflow: 'workflows', auto_reply: 'automation', form: 'automation' };

const exists = {
  form: (workspaceId, id) => prisma.whatsappForm.findFirst({ where: { id, workspaceId } }),
  workflow: (workspaceId, id) => prisma.workflow.findFirst({ where: { id, workspaceId } }),
  auto_reply: (workspaceId, id) => prisma.automationTrigger.findFirst({ where: { id, workspaceId } }),
  template: (workspaceId, id) => prisma.template.findFirst({ where: { id, workspaceId, status: { not: 'DELETED' } } }),
};

// Switches one record on or off. Templates are not switched: Meta decides.
async function setRecordLive(workspaceId, type, id, on) {
  if (type === 'form') await updateForm(workspaceId, id, { status: on ? 'Active' : 'Draft' });
  else if (type === 'workflow') await updateWorkflow(workspaceId, id, { isActive: on });
  else if (type === 'auto_reply') await updateTrigger(workspaceId, id, { isActive: on });
}

// The blueprint templates a workflow sends. It can only run once Meta has
// approved every one of them.
const templatesNeeded = (item) => item.nodes
  .filter((n) => n.subtype === 'template' && refKey(n.value))
  .map((n) => refKey(n.value));

/**
 * Creates or updates the real records for a build.
 *
 * `activate` true switches everything on that can be; false leaves new records
 * off (forms as drafts) for the person to switch on later. A workflow that
 * sends a template still waiting for Meta stays off either way.
 *
 * One item failing does not stop the others: each outcome is recorded on the
 * build and shown against its item.
 */
export async function applyBuild(workspaceId, id, { activate = true, waNumberId = null } = {}) {
  const build = await findBuild(workspaceId, id);
  const existing = await loadExisting(workspaceId, build);
  const { blueprint, issues } = checkBlueprint(blueprintOf(build), existing);
  if (blueprint.items.length === 0) fail('There is nothing to create yet.');
  if (hasErrors(issues)) {
    fail('Fix the problems marked in red before creating this setup.', 400, { code: 'BLUEPRINT_INVALID' });
  }

  for (const [type, flag] of Object.entries(NEEDS_FEATURE)) {
    if (blueprint.items.some((i) => i.type === type) && !(await hasFeature(workspaceId, flag))) {
      fail('Your plan does not include everything in this setup. Upgrade your plan to create it.', 403, { code: 'PLAN_FEATURE_LOCKED', feature: flag });
    }
  }

  const applied = { ...appliedOf(build) };
  const names = {};       // item key -> record name, for "@key" references
  const approved = {};    // template item key -> is it approved yet
  const failed = new Set();
  const ordered = [...blueprint.items].sort((a, b) => APPLY_ORDER[a.type] - APPLY_ORDER[b.type]);

  for (const item of ordered) {
    const hash = hashItem(item);
    const prior = applied[item.key]?.id ? applied[item.key] : null;
    const record = prior ? await exists[item.type](workspaceId, prior.id) : null;
    let note = null;

    try {
      if (item.type === 'template') {
        let template = record;
        if (!template) {
          template = await createTemplate(workspaceId, {
            name: item.name, category: item.category, language: item.language,
            components: templateComponents(item), ...(waNumberId ? { waNumberId } : {}),
          });
        } else if (prior.hash !== hash) {
          if (template.status === 'REJECTED') {
            template = await updateTemplate(workspaceId, template.id, { category: item.category, components: templateComponents(item) });
          } else {
            // Meta holds the submitted copy; it cannot be replaced from here.
            note = 'Already sent to Meta, so this change was not applied. Edit it from Templates.';
          }
        }
        names[item.key] = template.name;
        approved[item.key] = template.status === 'APPROVED';
        applied[item.key] = { type: 'template', id: template.id, hash: note ? prior.hash : hash, ...(note ? { note } : {}) };
        continue;
      }

      if (item.type === 'form') {
        const data = { name: item.name, schema: item.fields, keyword: item.keyword, completionMessage: item.completionMessage };
        const form = record
          ? await updateForm(workspaceId, record.id, { ...data, ...(activate ? { status: 'Active' } : {}) })
          : await createForm(workspaceId, { ...data, status: activate ? 'Active' : 'Draft' });
        names[item.key] = form.name;
        applied[item.key] = { type: 'form', id: form.id, hash };
        continue;
      }

      if (item.type === 'auto_reply') {
        const trigger = record
          ? await updateTrigger(workspaceId, record.id, { keyword: item.keyword, responseTemplate: item.response, ...(activate ? { isActive: true } : {}) })
          : await createTrigger(workspaceId, { keyword: item.keyword, responseTemplate: item.response, isActive: activate });
        applied[item.key] = { type: 'auto_reply', id: trigger.id, hash };
        continue;
      }

      // Workflow. Anything it points at must have been created just above.
      const refs = item.nodes.filter((n) => ['form', 'template'].includes(n.subtype)).map((n) => refKey(n.value)).filter(Boolean);
      const broken = refs.find((key) => failed.has(key) || !names[key]);
      if (broken) fail('Not created, because something it depends on could not be created.');

      const waiting = templatesNeeded(item).filter((key) => !approved[key]);
      const nodes = resolveNodes(item.nodes, names);
      const on = activate && waiting.length === 0;
      if (waiting.length) note = 'Switched off until Meta approves its template. Come back and switch it on then.';
      const workflow = record
        ? await updateWorkflow(workspaceId, record.id, { name: item.name, nodes, ...(activate || waiting.length ? { isActive: on } : {}) })
        : await createWorkflow(workspaceId, { name: item.name, nodes, edges: [], isActive: on });
      applied[item.key] = { type: 'workflow', id: workflow.id, hash, ...(note ? { note } : {}) };
    } catch (err) {
      failed.add(item.key);
      console.error(`[OnboardingAgent] Could not apply ${item.type} "${item.key}" of build ${build.id}:`, err.message);
      const message = /multiple numbers/i.test(err.message)
        ? 'You have more than one WhatsApp number — choose which one this template is for.'
        : err.message;
      applied[item.key] = { ...(prior || { type: item.type }), error: String(message).slice(0, 400) };
    }
  }

  // Items taken out of the blueprint since the last apply: their records are
  // switched off, not deleted. A form may hold customers' answers, and turning
  // something off can be undone where deleting cannot.
  const kept = new Set(blueprint.items.map((i) => i.key));
  for (const [key, entry] of Object.entries(applied)) {
    if (kept.has(key)) continue;
    if (entry?.id && entry.type !== 'template') {
      await setRecordLive(workspaceId, entry.type, entry.id, false).catch(() => {});
    }
    delete applied[key];
  }

  const saved = await prisma.agentBuild.update({
    where: { id: build.id },
    data: { blueprint, applied, status: failed.size ? 'CHANGED' : 'APPLIED', appliedAt: new Date() },
  });
  return { ...(await present(workspaceId, saved)), failed: failed.size };
}

/**
 * Switches every record a build created on or off in one go.
 *
 * Turning on skips a workflow whose template Meta has not approved yet —
 * switched on it would fail on every customer — and says so.
 */
export async function setLive(workspaceId, id, on) {
  const build = await findBuild(workspaceId, id);
  const applied = { ...appliedOf(build) };
  const blueprint = blueprintOf(build);
  const live = await liveState(workspaceId, applied);
  const skipped = [];

  for (const item of blueprint.items) {
    const entry = applied[item.key];
    if (!entry?.id || item.type === 'template' || !live.get(entry.id)?.exists) continue;

    if (on && item.type === 'workflow') {
      const waiting = templatesNeeded(item).some((key) => {
        const template = applied[key];
        return !template?.id || !live.get(template.id)?.on;
      });
      if (waiting) { skipped.push(item.name); continue; }
    }
    try {
      await setRecordLive(workspaceId, item.type, entry.id, on);
      if (on && entry.note) { const { note, ...rest } = entry; applied[item.key] = rest; }
    } catch (err) {
      skipped.push(item.name);
      console.error(`[OnboardingAgent] Could not switch ${item.type} ${entry.id}:`, err.message);
    }
  }

  const saved = await prisma.agentBuild.update({ where: { id: build.id }, data: { applied } });
  return { ...(await present(workspaceId, saved)), skipped };
}

// Removes the setup from the agent's list. The forms, workflows, auto-replies
// and templates it created are the workspace's own records and stay exactly as
// they are, managed from their usual screens.
export async function deleteBuild(workspaceId, id) {
  const build = await findBuild(workspaceId, id);
  await prisma.agentBuild.delete({ where: { id: build.id } });
  return { deleted: true };
}
