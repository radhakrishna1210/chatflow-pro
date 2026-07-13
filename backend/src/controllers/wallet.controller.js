import * as walletService from '../services/wallet.service.js';

export async function getWallet(req, res) {
  const wallet = await walletService.getWallet(req.params.workspaceId);
  res.json(wallet);
}

// Demo/manual recharge — server-authoritative. NOTE: this is not a real payment.
// In production, replace with a gateway checkout + webhook that calls
// walletService.credit() only after the charge is confirmed. It is ADMIN-only
// and bounded so it can't be used to mint arbitrary balance from the client.
export async function recharge(req, res) {
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'amount must be a positive number' });
  if (amount > 100000) return res.status(400).json({ error: 'Demo recharge is limited to 100000 per transaction' });
  const result = await walletService.credit(req.params.workspaceId, amount, {
    reason: 'Manual recharge (demo)',
    reference: `demo_${Date.now()}`,
  });
  res.json({ ...result, demo: true });
}
