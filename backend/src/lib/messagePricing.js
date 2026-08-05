// Per-conversation-category message pricing (INR).
//
// Meta bills WhatsApp template sends by the template's category, so a flat
// per-message rate over-charged utility and authentication traffic by ~6-8x.
// Campaign cost is now `valid recipients × the rate for the campaign's
// template category`.
//
// Workspace.costPerMessage is kept as the fallback for the one case these
// rates cannot cover — a campaign whose template category is missing or
// unrecognised — and remains the per-workspace override a reseller can set.

export const MESSAGE_CATEGORY_RATES = {
  MARKETING: 1.09,
  UTILITY: 0.16,
  AUTHENTICATION: 0.13,
};

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

// `fallback` is the workspace's costPerMessage. Returns a Number, never null,
// so callers can multiply without a guard.
export function rateForCategory(category, fallback) {
  const key = normalizeMessageCategory(category);
  if (key) return MESSAGE_CATEGORY_RATES[key];
  const fallbackRate = Number(fallback);
  return Number.isFinite(fallbackRate) ? fallbackRate : 0;
}

// What one over-quota message costs on a given plan.
//
// Resolution order:
//   1. the plan's own override for that category (Free marks these up),
//   2. the shared category rate — "cost", what campaigns are billed at,
//   3. the plan's flat overageRatePerMsg, for a send with no category at all
//      (an inbox reply carries no template, so no category).
//
// A plan with overageRates null therefore charges cost automatically, which
// keeps the paid tiers in step with MESSAGE_CATEGORY_RATES with nothing to
// re-seed when those change.
export function overageRateFor(plan, category) {
  const key = normalizeMessageCategory(category);
  if (key) {
    const override = plan?.overageRates?.[key];
    const overrideRate = Number(override);
    if (override != null && Number.isFinite(overrideRate) && overrideRate >= 0) return overrideRate;
    return MESSAGE_CATEGORY_RATES[key];
  }
  const flat = Number(plan?.overageRatePerMsg);
  return Number.isFinite(flat) ? flat : 0;
}

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
