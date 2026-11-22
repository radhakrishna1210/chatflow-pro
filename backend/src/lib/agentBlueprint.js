import { createHash } from 'node:crypto';
import { validateGraph, describeGraph } from '../services/workflowCompiler.service.js';
import { normalizeSchema } from '../services/whatsappForms.service.js';
import { keywordMatches } from '../services/automation.service.js';
import { normalizeTemplateComponents } from './templateStructure.js';

// The onboarding agent's blueprint: one document describing everything a
// request needs — forms, workflows, auto-replies, templates — and how they
// lead into each other.
//
// ── Why a blueprint at all ──────────────────────────────────────────────────
//
// On this platform the pieces of an automation are not linked in the database.
// A button starts a workflow because its label happens to match the workflow's
// keyword; a workflow sends a template because a step holds its name. Building
// one by hand means keeping those strings in step across four screens, and a
// model writing straight to the database would get it wrong in the same way,
// just faster.
//
// So the model writes this document instead, and everything in this file is
// about refusing or flagging a document whose pieces do not connect: a button
// that leads nowhere, two things listening for the same word, a step that
// names a form which is not there. Nothing here touches the database, so the
// rules that decide what gets built are tested without one.

export const ITEM_TYPES = ['form', 'workflow', 'auto_reply', 'template'];
export const MAX_ITEMS = 12;

// Inside a blueprint one item points at another as "@key". On apply that
// becomes the real record's name, which is what the engine resolves.
const REF = /^@([a-z0-9_]{1,40})$/;
export const refKey = (value) => REF.exec(String(value ?? '').trim())?.[1] ?? null;

const text = (v, max) => String(v ?? '').trim().slice(0, max);
const slug = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
const upper = (v) => text(v, 80).toUpperCase();

// WhatsApp reply buttons: at most three, twenty characters each.
const BUTTON_MAX = 3;
const BUTTON_CHARS = 20;

function normalizeForm(raw) {
  return {
    type: 'form',
    name: text(raw.name, 120) || 'Untitled form',
    keyword: upper(raw.keyword),
    completionMessage: text(raw.completionMessage, 1000) || "Thanks! We've recorded your response.",
    // Same normaliser the Forms screen saves through, so a form the agent
    // drafts is one the form runtime can actually ask.
    fields: normalizeSchema(Array.isArray(raw.fields) ? raw.fields : raw.schema),
  };
}

function normalizeWorkflow(raw) {
  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).slice(0, 40).map((n) => ({
    type: text(n?.type, 20),
    subtype: text(n?.subtype, 40),
    ...(n?.value != null && String(n.value).trim() !== '' ? { value: text(n.value, 1000) } : {}),
    ...(n?.type === 'condition' ? { skipIfFalse: Number(n.skipIfFalse ?? 1) } : {}),
  }));
  return { type: 'workflow', name: text(raw.name, 120) || 'Untitled workflow', nodes };
}

function normalizeAutoReply(raw) {
  return { type: 'auto_reply', keyword: upper(raw.keyword), response: text(raw.response ?? raw.responseTemplate, 1000) };
}

function normalizeTemplate(raw) {
  return {
    type: 'template',
    name: slug(raw.name).slice(0, 64),
    category: ['MARKETING', 'UTILITY'].includes(String(raw.category).toUpperCase()) ? String(raw.category).toUpperCase() : 'MARKETING',
    language: text(raw.language, 10) || 'en_US',
    header: text(raw.header, 60),
    body: text(raw.body, 1024),
    footer: text(raw.footer, 60),
    // Quick-reply labels only: these are what a customer taps, and each must
    // lead somewhere.
    buttons: (Array.isArray(raw.buttons) ? raw.buttons : [])
      .map((b) => text(typeof b === 'string' ? b : b?.text, 25)).filter(Boolean).slice(0, 10),
    // Sample values for {{1}}, {{2}}… — Meta will not review a body without them.
    examples: (Array.isArray(raw.examples) ? raw.examples : []).map((e) => text(e, 100)).filter(Boolean).slice(0, 10),
  };
}

const NORMALIZERS = { form: normalizeForm, workflow: normalizeWorkflow, auto_reply: normalizeAutoReply, template: normalizeTemplate };

/** One item, cleaned. Returns null for something that is not an item. */
export function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object' || !NORMALIZERS[raw.type]) return null;
  return NORMALIZERS[raw.type](raw);
}

/** A whole blueprint, cleaned: known item types only, unique keys, bounded. */
export function normalizeBlueprint(raw) {
  const seen = new Set();
  const items = [];
  for (const entry of Array.isArray(raw?.items) ? raw.items : []) {
    const item = normalizeItem(entry);
    if (!item) continue;
    let key = slug(entry.key) || slug(`${item.type}_${item.name || item.keyword || items.length + 1}`) || `item_${items.length + 1}`;
    while (seen.has(key)) key = `${key.slice(0, 36)}_${items.length + 1}`;
    seen.add(key);
    items.push({ key, ...item });
    if (items.length >= MAX_ITEMS) break;
  }
  return { summary: text(raw?.summary, 600), items };
}

// The Meta component array a template item becomes. Shared by the checks
// below and by apply, so what is validated is exactly what is submitted.
export function templateComponents(item) {
  const components = [];
  if (item.header) components.push({ type: 'HEADER', format: 'TEXT', text: item.header });
  const body = { type: 'BODY', text: item.body };
  const variables = [...new Set((item.body.match(/\{\{\s*(\d+)\s*\}\}/g) || []).map((m) => Number(m.replace(/\D/g, ''))))];
  if (variables.length) {
    body.example = { body_text: [variables.sort((a, b) => a - b).map((n, i) => item.examples[i] || `Sample ${n}`)] };
  }
  components.push(body);
  if (item.footer) components.push({ type: 'FOOTER', text: item.footer });
  if (item.buttons.length) {
    components.push({ type: 'BUTTONS', buttons: item.buttons.map((label) => ({ type: 'QUICK_REPLY', text: label })) });
  }
  return components;
}

const triggerOf = (item) => item.nodes.find((n) => n.type === 'trigger');
const keywordsOf = (value) => String(value || '').split(/[\n,]+/).map((k) => k.trim().toUpperCase()).filter(Boolean);

// What an inbound message can start, in the order the inbound handler tries
// them: a form's keyword first, then a workflow's, then an auto-reply's.
const RANK = { form: 0, workflow: 1, auto_reply: 2 };
const KIND = { form: 'form', workflow: 'workflow', auto_reply: 'auto-reply' };

function starterOf(item) {
  if (item.type === 'form') return item.keyword ? { keywords: keywordsOf(item.keyword) } : null;
  if (item.type === 'auto_reply') return item.keyword ? { keywords: keywordsOf(item.keyword) } : null;
  if (item.type === 'workflow') {
    const trigger = triggerOf(item);
    return trigger?.subtype === 'keyword' ? { keywords: keywordsOf(trigger.value) } : null;
  }
  return null;
}

const labelOf = (item) => item.name || item.keyword || item.key;

/**
 * Checks a normalised blueprint against itself and against what the workspace
 * already has.
 *
 * `existing` is { forms: [{ id, name, keyword }], workflows: [{ id, name,
 * keyword }], triggers: [{ id, keyword }], templates: [{ id, name, status }] }
 * with this build's own records left out, so re-applying a build does not
 * collide with itself.
 *
 * Returns { blueprint, issues }. An `error` blocks apply; a `warning` is shown
 * and left to the person. Workflow graphs come back normalised (the engine's
 * validator may add a missing "wait for reply").
 */
export function checkBlueprint(blueprint, existing = {}) {
  const issues = [];
  const error = (itemKey, message) => issues.push({ level: 'error', itemKey, message });
  const warn = (itemKey, message) => issues.push({ level: 'warning', itemKey, message });

  const have = {
    forms: existing.forms || [],
    workflows: existing.workflows || [],
    triggers: existing.triggers || [],
    templates: existing.templates || [],
  };

  const items = blueprint.items.map((item) => ({ ...item }));
  const byKey = new Map(items.map((i) => [i.key, i]));
  if (items.length === 0) issues.push({ level: 'error', itemKey: null, message: 'There is nothing to build yet.' });

  // ── Each item on its own ──────────────────────────────────────────────────
  for (const item of items) {
    if (item.type === 'form') {
      if (item.fields.length === 0) error(item.key, `The form "${item.name}" has no questions.`);
      // A workflow starts a form by its name, so two forms with one name would
      // make "which form" a coin toss.
      const sameName = (other) => String(other.name).toLowerCase() === item.name.toLowerCase();
      if (have.forms.some(sameName)) error(item.key, `You already have a form called "${item.name}" — give this one another name.`);
      else if (items.some((other) => other !== item && other.type === 'form' && sameName(other))) {
        error(item.key, `Two forms in this setup are called "${item.name}" — give one another name.`);
      }
      const startedByWorkflow = items.some((w) => w.type === 'workflow'
        && w.nodes.some((n) => n.subtype === 'form' && refKey(n.value) === item.key));
      if (!item.keyword && !startedByWorkflow) {
        error(item.key, `Nothing starts the form "${item.name}" — give it a keyword or start it from a workflow.`);
      }
    }

    if (item.type === 'auto_reply') {
      if (!item.keyword) error(item.key, 'This auto-reply has no keyword.');
      if (!item.response) error(item.key, `The auto-reply for "${item.keyword}" has no reply text.`);
    }

    if (item.type === 'template') {
      if (!/^[a-z0-9_]{1,64}$/.test(item.name)) error(item.key, 'A template name uses lowercase letters, numbers and underscores only.');
      if (!item.body) error(item.key, `The template "${item.name}" has no message text.`);
      else {
        try { normalizeTemplateComponents(item.category, templateComponents(item)); } catch (err) {
          error(item.key, `Template "${item.name}": ${err.message}`);
        }
      }
      if (have.templates.some((t) => t.name === item.name)) {
        error(item.key, `A template named "${item.name}" already exists — pick another name.`);
      }
    }

    if (item.type === 'workflow') {
      try {
        const { nodes, warnings } = validateGraph(item.nodes);
        item.nodes = nodes.map((n) => {
          const out = { type: n.type, subtype: n.subtype };
          if (n.value !== undefined) out.value = n.value;
          if (n.skipIfFalse !== undefined) out.skipIfFalse = n.skipIfFalse;
          return out;
        });
        warnings.forEach((w) => warn(item.key, w));
      } catch (err) {
        error(item.key, `Workflow "${item.name}": ${err.message}`);
        continue;
      }

      const steps = item.nodes.filter((n) => n.type !== 'trigger');
      steps.forEach((node, i) => {
        if (node.subtype === 'form') {
          const key = refKey(node.value);
          const target = key ? byKey.get(key) : null;
          if (key && target?.type !== 'form') error(item.key, `Workflow "${item.name}" starts a form that is not part of this setup.`);
          if (!key && !have.forms.some((f) => f.name.toLowerCase() === String(node.value).toLowerCase())) {
            error(item.key, `Workflow "${item.name}" starts the form "${node.value}", which does not exist.`);
          }
          // A condition right after it is another branch of the same menu
          // ("if they tapped Talk to us…"), which the form's branch skips. Only
          // an unguarded step would actually run on top of the form.
          if (i < steps.length - 1 && steps[i + 1].type !== 'condition') {
            warn(item.key, `In "${item.name}", the step after "start the form" runs straight away, before the customer has answered it.`);
          }
        }
        if (node.subtype === 'template') {
          const key = refKey(node.value);
          const target = key ? byKey.get(key) : null;
          if (key && target?.type !== 'template') error(item.key, `Workflow "${item.name}" sends a template that is not part of this setup.`);
          if (key && target?.type === 'template') {
            warn(item.key, `"${item.name}" sends the template "${target.name}", which Meta has to approve first. The workflow is switched on once it is approved.`);
          }
          if (!key) {
            const found = have.templates.find((t) => t.name.toLowerCase() === String(node.value).toLowerCase());
            if (!found) error(item.key, `Workflow "${item.name}" sends the template "${node.value}", which does not exist.`);
            else if (found.status !== 'APPROVED') warn(item.key, `The template "${found.name}" is not approved yet, so that step will fail until it is.`);
          }
        }
        if (node.subtype === 'buttons') {
          const options = String(node.value).split('|').map((p) => p.trim()).filter(Boolean).slice(1);
          if (options.length > BUTTON_MAX) error(item.key, `In "${item.name}", a question can offer at most ${BUTTON_MAX} buttons.`);
          const long = options.find((o) => o.length > BUTTON_CHARS);
          if (long) error(item.key, `In "${item.name}", the button "${long}" is longer than ${BUTTON_CHARS} characters.`);
        }
      });
    }
  }

  // ── How the items connect ─────────────────────────────────────────────────
  const starters = items
    .map((item) => ({ item, starter: starterOf(item) }))
    .filter((s) => s.starter);

  // Two things listening for the same word: only the first in the handler's
  // order ever runs, and the other looks set up but never fires.
  for (let a = 0; a < starters.length; a += 1) {
    for (let b = a + 1; b < starters.length; b += 1) {
      const shared = starters[a].starter.keywords.find((k) => starters[b].starter.keywords.includes(k));
      if (!shared) continue;
      const [winner, loser] = RANK[starters[a].item.type] <= RANK[starters[b].item.type]
        ? [starters[a].item, starters[b].item] : [starters[b].item, starters[a].item];
      error(loser.key, `"${shared}" starts both the ${KIND[winner.type]} "${labelOf(winner)}" and the ${KIND[loser.type]} "${labelOf(loser)}". Only the first would ever run — give one a different keyword.`);
    }
  }

  for (const { item, starter } of starters) {
    for (const keyword of starter.keywords) {
      const form = have.forms.find((f) => String(f.keyword || '').toUpperCase() === keyword);
      const trigger = have.triggers.find((t) => String(t.keyword || '').toUpperCase() === keyword);
      const workflow = have.workflows.find((w) => keywordsOf(w.keyword).includes(keyword));
      if (form && item.type === 'form') error(item.key, `Your form "${form.name}" already uses the keyword "${keyword}".`);
      else if (form) error(item.key, `Your existing form "${form.name}" already answers "${keyword}", so this would never run.`);
      if (trigger && item.type === 'auto_reply') error(item.key, `You already have an auto-reply for "${keyword}".`);
      else if (trigger && !form) warn(item.key, `You already have an auto-reply for "${keyword}"; this will answer instead of it.`);
      if (workflow && item.type === 'workflow') warn(item.key, `Your workflow "${workflow.name}" also starts on "${keyword}". Only one of the two will run.`);
      else if (workflow && item.type === 'auto_reply') warn(item.key, `Your workflow "${workflow.name}" starts on "${keyword}", so this auto-reply would not be sent.`);
    }
  }

  if (items.filter((i) => i.type === 'workflow' && triggerOf(i)?.subtype === 'welcome').length > 1) {
    issues.push({ level: 'warning', itemKey: null, message: 'More than one workflow greets new contacts; only one of them will run for each new contact.' });
  }

  // Every button a customer can tap has to lead somewhere. A tap arrives as
  // the button's label, so something must be listening for that text.
  const listening = [
    ...starters.flatMap((s) => s.starter.keywords),
    ...have.forms.map((f) => f.keyword),
    ...have.triggers.map((t) => t.keyword),
    ...have.workflows.flatMap((w) => keywordsOf(w.keyword)),
  ].filter(Boolean);
  const leadsSomewhere = (label) => listening.some((k) => keywordMatches(k, label));

  for (const item of items) {
    if (item.type === 'template') {
      item.buttons.filter((b) => !leadsSomewhere(b)).forEach((b) => {
        warn(item.key, `Nothing happens when a customer taps "${b}" on the template "${item.name}" — no form, workflow or auto-reply is listening for it.`);
      });
    }
    if (item.type === 'workflow') {
      const steps = item.nodes.filter((n) => n.type !== 'trigger');
      steps.forEach((node, i) => {
        // Followed by "wait for reply", the answer is handled inside this
        // workflow; otherwise the tap is a fresh message.
        if (node.subtype !== 'buttons' || steps[i + 1]?.subtype === 'wait_reply') return;
        String(node.value).split('|').map((p) => p.trim()).filter(Boolean).slice(1)
          .filter((option) => !leadsSomewhere(option))
          .forEach((option) => warn(item.key, `In "${item.name}", nothing happens when a customer taps "${option}".`));
      });
    }
  }

  return { blueprint: { summary: blueprint.summary, items }, issues };
}

export const hasErrors = (issues) => issues.some((i) => i.level === 'error');

const nameOfRef = (value, byKey) => {
  const target = byKey.get(refKey(value));
  return target ? target.name : String(value ?? '');
};

/** Plain-English read-back of one item, so a person checks meaning, not JSON. */
export function describeItem(item, blueprint) {
  const byKey = new Map((blueprint?.items || []).map((i) => [i.key, i]));
  if (item.type === 'form') {
    const start = item.keyword ? `When someone messages "${item.keyword}", ask` : 'Asks';
    return `${start} ${item.fields.length} question${item.fields.length === 1 ? '' : 's'}: ${item.fields.map((f) => f.label).join('; ')}.`;
  }
  if (item.type === 'auto_reply') return `When someone messages "${item.keyword}", reply "${item.response}".`;
  if (item.type === 'template') {
    return `A ${item.category.toLowerCase()} template for Meta to approve${item.buttons.length ? `, with buttons ${item.buttons.map((b) => `"${b}"`).join(', ')}` : ''}.`;
  }
  try {
    const readable = item.nodes.map((n) => (['form', 'template'].includes(n.subtype) && refKey(n.value)
      ? { ...n, value: nameOfRef(n.value, byKey) } : n));
    return describeGraph(readable);
  } catch {
    return 'This workflow is incomplete.';
  }
}

// Changes when anything about an item changes, so apply can tell which
// records need updating and which are already as described.
export function hashItem(item) {
  const { key, ...rest } = item;
  return createHash('sha1').update(JSON.stringify(rest)).digest('hex').slice(0, 16);
}

/** A workflow's nodes with "@key" references replaced by real record names. */
export function resolveNodes(nodes, namesByKey) {
  return nodes.map((n, i) => {
    const key = ['form', 'template'].includes(n.subtype) ? refKey(n.value) : null;
    // Every step carries a value, even an empty one: the workflow builder
    // prints it, and a missing one showed as "Assign: undefined".
    return { id: `step_${i + 1}`, ...n, value: key ? (namesByKey[key] ?? n.value) : (n.value ?? '') };
  });
}
