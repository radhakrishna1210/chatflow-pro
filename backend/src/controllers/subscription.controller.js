import { prisma } from '../lib/prisma.js';
import { getPlanLimits, listPlans, createCheckoutOrder, verifyCheckoutPayment } from '../services/subscription.service.js';
import { MESSAGE_CATEGORY_RATES } from '../lib/messagePricing.js';
import * as addons from '../services/addons.service.js';

export async function getSummary(req, res) {
  const workspaceId = req.params.workspaceId;
  const { plan, usage, remainingQuota } = await getPlanLimits(workspaceId);
  const subscription = await prisma.subscription.findUnique({ where: { workspaceId }, include: { pendingPlan: true } });

  res.json({
    plan: {
      key: plan.key, name: plan.name, priceMonthly: plan.priceMonthly,
      priceQuarterly: plan.priceQuarterly, currency: plan.currency,
      messageQuota: plan.messageQuota, contactLimit: plan.contactLimit, memberLimit: plan.memberLimit,
      apiKeyLimit: plan.apiKeyLimit, overageRatePerMsg: plan.overageRatePerMsg,
      // Null means the plan charges the shared cost rates; resolve them here so
      // the UI always has concrete numbers to show.
      overageRates: plan.overageRates ?? MESSAGE_CATEGORY_RATES,
      features: plan.features,
    },
    usage: { messagesUsed: usage.messagesUsed, periodStart: usage.periodStart, periodEnd: usage.periodEnd },
    remainingQuota: remainingQuota === Infinity ? -1 : remainingQuota,
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    pendingPlan: subscription.pendingPlan ? { key: subscription.pendingPlan.key, name: subscription.pendingPlan.name } : null,
  });
}

export async function getPlans(req, res) {
  const plans = await listPlans();
  // The per-message rates travel with each plan so the plans page has one
  // source for them instead of its own copy. A plan with its own overageRates
  // advertises those; the rest advertise the shared cost rates.
  res.json(plans.map((plan) => ({ ...plan, messagePricing: plan.overageRates ?? MESSAGE_CATEGORY_RATES })));
}

// The canonical per-message rates, for screens that talk about what a message
// costs without being about a particular plan (template category warnings, the
// utility-rewrite pitch). Plan-specific overrides ride on /plans instead.
export async function getMessagePricing(req, res) {
  res.json({ currency: 'INR', rates: MESSAGE_CATEGORY_RATES });
}

export async function createCheckout(req, res) {
  const { planId, cycle } = req.body;
  if (!planId) { const e = new Error('planId is required'); e.status = 400; throw e; }
  const order = await createCheckoutOrder(req.params.workspaceId, planId, cycle);
  res.json(order);
}

export async function verifyCheckout(req, res) {
  const result = await verifyCheckoutPayment(req.params.workspaceId, req.body);
  res.json(result);
}

// ─── Add-ons ─────────────────────────────────────────────────────────────────
// Prices come from lib/addonCatalogue.js, so what the screen shows and what the
// gateway charges are read from the same place.

export async function listAddons(req, res) {
  res.json(await addons.listAddons(req.params.workspaceId));
}

export async function createAddonCheckout(req, res) {
  res.json(await addons.createAddonOrder(req.params.workspaceId, req.body?.addonKey));
}

export async function verifyAddonCheckout(req, res) {
  res.json(await addons.verifyAddonPayment(req.params.workspaceId, req.body || {}));
}

export async function cancelAddon(req, res) {
  res.json(await addons.cancelAddon(req.params.workspaceId, req.params.addonKey));
}
