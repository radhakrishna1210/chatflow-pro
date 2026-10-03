import { prisma } from '../lib/prisma.js';

// Plan feature flags (Plan.features) — the one list of what each flag gates
// and the helpers every gate goes through (CF-051).
//
// Every flag below is enforced server-side where its feature is entered; a
// flag no plan ever lacks is still written into each plan's data (seeds and
// migrations) so it is a real switch the admin Plans tab can turn off, not a
// dead one. Core capabilities that are not plan features — the inbox,
// campaigns, templates, analytics — are deliberately absent. Limits
// (contacts, members, API keys, messages) are Plan columns, not flags.
export const PLAN_FEATURES = Object.freeze({
  // routes/automation.routes.js, routes/instagram.routes.js
  automation: { label: 'automation (auto-replies, keyword triggers and Instagram flows)' },
  // routes/workflow.routes.js, POST /ai/workflow/execute
  workflows: { label: 'workflows' },
  // POST /onboarding/chat
  aiOnboarding: { label: 'the AI onboarding assistant' },
  // Connecting a paid integration (integrations.controller.js)
  integrations: { label: 'paid integrations' },
  // AI agent deploy/test/intent toggle, attaching an agent to a campaign, and
  // at runtime: agent replies, campaign agent sessions, the LLM intent classifier
  campaignAi: { label: 'the Campaign AI Agent and AI intent matching' },
  // Enabling SMS/email fallback on a campaign, and sending it
  fallback: { label: 'SMS and email fallback' },
  // Enabling Voice AI, and answering calls with it
  voice: { label: 'Voice AI' },
  // The autonomous CRM agent: switching it on, running it, re-queueing its
  // tasks (routes/agent.routes.js), and at runtime its sweep and task runner
  // (agent.service.js AGENT_ELIGIBLE_WHERE). Paid plans only (CF-046).
  autonomousAgent: { label: 'the autonomous CRM agent' },
});

export const PLAN_FEATURE_KEYS = Object.keys(PLAN_FEATURES);

async function currentPlan(workspaceId) {
  const sub = await prisma.subscription.findUnique({
    where: { workspaceId },
    select: { plan: { select: { name: true, features: true } } },
  });
  return sub?.plan ?? null;
}

// Non-throwing check for runtime paths (an inbound message, a send). A lookup
// failure counts as "not allowed": the feature is skipped, nothing is charged.
export async function planAllows(workspaceId, flag) {
  try {
    const plan = await currentPlan(workspaceId);
    return Boolean(plan?.features?.[flag]);
  } catch (err) {
    console.error(`[PlanFeatures] Could not read the plan of ${workspaceId}:`, err.message);
    return false;
  }
}

// The 403 every gate returns: names the feature, the plan the workspace is
// on, and the cheapest plan that includes it, so the message says where to go.
export async function planFeatureLockedError(flag, currentPlanName = null) {
  const label = PLAN_FEATURES[flag]?.label ?? flag;
  const plans = await prisma.plan.findMany({
    where: { isActive: true },
    orderBy: { priceMonthly: 'asc' },
    select: { name: true, features: true },
  }).catch(() => []);
  const upgradeTo = plans.find((p) => p.features?.[flag])?.name ?? null;
  const e = new Error(
    `Your ${currentPlanName ? `${currentPlanName} ` : ''}plan does not include ${label}. `
    + (upgradeTo ? `Upgrade to ${upgradeTo} to unlock it.` : 'Upgrade your plan to unlock it.'),
  );
  e.status = 403;
  e.code = 'PLAN_FEATURE_LOCKED';
  e.feature = flag;
  e.details = { feature: flag, upgradeTo };
  e.expose = true;
  return e;
}

export async function assertPlanFeature(workspaceId, flag) {
  const plan = await currentPlan(workspaceId);
  if (plan?.features?.[flag]) return;
  throw await planFeatureLockedError(flag, plan?.name ?? null);
}

// The flags the workspace's plan grants, for screens that hide or disable a
// locked feature instead of letting the click 403.
export async function planFeatureMap(workspaceId) {
  const plan = await currentPlan(workspaceId).catch(() => null);
  return Object.fromEntries(PLAN_FEATURE_KEYS.map((k) => [k, Boolean(plan?.features?.[k])]));
}
