// The one place a `template` object for POST /{phone-number-id}/messages is
// assembled, for every kind of template this product can send.
//
// It used to be assembled twice — once in workers/campaign.worker.js and once
// in services/apikeys.service.js — from the same handful of helpers, in the
// same order, with the same list of things to remember. Both copies handled a
// standard template correctly and both got the two shopping formats wrong, in
// exactly the same way, because the list of things to remember is different
// for those:
//
//   STANDARD  header media / body variables / parameterised buttons. What both
//             copies did, and what has always worked.
//   CAROUSEL  everything lives on the cards, under one `carousel` component.
//             A card's quick reply needs a payload; a card's *static* URL
//             button needs nothing at all, and sending an empty parameter for
//             it is Meta error 100 ("Parameter 'text' is mandatory for
//             component parameter type 'text' and cannot be empty").
//   CATALOG   nothing is per-send, so nothing was emitted, so `components` was
//             absent — which is Meta error 131008 ("components cannot be
//             empty"). The catalog button still has to be addressed.
//
// Dispatching on the template's type (derived from its components — see
// lib/templateStructure.js) is what keeps a fix for one format from touching
// the others.

import { detectTemplateType, TEMPLATE_TYPES } from '../lib/templateStructure.js';
import {
  templateHasVariables,
  buildTextComponents,
  buildButtonComponents,
  buildCatalogButtonComponent,
  catalogButton,
  carouselCards,
} from '../lib/templateParams.js';
import { headerImageComponent, carouselComponent } from './templateImage.service.js';

const invalid = (message) => {
  const e = new Error(message);
  e.status = 422;
  return e;
};

const componentOf = (components, type) =>
  (Array.isArray(components) ? components : [])
    .find((c) => String(c?.type || '').toUpperCase() === type);

// ── Pre-flight validation ──────────────────────────────────────────────────
//
// Everything below refuses to build a payload Meta would reject, so the
// failure names the missing piece of template data instead of arriving hours
// later as an opaque campaign failure. None of it invents data to get past
// Meta: a template that cannot be sent correctly is reported as unsendable.

export function validateCarouselTemplate(template) {
  const cards = carouselCards(template?.components);
  if (cards.length === 0) {
    throw invalid(`Template "${template?.name}" is a carousel but has no cards stored. Re-save it in the template editor.`);
  }
  if (!componentOf(template?.components, 'BODY')?.text) {
    throw invalid(`Template "${template?.name}" is a carousel with no message body — Meta requires the bubble above the cards.`);
  }

  cards.forEach((card, i) => {
    const where = `Card ${i + 1} of template "${template?.name}"`;
    const comps = Array.isArray(card?.components) ? card.components : [];
    const header = comps.find((c) => String(c?.type || '').toUpperCase() === 'HEADER');
    if (!header) throw invalid(`${where} has no media header.`);
    // Either the stored bytes, or Meta's own approved sample to recover them
    // from — services/templateImage.service.js does the recovery. A card with
    // neither can never be sent, and saying so here beats a Meta rejection.
    const sample = header.example?.header_handle;
    const recoverable = /^https?:\/\//i.test(String(Array.isArray(sample) ? sample[0] : sample || ''));
    if (!header._assetId && !recoverable) {
      throw invalid(`${where} has no stored media to send. Re-upload the card's image in the template editor.`);
    }

    const buttons = comps.find((c) => String(c?.type || '').toUpperCase() === 'BUTTONS')?.buttons;
    if (!Array.isArray(buttons) || buttons.length === 0) {
      throw invalid(`${where} has no buttons — Meta requires at least one on every carousel card.`);
    }
    buttons.forEach((button, j) => {
      const type = String(button?.type || '').toUpperCase();
      // The label is what the recipient taps. It is fixed at approval time and
      // never supplied per send, but a card whose label was lost cannot be
      // sent correctly — a quick reply's payload is that label.
      if (!String(button?.text || '').trim()) {
        throw invalid(`${where}: button ${j + 1} has no label. Re-save the template with a label on every card button.`);
      }
      if (type === 'URL') {
        const url = String(button?.url || '').trim();
        if (!url) throw invalid(`${where}: button ${j + 1} is a link button with no URL.`);
        if (/\{\{\s*\d+\s*\}\}/.test(url)) {
          const example = Array.isArray(button.example) ? button.example[0] : button.example;
          if (!String(example ?? '').trim()) {
            throw invalid(`${where}: button ${j + 1} has a dynamic URL but no example value for its variable.`);
          }
        }
      }
    });
  });
}

export function validateCatalogTemplate(template) {
  const found = catalogButton(template?.components);
  if (!found) {
    throw invalid(`Template "${template?.name}" is stored as a catalog template but has no catalog button. Re-save it in the template editor.`);
  }
  if (!String(found.button?.text || '').trim()) {
    throw invalid(`The catalog button on template "${template?.name}" has no label. Re-save the template with one.`);
  }
  if (!componentOf(template?.components, 'BODY')?.text) {
    throw invalid(`Template "${template?.name}" has no body text — Meta requires one on a catalog template.`);
  }
}

// ── Assembly ───────────────────────────────────────────────────────────────

// Everything a debugger needs about a send, and nothing that must not be
// logged: no access token, no phone number id, no recipient, no message text.
const describePayload = (template, templateType, payload, { campaignId }) => ({
  templateId: template?.id ?? null,
  templateName: template?.name ?? null,
  templateType,
  campaignId,
  language: template?.language ?? null,
  category: template?.category ?? null,
  storedComponentTypes: (Array.isArray(template?.components) ? template.components : [])
    .map((c) => String(c?.type || '?').toUpperCase()),
  cardCount: carouselCards(template?.components).length,
  hasComponents: Array.isArray(payload.components) && payload.components.length > 0,
  sentComponents: (payload.components || []).map((c) => ({
    type: c.type,
    ...(c.sub_type ? { sub_type: c.sub_type } : {}),
    ...(c.index !== undefined ? { index: c.index } : {}),
    parameterTypes: (c.parameters || []).map((p) => p.type),
    ...(c.cards
      ? {
        cards: c.cards.map((card) => ({
          card_index: card.card_index,
          componentTypes: card.components.map((cc) => `${cc.type}${cc.sub_type ? `:${cc.sub_type}` : ''}`),
          // The label a button carries is template configuration, not
          // customer data, and "did the button text survive?" is the whole
          // question this logging exists to answer.
          buttonParameters: card.components
            .filter((cc) => cc.type === 'button')
            .map((cc) => ({ index: cc.index, sub_type: cc.sub_type, value: cc.parameters?.[0]?.payload ?? cc.parameters?.[0]?.text ?? null })),
        })),
      }
      : {}),
  })),
});

/**
 * Builds the `template` object for one send.
 *
 * @param template            the stored Template row (components as saved)
 * @param resolve             (index, component) => value for that {{n}}
 * @param extraComponents     appended verbatim (the campaign AI agent's CTA)
 * @param resolveMediaId      test seam: mints a sendable media id from an asset
 */
export async function buildTemplateSendPayload(template, {
  phoneNumberId,
  accessToken,
  resolve,
  extraComponents = [],
  campaignId = null,
  resolveMediaId = null,
  log = true,
}) {
  const components = Array.isArray(template?.components) ? template.components : [];
  const templateType = detectTemplateType(components);
  const payload = { name: template.name, language: { code: template.language } };

  const parts = [];

  if (templateType === TEMPLATE_TYPES.CAROUSEL) {
    validateCarouselTemplate(template);
    // The bubble above the cards is a plain body; its variables are resolved
    // exactly like a standard template's.
    if (templateHasVariables(components)) parts.push(...buildTextComponents(components, resolve));
    const carousel = await carouselComponent(template, { phoneNumberId, accessToken, resolve, resolveMediaId });
    if (carousel) parts.push(carousel);
  } else if (templateType === TEMPLATE_TYPES.CATALOG) {
    validateCatalogTemplate(template);
    if (templateHasVariables(components)) parts.push(...buildTextComponents(components, resolve));
    // Always present: this is the component whose absence was error 131008.
    const button = buildCatalogButtonComponent(components);
    if (button) parts.push(button);
  } else {
    // STANDARD — unchanged from what has always worked.
    const header = await headerImageComponent(template, { phoneNumberId, accessToken });
    if (header) parts.push(header);
    if (templateHasVariables(components)) parts.push(...buildTextComponents(components, resolve));
    parts.push(...buildButtonComponents(components));
  }

  parts.push(...extraComponents.filter(Boolean));
  if (parts.length) payload.components = parts;

  // A catalog or carousel send with no components is the exact shape Meta
  // rejects, and it means a helper above returned nothing. Fail here, where
  // the diagnosis is possible, rather than at Meta.
  if (templateType !== TEMPLATE_TYPES.STANDARD && !payload.components?.length) {
    throw invalid(`No sendable components could be built for ${templateType.toLowerCase()} template "${template.name}". Re-save the template in the editor.`);
  }

  if (log) {
    console.log('[TemplatePayload]', JSON.stringify(describePayload(template, templateType, payload, { campaignId })));
  }
  return payload;
}
