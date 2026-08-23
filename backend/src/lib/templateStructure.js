// What a template of each kind is allowed to contain, and the normaliser that
// enforces it before anything reaches Meta.
//
// Meta does not have a "template type" field: a catalog template is simply one
// whose buttons contain a CATALOG button, and a carousel template is one with a
// CAROUSEL component. The type is therefore *derived* from the components
// rather than stored — which is also what keeps templates synced back from Meta
// (which never reports a type) consistent with ones authored here.
//
// The rules below are Meta's published ones (Business Management API → message
// templates), and they differ sharply by kind:
//   - CAROUSEL  bubble carries a BODY only; no header, footer or buttons on the
//               bubble itself. 1-10 cards, every card the same header format
//               and the same button signature.
//   - CATALOG   BODY, optional FOOTER, and a single CATALOG button. No header.
//   - STANDARD  the familiar HEADER / BODY / FOOTER / BUTTONS shape.

import { normalizeButtons } from './templateButtons.js';

export const TEMPLATE_TYPES = { STANDARD: 'STANDARD', CATALOG: 'CATALOG', CAROUSEL: 'CAROUSEL' };

// Which template types each category may use. Catalog is a shopping format and
// Meta only accepts it under MARKETING; carousel is allowed for MARKETING and
// UTILITY. An authentication template is a passcode message and nothing else.
export const TYPES_BY_CATEGORY = {
  MARKETING: ['STANDARD', 'CATALOG', 'CAROUSEL'],
  UTILITY: ['STANDARD', 'CAROUSEL'],
  AUTHENTICATION: ['STANDARD'],
};

// Header formats offered per category for a STANDARD template. Meta does not
// allow any header on an authentication template.
export const HEADER_FORMATS_BY_CATEGORY = {
  MARKETING: ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'],
  UTILITY: ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'],
  AUTHENTICATION: ['NONE'],
};

// Media formats a carousel card header may use. Meta requires every card in one
// template to use the same one.
export const CARD_HEADER_FORMATS = ['IMAGE', 'VIDEO'];

export const CARD_LIMITS = { min: 1, max: 10, bodyChars: 160 };

const fail = (message) => { const e = new Error(message); e.status = 400; throw e; };

const typeOf = (c) => String(c?.type || '').trim().toUpperCase();
const find = (components, type) => (components || []).find((c) => typeOf(c) === type);

// Derives the template type from the components themselves — see the note at
// the top of this file about why it is not a stored column.
export function detectTemplateType(components) {
  const list = Array.isArray(components) ? components : [];
  if (list.some((c) => typeOf(c) === 'CAROUSEL')) return TEMPLATE_TYPES.CAROUSEL;
  const buttons = find(list, 'BUTTONS')?.buttons;
  if (Array.isArray(buttons) && buttons.some((b) => String(b?.type || '').toUpperCase() === 'CATALOG')) {
    return TEMPLATE_TYPES.CATALOG;
  }
  return TEMPLATE_TYPES.STANDARD;
}

// The header format a STANDARD template uses, as the builder's selector spells
// it ('NONE' when there is no header at all).
export function detectHeaderFormat(components) {
  const header = find(components, 'HEADER');
  if (!header) return 'NONE';
  return String(header.format || 'TEXT').toUpperCase();
}

function normalizeHeader(header, category) {
  const allowed = HEADER_FORMATS_BY_CATEGORY[category] || HEADER_FORMATS_BY_CATEGORY.MARKETING;
  const format = String(header.format || 'TEXT').toUpperCase();
  if (!allowed.includes(format)) {
    fail(category === 'AUTHENTICATION'
      ? 'Authentication templates cannot carry a header — Meta builds the passcode message itself.'
      : `A ${format.toLowerCase()} header is not supported for ${category.toLowerCase()} templates.`);
  }
  if (format === 'TEXT') {
    const text = String(header.text || '').trim();
    if (!text) fail('The header is set to text, but no header text was given.');
    if (text.length > 60) fail(`Header text is ${text.length} characters — the limit is 60.`);
    // Meta allows exactly one variable in a text header, and it needs a sample.
    const vars = text.match(/\{\{\s*\d+\s*\}\}/g) || [];
    if (vars.length > 1) fail('A text header may contain at most one variable.');
    const out = { type: 'HEADER', format: 'TEXT', text };
    if (vars.length === 1) {
      if (!header.example) {
        fail('The header has a variable, so it needs an example value showing what it becomes.');
      }
      out.example = header.example;
    }
    return out;
  }
  // A media header is reviewed from an uploaded sample; the handle is produced
  // by services/templates.service.js → uploadHeaderMedia before we get here.
  const out = { type: 'HEADER', format };
  if (!header.example) {
    fail(`A ${format.toLowerCase()} header needs a sample file uploaded before the template can be submitted.`);
  }
  out.example = header.example;
  return out;
}

function normalizeBody(body, { requireText = true, maxChars = 1024, label = 'Body' } = {}) {
  const text = String(body?.text || '').trim();
  if (!text) {
    if (requireText) fail(`${label} text is required.`);
    return null;
  }
  if (text.length > maxChars) fail(`${label} text is ${text.length} characters — the limit is ${maxChars}.`);
  const out = { type: 'BODY', text };
  if (body.example) out.example = body.example;
  return out;
}

function normalizeFooter(footer) {
  const text = String(footer?.text || '').trim();
  if (!text) return null;
  if (text.length > 60) fail(`Footer text is ${text.length} characters — the limit is 60.`);
  if (/\{\{\s*\d+\s*\}\}/.test(text)) fail('A footer cannot contain variables.');
  return { type: 'FOOTER', text };
}

// A carousel's cards. Meta rejects the template unless every card matches the
// first one's header format and button signature, so that is checked here
// rather than discovered hours later as a review failure.
function normalizeCarousel(carousel) {
  const cards = Array.isArray(carousel?.cards) ? carousel.cards : [];
  if (cards.length < CARD_LIMITS.min) fail('A carousel template needs at least one card.');
  if (cards.length > CARD_LIMITS.max) {
    fail(`A carousel can have at most ${CARD_LIMITS.max} cards — this one has ${cards.length}.`);
  }

  let headerFormat = null;
  let buttonSignature = null;

  const out = cards.map((card, i) => {
    const where = `Card ${i + 1}`;
    const comps = Array.isArray(card?.components) ? card.components : [];

    const header = find(comps, 'HEADER');
    if (!header) fail(`${where} needs a media header — every carousel card must show an image or a video.`);
    const format = String(header.format || '').toUpperCase();
    if (!CARD_HEADER_FORMATS.includes(format)) {
      fail(`${where} has a ${format.toLowerCase() || 'missing'} header — carousel cards support image or video only.`);
    }
    if (headerFormat === null) headerFormat = format;
    else if (format !== headerFormat) {
      fail(`${where} uses a ${format.toLowerCase()} header but card 1 uses ${headerFormat.toLowerCase()} — every card must use the same media type.`);
    }
    if (!header.example) fail(`${where} needs its media uploaded before the template can be submitted.`);

    // `_assetId` points at the stored bytes for this card's picture. Meta's
    // header_handle is review-only and cannot be sent, and a carousel has one
    // image per card rather than the single Template.headerAssetId column — so
    // the ids ride along in the components and are stripped by
    // toMetaComponents() on the way out. See services/templateImage.service.js.
    const cardComponents = [{ type: 'HEADER', format, example: header.example }];
    if (header._assetId) cardComponents[0]._assetId = String(header._assetId);

    const body = normalizeBody(find(comps, 'BODY'), {
      requireText: false, maxChars: CARD_LIMITS.bodyChars, label: `${where} body`,
    });
    if (body) cardComponents.push(body);

    const buttons = normalizeButtons(find(comps, 'BUTTONS')?.buttons, {
      context: 'card', where: `${where} button`,
    });
    if (buttons.length === 0) fail(`${where} needs at least one button — Meta requires them on every carousel card.`);

    const signature = buttons.map((b) => b.type).join(',');
    if (buttonSignature === null) buttonSignature = signature;
    else if (signature !== buttonSignature) {
      fail(`${where} has different buttons from card 1 (${signature} vs ${buttonSignature}) — every card must repeat the same buttons in the same order.`);
    }
    cardComponents.push({ type: 'BUTTONS', buttons });

    return { components: cardComponents };
  });

  return { type: 'CAROUSEL', cards: out };
}

// Validates and normalises a whole components array for the given category,
// returning exactly what Meta should receive. Throws a 400 naming the problem.
export function normalizeTemplateComponents(category, components) {
  const list = Array.isArray(components) ? components.filter(Boolean) : [];
  if (list.length === 0) fail('A template needs at least a body.');

  const cat = String(category || '').toUpperCase();
  const templateType = detectTemplateType(list);
  const allowedTypes = TYPES_BY_CATEGORY[cat] || TYPES_BY_CATEGORY.MARKETING;
  if (!allowedTypes.includes(templateType)) {
    fail(`${templateType.toLowerCase()} templates are not available for the ${cat.toLowerCase()} category — Meta allows ${allowedTypes.map((t) => t.toLowerCase()).join(', ')}.`);
  }

  if (templateType === TEMPLATE_TYPES.CAROUSEL) {
    // The bubble above the cards is a body and nothing else.
    if (find(list, 'HEADER')) fail('A carousel template cannot have a header — the media lives on each card.');
    if (find(list, 'FOOTER')) fail('A carousel template cannot have a footer.');
    if (find(list, 'BUTTONS')) fail('A carousel template cannot have buttons on the message itself — put them on each card.');
    const body = normalizeBody(find(list, 'BODY'), { label: 'Body' });
    return [body, normalizeCarousel(find(list, 'CAROUSEL'))];
  }

  if (templateType === TEMPLATE_TYPES.CATALOG) {
    if (find(list, 'HEADER')) fail('A catalog template cannot have a header.');
    const out = [normalizeBody(find(list, 'BODY'), { label: 'Body' })];
    const footer = normalizeFooter(find(list, 'FOOTER'));
    if (footer) out.push(footer);
    out.push({ type: 'BUTTONS', buttons: normalizeButtons(find(list, 'BUTTONS')?.buttons) });
    return out;
  }

  // STANDARD — header, body, footer, buttons, in the order Meta expects.
  const out = [];
  const header = find(list, 'HEADER');
  if (header) out.push(normalizeHeader(header, cat));
  out.push(normalizeBody(find(list, 'BODY'), { label: 'Body' }));
  const footer = normalizeFooter(find(list, 'FOOTER'));
  if (footer) out.push(footer);
  const buttons = normalizeButtons(find(list, 'BUTTONS')?.buttons);
  if (buttons.length) out.push({ type: 'BUTTONS', buttons });
  return out;
}

// Strips the internal `_`-prefixed bookkeeping (currently a carousel card's
// `_assetId`) that is persisted with a template but must never be posted to
// Meta, which rejects unrecognised component fields.
export function toMetaComponents(components) {
  const clean = (value) => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([k]) => !k.startsWith('_'))
          .map(([k, v]) => [k, clean(v)]),
      );
    }
    return value;
  };
  return clean(Array.isArray(components) ? components : []);
}

// Carries the internal `_`-prefixed bookkeeping from a template already stored
// here onto the version Meta just reported.
//
// Meta is authoritative about a template's *approved* shape, but it has never
// seen the fields this product keeps alongside it — a carousel card's
// `_assetId` (the stored bytes every send re-uploads, since Meta's review
// handle cannot be sent) and a catalog button's
// `_thumbnailProductRetailerId`. Overwriting the stored components wholesale
// with Meta's copy dropped both: that is why re-syncing made a carousel's
// images vanish from the editor, and why the next send of it failed with "no
// stored media".
//
// Nodes are matched by `type` where the list has one (a components array), by
// position otherwise (a cards array, a buttons array), so a template whose
// shape changed on Meta simply keeps whatever still lines up. Applying it
// twice changes nothing the first application did not — sync stays idempotent.
export function preserveInternalFields(existing, incoming) {
  const merge = (was, now) => {
    if (Array.isArray(now)) {
      if (!Array.isArray(was)) return now;
      const usedByType = new Map();
      return now.map((entry, i) => {
        if (entry && typeof entry === 'object' && entry.type !== undefined) {
          const key = String(entry.type).toUpperCase();
          const skip = usedByType.get(key) || 0;
          usedByType.set(key, skip + 1);
          const candidates = was.filter((w) => String(w?.type ?? '').toUpperCase() === key);
          return merge(candidates[skip], entry);
        }
        return merge(was[i], entry);
      });
    }
    if (!now || typeof now !== 'object') return now;
    if (!was || typeof was !== 'object' || Array.isArray(was)) return now;

    const out = {};
    // The stored internals first, so anything Meta genuinely reports wins.
    for (const [k, v] of Object.entries(was)) if (k.startsWith('_')) out[k] = v;
    for (const [k, v] of Object.entries(now)) {
      out[k] = k in was ? merge(was[k], v) : v;
    }
    return out;
  };

  const list = Array.isArray(incoming) ? incoming : [];
  // Meta answering with nothing is not evidence the template lost its
  // components — never let it empty a stored template.
  if (list.length === 0) return Array.isArray(existing) ? existing : list;
  return merge(Array.isArray(existing) ? existing : [], list);
}
