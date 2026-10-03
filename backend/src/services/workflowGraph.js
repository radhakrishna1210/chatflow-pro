// What a workflow graph may contain, and the check that enforces it.
//
// The engine reads `node.subtype` and used to silently skip anything it did
// not recognise, so an invented subtype (from an API client or an AI draft)
// produced a workflow that saved, showed up in the list, and never fired — the
// worst possible failure, because it looks like it works. validateGraph() runs
// on every workflow create/update (validators/index.js) and refuses rather
// than guesses.
//
// This module used to also hold a second, LLM-driven "compile" generator
// behind POST /workflows/compile. Nothing called it; the builder's
// "Create with AI" uses generateWorkflowPreview (automation.service.js), so
// that is now the one generator, and drafts it produces are saved inactive.

// The engine's real vocabulary, read from workflowEngine.service.js and
// workflowCrm.service.js. Kept here as one table because "what can a workflow
// do" was previously only discoverable by reading two switch statements.
// What the `media` trigger can be narrowed to (inboundMessage.js#mediaTypeOf).
export const MEDIA_KINDS = ['any', 'image', 'video', 'audio', 'document', 'sticker'];

export const TRIGGERS = {
  keyword: { needsValue: true, describe: (v) => `someone messages "${v}"` },
  welcome: { needsValue: false, describe: () => 'a new contact messages for the first time' },
  // A photo, video, document, sticker or voice note (value narrows the kind).
  media: {
    needsValue: false,
    describe: (v) => ({
      image: 'someone sends a photo', video: 'someone sends a video', audio: 'someone sends a voice note',
      document: 'someone sends a document', sticker: 'someone sends a sticker',
    })[String(v || '').toLowerCase()] ?? 'someone sends a photo, video, document or voice note',
  },
  // `missed` is deliberately absent: nothing delivers a missed-call event to
  // the engine, so a workflow compiled onto it would never fire.
  lead_created: { needsValue: false, describe: () => 'a lead is created' },
  lead_status: { needsValue: false, describe: (v) => (v ? `a lead becomes ${v}` : 'a lead changes status') },
  deal_stage: { needsValue: false, describe: (v) => (v ? `a deal reaches ${v}` : 'a deal changes stage') },
  score_above: { needsValue: true, describe: (v) => `a lead's score rises above ${v}` },
};

export const ACTIONS = {
  message: { needsValue: true, describe: (v) => `send "${v}"` },
  buttons: { needsValue: true, describe: (v) => `ask "${String(v).split('|')[0].trim()}" with options` },
  wait_reply: { needsValue: false, describe: (v) => (v ? `wait for their reply (saved as {{${v}}})` : 'wait for their reply') },
  template: { needsValue: true, describe: (v) => `send template "${v}"` },
  delay: { needsValue: true, describe: (v) => `wait ${v}` },
  tag: { needsValue: true, describe: (v) => `tag the contact "${v}"` },
  // The engine's `agent` step assigns the conversation to a workspace member
  // and stops automation on it — a human handoff, not the AI agent.
  agent: { needsValue: false, describe: () => 'hand the chat to a person on the team' },
  task: { needsValue: true, describe: (v) => `create a task "${v}"` },
  lead_status: { needsValue: true, describe: (v) => `set the lead to ${v}` },
  owner: { needsValue: true, describe: () => 'assign an owner' },
  sequence: { needsValue: true, describe: () => 'enrol them in a sequence' },
};

// Mirrors CONDITION_SUBTYPES in workflowConditions.js.
export const CONDITIONS = {
  contains: { needsValue: true, describe: (v) => `if their message contains "${v}"` },
  equals: { needsValue: true, describe: (v) => `if their message is "${v}"` },
  is_new_contact: { needsValue: false, describe: () => 'if they are a new contact' },
  has_tag: { needsValue: true, describe: (v) => `if they are tagged "${v}"` },
  field_equals: { needsValue: true, describe: (v) => `if ${String(v).replace('=', ' is ')}` },
  field_set: { needsValue: true, describe: (v) => `if their ${v} is known` },
};

// The built-in lead statuses and deal stages. A workflow may name any status
// or stage key — workspaces add their own lifecycle stages (Customize Your
// Business → Lead Lifecycle) and pipeline stages — so these are not a graph
// rule. workflow.service.js checks the keys against the workspace's own
// configuration on save and warns about an unknown one.
export const BUILTIN_LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'NURTURING', 'CONVERTED', 'LOST'];
export const BUILTIN_DEAL_STAGES = ['QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];

// Triggers fired by a CRM change rather than by the customer writing in. A run
// they start has no recent customer message, so WhatsApp's 24-hour window is
// usually closed and only a template reaches the contact.
export const CRM_TRIGGER_SUBTYPES = new Set(['lead_created', 'lead_status', 'deal_stage', 'score_above']);

// Steps that put free-form text in front of the customer: only deliverable
// inside the 24-hour customer service window.
const FREE_FORM_SUBTYPES = new Set(['message', 'buttons']);

// Matches parseDelayMs below. "Immediate" (the builder's first delay option)
// and "0" are a zero delay.
const DELAY_RE = /^\s*\d+(\.\d+)?\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?\s*$/i;
const IMMEDIATE_RE = /^\s*immediate\s*$/i;

// "5 min" / "1 hour" / "1 day" / "10" / "10s" / "Immediate" — the strings the
// builder emits or numeric inputs, defaulting to seconds for bare numbers.
// Lives here (re-exported by the engine) so the validator's 24-hour warning
// measures delays exactly the way the engine waits them.
export function parseDelayMs(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text || text === 'immediate' || text === '0') return 0;

  const match = text.match(/^(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)?$/);
  if (!match) return 0;

  const amount = parseFloat(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return 0;

  const unit = match[2] || 's';
  const perUnit =
    /^(seconds?|secs?|s)$/.test(unit) ? 1000 :
    /^(minutes?|mins?|m)$/.test(unit) ? 60_000 :
    /^(hours?|hrs?|h)$/.test(unit) ? 3_600_000 :
    86_400_000;

  // BullMQ delays are milliseconds in a 32-bit-ish range in practice; a week
  // is far beyond any sane automation delay and keeps jobs from being parked
  // effectively forever by a typo like "999 days".
  return Math.min(amount * perUnit, 7 * 86_400_000);
}

// WhatsApp's window is 24 hours from the customer's last message; a step that
// far out cannot be delivered as free text, and 23 hours leaves no margin for
// the run itself.
const WINDOW_WARN_MS = 23 * 3_600_000;

// The engine's own limit (workflowEngine.service.js), counting conditions.
export const MAX_ACTIONS = 20;

// What WhatsApp shows of an option: reply-button titles are cut to 20
// characters, list rows (four or more options) to 24. Mirrors
// lib/meta.js#INTERACTIVE_LIMITS, kept literal so the validator does not load
// the Meta client and its configuration.
const BUTTON_TITLE_CHARS = 20;
const ROW_TITLE_CHARS = 24;
const MAX_BUTTONS = 3;
const MAX_OPTIONS = 10;

const fail = (message, status = 400) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};

// The options of a buttons step, as authored ("Question | A | B" or an
// explicit `options` array).
export const buttonOptions = (node) => (Array.isArray(node?.options) && node.options.length
  ? node.options.map((o) => String(typeof o === 'string' ? o : o?.title ?? '').trim()).filter(Boolean)
  : String(node?.value ?? '').split('|').map((p) => p.trim()).filter(Boolean).slice(1));

const describeDelay = (ms) => (ms >= 86_400_000 && ms % 86_400_000 === 0
  ? `${ms / 86_400_000} day(s)`
  : `${Math.round(ms / 3_600_000)} hour(s)`);

/**
 * Checks a graph against what the engine can actually run.
 *
 * Returns { nodes, warnings }. Throws on anything that would produce a
 * workflow that saves but never fires. `nodes` is the normalised graph to
 * persist: ids, canvas positions and step settings are kept, and a wait for
 * the reply is inserted where buttons lead straight into a condition.
 */
export function validateGraph(raw) {
  const nodes = Array.isArray(raw) ? raw : [];
  const warnings = [];

  const triggers = nodes.filter((n) => n?.type === 'trigger');
  if (triggers.length === 0) fail('That automation has no starting point — say what should set it off.');
  if (triggers.length > 1) fail('An automation can only have one trigger.');

  const trigger = triggers[0];
  const triggerSpec = TRIGGERS[trigger.subtype];
  if (!triggerSpec) {
    fail(`"${trigger.subtype ?? 'unknown'}" is not something that can start an automation. Available: ${Object.keys(TRIGGERS).join(', ')}.`);
  }
  if (triggerSpec.needsValue && !String(trigger.value ?? '').trim()) {
    fail(`A "${trigger.subtype}" trigger needs a value — for example the keyword to watch for.`);
  }

  if (trigger.subtype === 'media' && trigger.value
    && !MEDIA_KINDS.includes(String(trigger.value).trim().toLowerCase())) {
    fail(`"${trigger.value}" is not a kind of media. One of: ${MEDIA_KINDS.join(', ')}.`);
  }
  if (trigger.subtype === 'score_above' && !Number.isFinite(Number(trigger.value))) {
    fail('A score trigger needs a number.');
  }

  const steps = nodes.filter((n) => n?.type === 'action' || n?.type === 'condition');
  const actions = steps.filter((n) => n.type === 'action');
  if (actions.length === 0) fail('That automation does not do anything — say what should happen.');

  steps.forEach((node, i) => {
    if (node.type === 'condition') {
      const spec = CONDITIONS[node.subtype];
      if (!spec) {
        fail(`Step ${i + 1}: "${node.subtype ?? 'unknown'}" is not a condition the engine can check. Available: ${Object.keys(CONDITIONS).join(', ')}.`);
      }
      if (spec.needsValue && !String(node.value ?? '').trim()) {
        fail(`Step ${i + 1} (${node.subtype}) is missing its value.`);
      }
      const skip = Number(node.skipIfFalse ?? 1);
      if (!Number.isInteger(skip) || skip < 1 || i + skip >= steps.length) {
        fail(`Step ${i + 1}: a condition must skip between 1 and ${steps.length - i - 1} following step(s).`);
      }
      return;
    }
    const spec = ACTIONS[node.subtype];
    if (!spec) {
      fail(`Step ${i + 1}: "${node.subtype ?? 'unknown'}" is not something an automation can do. Available: ${Object.keys(ACTIONS).join(', ')}.`);
    }
    if (spec.needsValue && !String(node.value ?? '').trim()) {
      fail(`Step ${i + 1} (${node.subtype}) is missing its value.`);
    }
    if (node.subtype === 'delay' && !(DELAY_RE.test(String(node.value)) || IMMEDIATE_RE.test(String(node.value)))) {
      fail(`Step ${i + 1}: "${node.value}" is not a duration the engine understands. Use something like "2 hours" or "1 day".`);
    }
    if (node.subtype === 'template') {
      if (node.templateId != null && typeof node.templateId !== 'string') {
        fail(`Step ${i + 1}: the template id must be text.`);
      }
      if (node.params != null && (!Array.isArray(node.params)
        || node.params.some((p) => p != null && typeof p !== 'string' && typeof p !== 'number'))) {
        fail(`Step ${i + 1}: template values must be a list of texts, one per {{1}}, {{2}}, …`);
      }
    }
    if (node.subtype === 'buttons') {
      const options = buttonOptions(node);
      if (options.length < 1) fail(`Step ${i + 1}: buttons are written as "Question | Option A | Option B".`);
      // Two options WhatsApp would show identically: Meta refuses duplicate
      // reply-button titles, and a tap on either could only ever be read as
      // the first.
      const shown = options.slice(0, MAX_OPTIONS);
      const max = shown.length <= MAX_BUTTONS ? BUTTON_TITLE_CHARS : ROW_TITLE_CHARS;
      const kind = shown.length <= MAX_BUTTONS ? 'button' : 'list option';
      const seen = new Map();
      for (const option of shown) {
        const title = option.slice(0, max).trim().toLowerCase();
        if (seen.has(title)) {
          fail(`Step ${i + 1}: the options "${seen.get(title)}" and "${option}" would show as the same ${kind} on WhatsApp, which cuts a ${kind} to ${max} characters. Make them differ within the first ${max} characters.`);
        }
        seen.set(title, option);
      }
      if (options.length > MAX_OPTIONS) {
        warnings.push(`Step ${i + 1}: WhatsApp shows at most ${MAX_OPTIONS} options; the last ${options.length - MAX_OPTIONS} will not be offered.`);
      }
    }
  });

  // Buttons followed straight by a condition test the trigger message, not the
  // customer's choice. The fix is unambiguous, so it is made and reported. An
  // earlier condition whose skip window covers the buttons is widened to cover
  // the inserted wait too, or its last guarded step would escape the guard.
  const ordered = steps.map((n, i) => ({ node: { ...n }, step: i + 1 }));
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const { node, step } = ordered[i];
    if (node.subtype === 'buttons' && ordered[i + 1].node.type === 'condition') {
      for (let j = 0; j < i; j += 1) {
        const guard = ordered[j].node;
        if (guard.type === 'condition' && j + Number(guard.skipIfFalse ?? 1) >= i) {
          guard.skipIfFalse = Number(guard.skipIfFalse ?? 1) + 1;
        }
      }
      ordered.splice(i + 1, 0, {
        node: { ...(node.id != null ? { id: `${node.id}_reply` } : {}), type: 'action', subtype: 'wait_reply', value: '' },
        step: null,
      });
      warnings.push(`Added a "wait for their reply" after step ${step}, so the conditions below it check which option was tapped.`);
    }
  }
  if (ordered.length > MAX_ACTIONS) fail(`That is ${ordered.length} steps; the engine runs at most ${MAX_ACTIONS}.`);

  // Worth saying out loud rather than silently accepting: a trailing delay
  // parks the run forever with nothing after it.
  if (actions.at(-1)?.subtype === 'delay') {
    warnings.push('The last step is a wait with nothing after it, so the automation will pause and then stop.');
  }
  if (actions.every((a) => a.subtype === 'delay')) {
    warnings.push('Every step is a wait — this automation will not do anything.');
  }

  warnings.push(...deliveryWarnings(trigger, steps));

  // Normalised so the engine and the visual builder both read them the same
  // way. Everything else on a node (id, canvas position, options, reminder,
  // template id and values) is kept: it is what the builder and the engine
  // read back, and dropping it lost the step's own settings.
  const normalise = (n) => ({
    ...n,
    type: n.type,
    subtype: n.subtype,
    value: n.value != null ? String(n.value) : undefined,
    ...(n.type === 'condition' ? { skipIfFalse: Number(n.skipIfFalse ?? 1) } : {}),
  });
  const normalised = [normalise(trigger), ...ordered.map(({ node }) => normalise(node))];

  return { nodes: normalised, warnings };
}

// Steps that will not reach the customer the way the author expects, found by
// walking the steps in order. Conditions are treated as passing: the warning
// is about what can happen, not what always happens.
function deliveryWarnings(trigger, steps) {
  const warnings = [];
  const crm = CRM_TRIGGER_SUBTYPES.has(trigger.subtype);
  // Time since the customer last wrote, along the straight path: the trigger
  // message (nothing, for a CRM trigger) and every answered wait.
  let sinceCustomer = 0;
  let customerSpoke = !crm;
  const crmFreeForm = [];

  steps.forEach((node, i) => {
    if (node.type !== 'action') return;
    if (node.subtype === 'wait_reply') {
      sinceCustomer = 0;
      customerSpoke = true;
      return;
    }
    if (node.subtype === 'delay') {
      sinceCustomer += parseDelayMs(node.value);
      return;
    }
    if (node.subtype === 'agent') {
      warnings.push(`Step ${i + 1} ("Assign to agent") pauses all automation on this chat until an agent resolves it or it expires.`);
      return;
    }
    if (!FREE_FORM_SUBTYPES.has(node.subtype)) return;
    if (!customerSpoke) {
      crmFreeForm.push(i + 1);
    } else if (sinceCustomer >= WINDOW_WARN_MS) {
      warnings.push(`Step ${i + 1} (${node.subtype}) runs ${describeDelay(sinceCustomer)} after the customer last wrote. WhatsApp only delivers free-form messages within 24 hours of that, so this step will fail — use a template step, or wait for their reply first.`);
    }
  });

  if (crmFreeForm.length) {
    const many = crmFreeForm.length > 1;
    warnings.push(`Step${many ? 's' : ''} ${crmFreeForm.join(', ')} send${many ? '' : 's'} a free-form message, which is only delivered if the contact messaged you in the last 24h. This workflow starts from a CRM change, so use a template step to reach the contact.`);
  }
  return warnings;
}

/** Plain-English read-back, so the person checks meaning rather than JSON. */
export function describeGraph(nodes) {
  const trigger = nodes.find((n) => n.type === 'trigger');
  const actions = nodes.filter((n) => n.type === 'action' || n.type === 'condition');
  const when = TRIGGERS[trigger.subtype]?.describe(trigger.value) ?? trigger.subtype;
  const steps = actions.map((a) => (a.type === 'condition'
    ? `${CONDITIONS[a.subtype]?.describe(a.value) ?? a.subtype} (otherwise skip ${a.skipIfFalse ?? 1})`
    : ACTIONS[a.subtype]?.describe(a.value) ?? a.subtype));
  return `When ${when}, ${steps.join(', then ')}.`;
}
export const __testing = { MAX_ACTIONS };
