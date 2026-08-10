// Validation for a template's BUTTONS component.
//
// Meta enforces these rules at submission time and rejects the whole template
// when one is broken, which surfaces to the user hours later as an opaque
// review failure. Checking here turns that into an immediate, specific error.
//
// Limits are Meta's published ones (Business Management API → message
// templates → components):
//   - 10 buttons total
//   - PHONE_NUMBER x1, URL x2, COPY_CODE x1, QUICK_REPLY x10
//   - button text 25 chars, URL 2000 chars
//   - a URL button may carry exactly one variable, only at the very end
//   - quick replies must be contiguous, never alternating with other types

export const BUTTON_LIMITS = {
  total: 10,
  PHONE_NUMBER: 1,
  URL: 2,
  COPY_CODE: 1,
  QUICK_REPLY: 10,
  // A catalog template carries exactly one CATALOG button and nothing else.
  CATALOG: 1,
  // Carousel cards are far more restricted than the message bubble: at most
  // two buttons, quick-reply or link only, and every card must repeat the
  // same set (enforced across cards in lib/templateStructure.js).
  cardTotal: 2,
  textChars: 25,
  urlChars: 2000,
  // Meta renders at most 3 buttons on desktop; beyond that the template is
  // valid but invisible to desktop users, which is worth warning about.
  desktopSafe: 3,
};

const TYPES = new Set(['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE', 'CATALOG']);
// Meta accepts only these two inside a carousel card.
const CARD_TYPES = new Set(['QUICK_REPLY', 'URL']);

const fail = (message) => { const e = new Error(message); e.status = 400; throw e; };

// Accepts the buttons array a client sends and returns the exact shape Meta
// expects, or throws with a message naming the offending button.
//
// `context` switches between the message bubble's rules and the much tighter
// ones Meta applies inside a carousel card ('card'), where only quick-reply
// and link buttons are allowed and at most two of them.
export function normalizeButtons(raw, { context = 'template', where: whereLabel = 'Button' } = {}) {
  const isCard = context === 'card';
  const list = Array.isArray(raw) ? raw.filter(Boolean) : [];
  if (list.length === 0) return [];

  const maxTotal = isCard ? BUTTON_LIMITS.cardTotal : BUTTON_LIMITS.total;
  if (list.length > maxTotal) {
    fail(isCard
      ? `A carousel card can have at most ${maxTotal} buttons — this one has ${list.length}.`
      : `A template can have at most ${maxTotal} buttons — this one has ${list.length}.`);
  }

  const counts = { QUICK_REPLY: 0, URL: 0, PHONE_NUMBER: 0, COPY_CODE: 0, CATALOG: 0 };
  const out = [];

  list.forEach((btn, i) => {
    const type = String(btn?.type || '').trim().toUpperCase();
    const where = `${whereLabel} ${i + 1}`;
    const allowed = isCard ? CARD_TYPES : TYPES;
    if (!allowed.has(type)) {
      fail(isCard
        ? `${where} is a ${btn?.type || 'unknown'} button — carousel cards only support quick-reply and link buttons.`
        : `${where} has an unsupported type "${btn?.type}". Use a quick reply, a link, a phone number, a copy-code, or a catalog button.`);
    }

    counts[type] += 1;
    const perType = isCard ? BUTTON_LIMITS.cardTotal : BUTTON_LIMITS[type];
    if (counts[type] > perType) {
      const label = { PHONE_NUMBER: 'phone-number', URL: 'link', COPY_CODE: 'copy-code', QUICK_REPLY: 'quick-reply', CATALOG: 'catalog' }[type];
      fail(`Only ${perType} ${label} button${perType === 1 ? ' is' : 's are'} allowed per ${isCard ? 'card' : 'template'}.`);
    }

    const text = String(btn?.text || '').trim();
    if (!text) fail(`${where} needs a label.`);
    if (text.length > BUTTON_LIMITS.textChars) {
      fail(`${where} label is ${text.length} characters — the limit is ${BUTTON_LIMITS.textChars}.`);
    }

    if (type === 'QUICK_REPLY') {
      out.push({ type, text });
      return;
    }

    if (type === 'URL') {
      const url = String(btn?.url || '').trim();
      if (!url) fail(`${where} needs a URL.`);
      if (url.length > BUTTON_LIMITS.urlChars) fail(`${where} URL is longer than ${BUTTON_LIMITS.urlChars} characters.`);
      if (!/^https?:\/\//i.test(url)) fail(`${where} URL must start with http:// or https://`);

      const vars = url.match(/\{\{\s*\d+\s*\}\}/g) || [];
      if (vars.length > 1) fail(`${where} URL may contain at most one variable.`);
      if (vars.length === 1 && !/\{\{\s*\d+\s*\}\}$/.test(url)) {
        fail(`${where} URL variable must be at the very end of the address — Meta only allows a dynamic suffix.`);
      }
      const entry = { type, text, url };
      // Meta requires a worked example whenever the URL is dynamic.
      if (vars.length === 1) {
        const example = String(btn?.example || '').trim();
        if (!example) fail(`${where} has a dynamic URL, so it needs an example value showing what the variable becomes.`);
        entry.example = [example];
      }
      out.push(entry);
      return;
    }

    if (type === 'PHONE_NUMBER') {
      const phone = String(btn?.phone_number || btn?.phoneNumber || '').trim();
      if (!phone) fail(`${where} needs a phone number.`);
      if (!/^\+?[0-9\s\-()]{6,20}$/.test(phone)) fail(`${where} has an invalid phone number.`);
      out.push({ type, text, phone_number: phone });
      return;
    }

    // A catalog button carries no destination of its own — it opens the
    // catalog already connected to the WhatsApp Business account.
    if (type === 'CATALOG') {
      out.push({ type, text });
      return;
    }

    // COPY_CODE carries the sample coupon Meta shows the reviewer.
    const code = String(btn?.example || btn?.code || '').trim();
    if (!code) fail(`${where} needs an example code (e.g. SAVE20).`);
    out.push({ type, text, example: [code] });
  });

  // Meta's catalog button replaces the whole button row — it cannot share the
  // template with links, calls or quick replies.
  if (counts.CATALOG > 0 && out.length > 1) {
    fail('A catalog button must be the only button on the template.');
  }

  // Quick replies must sit together. Meta errors on QR → URL → QR.
  const qrPositions = out.map((b, i) => (b.type === 'QUICK_REPLY' ? i : -1)).filter((i) => i !== -1);
  if (qrPositions.length > 1) {
    const contiguous = qrPositions[qrPositions.length - 1] - qrPositions[0] === qrPositions.length - 1;
    if (!contiguous) {
      fail('Quick-reply buttons must be grouped together — Meta rejects them interleaved with link or call buttons.');
    }
  }

  return out;
}

// Non-fatal advice shown next to the builder.
export function buttonWarnings(buttons) {
  const notes = [];
  if (buttons.length > BUTTON_LIMITS.desktopSafe) {
    notes.push(`Templates with more than ${BUTTON_LIMITS.desktopSafe} buttons are not shown on WhatsApp desktop.`);
  }
  return notes;
}
