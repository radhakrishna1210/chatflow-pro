import * as whatsappService from '../services/whatsapp.service.js';

export async function listNumbers(req, res) {
  const numbers = await whatsappService.listNumbers(req.params.workspaceId);
  res.json(numbers);
}

export async function connectOwnNumber(req, res) {
  const number = await whatsappService.connectOwnNumber(req.params.workspaceId, req.body);
  res.status(201).json(number);
}

export async function listPool(req, res) {
  const pool = await whatsappService.listPool();
  res.json(pool);
}

export async function onboard(req, res) {
  const { workspaceId } = req.params;
  const { poolEntryId } = req.body;
  if (!poolEntryId) return res.status(400).json({ error: 'poolEntryId is required' });
  const result = await whatsappService.onboardFromPool(workspaceId, poolEntryId);
  res.status(201).json(result);
}

export async function refreshNumbers(req, res) {
  const numbers = await whatsappService.refreshNumbers(req.params.workspaceId);
  res.json(numbers);
}

export async function disconnect(req, res) {
  const result = await whatsappService.disconnectNumber(req.params.workspaceId, req.params.id);
  res.json(result);
}

export async function embeddedSignupConfig(req, res) {
  res.json(whatsappService.getEmbeddedSignupConfig());
}

export async function completeEmbeddedSignup(req, res) {
  const number = await whatsappService.completeEmbeddedSignup(req.params.workspaceId, req.body);
  res.status(201).json(number);
}

// Ask Meta to send a 6-digit code to the number, and confirm it. Previously
// available only to the platform super admin, and only for numbers in the
// platform's own WABA.
export async function requestVerification(req, res) {
  const result = await whatsappService.requestNumberVerification(
    req.params.workspaceId, req.params.id, req.body?.method,
  );
  res.json(result);
}

export async function confirmVerification(req, res) {
  const result = await whatsappService.confirmNumberVerification(
    req.params.workspaceId, req.params.id, req.body?.code,
  );
  res.json(result);
}

// Everything that has to be true for a number to work, checked live against
// Meta. The pieces fail independently, so a row that says ACTIVE can still be
// unable to send or receive.
export async function health(req, res) {
  res.json(await whatsappService.connectionHealth(req.params.workspaceId, req.params.id));
}

// Replaces the credentials on an existing number, keeping its conversations,
// campaigns and templates — which disconnect-then-reconnect would detach.
export async function reconnect(req, res) {
  res.json(await whatsappService.reconnectNumber(req.params.workspaceId, req.params.id, req.body || {}));
}

export async function checkSubscription(req, res) {
  const result = await whatsappService.checkSubscription(req.params.workspaceId, req.params.id);
  res.json(result);
}
