import * as service from '../services/integrations.service.js';

export async function list(req, res) {
  res.json(await service.listIntegrations(req.params.workspaceId));
}
export async function connect(req, res) {
  const { provider } = req.params;
  const row = await service.connectIntegration(req.params.workspaceId, provider, req.body || {});
  res.status(201).json(row);
}
export async function disconnect(req, res) {
  res.json(await service.disconnectIntegration(req.params.workspaceId, req.params.provider));
}
