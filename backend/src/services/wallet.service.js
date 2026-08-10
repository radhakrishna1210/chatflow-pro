import { prisma } from '../lib/prisma.js';
import { getRazorpayClient, verifyPaymentSignature, normalizeRazorpayError } from '../lib/razorpay.js';
import { env } from '../config/env.js';

const MAX_RECHARGE = 100000;

// Server-authoritative wallet. Balance lives on Workspace.walletBalance and is
// only ever changed here, inside a transaction that takes a row lock on the
// workspace first, alongside an immutable WalletTransaction ledger row. The
// client can never set a balance directly.
//
// Three things make a double-charge impossible:
//   1. SELECT … FOR UPDATE serialises concurrent writers on the same wallet,
//      so two workers can't both read the same "before" balance.
//   2. Every ledger row records balanceBefore → balanceAfter, so the history
//      is self-checking.
//   3. Callers pass an idempotencyKey (payment id, campaign id). It has a
//      unique index, so a replayed callback/retry collides in the database
//      rather than relying on a read-then-write check that a race can slip
//      past.

// Rounds to paise. Floating-point drift on repeated credits/debits would
// otherwise leave balances like 407.99999999999994.
const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

// Prisma's default interactive-transaction budget is 5s, which is tight for
// this path: each balance change makes four round-trips (idempotency lookup,
// locking SELECT, balance update, ledger insert) and production runs against
// a pooled Postgres in another region. Blowing the budget aborts the
// transaction mid-flight (P2028), so the limits are explicit and generous —
// the row lock means a slow transaction blocks other writers to the same
// wallet, which is exactly the serialisation we want, not a reason to fail.
const TX_OPTS = { maxWait: 15_000, timeout: 30_000 };

// How much runway counts as "running low", expressed in messages rather than
// rupees: a workspace paying 0.85/message and one paying 2.20 do not run out
// at the same balance, so a flat threshold would warn one far too early and
// the other far too late.
export const LOW_BALANCE_MESSAGES = 100;

// Wallet health, derived here so every banner in the app agrees rather than
// each screen inventing its own idea of "low".
export function walletStatus(balance, costPerMessage) {
  const bal = Number(balance) || 0;
  const cost = Number(costPerMessage) || 0;
  // A zero/unknown per-message cost leaves nothing to scale by; fall back to a
  // bare "is there anything in it" rather than reporting a false LOW.
  const threshold = money(cost > 0 ? cost * LOW_BALANCE_MESSAGES : 0);
  if (bal <= 0) return { status: 'EMPTY', threshold, messagesRemaining: 0 };
  if (threshold > 0 && bal < threshold) {
    return { status: 'LOW', threshold, messagesRemaining: Math.floor(bal / cost) };
  }
  return { status: 'HEALTHY', threshold, messagesRemaining: cost > 0 ? Math.floor(bal / cost) : null };
}

export async function getWallet(workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { walletBalance: true, costPerMessage: true },
  });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  const transactions = await prisma.walletTransaction.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const balance = Number(ws.walletBalance);
  const costPerMessage = Number(ws.costPerMessage);
  const health = walletStatus(balance, costPerMessage);
  return {
    balance,
    costPerMessage,
    // HEALTHY | LOW | EMPTY, plus what the threshold actually was, so the UI
    // can explain the number instead of just asserting it.
    status: health.status,
    lowBalanceThreshold: health.threshold,
    messagesRemaining: health.messagesRemaining,
    transactions: transactions.map(serialize),
  };
}

function serialize(t) {
  return {
    id: t.id,
    workspaceId: t.workspaceId,
    amount: Number(t.amount),
    type: t.type,
    category: t.category,
    reason: t.reason,
    balanceBefore: t.balanceBefore == null ? null : Number(t.balanceBefore),
    balanceAfter: Number(t.balanceAfter),
    status: t.status,
    gateway: t.gateway,
    reference: t.reference,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

// Locks the workspace row for the rest of the surrounding transaction and
// returns the current balance. Every mutation below goes through this.
async function lockBalance(tx, workspaceId) {
  const rows = await tx.$queryRaw`
    SELECT "walletBalance" FROM "Workspace" WHERE "id" = ${workspaceId} FOR UPDATE
  `;
  if (!rows || rows.length === 0) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  return Number(rows[0].walletBalance);
}

// Returns the existing ledger row for an idempotency key, or null.
async function findByIdempotencyKey(client, idempotencyKey) {
  if (!idempotencyKey) return null;
  return client.walletTransaction.findUnique({ where: { idempotencyKey } });
}

async function runCredit(tx, workspaceId, amt, { reason, reference, category, gateway, idempotencyKey }) {
  const existing = await findByIdempotencyKey(tx, idempotencyKey);
  if (existing) {
    const ws = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { walletBalance: true } });
    return { balance: Number(ws.walletBalance), transaction: serialize(existing), alreadyProcessed: true };
  }

  const before = await lockBalance(tx, workspaceId);
  const after = money(before + amt);
  await tx.workspace.update({ where: { id: workspaceId }, data: { walletBalance: after } });
  const txn = await tx.walletTransaction.create({
    data: {
      workspaceId, amount: amt, type: 'CREDIT', category, reason,
      balanceBefore: before, balanceAfter: after, status: 'SUCCESS',
      gateway, reference, idempotencyKey,
    },
  });
  return { balance: after, transaction: serialize(txn), alreadyProcessed: false };
}

// Credit the wallet. In production this is only ever called AFTER a payment
// gateway webhook has confirmed a real charge — never directly from a client
// "recharge" button. `reference` should be the gateway payment id.
export async function credit(workspaceId, amount, {
  reason = 'Wallet recharge', reference = null, category = 'RECHARGE',
  gateway = null, idempotencyKey = null,
} = {}, tx = null) {
  const amt = money(amount);
  if (!Number.isFinite(amt) || amt <= 0) { const e = new Error('amount must be a positive number'); e.status = 400; throw e; }

  const opts = { reason, reference, category, gateway, idempotencyKey };
  try {
    if (tx) return await runCredit(tx, workspaceId, amt, opts);
    return await prisma.$transaction((client) => runCredit(client, workspaceId, amt, opts), TX_OPTS);
  } catch (err) {
    // Lost the race against a concurrent request carrying the same key — the
    // other one succeeded, so converge on its result instead of erroring.
    if (err.code === 'P2002' && idempotencyKey) {
      const existing = await findByIdempotencyKey(prisma, idempotencyKey);
      const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { walletBalance: true } });
      if (existing) return { balance: Number(ws.walletBalance), transaction: serialize(existing), alreadyProcessed: true };
    }
    throw err;
  }
}

async function runDebit(tx, workspaceId, amt, { reason, reference, category, idempotencyKey }) {
  const existing = await findByIdempotencyKey(tx, idempotencyKey);
  if (existing) {
    const ws = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { walletBalance: true } });
    return { ok: true, balance: Number(ws.walletBalance), transaction: serialize(existing), alreadyProcessed: true };
  }

  const before = await lockBalance(tx, workspaceId);
  // Never let a wallet go negative, whatever the caller asks for.
  if (before < amt) return { ok: false, reason: 'Insufficient balance', balance: before, required: amt };

  const after = money(before - amt);
  await tx.workspace.update({ where: { id: workspaceId }, data: { walletBalance: after } });
  const txn = await tx.walletTransaction.create({
    data: {
      workspaceId, amount: amt, type: 'DEBIT', category, reason,
      balanceBefore: before, balanceAfter: after, status: 'SUCCESS',
      gateway: 'system', reference, idempotencyKey,
    },
  });
  return { ok: true, balance: after, transaction: serialize(txn), alreadyProcessed: false };
}

// Debit the wallet for real usage. Returns { ok:false, reason } on insufficient
// funds rather than throwing, so callers can decide how to handle it.
// Pass `tx` (a Prisma interactive-transaction client) to run this as part of a
// caller's existing transaction (e.g. subscription.service.js#consumeMessageCredit)
// instead of opening a new one.
export async function debit(workspaceId, amount, {
  reason = 'Usage', reference = null, category = 'USAGE', idempotencyKey = null,
} = {}, tx = null) {
  const amt = money(amount);
  if (!Number.isFinite(amt) || amt <= 0) { const e = new Error('amount must be a positive number'); e.status = 400; throw e; }

  const opts = { reason, reference, category, idempotencyKey };
  try {
    if (tx) return await runDebit(tx, workspaceId, amt, opts);
    return await prisma.$transaction((client) => runDebit(client, workspaceId, amt, opts), TX_OPTS);
  } catch (err) {
    if (err.code === 'P2002' && idempotencyKey) {
      const existing = await findByIdempotencyKey(prisma, idempotencyKey);
      const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { walletBalance: true } });
      if (existing) return { ok: true, balance: Number(ws.walletBalance), transaction: serialize(existing), alreadyProcessed: true };
    }
    throw err;
  }
}

// Real Razorpay top-up (replaces the old demo-only recharge for the primary
// UI flow). The amount is validated server-side and stored in the order's
// notes — verifyTopupPayment() reads the *order's* amount back from Razorpay
// rather than trusting whatever the client sends at verify time.
export async function createTopupOrder(workspaceId, amount) {
  const amt = money(amount);
  if (!Number.isFinite(amt) || amt <= 0) { const e = new Error('amount must be a positive number'); e.status = 400; throw e; }
  if (amt > MAX_RECHARGE) { const e = new Error(`Recharge is limited to ${MAX_RECHARGE} per transaction`); e.status = 400; throw e; }

  const client = getRazorpayClient();
  const order = await client.orders.create({
    amount: Math.round(amt * 100),
    currency: 'INR',
    receipt: `wtop_${workspaceId.slice(-12)}_${Date.now().toString(36)}`,
    notes: { workspaceId, type: 'wallet_topup' },
  }).catch(normalizeRazorpayError);

  return { orderId: order.id, amount: order.amount, currency: order.currency, keyId: env.RAZORPAY_KEY_ID };
}

// Verifies the payment signature, reads the order back from Razorpay (never
// trusting a client-supplied amount), and credits the wallet.
export async function verifyTopupPayment(workspaceId, { orderId, paymentId, signature } = {}) {
  if (!orderId || !paymentId || !signature) {
    const e = new Error('orderId, paymentId and signature are required'); e.status = 400; throw e;
  }
  if (!verifyPaymentSignature({ orderId, paymentId, signature })) {
    const e = new Error('Payment signature verification failed'); e.status = 400; throw e;
  }

  const client = getRazorpayClient();
  const order = await client.orders.fetch(orderId).catch(normalizeRazorpayError);
  if (order.notes?.workspaceId !== workspaceId || order.notes?.type !== 'wallet_topup') {
    const e = new Error('This payment does not belong to your workspace'); e.status = 403; throw e;
  }

  const amt = money(Number(order.amount) / 100);
  // Idempotency is enforced by the unique key rather than a pre-check, so a
  // duplicate gateway callback, a network retry and a double-clicked verify
  // all converge on the one original credit.
  const result = await credit(workspaceId, amt, {
    reason: 'Wallet recharge (Razorpay)',
    reference: paymentId,
    category: 'RECHARGE',
    gateway: 'razorpay',
    idempotencyKey: `rzp_topup_${paymentId}`,
  });

  if (!result.alreadyProcessed) {
    await prisma.invoice.create({
      data: {
        workspaceId,
        invoiceDate: new Date(),
        description: 'Wallet recharge',
        amount: amt,
        currency: order.currency,
        status: 'PAID',
        reference: paymentId,
      },
    }).catch(() => {});
  }

  return result;
}

// Powers the dashboard's spend cards (README Part 5). One pass over the
// ledger rather than five round trips.
export async function getWalletSummary(workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { walletBalance: true, costPerMessage: true },
  });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [todaySpend, campaignSpend, totalSpend, lastRecharge, rechargeTotal, campaignStats] = await Promise.all([
    prisma.walletTransaction.aggregate({
      _sum: { amount: true },
      where: { workspaceId, type: 'DEBIT', createdAt: { gte: startOfToday } },
    }),
    prisma.walletTransaction.aggregate({
      _sum: { amount: true },
      where: { workspaceId, type: 'DEBIT', category: 'CAMPAIGN' },
    }),
    prisma.walletTransaction.aggregate({
      _sum: { amount: true },
      where: { workspaceId, type: 'DEBIT' },
    }),
    prisma.walletTransaction.findFirst({
      where: { workspaceId, type: 'CREDIT', category: 'RECHARGE' },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.walletTransaction.aggregate({
      _sum: { amount: true },
      where: { workspaceId, type: 'CREDIT', category: 'RECHARGE' },
    }),
    prisma.campaign.aggregate({
      _count: { _all: true },
      _sum: { totalCost: true },
      where: { workspaceId },
    }),
  ]);

  // Refunds are credits, so subtract them from gross campaign spend to get
  // what campaigns actually cost.
  const refunds = await prisma.walletTransaction.aggregate({
    _sum: { amount: true },
    where: { workspaceId, type: 'CREDIT', category: 'REFUND' },
  });

  const totalCampaigns = campaignStats._count._all || 0;
  const netCampaignSpend = money(Number(campaignSpend._sum.amount || 0) - Number(refunds._sum.amount || 0));

  const summaryHealth = walletStatus(ws.walletBalance, ws.costPerMessage);

  return {
    balance: Number(ws.walletBalance),
    costPerMessage: Number(ws.costPerMessage),
    // Same derivation as getWallet, so the dashboard card and the banner can
    // never disagree about whether the wallet is low.
    status: summaryHealth.status,
    lowBalanceThreshold: summaryHealth.threshold,
    messagesRemaining: summaryHealth.messagesRemaining,
    todaySpend: money(todaySpend._sum.amount || 0),
    campaignSpend: netCampaignSpend,
    totalSpend: money(totalSpend._sum.amount || 0),
    totalRecharged: money(rechargeTotal._sum.amount || 0),
    lastRecharge: lastRecharge
      ? { amount: Number(lastRecharge.amount), at: lastRecharge.createdAt, gateway: lastRecharge.gateway }
      : null,
    totalCampaigns,
    averageCostPerCampaign: totalCampaigns > 0 ? money(netCampaignSpend / totalCampaigns) : 0,
  };
}
