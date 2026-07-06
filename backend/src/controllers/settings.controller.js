import * as settingsService from '../services/settings.service.js';

export async function getSettings(req, res) {
  const settings = await settingsService.getSettings(req.params.workspaceId);
  res.json(settings);
}

export async function updateSettings(req, res) {
  const settings = await settingsService.updateSettings(req.params.workspaceId, req.body);
  res.json(settings);
}

export async function getInvoices(req, res) {
  const invoices = await settingsService.getInvoices(req.params.workspaceId);
  res.json(invoices);
}

export async function getBilling(req, res) {
  try {
    const data = await settingsService.getBilling(req.params.workspaceId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateBilling(req, res) {
  try {
    const data = await settingsService.updateBilling(req.params.workspaceId, req.body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getWallet(req, res) {
  try {
    const data = await settingsService.getWallet(req.params.workspaceId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function rechargeWallet(req, res) {
  try {
    const data = await settingsService.rechargeWallet(req.params.workspaceId, req.body.amount);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getSubscription(req, res) {
  try {
    const data = await settingsService.getSubscription(req.params.workspaceId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateAddons(req, res) {
  try {
    const data = await settingsService.updateAddons(req.params.workspaceId, req.body.addons);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
