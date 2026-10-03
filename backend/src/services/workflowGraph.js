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

const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'LOST'];
const DEAL_STAGES = ['QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];

// Matches parseDelayMs in the engine.
const DELAY_RE = /^\s*\d+(\.\d+)?\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?\s*$/i;

// The engine's own limit (workflowEngine.service.js), counting conditions.
export const MAX_ACTIONS = 20;

const fail = (message, status = 400) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};

/**
 * Checks a graph against what the engine can actually run.
 *
 * Returns { nodes, warnings }. Throws on anything that would produce a
 * workflow that saves but never fires.
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
  if (trigger.subtype === 'lead_status' && trigger.value && !LEAD_STATUSES.includes(String(trigger.value).toUpperCase())) {
    fail(`"${trigger.value}" is not a lead status. One of: ${LEAD_STATUSES.join(', ')}.`);
  }
  if (trigger.subtype === 'deal_stage' && trigger.value && !DEAL_STAGES.includes(String(trigger.value).toUpperCase().replace(/\s+/g, '_'))) {
    fail(`"${trigger.value}" is not a deal stage. One of: ${DEAL_STAGES.join(', ')}.`);
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
    if (node.subtype === 'delay' && !DELAY_RE.test(String(node.value))) {
      fail(`Step ${i + 1}: "${node.value}" is not a duration the engine understands. Use something like "2 hours" or "1 day".`);
    }
    if (node.subtype === 'lead_status' && !LEAD_STATUSES.includes(String(node.value).toUpperCase())) {
      fail(`Step ${i + 1}: "${node.value}" is not a lead status. One of: ${LEAD_STATUSES.join(', ')}.`);
    }
    if (node.subtype === 'buttons' && !(Array.isArray(node.options) && node.options.length > 0)
      && String(node.value).split('|').map((p) => p.trim()).filter(Boolean).length < 2) {
      fail(`Step ${i + 1}: buttons are written as "Question | Option A | Option B".`);
    }
  });

  // Buttons followed straight by a condition test the trigger message, not the
  // customer's choice. The fix is unambiguous, so it is made and reported.
  const ordered = [];
  steps.forEach((node, i) => {
    ordered.push(node);
    if (node.subtype === 'buttons' && steps[i + 1]?.type === 'condition') {
      ordered.push({ type: 'action', subtype: 'wait_reply' });
      warnings.push(`Added a "wait for their reply" after step ${i + 1}, so the conditions below it check which option was tapped.`);
    }
  });
  if (ordered.length > MAX_ACTIONS) fail(`That is ${ordered.length} steps; the engine runs at most ${MAX_ACTIONS}.`);

  // Worth saying out loud rather than silently accepting: a trailing delay
  // parks the run forever with nothing after it.
  if (actions.at(-1)?.subtype === 'delay') {
    warnings.push('The last step is a wait with nothing after it, so the automation will pause and then stop.');
  }
  if (actions.every((a) => a.subtype === 'delay')) {
    warnings.push('Every step is a wait — this automation will not do anything.');
  }

  // Normalised so the engine and the visual builder both read them the same way.
  const normalised = [
    { type: 'trigger', subtype: trigger.subtype, value: trigger.value != null ? String(trigger.value) : undefined },
    ...ordered.map((a) => ({
      type: a.type,
      subtype: a.subtype,
      value: a.value != null ? String(a.value) : undefined,
      ...(a.type === 'condition' ? { skipIfFalse: Number(a.skipIfFalse ?? 1) } : {}),
    })),
  ];

  return { nodes: normalised, warnings };
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
