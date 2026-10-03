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
  ['delay', 'Wait / Delay'], ['tag', 'Add contact tag'], ['agent', 'Assign to agent'],
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

export function applyStepChange(step, fields) {
  const next = { ...step, ...fields };

  if (fields.type && fields.type !== step.type) {
    next.subtype = fields.type === 'trigger' ? 'keyword' : fields.type === 'condition' ? 'equals' : 'message';
    next.value = DEFAULT_STEP_VALUE[next.subtype];
    if (fields.type === 'condition') next.skipIfFalse = next.skipIfFalse ?? 1;
    else delete next.skipIfFalse;
    return next;
  }
  if (fields.subtype && fields.subtype !== step.subtype) {
    next.value = DEFAULT_STEP_VALUE[fields.subtype] ?? '';
  }
  // A reminder belongs to a "Wait for reply" step only.
  if (next.subtype !== 'wait_reply') { delete next.remindAfter; delete next.reminder; }
  return next;
}
