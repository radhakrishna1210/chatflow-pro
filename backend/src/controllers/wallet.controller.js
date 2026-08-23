import * as walletService from '../services/wallet.service.js';
import { notifyWorkspace } from '../services/notification.service.js';

export async function getWallet(req, res) {
  const wallet = await walletService.getWallet(req.params.workspaceId);
  res.json(wallet);
}

// Dashboard spend cards: balance, today's spend, campaign spend, last
// recharge, campaign count and average cost per campaign.
export async function getSummary(req, res) {
  const summary = await walletService.getWalletSummary(req.params.workspaceId);
  res.json(summary);
}

// Demo/manual recharge — server-authoritative. NOTE: this is not a real payment.
// In production, replace with a gateway checkout + webhook that calls
// walletService.credit() only after the charge is confirmed. It is ADMIN-only
// and bounded so it can't be used to mint arbitrary balance from the client.
export async function recharge(req, res) {
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'amount must be a positive number' });
  if (amount > 100000) return res.status(400).json({ error: 'Demo recharge is limited to 100000 per transaction' });

  // A client-supplied Idempotency-Key makes a retried/double-clicked recharge
  // credit the wallet exactly once.
  const key = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  const reference = key || `demo_${Date.now()}`;

  const result = await walletService.credit(req.params.workspaceId, amount, {
    reason: 'Manual recharge (demo)',
    reference,
    category: 'RECHARGE',
    gateway: 'manual',
    idempotencyKey: key ? `manual_${key}` : null,
  });

  if (!result.alreadyProcessed) {
    notifyWorkspace(req.params.workspaceId, {
      type: 'WALLET_RECHARGE',
      title: 'Wallet recharged',
      body: `₹${Number(amount).toFixed(2)} was added to your wallet. New balance: ₹${Number(result.balance).toFixed(2)}.`,
      link: 'payments',
    }).catch(() => {});
  }

  res.json({ ...result, demo: true });
}

// Real Razorpay top-up flow (test mode) — the primary path the frontend uses now.
export async function createCheckout(req, res) {
  const order = await walletService.createTopupOrder(req.params.workspaceId, req.body?.amount);
  res.json(order);
}

export async function verifyCheckout(req, res) {
  const result = await walletService.verifyTopupPayment(req.params.workspaceId, req.body);

  if (!result.alreadyProcessed) {
    notifyWorkspace(req.params.workspaceId, {
      type: 'WALLET_RECHARGE',
      title: 'Wallet recharged',
      body: `₹${Number(result.transaction.amount).toFixed(2)} was added to your wallet. New balance: ₹${Number(result.balance).toFixed(2)}.`,
      link: 'payments',
    }).catch(() => {});
  }

  res.json(result);
}
