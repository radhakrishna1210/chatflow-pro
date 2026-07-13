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

export async function checkSubscription(req, res) {
  const result = await whatsappService.checkSubscription(req.params.workspaceId, req.params.id);
  res.json(result);
}
