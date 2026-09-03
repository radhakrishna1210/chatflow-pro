// Validation for a template's BUTTONS component.
//
// Meta enforces these rules at submission time and rejects the whole template
// when one is broken, which surfaces to the user hours later as an opaque
// review failure. Checking here turns that into an immediate, specific error.
//
// Limits are Meta's published ones (Business Management API → message
// templates → components):
//   - 10 buttons total
//   - PHONE_NUMBER x1, URL x2, COPY_CODE x1, QUICK_REPLY x10, OTP x1
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
  // An authentication template carries exactly one OTP button and nothing
  // else — it is the button WhatsApp itself renders to copy the passcode.
  OTP: 1,
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

const TYPES = new Set(['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE', 'CATALOG', 'OTP']);

// The otp_type values Meta accepts on an OTP button. Only COPY_CODE is offered
// here: one-tap and zero-tap autofill additionally require a signed Android app
// hash registered on the WABA, and a template approved with either of those
// cannot be delivered without it — so accepting them would produce templates
// that pass review and then fail every send.
const OTP_TYPES = new Set(['COPY_CODE']);
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

  const counts = { QUICK_REPLY: 0, URL: 0, PHONE_NUMBER: 0, COPY_CODE: 0, CATALOG: 0, OTP: 0 };
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
      const label = { PHONE_NUMBER: 'phone-number', URL: 'link', COPY_CODE: 'copy-code', QUICK_REPLY: 'quick-reply', CATALOG: 'catalog', OTP: 'OTP' }[type];
      fail(`Only ${perType} ${label} button${perType === 1 ? ' is' : 's are'} allowed per ${isCard ? 'card' : 'template'}.`);
    }

    // Meta labels an OTP button "Copy code" when the template does not name
    // one, so an omitted label is a default rather than an error.
    const text = String(btn?.text || '').trim() || (type === 'OTP' ? 'Copy code' : '');
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
    //
    // The one thing that IS chosen per send is which product's picture heads
    // the message (`thumbnail_product_retailer_id` — the item's Content ID in
    // Commerce Manager). Meta does not accept it at template-creation time, so
    // it is kept under an underscore, out of what toMetaComponents() posts,
    // and read back by the send path. Optional: without it Meta uses the first
    // item in the catalog.
    if (type === 'CATALOG') {
      const entry = { type, text };
      const sku = String(
        btn?._thumbnailProductRetailerId ?? btn?.thumbnailProductRetailerId ?? '',
      ).trim();
      if (sku) {
        if (sku.length > 100) fail(`${where} thumbnail product ID is longer than 100 characters.`);
        entry._thumbnailProductRetailerId = sku;
      }
      out.push(entry);
      return;
    }

    // An OTP button is the authentication category's own button. Unlike
    // COPY_CODE — the marketing coupon button, which carries a fixed sample
    // code chosen at approval time — it carries no example at all: the value
    // it copies is the passcode supplied on each send.
    if (type === 'OTP') {
      const otpType = String(btn?.otp_type || btn?.otpType || 'COPY_CODE').trim().toUpperCase();
      if (!OTP_TYPES.has(otpType)) {
        fail(`${where} uses otp_type "${otpType}" — only COPY_CODE authentication buttons are supported.`);
      }
      out.push({ type, otp_type: otpType, text });
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

  // Same for the OTP button: Meta builds the whole authentication message
  // around it and accepts nothing beside it.
  if (counts.OTP > 0 && out.length > 1) {
    fail('An authentication template carries the OTP button and nothing else.');
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
