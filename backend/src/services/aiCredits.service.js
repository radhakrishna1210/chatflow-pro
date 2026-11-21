import { prisma } from '../lib/prisma.js';
import { debit } from './wallet.service.js';

// AI credits: what a workspace pays for work the model does on its behalf
// (today the onboarding agent).
//
// The model is the same two layers as message credits
// (subscription.service.js#consumeMessageCredit): a plan includes a number of
// credits each billing cycle, and once those are used each further credit is
// bought from the wallet at the plan's aiCreditRate. Recharging the wallet is
// therefore how credits are topped up; there is no separate credit balance to
// keep in step with it.
//
// Credits are charged on what a call actually used, after it returns: a long
// answer costs more than a short one, and a call that failed before the model
// answered costs nothing.

// One credit per this many tokens (prompt + answer), rounded up, minimum one.
export const TOKENS_PER_CREDIT = 1000;

export function creditsForUsage({ inputTokens = 0, outputTokens = 0 } = {}) {
  const tokens = Math.max(0, Number(inputTokens) || 0) + Math.max(0, Number(outputTokens) || 0);
  return Math.max(1, Math.ceil(tokens / TOKENS_PER_CREDIT));
}

// How `credits` splits between the plan's remaining allowance and the wallet.
// Pure, so the arithmetic that decides what a customer is charged is tested
// without a database. Whatever neither can cover is `unpaid`.
export function splitCharge({ credits, included, used, rate, walletBalance }) {
  const left = Math.max(0, (Number(included) || 0) - (Number(used) || 0));
  const fromPlan = Math.min(credits, left);
  const wanted = credits - fromPlan;
  const price = Number(rate) || 0;
  const affordable = price > 0 ? Math.floor((Number(walletBalance) || 0) / price + 1e-9) : 0;
  const fromWallet = Math.min(wanted, affordable);
  const walletAmount = Math.round(fromWallet * price * 100) / 100;
  return { fromPlan, fromWallet, walletAmount, unpaid: wanted - fromWallet };
}

async function loadBilling(client, workspaceId) {
  const subscription = await client.subscription.findUnique({ where: { workspaceId }, include: { plan: true } });
  if (!subscription) { const e = new Error('Subscription not found'); e.status = 404; throw e; }
  // ON CONFLICT DO NOTHING, so the first calls of a new billing period racing
  // each other cannot fail on the unique key.
  await client.usageCounter.createMany({
    data: [{ workspaceId, periodStart: subscription.currentPeriodStart, periodEnd: subscription.currentPeriodEnd, messagesUsed: 0 }],
    skipDuplicates: true,
  });
  return subscription;
}

// What the workspace has to spend right now.
export async function getAiCredits(workspaceId) {
  const subscription = await loadBilling(prisma, workspaceId);
  const [usage, workspace] = await Promise.all([
    prisma.usageCounter.findUnique({
      where: { workspaceId_periodStart: { workspaceId, periodStart: subscription.currentPeriodStart } },
      select: { aiCreditsUsed: true },
    }),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { walletBalance: true } }),
  ]);
  const included = subscription.plan.aiCreditsMonthly || 0;
  const used = usage?.aiCreditsUsed || 0;
  const rate = Number(subscription.plan.aiCreditRate) || 0;
  const walletBalance = Number(workspace?.walletBalance) || 0;
  const remaining = Math.max(0, included - used);
  const buyable = rate > 0 ? Math.floor(walletBalance / rate + 1e-9) : 0;
  return {
    plan: subscription.plan.name,
    included,
    used,
    remaining,
    rate,
    walletBalance,
    buyable,
    available: remaining + buyable,
    renewsAt: subscription.currentPeriodEnd,
    tokensPerCredit: TOKENS_PER_CREDIT,
  };
}

// Refuses before the model is called when there is nothing to pay with, so a
// workspace with no credits cannot run up usage it will never be charged for.
export async function assertAiCredits(workspaceId, needed = 1) {
  const credits = await getAiCredits(workspaceId);
  if (credits.available >= needed) return credits;
  const e = new Error(credits.rate > 0
    ? 'You are out of AI credits. Recharge your wallet or upgrade your plan to keep using the assistant.'
    : 'You are out of AI credits for this billing period. Upgrade your plan to keep using the assistant.');
  e.status = 402;
  e.code = 'AI_CREDITS_EXHAUSTED';
  throw e;
}

/**
 * Charges one model call. `usage` is { inputTokens, outputTokens, model } as
 * lib/llm.js#llmJsonMetered reports it.
 *
 * Returns { credits, fromPlan, fromWallet, walletAmount, unpaid }. A call that
 * turned out larger than the workspace could cover is charged as far as the
 * allowance and the wallet go and the rest recorded as unpaid, rather than
 * discarding an answer the model has already produced.
 */
export async function chargeAiCredits(workspaceId, usage, { userId = null, feature, reference = null } = {}) {
  const credits = creditsForUsage(usage);

  return prisma.$transaction(async (tx) => {
    const subscription = await loadBilling(tx, workspaceId);
    const { plan, currentPeriodStart } = subscription;

    // Row lock, so two calls finishing together cannot both spend the same
    // remaining allowance.
    const rows = await tx.$queryRaw`
      SELECT "aiCreditsUsed" FROM "UsageCounter"
      WHERE "workspaceId" = ${workspaceId} AND "periodStart" = ${currentPeriodStart}
      FOR UPDATE
    `;
    const used = Number(rows?.[0]?.aiCreditsUsed) || 0;
    const workspace = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { walletBalance: true } });

    const split = splitCharge({
      credits,
      included: plan.aiCreditsMonthly,
      used,
      rate: plan.aiCreditRate,
      walletBalance: workspace?.walletBalance,
    });

    if (split.fromPlan > 0) {
      await tx.usageCounter.update({
        where: { workspaceId_periodStart: { workspaceId, periodStart: currentPeriodStart } },
        data: { aiCreditsUsed: { increment: split.fromPlan } },
      });
    }

    if (split.fromWallet > 0 && split.walletAmount > 0) {
      const paid = await debit(workspaceId, split.walletAmount, {
        reason: `AI credits (${split.fromWallet})`,
        category: 'AI',
        reference,
      }, tx);
      // The balance was read before the wallet row was locked; if something
      // else spent it in between, the credits simply go unpaid.
      if (!paid.ok) {
        split.unpaid += split.fromWallet;
        split.fromWallet = 0;
        split.walletAmount = 0;
      }
    }

    await tx.aiCreditUsage.create({
      data: {
        workspaceId,
        userId,
        feature: String(feature || 'ai').slice(0, 60),
        reference,
        model: usage?.model ? String(usage.model).slice(0, 80) : null,
        inputTokens: Number(usage?.inputTokens) || 0,
        outputTokens: Number(usage?.outputTokens) || 0,
        credits,
        fromPlan: split.fromPlan,
        fromWallet: split.fromWallet,
        walletAmount: split.walletAmount,
      },
    });

    return { credits, ...split };
    // Same budget as wallet.service.js: this can wait on the wallet row lock
    // against a pooled remote database.
  }, { maxWait: 15_000, timeout: 30_000 });
}

export async function listAiCreditUsage(workspaceId, { limit = 50 } = {}) {
  const rows = await prisma.aiCreditUsage.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(Number(limit) || 50, 1), 200),
  });
  return rows.map((r) => ({ ...r, walletAmount: Number(r.walletAmount) }));
}
