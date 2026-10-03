// Workflow-builder step logic with no React in it, so it can be unit-tested
// with `node --test` and imported by AutomationView.jsx alike.

// Mirrors the vocabulary in backend/src/services/workflowGraph.js, which the
// server validates every saved workflow against.
export const TRIGGER_SUBTYPES = [
  // A "Missed inbound call" trigger used to be offered here, but nothing ever
  // delivers a missed-call event to the engine, so it could never fire.
  ['keyword', 'Keyword Match'], ['welcome', 'New Contact Welcome'],
  // A photo, video, document or voice note arrived (a transcribed voice note
  // also reaches keyword triggers first).
  ['media', 'Media Received'],
  // CRM events. These fire from the leads/deals services rather than from an
  // inbound message, so a run started by one has no conversation attached.
  ['lead_created', 'CRM: Lead created'],
  ['lead_status', 'CRM: Lead status changed'],
  ['deal_stage', 'CRM: Deal stage changed'],
  ['score_above', 'CRM: Lead score reaches'],
];

export const ACTION_SUBTYPES = [
  ['message', 'Send message'],
  // Tappable choices on WhatsApp, written "Question | Option A | Option B".
  ['buttons', 'Ask with buttons'],
  // Pauses the run until the customer answers; conditions below it test the
  // answer, and a name here saves it as {{name}} for later messages.
  ['wait_reply', 'Wait for reply'],
  ['template', 'Send approved template'],
  ['delay', 'Wait / Delay'], ['tag', 'Add contact tag'],
  // A human handoff: it pauses every automation on the chat, so the label says so.
  ['agent', 'Assign to agent (pauses automation)'],
  ['task', 'CRM: Create task'],
  ['lead_status', 'CRM: Set lead status'],
  ['owner', 'CRM: Assign owner'],
  ['sequence', 'CRM: Enrol in sequence'],
];

// Mirrors CONDITION_SUBTYPES in backend/src/services/workflowConditions.js. A
// condition asks something about the conversation and, when the answer is no,
// skips the steps below it — which is how this linear builder expresses a
// branch without becoming a graph editor.
export const CONDITION_SUBTYPES = [
  ['contains', 'Message contains'],
  ['equals', 'Message is exactly'],
  ['is_new_contact', 'Is a new contact'],
  ['has_tag', 'Contact has tag'],
  ['field_equals', 'Contact field equals'],
  ['field_set', 'Contact field is set'],
];

/** The human label of any subtype, falling back to the raw id. */
export function subtypeLabel(type, subtype) {
  const list = type === 'trigger' ? TRIGGER_SUBTYPES : type === 'condition' ? CONDITION_SUBTYPES : ACTION_SUBTYPES;
  return list.find(([id]) => id === subtype)?.[1] ?? String(subtype ?? '');
}

// ── Delays ──────────────────────────────────────────────────────────────────
// What the delay dropdown offers. "Immediate" is a zero delay (the engine and,
// per contract C5, the validator accept it). The palette default and the
// dropdown both come from here so they cannot disagree again (the palette used
// to add "1h", which the dropdown did not list).
export const DELAY_CHOICES = ['Immediate', '5 min', '15 min', '1 hour', '4 hours', '1 day'];

// Changing a step's kind must reset its value. Switching a keyword trigger to
// "Deal stage changed" would otherwise leave value:"ORDER" behind — the select
// would show nothing selected, and saving would store a stage the server never
// matches.
export const DEFAULT_STEP_VALUE = {
  keyword: 'HELP',
  welcome: '', lead_created: '', media: '',
  lead_status: '', deal_stage: '',
  score_above: '70',
  message: 'Thanks for reaching out. Our team will help you shortly.',
  buttons: 'How can we help? | Track my order | Talk to support',
  wait_reply: '', template: '',
  delay: '1 hour',
  tag: '', agent: '',
  task: '', owner: '', sequence: '',
  contains: '', equals: '', is_new_contact: '', has_tag: '', field_equals: '', field_set: '',
};

// Fields that belong to one subtype only and must not survive a change of kind.
const SUBTYPE_ONLY_FIELDS = {
  wait_reply: ['remindAfter', 'reminder'],
  template: ['templateId', 'params'],
};

export function applyStepChange(step, fields) {
  const next = { ...step, ...fields };

  if (fields.type && fields.type !== step.type) {
    next.subtype = fields.type === 'trigger' ? 'keyword' : fields.type === 'condition' ? 'equals' : 'message';
    next.value = DEFAULT_STEP_VALUE[next.subtype];
    if (fields.type === 'condition') next.skipIfFalse = next.skipIfFalse ?? 1;
    else delete next.skipIfFalse;
  } else if (fields.subtype && fields.subtype !== step.subtype) {
    next.value = DEFAULT_STEP_VALUE[fields.subtype] ?? '';
  }
  // A reminder belongs to a "Wait for reply" step only; a template id and its
  // parameters to a template step only.
  for (const [owner, keys] of Object.entries(SUBTYPE_ONLY_FIELDS)) {
    if (next.subtype !== owner) for (const k of keys) delete next[k];
  }
  return next;
}

// ── Trigger kinds and what each step can do under them ──────────────────────
export const CRM_TRIGGERS = new Set(['lead_created', 'lead_status', 'deal_stage', 'score_above']);
export const MESSAGE_TRIGGERS = new Set(['keyword', 'welcome', 'media']);
export const isCrmTrigger = (subtype) => CRM_TRIGGERS.has(subtype);

// Free-form chat steps. WhatsApp only delivers these inside the 24-hour
// customer-service window, which a CRM event does not open.
export const CHAT_WINDOW_ACTIONS = new Set(['message', 'buttons', 'wait_reply']);
// Steps that act on the contact's lead. A run started by a message has no lead
// of its own; the step applies to the contact's lead, if there is one.
export const LEAD_ACTIONS = new Set(['lead_status', 'owner']);

export const HINTS = {
  crmChatStep: 'This workflow starts from a CRM event, not a chat. A free-form message, buttons or "Wait for reply" only reaches a contact who messaged you in the last 24 hours — use "Send approved template" to reach everyone.',
  messageLeadStep: 'Applies to the contact\'s lead, if they have one. A contact with no lead is skipped for this step.',
  agent: 'Hands the chat to a person on your team. Every automation on this chat — workflows, auto-replies and the AI agent — pauses until the conversation is resolved or the handoff expires.',
  template: 'Templates reach the contact at any time, even outside the 24-hour window. Only templates Meta has approved can be sent.',
};

/**
 * The inline hint for one step given the workflow's trigger, or null. Mirrored
 * in the builder so the "looks valid but cannot work" combinations are called
 * out before they are saved.
 */
export function stepHint(triggerSubtype, step) {
  if (!step || step.type !== 'action') return null;
  if (step.subtype === 'agent') return { tone: 'warn', key: 'agent', text: HINTS.agent };
  if (isCrmTrigger(triggerSubtype) && CHAT_WINDOW_ACTIONS.has(step.subtype)) {
    return { tone: 'warn', key: 'crmChatStep', text: HINTS.crmChatStep };
  }
  if (MESSAGE_TRIGGERS.has(triggerSubtype) && LEAD_ACTIONS.has(step.subtype)) {
    return { tone: 'info', key: 'messageLeadStep', text: HINTS.messageLeadStep };
  }
  return null;
}

/**
 * The action choices in the order the builder offers them. Under a CRM trigger
 * the template step comes first: it is the only send that reliably reaches a
 * contact who has not messaged in the last day.
 */
export function actionSubtypesFor(triggerSubtype) {
  if (!isCrmTrigger(triggerSubtype)) return ACTION_SUBTYPES;
  const tpl = ACTION_SUBTYPES.find(([id]) => id === 'template');
  return [tpl, ...ACTION_SUBTYPES.filter(([id]) => id !== 'template')];
}

// ── Lead statuses and deal stages ──────────────────────────────────────────
// Built-ins, matching the server's defaults. CONVERTED is emitted when a lead
// is converted (leads.service.js#convertLead), so a trigger can wait for it;
// setting it by hand is what "Convert" does, so the action does not offer it.
export const BUILTIN_LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED', 'LOST'];
export const BUILTIN_DEAL_STAGES = ['QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];
const TRIGGER_ONLY_STATUSES = new Set(['CONVERTED']);

export const prettyEnum = (s) => String(s ?? '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

function mergeChoices(builtins, configured, current) {
  const out = [];
  const seen = new Set();
  const add = (key, label) => {
    const k = String(key ?? '').trim();
    if (!k || seen.has(k.toUpperCase())) return;
    seen.add(k.toUpperCase());
    out.push({ key: k, label: label || prettyEnum(k) });
  };
  // The workspace's own stages first, in its order and with its labels.
  for (const s of Array.isArray(configured) ? configured : []) {
    if (s && s.isActive !== false) add(s.key, s.label);
  }
  for (const k of builtins) add(k);
  // A saved value that is no longer configured stays selectable, rather than
  // the dropdown silently showing a different one.
  if (current) add(current, `${prettyEnum(current)} (not configured)`);
  return out;
}

/**
 * Lead-status choices: the workspace's lifecycle stages (Customize Your
 * Business → lead_lifecycle) plus the built-ins. `forAction` drops the
 * trigger-only CONVERTED.
 */
export function leadStatusChoices(crmConfig, { forAction = false, current } = {}) {
  const builtins = forAction ? BUILTIN_LEAD_STATUSES.filter((s) => !TRIGGER_ONLY_STATUSES.has(s)) : BUILTIN_LEAD_STATUSES;
  return mergeChoices(builtins, crmConfig?.lead_lifecycle?.stages, current);
}

/** Deal-stage choices: the workspace's pipeline (deal_setup) plus the built-ins. */
export function dealStageChoices(crmConfig, { current } = {}) {
  return mergeChoices(BUILTIN_DEAL_STAGES, crmConfig?.deal_setup?.stages, current);
}

// ── Keywords ────────────────────────────────────────────────────────────────
export const KEYWORD_HINT = 'Separate keywords with commas. Whole words, case-insensitive. The most specific matching keyword wins across workflows.';

/** The keywords a trigger value lists, trimmed and de-duplicated (case-insensitively). */
export function parseKeywords(value) {
  const seen = new Set();
  const out = [];
  for (const raw of String(value ?? '').split(',')) {
    const k = raw.trim();
    if (!k || seen.has(k.toUpperCase())) continue;
    seen.add(k.toUpperCase());
    out.push(k);
  }
  return out;
}

// ── Templates ───────────────────────────────────────────────────────────────
/** The body text of a template record (`components[].type === 'BODY'`). */
export function templateBodyText(template) {
  const list = Array.isArray(template?.components) ? template.components : [];
  const body = list.find((c) => String(c?.type || '').toUpperCase() === 'BODY');
  return typeof body?.text === 'string' ? body.text : '';
}

/**
 * How many body parameters a template takes: the highest {{n}} in its body.
 * Meta numbers them from 1 without gaps, so {{3}} alone still means three.
 */
export function templateParamCount(bodyText) {
  let max = 0;
  for (const m of String(bodyText ?? '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/** The 1-based placeholder numbers left blank in `params`. */
export function unmappedParams(count, params) {
  const list = Array.isArray(params) ? params : [];
  const out = [];
  for (let i = 0; i < count; i += 1) if (!String(list[i] ?? '').trim()) out.push(i + 1);
  return out;
}

/** `params` resized to exactly `count` entries, keeping what was typed. */
export function resizeParams(params, count) {
  const list = Array.isArray(params) ? params : [];
  return Array.from({ length: count }, (_, i) => String(list[i] ?? ''));
}

export const isApprovedTemplate = (t) => String(t?.status || '').toUpperCase() === 'APPROVED';

/**
 * The variables a step can use: the contact's name, custom fields, the last
 * reply, and every name an earlier "Wait for reply" step saves.
 */
export function variablesBefore(steps, index) {
  const names = [];
  (steps || []).slice(0, Math.max(0, index)).forEach((s) => {
    const v = String(s?.value ?? '').trim();
    if (s?.subtype === 'wait_reply' && v && !names.includes(v)) names.push(v);
  });
  return [
    { token: '{{name}}', label: 'Contact name' },
    { token: '{{custom.}}', label: 'Contact custom field (type its key after "custom.")' },
    ...(names.length ? [{ token: '{{last_reply}}', label: 'Last reply' }] : []),
    ...names.map((n) => ({ token: `{{${n}}}`, label: `Reply saved as "${n}"` })),
  ];
}

// ── Step numbering ──────────────────────────────────────────────────────────
// The server numbers steps from 1 *after* the trigger ("Step 1 (tag) is
// missing its value"), so the builder does too — in the list, on the canvas
// and in its own messages. The trigger is just "Trigger".

/** The 1-based number of steps[index], or null for the trigger. */
export function stepNumber(steps, index) {
  const list = steps || [];
  if (list[index]?.type === 'trigger') return null;
  let n = 0;
  for (let i = 0; i <= index && i < list.length; i += 1) if (list[i]?.type !== 'trigger') n += 1;
  return n;
}

/** "Trigger" or "Step N". */
export const stepTitle = (steps, index) => {
  const n = stepNumber(steps, index);
  return n === null ? 'Trigger' : `Step ${n}`;
};

// ── Editing the order ───────────────────────────────────────────────────────
// A condition guards the `skipIfFalse` steps after it. Inserting or removing a
// step inside that window has to grow or shrink it, or the guard silently
// covers different steps than the person chose.

const splitTrigger = (steps) => {
  const list = Array.isArray(steps) ? steps : [];
  return { triggers: list.filter((s) => s?.type === 'trigger'), body: list.filter((s) => s?.type !== 'trigger') };
};

/** How many steps follow steps[index] — the largest skip a condition there can have. */
export function maxSkipFor(steps, index) {
  const list = steps || [];
  let n = 0;
  for (let i = index + 1; i < list.length; i += 1) if (list[i]?.type !== 'trigger') n += 1;
  return n;
}

/** Clamps every condition's skip to the steps that actually follow it. */
export function clampSkips(steps) {
  const { triggers, body } = splitTrigger(steps);
  const fixed = body.map((s, i) => {
    if (s.type !== 'condition') return s;
    const max = body.length - i - 1;
    const skip = Number(s.skipIfFalse ?? 1);
    const next = Math.max(1, Math.min(Number.isInteger(skip) ? skip : 1, Math.max(1, max)));
    return next === s.skipIfFalse ? s : { ...s, skipIfFalse: next };
  });
  return [...triggers, ...fixed];
}

/**
 * Inserts `node` so it becomes the `position`-th non-trigger step (0-based).
 * A condition above it whose window reaches the new spot grows by one, so it
 * keeps guarding the steps it guarded and the inserted one between them.
 */
export function insertStep(steps, position, node) {
  const { triggers, body } = splitTrigger(steps);
  const at = Math.max(0, Math.min(Number(position) || 0, body.length));
  const grown = body.map((s, i) => {
    if (s.type !== 'condition' || i >= at) return s;
    const skip = Number(s.skipIfFalse ?? 1);
    // The window is steps i+1 .. i+skip; inserting at `at` lands inside it
    // when at <= i + skip (inserting right after the last guarded step does not).
    return at <= i + skip && at > i ? { ...s, skipIfFalse: skip + 1 } : s;
  });
  return [...triggers, ...grown.slice(0, at), node, ...grown.slice(at)];
}

/** Removes the step with `id`, shrinking any condition window that covered it. */
export function removeStep(steps, id) {
  const { triggers, body } = splitTrigger(steps);
  const at = body.findIndex((s) => s.id === id);
  if (at === -1) return (steps || []).filter((s) => s.id !== id);
  const shrunk = body.map((s, i) => {
    if (s.type !== 'condition' || i >= at) return s;
    const skip = Number(s.skipIfFalse ?? 1);
    return at <= i + skip ? { ...s, skipIfFalse: Math.max(1, skip - 1) } : s;
  });
  shrunk.splice(at, 1);
  return clampSkips([...triggers, ...shrunk]);
}

/** Moves the step with `id` to non-trigger position `to` (0-based). */
export function moveStepTo(steps, id, to) {
  const { triggers, body } = splitTrigger(steps);
  const from = body.findIndex((s) => s.id === id);
  if (from === -1) return steps;
  const target = Math.max(0, Math.min(Number(to) || 0, body.length - 1));
  if (target === from) return steps;
  const next = [...body];
  const [node] = next.splice(from, 1);
  next.splice(target, 0, node);
  return clampSkips([...triggers, ...next]);
}

/** Moves the step with `id` one place up (-1) or down (+1). */
export function moveStep(steps, id, dir) {
  const { body } = splitTrigger(steps);
  const from = body.findIndex((s) => s.id === id);
  if (from === -1) return steps;
  return moveStepTo(steps, id, from + (dir < 0 ? -1 : 1));
}

let idSeq = 0;
export const newStepId = () => `step_${Date.now().toString(36)}_${(idSeq += 1)}`;

/**
 * Nodes as the builder keeps them: trigger first, every node with an id (the
 * server's normalised nodes carry none), and no canvas `pos` (the canvas lays
 * out by order, so a stored position would only disagree with it).
 */
export function normaliseLoadedSteps(nodes) {
  const list = (Array.isArray(nodes) ? nodes : []).filter((n) => n && typeof n === 'object');
  const seen = new Set();
  const withIds = list.map((n) => {
    // eslint-disable-next-line no-unused-vars
    const { pos, ...rest } = n;
    let id = rest.id && !seen.has(rest.id) ? rest.id : newStepId();
    seen.add(id);
    return { ...rest, id };
  });
  const { triggers, body } = splitTrigger(withIds);
  return [...triggers.slice(0, 1), ...body];
}

// ── Save-time checks ────────────────────────────────────────────────────────
export const CONDITION_NEEDS_VALUE = new Set(['contains', 'equals', 'has_tag', 'field_equals', 'field_set']);

/**
 * Mistakes that save fine and then do nothing on WhatsApp. Returns
 * `{ message, fix? }` or null. `fix` names a one-click repair the builder
 * offers (e.g. inserting the missing "Wait for reply").
 *
 * Buttons followed straight by a condition test the message that *started*
 * the workflow, not the option the customer taps, so every branch but the
 * first silently skips.
 */
export function chatFlowIssue(steps, { templates } = {}) {
  const list = (steps || []).filter((s) => s.type !== 'trigger');
  for (let i = 0; i < list.length; i += 1) {
    const s = list[i];
    const n = i + 1;
    if (s.subtype === 'buttons') {
      const opts = String(s.value || '').split('|').map((x) => x.trim()).filter(Boolean).slice(1);
      if (opts.length === 0) return { message: `Step ${n} (buttons) needs options — write it as "Question | Option A | Option B".` };
      if (list[i + 1]?.type === 'condition') {
        return {
          message: `Step ${n} asks with buttons and step ${n + 1} is a condition. Add a "Wait for reply" step right after the buttons, so the conditions below check which option the customer tapped.`,
          fix: { kind: 'insert_wait_reply', afterId: s.id, position: i + 1, label: `Insert "Wait for reply" after step ${n}` },
        };
      }
    }
    if (s.type === 'condition') {
      if (CONDITION_NEEDS_VALUE.has(s.subtype) && !String(s.value || '').trim()) return { message: `Step ${n}: the condition "${subtypeLabel('condition', s.subtype)}" needs a value.` };
      if (i + 1 >= list.length) return { message: `Step ${n} is a condition with nothing after it, so it guards nothing — add the steps it should control below it.` };
    }
    if (s.subtype === 'template') {
      if (!String(s.value || '').trim()) return { message: `Step ${n}: choose an approved template to send.` };
      const tpl = Array.isArray(templates)
        ? templates.find((t) => (s.templateId && t.id === s.templateId) || t.name === s.value)
        : null;
      if (tpl) {
        const missing = unmappedParams(templateParamCount(templateBodyText(tpl)), s.params);
        if (missing.length) return { message: `Step ${n}: fill template variable${missing.length === 1 ? '' : 's'} ${missing.map((m) => `{{${m}}}`).join(', ')} — Meta refuses a template send with an empty variable.` };
      }
    }
    if (s.subtype === 'wait_reply' && s.remindAfter && !String(s.reminder || '').trim()) return { message: `Step ${n}: write the reminder text for the "Wait for reply" step, or set its reminder to Never.` };
  }
  return null;
}

/** The message of chatFlowIssue, or '' — kept for callers that only need text. */
export function chatFlowError(steps, opts) {
  return chatFlowIssue(steps, opts)?.message || '';
}

// ── Runs ────────────────────────────────────────────────────────────────────
/**
 * Reads a runs response. The list arrives as a bare array or as an object
 * (`{ data|runs|items, total }`); the total, when not in the body, may come as
 * an X-Total-Count header (contract C1). Returns `{ items, total }`, total null
 * when unknown.
 */
export function readRunsPage(body, totalHeader) {
  let items = [];
  let total = null;
  if (Array.isArray(body)) items = body;
  else if (body && typeof body === 'object') {
    items = [body.data, body.runs, body.items].find(Array.isArray) || [];
    if (Number.isFinite(Number(body.total)) && body.total !== null && body.total !== '') total = Number(body.total);
  }
  if (total === null && totalHeader !== null && totalHeader !== undefined && totalHeader !== '' && Number.isFinite(Number(totalHeader))) {
    total = Number(totalHeader);
  }
  return { items, total };
}

/**
 * How a run should read in history. A CANCELLED run whose error (or last
 * trace entry) says "Not run: <reason>" was a suppressed trigger — the
 * workflow matched but deliberately did not start — so it reads "Didn't run".
 */
export function describeRun(run) {
  const status = String(run?.status || '').toUpperCase();
  const trace = Array.isArray(run?.trace) ? run.trace : [];
  const notRun = [run?.error, ...trace.map((t) => t?.detail)]
    .map((x) => String(x ?? ''))
    .find((x) => /^not run:/i.test(x.trim()));
  if (status === 'CANCELLED' && notRun) {
    return { label: "Didn't run", tone: 'muted', reason: notRun.trim().replace(/^not run:\s*/i, ''), suppressed: true };
  }
  const tone = { COMPLETED: 'ok', FAILED: 'error', CANCELLED: 'muted' }[status] || 'pending';
  const label = { COMPLETED: 'Completed', FAILED: 'Failed', CANCELLED: 'Cancelled', RUNNING: 'Running', WAITING: 'Waiting', PAUSED: 'Paused' }[status] || prettyEnum(status || 'unknown');
  return { label, tone, reason: run?.error ? String(run.error) : '', suppressed: false };
}
