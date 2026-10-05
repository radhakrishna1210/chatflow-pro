import * as settingsService from '../services/settings.service.js';

export async function getSettings(req, res) {
  const settings = await settingsService.getSettings(req.params.workspaceId);
  // The verify token is the HMAC secret for outgoing deliveries; anyone holding
  // it can forge events to the customer's endpoint. Only roles that can change
  // the webhook need to see it.
  if (!['CLIENT', 'ADMIN'].includes(req.user?.role) && req.user?.superAdmin !== true) {
    delete settings.webhookVerifyToken;
  }
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

export async function downloadInvoice(req, res) {
  const doc = await settingsService.getInvoiceDocument(req.params.workspaceId, req.params.invoiceId);
  res.setHeader('Content-Type', doc.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${doc.filename}"`);
  res.send(doc.html);
}

export async function testWebhook(req, res) {
  const result = await settingsService.testWebhook(req.params.workspaceId);
  res.json(result);
}
