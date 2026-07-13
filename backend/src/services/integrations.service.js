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

export async function connectIntegration(workspaceId, provider, { type, credentials, config }) {
  if (!provider || !type) { const e = new Error('provider and type are required'); e.status = 400; throw e; }
  if (!['apikey', 'oauth', 'webhook'].includes(type)) { const e = new Error('invalid integration type'); e.status = 400; throw e; }

  const data = {
    workspaceId, provider, type, status: 'CONNECTED',
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
  const row = await prisma.workspaceIntegration.findUnique({
    where: { workspaceId_provider: { workspaceId, provider } },
  });
  if (!row) { const e = new Error('Integration not connected'); e.status = 404; throw e; }
  await prisma.workspaceIntegration.delete({ where: { id: row.id } });
  return { ok: true };
}
