import { prisma } from '../lib/prisma.js';
import { getRazorpayClient, verifyPaymentSignature, normalizeRazorpayError } from '../lib/razorpay.js';
import { env } from '../config/env.js';

const MAX_RECHARGE = 100000;

// Server-authoritative wallet. Balance lives on Workspace.walletBalance and is
// only ever changed here, inside a transaction, alongside an immutable
// WalletTransaction ledger row. The client can never set a balance directly.

export async function getWallet(workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { walletBalance: true },
  });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  const transactions = await prisma.walletTransaction.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return { balance: Number(ws.walletBalance), transactions: transactions.map(serialize) };
}

function serialize(t) {
  return {
    id: t.id, amount: Number(t.amount), type: t.type, reason: t.reason,
    balanceAfter: Number(t.balanceAfter), reference: t.reference, createdAt: t.createdAt,
  };
}

// Credit the wallet. In production this is only ever called AFTER a payment
// gateway webhook has confirmed a real charge — never directly from a client
// "recharge" button. `reference` should be the gateway payment id.
export async function credit(workspaceId, amount, { reason = 'Wallet recharge', reference = null } = {}) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) { const e = new Error('amount must be a positive number'); e.status = 400; throw e; }

  return prisma.$transaction(async (tx) => {
    const ws = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { walletBalance: true } });
    if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
    const newBalance = Number(ws.walletBalance) + amt;
    await tx.workspace.update({ where: { id: workspaceId }, data: { walletBalance: newBalance } });
    const txn = await tx.walletTransaction.create({
      data: { workspaceId, amount: amt, type: 'CREDIT', reason, balanceAfter: newBalance, reference },
    });
    return { balance: newBalance, transaction: serialize(txn) };
  });
}

// Real Razorpay top-up (replaces the old demo-only recharge for the primary
// UI flow). The amount is validated server-side and stored in the order's
// notes — verifyTopupPayment() reads the *order's* amount back from Razorpay
// rather than trusting whatever the client sends at verify time.
export async function createTopupOrder(workspaceId, amount) {
  const amt = Number(amount);
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

  // Idempotency guard: a replayed verify call (network retry, double-click)
  // for the same Razorpay payment must not credit the wallet twice.
  const existing = await prisma.walletTransaction.findFirst({ where: { workspaceId, reference: paymentId } });
  if (existing) {
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { walletBalance: true } });
    return { balance: Number(ws.walletBalance), transaction: serialize(existing), alreadyProcessed: true };
  }

  const amt = Number(order.amount) / 100;
  const result = await credit(workspaceId, amt, { reason: 'Wallet recharge (Razorpay)', reference: paymentId });

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
  });

  return result;
}

async function runDebit(client, workspaceId, amt, reason, reference) {
  const ws = await client.workspace.findUnique({ where: { id: workspaceId }, select: { walletBalance: true } });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  const current = Number(ws.walletBalance);
  if (current < amt) return { ok: false, reason: 'Insufficient balance', balance: current };
  const newBalance = current - amt;
  await client.workspace.update({ where: { id: workspaceId }, data: { walletBalance: newBalance } });
  const txn = await client.walletTransaction.create({
    data: { workspaceId, amount: amt, type: 'DEBIT', reason, balanceAfter: newBalance, reference },
  });
  return { ok: true, balance: newBalance, transaction: serialize(txn) };
}

// Debit the wallet for real usage. Returns { ok:false, reason } on insufficient
// funds rather than throwing, so callers can decide how to handle it.
// Pass `tx` (a Prisma interactive-transaction client) to run this as part of a
// caller's existing transaction (e.g. subscription.service.js#consumeMessageCredit)
// instead of opening a new one.
export async function debit(workspaceId, amount, { reason = 'Usage', reference = null } = {}, tx = null) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) { const e = new Error('amount must be a positive number'); e.status = 400; throw e; }

  if (tx) return runDebit(tx, workspaceId, amt, reason, reference);
  return prisma.$transaction((client) => runDebit(client, workspaceId, amt, reason, reference));
}
