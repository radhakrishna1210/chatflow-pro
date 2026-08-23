// Builds the `components` array Meta wants when sending an approved template.
//
// A template's variables do not all live in the same place, and that is what
// this file exists to hide. Text placeholders ({{1}}) sit in a component's
// `text`; an image header has no placeholder at all; a link button's variable
// hides inside `buttons[n].url`. Anything that scans only `text` silently drops
// the last two, and Meta answers with an error naming neither — 132000 for the
// missing header, 131008 ("Button at index 0 of type Url requires a parameter")
// for the missing button. Both shipped that way once.
//
// Callers differ only in where the *values* come from — a contact record for a
// campaign, the caller's own array in the API Playground — so text values are
// supplied through a resolver while the component shapes are decided here.
// Button values are not a caller decision: they come from the button's own
// `example`, which lib/templateButtons.js makes mandatory at creation time for
// every button type that needs one.

// Highest {{n}} in a piece of template text — that is how many parameters Meta
// expects for the component, regardless of how many times each is repeated.
export const countVariables = (text) => {
  const nums = [...String(text || '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => parseInt(m[1], 10));
  return nums.length ? Math.max(...nums) : 0;
};

export const templateHasVariables = (components) =>
  Array.isArray(components) && components.some((c) => /\{\{\d+\}\}/.test(c?.text || ''));

// The sample values Meta was shown at approval time, e.g. ["Priya", "25"] for
// "Hi {{1}}, {{2}}% off".
export const bodyExamples = (component) => {
  const rows = component?.example?.body_text;
  return Array.isArray(rows?.[0]) ? rows[0] : Array.isArray(rows) ? rows : [];
};

// One entry per component that carries text placeholders. `resolve(index,
// component)` returns the value for that component's {{index+1}}. Sending the
// right *count* is what Meta checks — a short array fails the whole send with
// 132000, and an empty string counts as missing.
export const buildTextComponents = (components, resolve) =>
  (components || [])
    .filter((c) => /\{\{\d+\}\}/.test(c?.text || ''))
    .map((c) => ({
      type: String(c.type || 'body').toLowerCase(),
      parameters: Array.from({ length: countVariables(c.text) }, (_, i) => ({
        type: 'text',
        text: resolve(i, c),
      })),
    }));

// Contacts only carry name/phone/email, so {{1}} is filled with the contact's
// name (the convention used everywhere else templates are authored, e.g.
// data/templateLibrary.js). There is no per-recipient data behind {{2}} and up,
// so those fall back to the sample the template was approved with: repeating
// the name there turned "Hi Priya, {{2}}% off" into "Priya% off" on delivery.
//
// Lives here rather than in the campaign worker because the campaign AI agent
// has to reproduce the exact text a contact was sent — two copies of these
// rules would eventually disagree about what the customer actually read.
export const contactVariableResolver = (contact) => {
  const name = (contact?.name || '').trim() || 'there';
  return (index, component) => {
    if (index === 0) return name;
    // A parameter Meta receives as an empty string fails the send, so an absent
    // example falls back to the name rather than to nothing.
    return String(bodyExamples(component)[index] ?? '').trim() || name;
  };
};

// Renders a component's text the way the recipient sees it, with {{n}}
// replaced by the same values the send used.
export const fillVariables = (text, component, resolve) =>
  String(text || '').replace(/\{\{(\d+)\}\}/g, (match, n) => {
    const value = resolve(parseInt(n, 10) - 1, component);
    return value === undefined || value === null ? match : String(value);
  });

// A button's `example` is stored as a one-element array by templateButtons.js,
// but a template synced from Meta can arrive with a bare string.
const exampleValue = (button) => {
  const raw = Array.isArray(button?.example) ? button.example[0] : button?.example;
  return String(raw ?? '').trim();
};

// Meta wants only the part that replaces {{n}} — the dynamic suffix, since a
// URL button's variable is only ever allowed at the very end. Templates created
// here store exactly that ("deals"), but one synced from Meta can carry the
// whole filled-in URL, so a matching static prefix is stripped.
const urlButtonValue = (button) => {
  const value = exampleValue(button);
  const prefix = String(button?.url || '').split('{{')[0];
  return prefix && value.startsWith(prefix) ? value.slice(prefix.length) : value;
};

// The two button types that must be supplied on EVERY send: a URL button whose
// address ends in {{n}}, and any copy-code button. Quick-reply and phone-number
// buttons take no parameters — but they still occupy an index, so positions are
// preserved rather than renumbered.
export const buildButtonComponents = (components) => {
  const buttons = (components || []).find(
    (c) => String(c?.type || '').toUpperCase() === 'BUTTONS',
  )?.buttons;

  return (Array.isArray(buttons) ? buttons : []).flatMap((button, index) => {
    const type = String(button?.type || '').toUpperCase();
    const base = { type: 'button', index: String(index) };

    if (type === 'URL' && /\{\{\s*\d+\s*\}\}/.test(String(button?.url || ''))) {
      const value = urlButtonValue(button);
      return value ? [{ ...base, sub_type: 'url', parameters: [{ type: 'text', text: value }] }] : [];
    }
    if (type === 'COPY_CODE') {
      const code = exampleValue(button);
      return code ? [{ ...base, sub_type: 'copy_code', parameters: [{ type: 'coupon_code', coupon_code: code }] }] : [];
    }
    return [];
  });
};

// ── Carousel ───────────────────────────────────────────────────────────────
//
// A carousel send repeats the whole component dance once per card, under a
// `carousel` component with each card addressed by index. The card's picture is
// resolved separately (it needs a phone-scoped media id — see
// services/templateImage.service.js); everything else is shape work and lives
// here alongside the message-bubble equivalents.

export const carouselCards = (components) => {
  const carousel = (components || []).find((c) => String(c?.type || '').toUpperCase() === 'CAROUSEL');
  return Array.isArray(carousel?.cards) ? carousel.cards : [];
};

const cardComponent = (card, type) =>
  (Array.isArray(card?.components) ? card.components : [])
    .find((c) => String(c?.type || '').toUpperCase() === type);

// Every button on a card must be addressed in the send, not just the ones with
// variables: Meta requires a payload for a carousel quick reply, where the same
// button in the message bubble needs nothing. The payload is the button's own
// label, which is what the webhook then reports back when a recipient taps it.
export const buildCardButtonComponents = (card) => {
  const buttons = cardComponent(card, 'BUTTONS')?.buttons;
  return (Array.isArray(buttons) ? buttons : []).map((button, index) => {
    const type = String(button?.type || '').toUpperCase();
    const base = { type: 'button', index: String(index) };
    if (type === 'URL') {
      const raw = Array.isArray(button?.example) ? button.example[0] : button?.example;
      const value = String(raw ?? '').trim();
      const prefix = String(button?.url || '').split('{{')[0];
      const suffix = prefix && value.startsWith(prefix) ? value.slice(prefix.length) : value;
      return { ...base, sub_type: 'url', parameters: [{ type: 'text', text: suffix || ' ' }] };
    }
    return { ...base, sub_type: 'quick_reply', parameters: [{ type: 'payload', payload: String(button?.text || '').trim() }] };
  });
};

// The card's body parameters, on the same rules as the message body: one entry
// per {{n}}, values from the caller's resolver.
export const buildCardBodyComponent = (card, resolve) => {
  const body = cardComponent(card, 'BODY');
  const count = countVariables(body?.text);
  if (!count) return null;
  return {
    type: 'body',
    parameters: Array.from({ length: count }, (_, i) => ({ type: 'text', text: resolve(i, body) })),
  };
};
