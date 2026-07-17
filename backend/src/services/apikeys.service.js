import { prisma } from '../lib/prisma.js';
import { randomBytes, createHash } from 'crypto';
import { queueApiKeyCreatedEmail } from './email.service.js';
import { assertWithinLimit } from './subscription.service.js';

function generateKey() {
  const raw = 'cfp_' + randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 12);
  return { raw, hash, prefix };
}

export async function listApiKeys(workspaceId) {
  return prisma.apiKey.findMany({
    where: { workspaceId, revokedAt: null },
    select: { id: true, name: true, keyPrefix: true, environment: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createApiKey(workspaceId, { name, environment = 'production' }, user) {
  await assertWithinLimit(workspaceId, 'apiKey');
  const { raw, hash, prefix } = generateKey();
  await prisma.apiKey.create({ data: { workspaceId, name, keyHash: hash, keyPrefix: prefix, environment } });

  if (user) {
    queueApiKeyCreatedEmail({
      userEmail: user.email,
      userName: user.name,
      keyName: name,
      environment,
      keyPrefix: prefix,
    }).catch(() => {});
  }

  return { rawKey: raw, keyPrefix: prefix, name, environment };
}

export async function rotateApiKey(workspaceId, id) {
  const key = await prisma.apiKey.findFirst({ where: { id, workspaceId, revokedAt: null } });
  if (!key) { const e = new Error('API key not found'); e.status = 404; throw e; }

  const { raw, hash, prefix } = generateKey();
  await prisma.apiKey.update({ where: { id }, data: { keyHash: hash, keyPrefix: prefix } });
  return { rawKey: raw, keyPrefix: prefix };
}

export async function revokeApiKey(workspaceId, id) {
  const key = await prisma.apiKey.findFirst({ where: { id, workspaceId } });
  if (!key) { const e = new Error('API key not found'); e.status = 404; throw e; }
  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
}
