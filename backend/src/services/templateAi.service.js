// Drafts a WhatsApp template from a plain-English description.
//
// Returns an editable preview rather than saving: Meta reviews every template
// and rejects the ones that read like spam or mis-declare their category, so
// the user must see and adjust the copy before it is submitted. The shape
// matches what TemplateModal renders, so "Edit in builder" is a straight
// hand-off with no translation step.

import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import { normalizeButtons, buttonWarnings } from '../lib/templateButtons.js';

let _ai = null;
let _aiKey = null;
function getAi() {
  const key = env.GEMINI_API_KEY;
  if (!key) return null;
  if (!_ai || _aiKey !== key) {
    _ai = new GoogleGenAI({ apiKey: key });
    _aiKey = key;
  }
  return _ai;
}

// Shown in the UI as one-click starting points.
export const TEMPLATE_SUGGESTIONS = [
  { label: 'Abandoned cart',      prompt: 'Remind a customer they left items in their cart and offer a discount code to complete the order.', category: 'MARKETING' },
  { label: 'Appointment reminder', prompt: 'Remind a patient of their appointment date and time, and let them confirm or reschedule.',        category: 'UTILITY' },
  { label: 'Order shipped',        prompt: 'Tell a customer their order has shipped and give them a tracking link.',                          category: 'UTILITY' },
  { label: 'Festival offer',       prompt: 'Announce a festive sale with a discount percentage and a link to shop.',                          category: 'MARKETING' },
  { label: 'Welcome message',      prompt: 'Welcome a new customer after signup and tell them how to get help.',                              category: 'MARKETING' },
  { label: 'Payment reminder',     prompt: 'Politely remind a customer that an invoice is due, with the amount and due date.',                category: 'UTILITY' },
  { label: 'Feedback request',     prompt: 'Ask a customer to rate their recent experience and leave a short review.',                        category: 'MARKETING' },
  { label: 'OTP verification',     prompt: 'Send a one-time password for login verification that expires in 10 minutes.',                     category: 'AUTHENTICATION' },
];

const SYSTEM_PROMPT = `You write WhatsApp message templates that pass Meta's review.

Return JSON only. No markdown.

{
  "name": string,          // lowercase, digits and underscores only, max 60 chars, descriptive
  "category": "MARKETING" | "UTILITY" | "AUTHENTICATION",
  "language": string,      // BCP-47-ish code Meta accepts, e.g. "en", "en_US", "hi"
  "body": string,          // the message text
  "footer": string,        // short sign-off, or "" for none
  "headerText": string,    // short header line, or "" if the template needs no text header
  "suggestImage": boolean, // true when a picture would genuinely help (product, offer, food, property)
  "imageIdea": string,     // one line describing the picture to upload, or ""
  "variables": [ { "index": 1, "meaning": "customer name", "example": "Priya" } ],
  "buttons": [             // [] when the message needs no action
    { "type": "QUICK_REPLY", "text": "Yes, confirm" },
    { "type": "URL", "text": "Track order", "url": "https://example.com/track/{{1}}", "example": "10482" },
    { "type": "PHONE_NUMBER", "text": "Call us", "phone_number": "+911234567890" },
    { "type": "COPY_CODE", "text": "Copy code", "example": "SAVE20" }
  ],
  "rationale": string      // one sentence on why this copy and category
}

Rules:
- Category must match intent. Order updates, reminders, alerts and receipts are UTILITY. Promotions, offers and re-engagement are MARKETING. One-time passcodes are AUTHENTICATION and nothing else.
- Body under 1024 characters, warm and direct. No ALL CAPS shouting, no "click here", no unverifiable claims — Meta rejects those.
- Use {{1}}, {{2}} … numbered from 1 with no gaps, in the order they appear. {{1}} should be the recipient's name where natural.
- Give every variable a realistic example. Meta rejects templates whose samples are placeholders like "XXX".
- Footer max 60 characters. Add "Reply STOP to opt out" on MARKETING templates.
- headerText max 60 characters and may contain at most one variable.
- AUTHENTICATION templates: body carries the code as {{1}}, no footer, no header, suggestImage false, buttons [].

Buttons — propose the ones that genuinely help the reader act, then stop:
- Label max 25 characters. At most 2 URL, 1 PHONE_NUMBER, 1 COPY_CODE, and up to 10 QUICK_REPLY, 10 in total.
- Keep every quick reply together in the list; never alternate them with other types.
- Prefer 2 to 3 buttons. More than 3 are hidden on WhatsApp desktop.
- A URL may carry one variable and only as the final characters, e.g. "https://shop.com/orders/{{1}}"; give its example separately.
- Use COPY_CODE only for a real discount or coupon code, with the code in "example".
- Reminders and confirmations suit QUICK_REPLY ("Confirm", "Reschedule"). Promotions suit a URL. Support messages suit PHONE_NUMBER.`;

function parseJson(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const s = trimmed.indexOf('{'), e = trimmed.lastIndexOf('}');
  if (s !== -1 && e > s) { try { return JSON.parse(trimmed.slice(s, e + 1)); } catch { /* give up */ } }
  return null;
}

const CATEGORIES = new Set(['MARKETING', 'UTILITY', 'AUTHENTICATION']);

// Renumbers {{n}} placeholders to a gapless 1..N sequence. Meta rejects a body
// that jumps from {{1}} to {{3}}, and models do that often enough to matter.
function normalizeVariables(body, rawVars) {
  const found = [...String(body).matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  const order = [...new Set(found)];
  let text = body;
  order.forEach((original, i) => {
    text = text.replace(new RegExp(`\\{\\{\\s*${original}\\s*\\}\\}`, 'g'), `__V${i + 1}__`);
  });
  text = text.replace(/__V(\d+)__/g, '{{$1}}');

  const byIndex = new Map((Array.isArray(rawVars) ? rawVars : []).map((v) => [Number(v?.index), v]));
  const variables = order.map((original, i) => {
    const src = byIndex.get(original) || {};
    return {
      index: i + 1,
      meaning: String(src.meaning || (i === 0 ? 'customer name' : `value ${i + 1}`)).slice(0, 60),
      example: String(src.example || (i === 0 ? 'Priya' : 'value')).slice(0, 60),
    };
  });
  return { body: text, variables };
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

function normalize(raw, prompt) {
  const category = CATEGORIES.has(raw?.category) ? raw.category : 'MARKETING';
  const isAuth = category === 'AUTHENTICATION';

  const { body, variables } = normalizeVariables(
    String(raw?.body || '').trim().slice(0, 1024) || String(prompt).trim(),
    raw?.variables,
  );

  const name = slug(raw?.name) || slug(prompt) || 'ai_template';
  const footer = isAuth ? '' : String(raw?.footer || '').trim().slice(0, 60);
  const headerText = isAuth ? '' : String(raw?.headerText || '').trim().slice(0, 60);

  // Run the model's buttons through the real validator. A draft is a
  // suggestion, so an invalid set is dropped rather than shown — the user
  // should never be handed buttons that Meta will reject on submit.
  let buttons = [];
  let buttonNote = '';
  if (!isAuth && Array.isArray(raw?.buttons) && raw.buttons.length) {
    try {
      buttons = normalizeButtons(raw.buttons);
    } catch (err) {
      buttons = [];
      buttonNote = `Suggested buttons were dropped: ${err.message}`;
    }
  }

  return {
    name,
    category,
    language: String(raw?.language || 'en').trim().slice(0, 10) || 'en',
    headerText,
    body,
    footer,
    variables,
    buttons,
    buttonNote,
    buttonWarnings: buttonWarnings(buttons),
    // Advisory only — the user still has to pick and upload a file, because
    // Meta needs a real sample image to approve a media header.
    suggestImage: isAuth ? false : Boolean(raw?.suggestImage),
    imageIdea: isAuth ? '' : String(raw?.imageIdea || '').trim().slice(0, 160),
    rationale: String(raw?.rationale || '').trim().slice(0, 240),
  };
}

// Deterministic draft when Gemini can't be reached, so the feature degrades to
// something usable instead of an error. `reason` separates "no key configured"
// from "the key is there but the call failed" — reporting the first for both
// hid a retired-model 404 behind a config message that looked correct.
function fallbackDraft(prompt, reason = 'no_key') {
  const p = String(prompt).toLowerCase();
  const pick = (cond, value) => (cond ? value : null);
  const preset =
    pick(/cart|abandon/.test(p), {
      category: 'MARKETING', headerText: 'You left something behind',
      body: 'Hi {{1}}, you still have items waiting in your cart. Complete your order today and use code {{2}} to save on your purchase.',
      footer: 'Reply STOP to opt out', vars: [['customer name', 'Priya'], ['discount code', 'SAVE10']], image: true,
      buttons: [{ type: 'COPY_CODE', text: 'Copy code', example: 'SAVE10' }],
      idea: 'A photo of the product left in the cart.',
    }) ||
    pick(/appointment|booking|reminder/.test(p), {
      category: 'UTILITY', headerText: 'Appointment reminder',
      body: 'Hi {{1}}, this is a reminder for your appointment on {{2}} at {{3}}. Reply CONFIRM to confirm or CANCEL to reschedule.',
      footer: '', vars: [['customer name', 'Priya'], ['date', '12 August'], ['time', '4:30 PM']], image: false, idea: '',
      buttons: [{ type: 'QUICK_REPLY', text: 'Confirm' }, { type: 'QUICK_REPLY', text: 'Reschedule' }],
    }) ||
    pick(/order|ship|deliver|track/.test(p), {
      category: 'UTILITY', headerText: 'Your order is on the way',
      body: 'Hi {{1}}, your order {{2}} has shipped. Track it here: {{3}}. Thanks for shopping with us.',
      footer: '', vars: [['customer name', 'Priya'], ['order number', '#10482'], ['tracking link', 'example.com/track']], image: false, idea: '',
      buttons: [{ type: 'URL', text: 'Track order', url: 'https://example.com/track/{{1}}', example: '10482' }],
    }) ||
    pick(/otp|verif|password|code/.test(p), {
      category: 'AUTHENTICATION', headerText: '',
      body: '{{1}} is your verification code. It expires in 10 minutes. Do not share it with anyone.',
      footer: '', vars: [['one-time code', '482913']], image: false, idea: '',
    }) || {
      category: 'MARKETING', headerText: '',
      body: `Hi {{1}}, ${String(prompt).trim().replace(/\.$/, '')}.`,
      footer: 'Reply STOP to opt out', vars: [['customer name', 'Priya']], image: false, idea: '',
    };

  return normalize({
    name: slug(prompt) || 'ai_template',
    category: preset.category,
    language: 'en',
    headerText: preset.headerText,
    body: preset.body,
    footer: preset.footer,
    suggestImage: preset.image,
    imageIdea: preset.idea,
    buttons: preset.buttons || [],
    variables: preset.vars.map(([meaning, example], i) => ({ index: i + 1, meaning, example })),
    rationale: reason === 'no_key'
      ? 'Drafted from a built-in pattern because no AI key is configured on the server.'
      : 'Drafted from a built-in pattern because the AI service could not be reached.',
  }, prompt);
}

const UTILITY_VARIANT_PROMPT = `You rewrite a WhatsApp template so Meta classifies it as UTILITY instead of MARKETING.

Meta treats a template as MARKETING when it promotes, upsells or re-engages: offers, discounts, "shop now", new arrivals, loyalty nudges, anything aimed at generating demand. It treats it as UTILITY when the message is *about a transaction the customer already has* — an order, a booking, an account, a payment, a delivery, a request they made.

Rewrite the template so it reports on that existing transaction and nothing more.

Return JSON only:
{
  "name": string,        // lowercase/digits/underscores, derived from the original, max 60
  "body": string,
  "headerText": string,  // "" for none
  "footer": string,      // "" for none; a UTILITY message needs no opt-out line
  "variables": [ { "index": 1, "meaning": string, "example": string } ],
  "buttons": [ ... ],    // same shapes as a normal template; [] if none help
  "changes": [ string ], // what you removed or reworded, one short line each
  "caveat": string       // when this rewrite is NOT a faithful substitute, else ""
}

Rules:
- Remove every promotional element: discounts, coupon codes, urgency, "limited time", "shop now", emoji used for excitement, and any COPY_CODE button.
- Keep the message genuinely useful and specific to the customer's own transaction. Do not invent an order or booking that the original did not imply.
- Placeholders {{1}}, {{2}} … numbered from 1 with no gaps, each with a realistic example.
- Buttons: prefer a quick reply or a link to the customer's own order/booking. Never a coupon.
- If the original is purely promotional and has no transactional basis at all, still produce the closest honest UTILITY rewrite and say so plainly in "caveat".`;

// Rewrites an existing template to read as UTILITY.
//
// Meta re-categorises approved templates, usually UTILITY -> MARKETING, and on
// the workspace's own rates that is a ~7x price rise per message. A rewrite is
// the only way back, so this drafts one instead of leaving the customer to pay
// the higher rate or guess at what Meta objected to.
export async function generateUtilityVariant({ name, category, language, components }) {
  const comps = Array.isArray(components) ? components : [];
  const get = (t) => comps.find((c) => String(c?.type || '').toUpperCase() === t);
  const body = get('BODY')?.text || '';
  if (!body.trim()) { const e = new Error('That template has no body to rewrite'); e.status = 400; throw e; }

  const header = get('HEADER');
  const original = [
    `name: ${name}`,
    `current category: ${category}`,
    header?.text ? `header: ${header.text}` : header ? `header: (${header.format} media)` : null,
    `body: ${body}`,
    get('FOOTER')?.text ? `footer: ${get('FOOTER').text}` : null,
    get('BUTTONS')?.buttons?.length ? `buttons: ${get('BUTTONS').buttons.map((b) => `${b.type}:${b.text}`).join(', ')}` : null,
  ].filter(Boolean).join('\n');

  const ai = getAi();
  if (!ai) {
    const e = new Error('A utility rewrite needs an AI key on the server. Edit the template by hand to remove promotional wording.');
    e.status = 503; e.expose = true; throw e;
  }

  let parsed;
  try {
    const response = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: `${UTILITY_VARIANT_PROMPT}\n\nTemplate to rewrite:\n${original}`,
      config: { temperature: 0.3, responseMimeType: 'application/json' },
    });
    parsed = parseJson(response.text);
  } catch (err) {
    console.error('[TemplateAI] utility variant failed:', err.message);
    const e = new Error('The AI service could not produce a rewrite right now. Try again shortly.');
    e.status = 502; throw e;
  }
  if (!parsed) { const e = new Error('The rewrite came back unreadable. Try again.'); e.status = 502; throw e; }

  // Force UTILITY through the normal normaliser so the result obeys every rule
  // a hand-built template does — including dropping a footer and any buttons
  // Meta would reject.
  const draft = normalize({ ...parsed, category: 'UTILITY', language: language || 'en' }, body);

  return {
    ...draft,
    name: slug(parsed?.name) || `${slug(name)}_utility`.slice(0, 60),
    changes: (Array.isArray(parsed?.changes) ? parsed.changes : []).map((c) => String(c).trim()).filter(Boolean).slice(0, 8),
    caveat: String(parsed?.caveat || '').trim().slice(0, 300),
    from: { name, category },
    provider: 'gemini',
  };
}

export async function generateTemplateDraft(prompt) {
  const clean = String(prompt || '').trim();
  if (!clean) { const e = new Error('Describe the template you want'); e.status = 400; throw e; }

  const ai = getAi();
  if (!ai) return { ...fallbackDraft(clean, 'no_key'), provider: 'fallback', fallbackReason: 'no_key' };

  try {
    const response = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: `${SYSTEM_PROMPT}\n\nDescribe the template to write: ${clean}`,
      config: { temperature: 0.5, responseMimeType: 'application/json' },
    });
    const parsed = parseJson(response.text);
    if (!parsed) return { ...fallbackDraft(clean, 'error'), provider: 'fallback', fallbackReason: 'error' };
    return { ...normalize(parsed, clean), provider: 'gemini' };
  } catch (err) {
    console.error('[TemplateAI] generation failed:', err.message);
    return { ...fallbackDraft(clean, 'error'), provider: 'fallback', fallbackReason: 'error' };
  }
}
