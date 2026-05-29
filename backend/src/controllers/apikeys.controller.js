import * as apiKeysService from '../services/apikeys.service.js';

export async function list(req, res) {
  const keys = await apiKeysService.listApiKeys(req.params.workspaceId);
  res.json(keys);
}

export async function create(req, res) {
  const result = await apiKeysService.createApiKey(req.params.workspaceId, req.body, req.user);
  res.status(201).json(result);
}

export async function rotate(req, res) {
  const result = await apiKeysService.rotateApiKey(req.params.workspaceId, req.params.id);
  res.json(result);
}

export async function revoke(req, res) {
  await apiKeysService.revokeApiKey(req.params.workspaceId, req.params.id);
  res.status(204).send();
}
