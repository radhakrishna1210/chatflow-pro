import * as apiKeysService from '../services/apikeys.service.js';

export async function list(req, res) {
  const keys = await apiKeysService.listApiKeys(
    req.params.workspaceId
  );

  res.json(keys);
}

// Get or provision the dedicated Authentication API key.
//
// The raw key is returned only when the Authentication key
// is newly provisioned. Existing keys are returned as metadata.
export async function getAuthentication(req, res) {
  const result =
    await apiKeysService.getOrCreateAuthenticationApiKey(
      req.params.workspaceId
    );

  res.json(result);
}

// Rotate the dedicated Authentication API key.
//
// The newly generated raw key is returned once so the
// workspace owner can copy it into their backend.
export async function rotateAuthentication(req, res) {
  const result =
    await apiKeysService.rotateAuthenticationApiKey(
      req.params.workspaceId
    );

  res.json(result);
}

// The scope catalogue, so the key-creation UI lists exactly what the server
// will accept rather than a hardcoded copy of it.
export async function scopes(req, res) {
  res.json(apiKeysService.listApiScopes());
}

export async function create(req, res) {
  const result = await apiKeysService.createApiKey(
    req.params.workspaceId,
    req.body,
    req.user
  );

  res.status(201).json(result);
}

export async function rotate(req, res) {
  const result = await apiKeysService.rotateApiKey(
    req.params.workspaceId,
    req.params.id
  );

  res.json(result);
}

export async function revoke(req, res) {
  await apiKeysService.revokeApiKey(
    req.params.workspaceId,
    req.params.id
  );

  res.status(204).send();
}

export async function testMessage(req, res) {
  const result = await apiKeysService.sendTestMessage(
    req.params.workspaceId,
    req.body
  );

  res.json(result);
}