import { prisma } from '../lib/prisma.js';

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

// Debit the wallet for real usage. Returns { ok:false, reason } on insufficient
// funds rather than throwing, so callers can decide how to handle it.
export async function debit(workspaceId, amount, { reason = 'Usage', reference = null } = {}) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) { const e = new Error('amount must be a positive number'); e.status = 400; throw e; }

  return prisma.$transaction(async (tx) => {
    const ws = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { walletBalance: true } });
    if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
    const current = Number(ws.walletBalance);
    if (current < amt) return { ok: false, reason: 'Insufficient balance', balance: current };
    const newBalance = current - amt;
    await tx.workspace.update({ where: { id: workspaceId }, data: { walletBalance: newBalance } });
    const txn = await tx.walletTransaction.create({
      data: { workspaceId, amount: amt, type: 'DEBIT', reason, balanceAfter: newBalance, reference },
    });
    return { ok: true, balance: newBalance, transaction: serialize(txn) };
  });
}
