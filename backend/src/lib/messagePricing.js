// Per-conversation-category message pricing (INR).
//
// Meta bills WhatsApp template sends by the template's category, so a flat
// per-message rate over-charged utility and authentication traffic by ~6-8x.
// Campaign cost is now `valid recipients × the rate for the campaign's
// template category`.
//
// messageRate() below is the single price of one message: campaign quotes and
// launch, inbox/API overage and wallet health all call it, so the same message
// costs the same whichever path sends it. (Workspace.costPerMessage no longer
// prices anything; it only labels legacy rows.)

export const MESSAGE_CATEGORY_RATES = {
  MARKETING: 1.09,
  UTILITY: 0.16,
  AUTHENTICATION: 0.13,
};

// Charged per campaign fallback SMS (fallback.service.js). Those go out on the
// platform's Twilio account, so they are billed to the workspace wallet like
// any other message rather than absorbed.
export const SMS_FALLBACK_RATE = 0.25;

// Meta has used both "AUTHENTICATION" and the older "OTP" spelling, and
// templates synced from Meta arrive in whatever case the API returned.
const ALIASES = {
  OTP: 'AUTHENTICATION',
  AUTH: 'AUTHENTICATION',
  MARKETING_LITE: 'MARKETING',
};

export function normalizeMessageCategory(category) {
  const key = String(category || '').trim().toUpperCase();
  if (!key) return null;
  const resolved = ALIASES[key] || key;
  return resolved in MESSAGE_CATEGORY_RATES ? resolved : null;
}

// What one message costs on a given plan (`plan` may be null: no overrides,
// no flat rate). Returns a Number, never null, so callers can multiply
// without a guard.
//
// Resolution order:
//   1. the plan's own override for that category (Free marks these up),
//   2. the shared category rate — "cost",
//   3. a template category Meta uses but this table does not know is priced
//      as MARKETING, the highest rate, so an unrecognised category is never
//      billed below cost,
//   4. the plan's flat overageRatePerMsg, for a send with no category at all
//      (an inbox reply carries no template, so no category).
//
// A plan with overageRates null therefore charges cost automatically, which
// keeps the paid tiers in step with MESSAGE_CATEGORY_RATES with nothing to
// re-seed when those change.
export function messageRate(plan, category) {
  const key = normalizeMessageCategory(category) ?? (String(category ?? '').trim() ? 'MARKETING' : null);
  if (key) {
    const override = plan?.overageRates?.[key];
    const overrideRate = Number(override);
    if (override != null && Number.isFinite(overrideRate) && overrideRate >= 0) return overrideRate;
    return MESSAGE_CATEGORY_RATES[key];
  }
  const flat = Number(plan?.overageRatePerMsg);
  return Number.isFinite(flat) ? flat : 0;
}

// Over-quota sends (subscription.service.js) are priced by the same function.
export const overageRateFor = messageRate;

// Normalises an admin-supplied override map. Returns null for "no override"
// so the plan falls back to cost rather than being pinned at zero.
export function normalizeOverageRates(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const key of Object.keys(MESSAGE_CATEGORY_RATES)) {
    const value = Number(raw[key]);
    if (raw[key] != null && raw[key] !== '' && Number.isFinite(value) && value >= 0) {
      out[key] = Math.round(value * 10000) / 10000;
    }
  }
  return Object.keys(out).length ? out : null;
}
