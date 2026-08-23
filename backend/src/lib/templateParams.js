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

// A card button's send-time component, or nothing when the button has no
// value to carry.
//
// The rules are not the same as the message bubble's:
//   - a quick reply on a card DOES need a component, with the button's own
//     label as the payload — that is what the webhook reports back on a tap;
//   - a URL button needs one only when its address ends in {{n}}, and then the
//     parameter is the dynamic suffix, exactly as in the bubble.
//
// A *static* URL button therefore contributes nothing. Emitting one anyway is
// what produced Meta error 100 — "Parameter 'text' is mandatory for component
// parameter type 'text' and cannot be empty" — because the only value
// available for it was the empty string (padded to a single space, which Meta
// trims back to empty). The card still shows the button and its label; neither
// is something the send supplies, they were fixed at approval time.
const cardButtonComponent = (button, index, { where }) => {
  const type = String(button?.type || '').toUpperCase();
  const base = { type: 'button', index: String(index) };

  if (type === 'URL') {
    if (!/\{\{\s*\d+\s*\}\}/.test(String(button?.url || ''))) return null;
    const value = urlButtonValue(button);
    if (!value) {
      const e = new Error(`${where} has a dynamic URL but no example value to fill it with — re-save the template with a sample for the URL variable.`);
      e.status = 422;
      throw e;
    }
    return { ...base, sub_type: 'url', parameters: [{ type: 'text', text: value }] };
  }

  const payload = String(button?.text || '').trim();
  if (!payload) {
    const e = new Error(`${where} has no label, so there is nothing to send as its payload. Re-save the template with a label on every card button.`);
    e.status = 422;
    throw e;
  }
  return { ...base, sub_type: 'quick_reply', parameters: [{ type: 'payload', payload }] };
};

export const buildCardButtonComponents = (card, { cardNumber = 1 } = {}) => {
  const buttons = cardComponent(card, 'BUTTONS')?.buttons;
  return (Array.isArray(buttons) ? buttons : [])
    .map((button, index) => cardButtonComponent(button, index, { where: `Card ${cardNumber} button ${index + 1}` }))
    .filter(Boolean);
};

// ── Catalog ────────────────────────────────────────────────────────────────
//
// A catalog template's only button opens the WABA's connected catalog, so
// nothing about it is chosen per send — which is exactly why the send used to
// carry no components at all and Meta answered 131008 ("components cannot be
// empty"). Meta still requires the button to be addressed; the optional
// `thumbnail_product_retailer_id` names which product's picture heads the
// message, and when it is absent Meta uses the first item in the catalog.
//
// The SKU is stored on the button itself as `_thumbnailProductRetailerId`.
// The underscore keeps it out of what is posted to Meta at creation time (see
// lib/templateStructure.js → toMetaComponents), where the button carries only
// a type and a label.
export const catalogButton = (components) => {
  const buttons = (components || []).find(
    (c) => String(c?.type || '').toUpperCase() === 'BUTTONS',
  )?.buttons;
  const index = (Array.isArray(buttons) ? buttons : [])
    .findIndex((b) => String(b?.type || '').toUpperCase() === 'CATALOG');
  return index === -1 ? null : { button: buttons[index], index };
};

export const buildCatalogButtonComponent = (components) => {
  const found = catalogButton(components);
  if (!found) return null;
  const sku = String(found.button?._thumbnailProductRetailerId ?? '').trim();
  const component = { type: 'button', sub_type: 'catalog', index: String(found.index) };
  if (sku) component.parameters = [{ type: 'action', action: { thumbnail_product_retailer_id: sku } }];
  return component;
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
