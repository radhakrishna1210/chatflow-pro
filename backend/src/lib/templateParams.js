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
