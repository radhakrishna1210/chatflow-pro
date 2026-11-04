import { prisma } from '../lib/prisma.js';
import { encrypt } from '../lib/encryption.js';

// Real, workspace-scoped integration storage. API-key credentials are encrypted
// at rest server-side (same pattern as WaNumber.encryptedAccessToken) — never
// stored in the browser. Secrets are never returned to the client.

export async function listIntegrations(workspaceId) {
  const rows = await prisma.workspaceIntegration.findMany({
    where: { workspaceId },
    orderBy: { connectedAt: 'desc' },
  });
  // Strip encrypted credentials — only report that a connection exists.
  return rows.map(({ encryptedCredentials, ...r }) => ({ ...r, hasCredentials: !!encryptedCredentials }));
}

const badRequest = (message) => { const e = new Error(message); e.status = 400; return e; };
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Shape checks for what a browser may store against a connection. Without
// them the provider id, the credential map and the config blob were all
// unbounded and untyped — a multi-megabyte `config` was stored and then sent
// back on every page load of the Integrations screen.
function assertConnectInput(provider, { type, credentials, config }) {
  if (typeof provider !== 'string' || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(provider)) throw badRequest('invalid integration provider');
  if (!type) throw badRequest('provider and type are required');
  if (!['apikey', 'oauth', 'webhook'].includes(type)) throw badRequest('invalid integration type');
  if (credentials !== undefined && credentials !== null) {
    if (!isPlainObject(credentials)) throw badRequest('credentials must be an object');
    const entries = Object.entries(credentials);
    if (entries.length > 20) throw badRequest('too many credential fields');
    for (const [k, v] of entries) {
      if (k.length > 60 || typeof v !== 'string' || v.length > 4000) throw badRequest('credential values must be text of at most 4000 characters');
    }
  }
  if (type === 'apikey' && !(isPlainObject(credentials) && Object.values(credentials).some((v) => String(v).trim()))) {
    throw badRequest('credentials are required for an API-key connection');
  }
  if (config !== undefined && config !== null) {
    if (!isPlainObject(config)) throw badRequest('config must be an object');
    if (JSON.stringify(config).length > 4096) throw badRequest('config is too large');
  }
}

export async function connectIntegration(workspaceId, provider, input = {}) {
  assertConnectInput(provider, input);
  const { type, credentials, config } = input;

  // A manual 'oauth' record is only a request ("connect me when this provider
  // is wired") — it holds no token, so it is PENDING, not CONNECTED. It used to
  // be stored as CONNECTED and the card claimed a live Zoho/Salesforce link
  // that did not exist. It must also never overwrite a real OAuth grant: the
  // upsert below nulls the credentials, which silently destroyed the tokens.
  if (type === 'oauth') {
    const existing = await prisma.workspaceIntegration.findUnique({
      where: { workspaceId_provider: { workspaceId, provider } },
    });
    if (existing?.encryptedCredentials) {
      const { encryptedCredentials, ...safe } = existing;
      return { ...safe, hasCredentials: true };
    }
  }

  const data = {
    workspaceId, provider, type, status: type === 'oauth' ? 'PENDING' : 'CONNECTED',
    config: config ?? null,
    encryptedCredentials:
      type === 'apikey' && credentials && Object.keys(credentials).length
        ? encrypt(JSON.stringify(credentials))
        : null,
  };

  const row = await prisma.workspaceIntegration.upsert({
    where: { workspaceId_provider: { workspaceId, provider } },
    create: data,
    update: { type: data.type, status: data.status, config: data.config, encryptedCredentials: data.encryptedCredentials },
  });
  const { encryptedCredentials, ...safe } = row;
  return { ...safe, hasCredentials: !!encryptedCredentials };
}

export async function disconnectIntegration(workspaceId, provider) {
  if (typeof provider !== 'string' || provider.length > 40) throw badRequest('invalid integration provider');
  const row = await prisma.workspaceIntegration.findUnique({
    where: { workspaceId_provider: { workspaceId, provider } },
  });
  if (!row) { const e = new Error('Integration not connected'); e.status = 404; throw e; }
  await prisma.workspaceIntegration.delete({ where: { id: row.id } });
  return { ok: true };
}
