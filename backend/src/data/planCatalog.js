// The plan catalogue: the one place a plan's price, limits and feature flags
// are written down.
//
// It used to be written twice — in server.js (upserted on every boot) and in
// scripts/seed-plans.js — under a "keep in sync" comment, which is how two
// lists end up disagreeing about what a plan costs. Both import this now.
//
// IMPORTANT: server.js upserts this list into the Plan table on every boot, so
// a change here becomes the live price for every existing subscriber at their
// next renewal. Edit it as a pricing change, not as a code change.
//
// The paid ladder mirrors Interakt's (interakt.shop/pricing, read 2026-11-26):
//
//              monthly   quarterly   yearly
//   Starter      ₹999      ₹3,499    ₹11,999
//   Growth     ₹2,799      ₹7,699    ₹26,399
//   Advanced   ₹3,799     ₹10,499    ₹35,999
//   Enterprise          on request
//
// with unlimited agents, messages and contacts on every paid plan, and the
// included custom fields / custom events stepping up by tier (PLAN_ALLOWANCES
// below). Two things are deliberately *not* copied:
//
//   - Per-message rates. Ours stay the shared cost rates in
//     lib/messagePricing.js on every paid plan (`overageRates: null`).
//   - Interakt's monthly Starter is Instagram-only. Ours keeps WhatsApp, so
//     the workspaces already on it keep working.
//
// Enterprise is sold by enquiry and has no Plan row — there is no price to
// check out against.

const PAID_FEATURES = { automation: true, workflows: true, aiOnboarding: true, integrations: true };

export const PLANS = [
  {
    key: 'FREE',
    name: 'Free',
    priceMonthly: 0,
    priceQuarterly: null,
    priceYearly: null,
    currency: 'INR',
    messageQuota: 100,
    contactLimit: 100,
    memberLimit: 1,
    campaignLimit: null,
    apiKeyLimit: 1,
    // Flat rate for a send with no template category (an inbox reply).
    overageRatePerMsg: 0.02,
    // Free pays a markup on over-quota template sends — 2x cost, mirroring
    // the 2x ratio Free already carried against the paid tiers. The paid plans
    // leave this null and are charged cost (lib/messagePricing.js).
    overageRates: { MARKETING: 2.18, UTILITY: 0.32, AUTHENTICATION: 0.26 },
    // The whole Automation tab (basic auto-replies, keyword triggers, workflows,
    // forms, Instagram, Voice AI) is available on every plan. Free accounts are
    // still bounded by messageQuota/contactLimit above, which is what actually
    // meters usage — gating the feature only made the tab look broken.
    features: { automation: true, workflows: true },
  },
  // The entry tier is sold as "Starter" but keeps the key BASIC: the key is the
  // permanent join for existing subscriptions, and the STARTER key belongs to a
  // retired legacy plan (RETIRED_PLAN_SUCCESSOR below).
  {
    key: 'BASIC',
    name: 'Starter',
    priceMonthly: 999,
    priceQuarterly: 3499,
    priceYearly: 11999,
    currency: 'INR',
    messageQuota: -1,
    contactLimit: null,
    memberLimit: null,
    campaignLimit: null,
    // Not unlimited: API access is where Starter stops short of Growth.
    apiKeyLimit: 10,
    overageRatePerMsg: 0.01,
    // null = charge cost: the shared per-category rates.
    overageRates: null,
    features: PAID_FEATURES,
  },
  {
    key: 'GROWTH',
    name: 'Growth',
    priceMonthly: 2799,
    priceQuarterly: 7699,
    priceYearly: 26399,
    currency: 'INR',
    messageQuota: -1,
    contactLimit: null,
    memberLimit: null,
    campaignLimit: null,
    apiKeyLimit: null,
    overageRatePerMsg: 0.008,
    overageRates: null,
    features: PAID_FEATURES,
  },
  {
    key: 'ADVANCED',
    name: 'Advanced',
    priceMonthly: 3799,
    priceQuarterly: 10499,
    priceYearly: 35999,
    currency: 'INR',
    messageQuota: -1,
    contactLimit: null,
    memberLimit: null,
    campaignLimit: null,
    apiKeyLimit: null,
    overageRatePerMsg: 0.008,
    overageRates: null,
    features: PAID_FEATURES,
  },
];

// Plans the catalogue no longer sells. They are deactivated rather than deleted
// because Subscription.planId still references them, and any workspace left on
// one is moved onto its successor so nobody is stranded on a plan that can no
// longer be renewed or displayed. Each retired tier maps to the plan that
// inherited its limits and features, so the move costs no capability.
export const RETIRED_PLAN_SUCCESSOR = { STARTER: 'BASIC', PRO: 'BASIC', ENTERPRISE: 'GROWTH' };

// What each plan includes of the capabilities that are otherwise bought as
// add-on packs (lib/addonCatalogue.js): custom contact fields and custom
// events. Interakt's ladder is 15 / 25 / 30 fields and 0 / 5 / 7 events.
//
// Kept here rather than in Plan.features because the admin console normalises
// that column to booleans, which would turn "25" into "true" on the first edit.
// A plan with no entry (Free, or one created in the admin console) includes
// none, exactly as before. Read by services/addons.service.js#addonAllowance,
// which adds any purchased packs on top.
//
// Contact tags are not listed: they are unlimited on every plan here, where
// Interakt caps them at 15 / 30 / 45. Introducing a cap would break every
// workspace already over it, so that one stays more generous on purpose.
export const PLAN_ALLOWANCES = Object.freeze({
  BASIC:    Object.freeze({ customFields: 15, customEvents: 0 }),
  GROWTH:   Object.freeze({ customFields: 25, customEvents: 5 }),
  ADVANCED: Object.freeze({ customFields: 30, customEvents: 7 }),
});

export const planAllowance = (planKey, capability) => Number(PLAN_ALLOWANCES[planKey]?.[capability] ?? 0);
