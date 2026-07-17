import { prisma } from '../lib/prisma.js';
import { debit } from './wallet.service.js';
import { getRazorpayClient, verifyPaymentSignature, normalizeRazorpayError } from '../lib/razorpay.js';
import { env } from '../config/env.js';

// Returns the workspace's subscription + plan + the UsageCounter for the
// subscription's current billing cycle, creating the counter if it doesn't
// exist yet (e.g. right after a cycle rollover).
export async function getActiveSubscription(workspaceId) {
  const subscription = await prisma.subscription.findUnique({
    where: { workspaceId },
    include: { plan: true },
  });
  if (!subscription) { const e = new Error('Subscription not found'); e.status = 404; throw e; }

  let usage = await prisma.usageCounter.findUnique({
    where: { workspaceId_periodStart: { workspaceId, periodStart: subscription.currentPeriodStart } },
  });
  if (!usage) {
    usage = await prisma.usageCounter.upsert({
      where: { workspaceId_periodStart: { workspaceId, periodStart: subscription.currentPeriodStart } },
      update: {},
      create: {
        workspaceId,
        periodStart: subscription.currentPeriodStart,
        periodEnd: subscription.currentPeriodEnd,
        messagesUsed: 0,
      },
    });
  }

  return { subscription, plan: subscription.plan, usage };
}

// Two-layer usage model (README §12.2): the plan's included quota is free,
// then a wallet debit covers overflow. Runs in a single transaction so
// concurrent worker sends can't both slip past the quota — the quota check
// is an atomic conditional increment (updateMany re-evaluates its WHERE
// against the row Postgres just locked), never a read-then-write.
export async function consumeMessageCredit(workspaceId, { reason = 'Message send' } = {}) {
  return prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.findUnique({ where: { workspaceId }, include: { plan: true } });
    if (!subscription) { const e = new Error('Subscription not found'); e.status = 404; throw e; }
    if (subscription.status !== 'ACTIVE') {
      return { ok: false, code: 'SUBSCRIPTION_INACTIVE' };
    }

    const { plan, currentPeriodStart, currentPeriodEnd } = subscription;
    const periodKey = { workspaceId_periodStart: { workspaceId, periodStart: currentPeriodStart } };

    await tx.usageCounter.upsert({
      where: periodKey,
      update: {},
      create: { workspaceId, periodStart: currentPeriodStart, periodEnd: currentPeriodEnd, messagesUsed: 0 },
    });

    if (plan.messageQuota === -1) {
      await tx.usageCounter.update({ where: periodKey, data: { messagesUsed: { increment: 1 } } });
      return { ok: true, source: 'QUOTA', remaining: Infinity };
    }

    const claimed = await tx.usageCounter.updateMany({
      where: { workspaceId, periodStart: currentPeriodStart, messagesUsed: { lt: plan.messageQuota } },
      data: { messagesUsed: { increment: 1 } },
    });
    if (claimed.count > 0) {
      const usage = await tx.usageCounter.findUnique({ where: periodKey });
      return { ok: true, source: 'QUOTA', remaining: plan.messageQuota - usage.messagesUsed };
    }

    // Quota exhausted — overflow to the wallet at the plan's overage rate.
    const result = await debit(workspaceId, plan.overageRatePerMsg, { reason }, tx);
    if (!result.ok) return { ok: false, code: 'QUOTA_AND_WALLET_EXHAUSTED' };
    return { ok: true, source: 'WALLET', newBalance: result.balance };
  });
}

const LIMIT_KINDS = {
  contact: { field: 'contactLimit', label: 'contacts', count: (workspaceId) => prisma.contact.count({ where: { workspaceId } }) },
  member: { field: 'memberLimit', label: 'members', count: (workspaceId) => prisma.workspaceMember.count({ where: { workspaceId } }) },
  apiKey: { field: 'apiKeyLimit', label: 'API keys', count: (workspaceId) => prisma.apiKey.count({ where: { workspaceId, revokedAt: null } }) },
};

// README §12.4 plan-limit checks (contacts, members, API keys). `additional`
// lets a caller check a batch (e.g. a CSV import adding N new contacts) in one
// call instead of looping. A null/undefined plan limit means unlimited.
export async function assertWithinLimit(workspaceId, kind, { additional = 1, message } = {}) {
  const config = LIMIT_KINDS[kind];
  if (!config) throw new Error(`Unknown limit kind: ${kind}`);

  const { plan } = await getActiveSubscription(workspaceId);
  const limit = plan[config.field];
  if (limit === null || limit === undefined) return;

  const count = await config.count(workspaceId);
  if (count + additional > limit) {
    const e = new Error(message || `Your plan allows up to ${limit} ${config.label}. Upgrade your plan to add more.`);
    e.status = 403;
    e.code = 'PLAN_LIMIT_REACHED';
    throw e;
  }
}

export async function hasFeature(workspaceId, flag) {
  const { plan } = await getActiveSubscription(workspaceId);
  return !!plan.features?.[flag];
}

export async function getPlanLimits(workspaceId) {
  const { plan, usage } = await getActiveSubscription(workspaceId);
  const remainingQuota = plan.messageQuota === -1
    ? Infinity
    : Math.max(0, plan.messageQuota - usage.messagesUsed);

  return { plan, usage, remainingQuota };
}

export async function listPlans() {
  return prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceMonthly: 'asc' } });
}

// Creates a Razorpay order for one billing cycle of `planId`. The order's
// `notes` carry workspaceId+planId so verifyCheckoutPayment can read back
// what was actually paid for — never trust a client-supplied planId here.
export async function createCheckoutOrder(workspaceId, planId) {
  const plan = await prisma.plan.findFirst({ where: { id: planId, isActive: true } });
  if (!plan) { const e = new Error('Plan not found'); e.status = 404; throw e; }

  const amountPaise = Math.round(Number(plan.priceMonthly) * 100);
  if (amountPaise <= 0) { const e = new Error("This plan is free — there's nothing to check out"); e.status = 400; throw e; }

  const client = getRazorpayClient();
  const order = await client.orders.create({
    amount: amountPaise,
    currency: 'INR',
    // Razorpay caps `receipt` at 40 chars — a full cuid workspaceId + a
    // millisecond timestamp would overflow it, so truncate and base36 the
    // timestamp. Not used for lookups (that's what `notes` is for below).
    receipt: `sub_${workspaceId.slice(-12)}_${Date.now().toString(36)}`,
    notes: { workspaceId, planId: plan.id },
  }).catch(normalizeRazorpayError);

  return {
    orderId: order.id, amount: order.amount, currency: order.currency, keyId: env.RAZORPAY_KEY_ID,
    plan: { id: plan.id, key: plan.key, name: plan.name, priceMonthly: plan.priceMonthly },
  };
}

// Verifies the Razorpay payment signature, then reads the order's own notes
// (rather than trusting the request body) to find which plan was actually
// paid for. The new plan takes effect immediately: a fresh billing cycle
// starts now (so the buyer gets the full new quota right away, not whatever
// was left of the old plan's cycle) rather than waiting for the next
// scheduled rollover.
export async function verifyCheckoutPayment(workspaceId, { orderId, paymentId, signature } = {}) {
  if (!orderId || !paymentId || !signature) {
    const e = new Error('orderId, paymentId and signature are required'); e.status = 400; throw e;
  }
  if (!verifyPaymentSignature({ orderId, paymentId, signature })) {
    const e = new Error('Payment signature verification failed'); e.status = 400; throw e;
  }

  const client = getRazorpayClient();
  const order = await client.orders.fetch(orderId).catch(normalizeRazorpayError);
  if (order.notes?.workspaceId !== workspaceId) {
    const e = new Error('This payment does not belong to your workspace'); e.status = 403; throw e;
  }

  const plan = await prisma.plan.findUnique({ where: { id: order.notes?.planId } });
  if (!plan) { const e = new Error('Plan for this payment could not be found'); e.status = 404; throw e; }

  const subscription = await prisma.subscription.findUnique({ where: { workspaceId } });
  if (!subscription) { const e = new Error('Subscription not found'); e.status = 404; throw e; }

  // Idempotency guard: a replayed verify call (network retry, double-click)
  // for the same Razorpay payment must not apply the plan change twice.
  const existingInvoice = await prisma.invoice.findFirst({ where: { workspaceId, reference: paymentId } });
  if (existingInvoice) {
    return { applied: 'already_processed', plan: { key: plan.key, name: plan.name } };
  }

  // The charge happened regardless of when the plan itself takes effect.
  await prisma.invoice.create({
    data: {
      workspaceId,
      invoiceDate: new Date(),
      description: `${plan.name} plan subscription`,
      amount: Number(order.amount) / 100,
      currency: order.currency,
      status: 'PAID',
      reference: paymentId,
    },
  });

  const periodStart = new Date();
  const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);
  await prisma.subscription.update({
    where: { workspaceId },
    data: {
      planId: plan.id, pendingPlanId: null, status: 'ACTIVE', cancelAtPeriodEnd: false,
      currentPeriodStart: periodStart, currentPeriodEnd: periodEnd,
    },
  });
  await prisma.usageCounter.upsert({
    where: { workspaceId_periodStart: { workspaceId, periodStart } },
    update: {},
    create: { workspaceId, periodStart, periodEnd, messagesUsed: 0 },
  });
  return { applied: 'immediately', plan: { key: plan.key, name: plan.name } };
}

// Billing-cycle reset (README §12.6). Finds ACTIVE subscriptions whose cycle
// has ended and either cancels them (cancelAtPeriodEnd) or rolls them
// forward one cycle, applying a scheduled plan change if one is pending.
// Each subscription is processed in its own transaction so one failure
// doesn't block the rest — callers (worker job, startup recovery) just log
// what failed. Idempotent: re-fetching inside the transaction and only
// advancing rows still due (currentPeriodEnd <= now, still ACTIVE) means a
// second run over the same data is a no-op.
export async function runBillingCycleSweep(now = new Date()) {
  const due = await prisma.subscription.findMany({
    where: { status: 'ACTIVE', currentPeriodEnd: { lte: now } },
  });

  let renewed = 0, cancelled = 0, failed = 0;
  for (const sub of due) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const fresh = await tx.subscription.findUnique({ where: { id: sub.id } });
        // Already processed by a concurrent/earlier run of this same sweep.
        if (!fresh || fresh.status !== 'ACTIVE' || fresh.currentPeriodEnd > now) return null;

        if (fresh.cancelAtPeriodEnd) {
          await tx.subscription.update({ where: { id: fresh.id }, data: { status: 'CANCELLED' } });
          // No separate suspension flag (README §12.4) — workspaceContext
          // already blocks access once Subscription.status is CANCELLED.
          return 'cancelled';
        }

        const cycleMs = fresh.currentPeriodEnd.getTime() - fresh.currentPeriodStart.getTime();
        const newPeriodStart = fresh.currentPeriodEnd;
        const newPeriodEnd = new Date(newPeriodStart.getTime() + (cycleMs > 0 ? cycleMs : 30 * 24 * 60 * 60 * 1000));

        await tx.subscription.update({
          where: { id: fresh.id },
          data: {
            planId: fresh.pendingPlanId || fresh.planId,
            pendingPlanId: null,
            currentPeriodStart: newPeriodStart,
            currentPeriodEnd: newPeriodEnd,
          },
        });

        // Quota resets on renewal — wallet balance is untouched, it's separate money.
        await tx.usageCounter.upsert({
          where: { workspaceId_periodStart: { workspaceId: fresh.workspaceId, periodStart: newPeriodStart } },
          update: {},
          create: { workspaceId: fresh.workspaceId, periodStart: newPeriodStart, periodEnd: newPeriodEnd, messagesUsed: 0 },
        });
        return 'renewed';
      });

      if (outcome === 'cancelled') cancelled++;
      else if (outcome === 'renewed') renewed++;
    } catch (err) {
      failed++;
      console.error(`[BillingCycle] Failed to process subscription ${sub.id}:`, err.message);
    }
  }

  return { processed: due.length, renewed, cancelled, failed };
}
