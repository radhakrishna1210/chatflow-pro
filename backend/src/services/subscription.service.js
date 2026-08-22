import { prisma } from '../lib/prisma.js';
import { debit, credit } from './wallet.service.js';
import { overageRateFor } from '../lib/messagePricing.js';
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
//
// `prepaid: true` means the wallet was already charged up front for this
// message (campaigns pay their whole cost at launch). Such a send still meters
// quota, but must never touch the wallet again — that would double-charge —
// and must never be refused for an exhausted balance the customer already paid.
//
// `messageCategory` is the template's category (MARKETING / UTILITY /
// AUTHENTICATION). Overage is billed at that category's rate, so an
// over-quota send costs what the message actually costs. Omit it for a send
// that carries no template — an inbox reply — and the plan's flat
// overageRatePerMsg is used instead.
export async function consumeMessageCredit(workspaceId, { reason = 'Message send', prepaid = false, messageCategory = null } = {}) {
  return prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.findUnique({ where: { workspaceId }, include: { plan: true } });
    if (!subscription) { const e = new Error('Subscription not found'); e.status = 404; throw e; }
    // PAST_DUE still sends. It means a renewal charge failed and the grace
    // window is running, and the whole point of that window is that the
    // workspace keeps working while the customer tops up — matching
    // workspaceContext, which also blocks only CANCELLED and EXPIRED. Refusing
    // here would have made the grace period cosmetic: access to the screens,
    // but no messages.
    if (!['ACTIVE', 'PAST_DUE'].includes(subscription.status)) {
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

    // Quota exhausted. A prepaid message is already paid for, so it just
    // records the usage and goes out.
    if (prepaid) {
      await tx.usageCounter.update({ where: periodKey, data: { messagesUsed: { increment: 1 } } });
      return { ok: true, source: 'PREPAID' };
    }

    // Otherwise overflow to the wallet, priced by the message's category so
    // the charge tracks what the send actually costs. `amount` is returned so
    // releaseMessageCredit can give back exactly what was taken.
    const amount = overageRateFor(plan, messageCategory);
    const result = await debit(workspaceId, amount, { reason, category: 'USAGE' }, tx);
    if (!result.ok) return { ok: false, code: 'QUOTA_AND_WALLET_EXHAUSTED' };
    return { ok: true, source: 'WALLET', newBalance: result.balance, amount };
    // Same reasoning as wallet.service.js#TX_OPTS: this runs once per campaign
    // message and can take a row lock on the wallet, so it needs more than
    // Prisma's default 5s budget against a pooled remote database.
  }, { maxWait: 15_000, timeout: 30_000 });
}

// Gives back a credit taken by consumeMessageCredit() when the send it was
// taken for never happened. The credit is claimed *before* handing the
// message to Meta (it has to be — the quota check is what authorises the
// send), so a rejected send would otherwise permanently burn a message from
// the customer's monthly allowance for a message nobody ever received.
//
// `source` is the value consumeMessageCredit returned: QUOTA and PREPAID both
// incremented the usage counter, WALLET did not (it debited the overage rate
// instead) and so is refunded in money rather than in quota.
export async function releaseMessageCredit(workspaceId, { source, amount: charged = null, messageCategory = null, reason = 'Refund for failed message send' } = {}) {
  if (!source) return { released: false };

  if (source === 'WALLET') {
    const subscription = await prisma.subscription.findUnique({
      where: { workspaceId }, include: { plan: true },
    });
    if (!subscription) return { released: false };
    // Prefer the exact figure consumeMessageCredit reported. Re-deriving it
    // would refund the wrong amount if the plan's rates changed in between.
    const amount = charged != null && Number.isFinite(Number(charged))
      ? Number(charged)
      : overageRateFor(subscription.plan, messageCategory);
    if (!(amount > 0)) return { released: false };
    const result = await credit(workspaceId, amount, { reason, category: 'REFUND', gateway: 'system' })
      .catch((err) => { console.error(`[Subscription] Overage refund failed for ${workspaceId}:`, err.message); return null; });
    return { released: !!result, source, amount };
  }

  const subscription = await prisma.subscription.findUnique({ where: { workspaceId } });
  if (!subscription) return { released: false };
  // Guarded at 0 so a double release (a retry that also fails, a replayed
  // webhook) can never drive usage negative and hand out free quota.
  const decremented = await prisma.usageCounter.updateMany({
    where: { workspaceId, periodStart: subscription.currentPeriodStart, messagesUsed: { gt: 0 } },
    data: { messagesUsed: { decrement: 1 } },
  });
  return { released: decremented.count > 0, source };
}

// `memberLimit` counts *teammates*, not seats: the workspace owner does not
// consume one. Counting the owner made a Free plan (memberLimit 1) reject the
// very first invite with "your plan allows up to 1 members" while the admin
// was the only person in the workspace — the plan was full before anyone had
// been invited. Pending invitations count, so a plan can't be oversubscribed
// by sending N invites and having them all accepted.
const OWNER_SEAT = 1;

// `ignoreInvitationId` excludes the invitation currently being accepted: it is
// still PENDING at check time, and the member row it becomes must not be
// counted twice.
async function countTeamSeats(workspaceId, { ignoreInvitationId = null } = {}) {
  const [members, pendingInvites] = await Promise.all([
    prisma.workspaceMember.count({ where: { workspaceId } }),
    prisma.invitation.count({
      where: {
        workspaceId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
        ...(ignoreInvitationId ? { id: { not: ignoreInvitationId } } : {}),
      },
    }),
  ]);
  return Math.max(0, members - OWNER_SEAT) + pendingInvites;
}

const LIMIT_KINDS = {
  contact: { field: 'contactLimit', label: 'contacts', count: (workspaceId) => prisma.contact.count({ where: { workspaceId } }) },
  member: { field: 'memberLimit', label: 'team members (the workspace owner is not counted)', count: countTeamSeats },
  apiKey: { field: 'apiKeyLimit', label: 'API keys', count: (workspaceId) => prisma.apiKey.count({ where: { workspaceId, revokedAt: null } }) },
  campaign: { field: 'campaignLimit', label: 'campaigns', count: (workspaceId) => prisma.campaign.count({ where: { workspaceId } }) },
};

// README §12.4 plan-limit checks (contacts, members, API keys). `additional`
// lets a caller check a batch (e.g. a CSV import adding N new contacts) in one
// call instead of looping. A null/undefined plan limit means unlimited.
export async function assertWithinLimit(workspaceId, kind, { additional = 1, message, ...countOptions } = {}) {
  const config = LIMIT_KINDS[kind];
  if (!config) throw new Error(`Unknown limit kind: ${kind}`);

  const { plan } = await getActiveSubscription(workspaceId);
  const limit = plan[config.field];
  if (limit === null || limit === undefined) return;

  const count = await config.count(workspaceId, countOptions);
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
export async function createCheckoutOrder(workspaceId, planId, cycle = 'monthly') {
  const plan = await prisma.plan.findFirst({ where: { id: planId, isActive: true } });
  if (!plan) { const e = new Error('Plan not found'); e.status = 404; throw e; }

  const billingCycle = cycle === 'quarterly' ? 'quarterly' : 'monthly';
  if (billingCycle === 'quarterly' && plan.priceQuarterly == null) {
    const e = new Error('This plan is not sold on a quarterly cycle'); e.status = 400; throw e;
  }
  const price = billingCycle === 'quarterly' ? plan.priceQuarterly : plan.priceMonthly;

  const amountPaise = Math.round(Number(price) * 100);
  if (amountPaise <= 0) { const e = new Error("This plan is free — there's nothing to check out"); e.status = 400; throw e; }

  const client = getRazorpayClient();
  const order = await client.orders.create({
    amount: amountPaise,
    currency: 'INR',
    // Razorpay caps `receipt` at 40 chars — a full cuid workspaceId + a
    // millisecond timestamp would overflow it, so truncate and base36 the
    // timestamp. Not used for lookups (that's what `notes` is for below).
    receipt: `sub_${workspaceId.slice(-12)}_${Date.now().toString(36)}`,
    // `cycle` rides along so verifyCheckoutPayment sets a period length that
    // matches what was actually paid for, rather than trusting the client.
    notes: { workspaceId, planId: plan.id, cycle: billingCycle },
  }).catch(normalizeRazorpayError);

  return {
    orderId: order.id, amount: order.amount, currency: order.currency, keyId: env.RAZORPAY_KEY_ID,
    cycle: billingCycle,
    plan: {
      id: plan.id, key: plan.key, name: plan.name,
      priceMonthly: plan.priceMonthly, priceQuarterly: plan.priceQuarterly,
    },
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
      description: `${plan.name} plan subscription (${order.notes?.cycle === 'quarterly' ? 'quarterly' : 'monthly'})`,
      amount: Number(order.amount) / 100,
      currency: order.currency,
      status: 'PAID',
      reference: paymentId,
    },
  });

  // Cycle length comes from the order's own notes, so a quarterly purchase
  // gets a 90-day period. runBillingCycleSweep() rolls forward by whatever
  // this period's length is, so quarterly renewals stay quarterly.
  const cycleDays = order.notes?.cycle === 'quarterly' ? 90 : 30;
  const periodStart = new Date();
  const periodEnd = new Date(periodStart.getTime() + cycleDays * 24 * 60 * 60 * 1000);
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
// Amounts inside notification copy, in the wallet's currency. Written out here
// because these strings are read by a person deciding whether to top up, and
// "1500" and "₹1,500.00" are not equally clear at that moment.
const formatMoney = (value) => `₹${Number(value || 0).toLocaleString('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

// How long a workspace keeps working after a renewal charge fails.
//
// PAST_DUE is deliberately not blocked by workspaceContext (only CANCELLED and
// EXPIRED are), so this window is real access rather than a warning banner. It
// exists so a customer whose wallet ran dry over a weekend can top up before
// their campaigns and inbox go dark.
const RENEWAL_GRACE_DAYS = 3;

// A period of roughly three months is a quarterly subscription. Compared
// loosely because month lengths vary: Jan 31 → Apr 30 is 89 days, Mar → Jun 92.
const QUARTERLY_MIN_DAYS = 80;

// What this subscription owes for its next period, and which cycle it is on.
function renewalCharge(subscription, plan) {
  const cycleMs = subscription.currentPeriodEnd.getTime() - subscription.currentPeriodStart.getTime();
  const cycleDays = Math.round(cycleMs / 86_400_000);
  const quarterly = cycleDays >= QUARTERLY_MIN_DAYS && plan.priceQuarterly != null;
  const amount = Number(quarterly ? plan.priceQuarterly : plan.priceMonthly) || 0;
  return {
    amount,
    cycleDays,
    cycle: quarterly ? 'quarterly' : 'monthly',
    // Guards a malformed row with a zero-length cycle, which would otherwise
    // roll the period to exactly where it already is and be swept forever.
    cycleMs: cycleMs > 0 ? cycleMs : 30 * 86_400_000,
  };
}

export async function runBillingCycleSweep(now = new Date()) {
  // PAST_DUE is included so a failed charge is retried on the next sweep. This
  // selected ACTIVE only, which — once renewal can fail at all — would leave a
  // past-due subscription never looked at again: neither charged nor expired.
  const due = await prisma.subscription.findMany({
    where: { status: { in: ['ACTIVE', 'PAST_DUE'] }, currentPeriodEnd: { lte: now } },
    include: { plan: true, pendingPlan: true },
  });

  let renewed = 0, cancelled = 0, failed = 0, pastDue = 0, expired = 0, charged = 0;
  // Side effects that must not run inside a transaction, and must not happen at
  // all if one rolls back.
  const announcements = [];

  for (const sub of due) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const fresh = await tx.subscription.findUnique({ where: { id: sub.id } });
        // Already handled by a concurrent or earlier run of this same sweep.
        if (!fresh || !['ACTIVE', 'PAST_DUE'].includes(fresh.status) || fresh.currentPeriodEnd > now) return null;

        if (fresh.cancelAtPeriodEnd) {
          await tx.subscription.update({ where: { id: fresh.id }, data: { status: 'CANCELLED' } });
          // No separate suspension flag (README 12.4) — workspaceContext blocks
          // access once Subscription.status is CANCELLED.
          return { kind: 'cancelled' };
        }

        // A scheduled plan change takes effect at rollover, so the period about
        // to begin is billed at the plan it will actually be on.
        const effectivePlan = sub.pendingPlan ?? sub.plan;
        const { amount, cycle, cycleMs } = renewalCharge(fresh, effectivePlan);
        const newPeriodStart = fresh.currentPeriodEnd;
        const newPeriodEnd = new Date(newPeriodStart.getTime() + cycleMs);

        const rollForward = async () => {
          await tx.subscription.update({
            where: { id: fresh.id },
            data: {
              planId: fresh.pendingPlanId || fresh.planId,
              pendingPlanId: null,
              status: 'ACTIVE',
              currentPeriodStart: newPeriodStart,
              currentPeriodEnd: newPeriodEnd,
            },
          });
          // Quota resets on renewal. Wallet balance is separate money and is
          // only moved by the charge above.
          await tx.usageCounter.upsert({
            where: { workspaceId_periodStart: { workspaceId: fresh.workspaceId, periodStart: newPeriodStart } },
            update: {},
            create: { workspaceId: fresh.workspaceId, periodStart: newPeriodStart, periodEnd: newPeriodEnd, messagesUsed: 0 },
          });
        };

        // Free plans have nothing to collect.
        if (amount <= 0) {
          await rollForward();
          return { kind: 'renewed', amount: 0 };
        }

        // The renewal charge itself. This is what the sweep never did — it
        // rolled the period forward and reset the quota while collecting
        // nothing, so a workspace paid once for a paid plan and then held it
        // indefinitely for free.
        //
        // The key names the period being paid for rather than the run, so
        // tomorrow's retry of the same overdue period reuses it and nobody is
        // charged twice for one month.
        const charge = await debit(fresh.workspaceId, amount, {
          reason: `${effectivePlan.name} subscription (${cycle})`,
          reference: fresh.id,
          category: 'SUBSCRIPTION',
          idempotencyKey: `sub_renew_${fresh.id}_${newPeriodStart.getTime()}`,
        }, tx);

        if (!charge.ok) {
          // Out of money. The period end stays where it is: it is what the
          // grace window is measured from, and it is the period nobody has
          // paid for.
          const graceEndsAt = new Date(fresh.currentPeriodEnd.getTime() + RENEWAL_GRACE_DAYS * 86_400_000);
          if (now > graceEndsAt) {
            await tx.subscription.update({ where: { id: fresh.id }, data: { status: 'EXPIRED' } });
            return { kind: 'expired', amount, balance: charge.balance, graceEndsAt };
          }
          await tx.subscription.update({ where: { id: fresh.id }, data: { status: 'PAST_DUE' } });
          return { kind: 'past_due', amount, balance: charge.balance, graceEndsAt };
        }

        // Paid. The invoice is written in the same transaction as the debit, so
        // the ledger and the invoice list can never disagree.
        if (!charge.alreadyProcessed) {
          await tx.invoice.create({
            data: {
              workspaceId: fresh.workspaceId,
              invoiceDate: now,
              description: `${effectivePlan.name} plan, ${cycle} renewal`,
              amount,
              currency: effectivePlan.currency || 'INR',
              status: 'PAID',
              reference: `sub_renew_${fresh.id}_${newPeriodStart.getTime()}`,
            },
          });
        }

        await rollForward();
        return { kind: 'renewed', amount, balance: charge.balance };
      });

      if (!outcome) continue;

      if (outcome.kind === 'cancelled') {
        cancelled += 1;
      } else if (outcome.kind === 'renewed') {
        renewed += 1;
        charged += outcome.amount;
      } else if (outcome.kind === 'past_due') {
        pastDue += 1;
        announcements.push({
          workspaceId: sub.workspaceId,
          type: 'SUBSCRIPTION_PAST_DUE',
          title: 'Your subscription could not be renewed',
          body: `We could not collect ${formatMoney(outcome.amount)} for your plan; the wallet balance is `
            + `${formatMoney(outcome.balance ?? 0)}. Top up before `
            + `${outcome.graceEndsAt.toLocaleDateString('en-IN')} to keep the workspace running.`,
          link: 'payments',
          meta: { amount: outcome.amount, graceEndsAt: outcome.graceEndsAt },
        });
      } else if (outcome.kind === 'expired') {
        expired += 1;
        announcements.push({
          workspaceId: sub.workspaceId,
          type: 'SUBSCRIPTION_EXPIRED',
          title: 'Your subscription has expired',
          body: `The renewal charge of ${formatMoney(outcome.amount)} could not be collected within the grace `
            + 'period. Top up your wallet and renew from the Payments screen to restore access.',
          link: 'payments',
          meta: { amount: outcome.amount },
        });
      }
    } catch (err) {
      failed++;
      console.error(`[BillingCycle] Failed to process subscription ${sub.id}:`, err.message);
    }
  }

  // Outside the transactions, and never fatal: a notification that could not be
  // written must not undo a charge that succeeded.
  if (announcements.length > 0) {
    const { notifyWorkspace } = await import('./notification.service.js');
    await Promise.allSettled(announcements.map(({ workspaceId, ...note }) => notifyWorkspace(workspaceId, note)));
  }

  return { processed: due.length, renewed, cancelled, failed, pastDue, expired, charged };
}
