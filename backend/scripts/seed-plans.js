import { prisma } from '../src/lib/prisma.js';

// Keep in sync with initializeSubscriptions() in src/server.js — that list is
// upserted on every boot, so a change made only here would be overwritten.
const PLANS = [
  {
    key: 'FREE',
    name: 'Free',
    priceMonthly: 0,
    priceQuarterly: null,
    currency: 'INR',
    messageQuota: 100,
    contactLimit: 100,
    memberLimit: 1,
    campaignLimit: null,
    apiKeyLimit: 1,
    // Flat rate for a send with no template category (an inbox reply).
    overageRatePerMsg: 0.02,
    // Free pays a markup on over-quota template sends — 2x cost, mirroring
    // the 2x ratio Free already carried against the paid tiers. Basic and
    // Growth leave this null and are charged cost (lib/messagePricing.js).
    overageRates: { MARKETING: 2.18, UTILITY: 0.32, AUTHENTICATION: 0.26 },
    // The whole Automation tab (basic auto-replies, keyword triggers, workflows,
    // forms, Instagram, Voice AI) is available on every plan. Free accounts are
    // still bounded by messageQuota/contactLimit above, which is what actually
    // meters usage — gating the feature only made the tab look broken.
    features: { automation: true, workflows: true },
  },
  // Basic carries the former Pro limits and features; Growth carries the
  // former Enterprise ones.
  {
    key: 'BASIC',
    name: 'Basic',
    priceMonthly: 1500,
    priceQuarterly: 3500,
    currency: 'INR',
    messageQuota: 10000,
    contactLimit: null,
    memberLimit: 10,
    campaignLimit: null,
    apiKeyLimit: 10,
    overageRatePerMsg: 0.01,
    // null = charge cost: the shared per-category rates.
    overageRates: null,
    features: { automation: true, workflows: true, aiOnboarding: true, integrations: true },
  },
  {
    key: 'GROWTH',
    name: 'Growth',
    priceMonthly: 2500,
    priceQuarterly: 7500,
    currency: 'INR',
    messageQuota: -1,
    contactLimit: null,
    memberLimit: null,
    campaignLimit: null,
    apiKeyLimit: null,
    overageRatePerMsg: 0.008,
    overageRates: null,
    features: { automation: true, workflows: true, aiOnboarding: true, integrations: true },
  },
];

// Each retired tier maps to the plan that inherited its limits and features,
// so a workspace moved off it loses no capability.
const RETIRED_PLAN_SUCCESSOR = { STARTER: 'BASIC', PRO: 'BASIC', ENTERPRISE: 'GROWTH' };
const RETIRED_PLAN_KEYS = Object.keys(RETIRED_PLAN_SUCCESSOR);

async function main() {
  const planByKey = new Map();
  for (const plan of PLANS) {
    const { key, ...data } = plan;
    const result = await prisma.plan.upsert({
      where: { key },
      update: data,
      create: { key, ...data },
    });
    planByKey.set(result.key, result);
    console.log(`Upserted plan: ${result.key}`);
  }

  // Deactivated rather than deleted: Subscription.planId still references
  // these rows. Subscribers move to the successor plan first so nothing is
  // left pointing at a plan that can no longer be renewed or displayed.
  const retired = await prisma.plan.findMany({
    where: { key: { in: RETIRED_PLAN_KEYS } },
    select: { id: true, key: true },
  });
  if (retired.length > 0) {
    const movedPerPlan = [];
    for (const oldPlan of retired) {
      const successor = planByKey.get(RETIRED_PLAN_SUCCESSOR[oldPlan.key]);
      if (!successor) continue;
      const moved = await prisma.subscription.updateMany({
        where: { planId: oldPlan.id },
        data: { planId: successor.id },
      });
      if (moved.count > 0) movedPerPlan.push(`${moved.count} ${oldPlan.key}→${successor.key}`);
    }
    const retiredIds = retired.map((p) => p.id);
    const clearedPending = await prisma.subscription.updateMany({
      where: { pendingPlanId: { in: retiredIds } },
      data: { pendingPlanId: null },
    });
    await prisma.plan.updateMany({
      where: { id: { in: retiredIds } },
      data: { isActive: false },
    });
    console.log(`Retired ${retired.map((p) => p.key).join(', ')} — moved ${movedPerPlan.join(', ') || 'none'}, cleared ${clearedPending.count} pending change(s).`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
