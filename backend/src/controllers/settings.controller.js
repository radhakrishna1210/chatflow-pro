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

export async function testWebhook(req, res) {
  const result = await settingsService.testWebhook(req.params.workspaceId);
  res.json(result);
}
