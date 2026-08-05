import { prisma } from '../lib/prisma.js';
import { getPlanLimits, listPlans, createCheckoutOrder, verifyCheckoutPayment } from '../services/subscription.service.js';
import { MESSAGE_CATEGORY_RATES } from '../lib/messagePricing.js';

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
  res.json(plans);
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
