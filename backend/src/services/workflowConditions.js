// Conditions and variables for workflow steps.
//
// The engine ran a flat list of actions with a cursor and no way to ask a
// question about the conversation — the builder said as much in its own comment
// ("a chain rather than a branching graph"). So a workflow could greet someone
// but not treat a returning customer differently from a new one, and a message
// could not say the person's name.
//
// Branching is expressed as "if this is not true, skip the next N steps"
// rather than as a nested graph. That is a deliberate trade: the runtime is a
// flat array with an integer cursor that is persisted across delays and
// restarts, and nesting would mean a stack to serialise and resume. Skip counts
// fit the model exactly, survive a resume for free, and are authorable in the
// linear builder that already exists.

// What a condition can ask about. Each takes the step's `value` as its operand,
// except the ones that ask about the contact itself.
export const CONDITION_SUBTYPES = [
  { id: 'contains', label: 'Message contains', needsValue: true },
  { id: 'equals', label: 'Message is exactly', needsValue: true },
  { id: 'is_new_contact', label: 'Is a new contact', needsValue: false },
  { id: 'has_tag', label: 'Contact has tag', needsValue: true },
  { id: 'field_equals', label: 'Contact field equals', needsValue: true },
  { id: 'field_set', label: 'Contact field is set', needsValue: true },
];

const norm = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Evaluates one condition step.
 *
 * @param {object} node    the condition step: { subtype, value }
 * @param {object} context { messageBody, isNewContact, contact }
 */
export function evaluateCondition(node, context = {}) {
  const { messageBody = '', isNewContact = false, contact = null } = context;
  const value = node?.value;

  switch (node?.subtype) {
    case 'contains':
      return norm(messageBody).includes(norm(value)) && norm(value) !== '';
    case 'equals':
      return norm(messageBody) === norm(value);
    case 'is_new_contact':
      return Boolean(isNewContact);
    case 'has_tag':
      return (contact?.tags || []).some((t) => norm(t) === norm(value));
    case 'field_equals': {
      // "key=expected" — the only condition needing two operands, kept on one
      // field so the linear builder does not need a second input.
      const [key, expected] = String(value ?? '').split('=');
      if (!key) return false;
      return norm(readContactValue(contact, key.trim())) === norm(expected);
    }
    case 'field_set': {
      const v = readContactValue(contact, String(value ?? '').trim());
      return v !== undefined && v !== null && String(v).trim() !== '';
    }
    default:
      // An unknown condition must not silently take the true branch and run
      // steps the author meant to guard.
      return false;
  }
}

// Reads a value off the contact by name: a built-in column, or a custom field
// defined by the workspace.
function readContactValue(contact, key) {
  if (!contact || !key) return undefined;
  const builtin = { name: contact.name, phone: contact.phoneNumber, phonenumber: contact.phoneNumber, email: contact.email };
  const lower = key.toLowerCase();
  if (lower in builtin) return builtin[lower];
  const custom = contact.customFields && typeof contact.customFields === 'object' ? contact.customFields : {};
  return custom[key] ?? custom[lower];
}

// How many following steps a false condition skips. Defaults to one, which is
// the common case ("if X, say this") and what an author gets by not setting it.
export function skipCount(node) {
  const n = Number(node?.skipIfFalse ?? node?.skip ?? 1);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

// ─── Variables ───────────────────────────────────────────────────────────────
//
// `{{name}}` in a step's text is replaced with the contact's name, and
// `{{custom.order_number}}` with one of the workspace's own custom fields.
// Without this every automated message was identical for every recipient, which
// is the difference between an automation and a broadcast.

const TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * @param {string} text
 * @param {object} context { contact, variables, messageBody }
 */
export function renderTemplate(text, context = {}) {
  const { contact = null, variables = {}, messageBody = '' } = context;
  return String(text ?? '').replace(TOKEN, (match, rawKey) => {
    const key = rawKey.trim();
    const lower = key.toLowerCase();

    // Values the run has collected take precedence: they are the most specific
    // thing known about this particular conversation.
    if (variables && key in variables) return String(variables[key] ?? '');
    if (lower === 'message') return String(messageBody ?? '');

    if (lower.startsWith('custom.')) {
      const v = readContactValue(contact, key.slice('custom.'.length));
      return v === undefined || v === null ? '' : String(v);
    }
    if (lower.startsWith('contact.')) {
      const v = readContactValue(contact, key.slice('contact.'.length));
      return v === undefined || v === null ? '' : String(v);
    }

    const direct = readContactValue(contact, key);
    if (direct !== undefined && direct !== null) return String(direct);

    // An unknown token is removed rather than left in the message. Sending a
    // customer a literal "{{order_id}}" is worse than sending the sentence
    // without it.
    return '';
  });
}

// Tidies what substitution leaves behind: a removed token usually strands a
// double space or a space before punctuation.
export const tidy = (text) => String(text ?? '')
  .replace(/[ \t]{2,}/g, ' ')
  .replace(/\s+([,.!?;:])/g, '$1')
  .trim();
