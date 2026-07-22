import { prisma } from '../lib/prisma.js';
import { randomBytes, createHash } from 'crypto';
import { queueApiKeyCreatedEmail } from './email.service.js';
import { assertWithinLimit } from './subscription.service.js';
import { decrypt } from '../lib/encryption.js';

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

// Powers the "Send Test Message" button in the API Playground. Sends a real
// WhatsApp message through the workspace's connected number — either a
// no-variable template (by name) or plain text, mirroring the shape of the
// public /messages endpoint (whatsapp.service.js#sendPublicMessage) without
// requiring a raw API key in the browser.
export async function sendTestMessage(workspaceId, { to, templateId, message }) {
  const waNumber = await prisma.waNumber.findFirst({ where: { workspaceId } });
  if (!waNumber) { const e = new Error('Connect a WhatsApp number first'); e.status = 404; throw e; }

  const accessToken = decrypt(waNumber.encryptedAccessToken);
  const { sendWhatsAppMessage, sendTextMessage } = await import('../lib/meta.js');

  try {
    if (templateId) {
      const template = await prisma.template.findFirst({ where: { workspaceId, name: templateId } });
      if (!template) { const e = new Error(`Template not found: "${templateId}"`); e.status = 404; throw e; }

      const body = Array.isArray(template.components)
        ? template.components.find((c) => String(c?.type || '').toUpperCase() === 'BODY')
        : null;
      if (body && /\{\{\d+\}\}/.test(body.text || '')) {
        const e = new Error('This template has variables and cannot be sent from the test playground — use a template with no variables.');
        e.status = 422;
        throw e;
      }

      const result = await sendWhatsAppMessage(waNumber.metaPhoneNumberId, accessToken, to, {
        name: template.name,
        language: { code: template.language },
      });
      return { ok: true, messageId: result?.messages?.[0]?.id ?? null };
    }

    const result = await sendTextMessage(waNumber.metaPhoneNumberId, accessToken, to, message);
    return { ok: true, messageId: result?.messages?.[0]?.id ?? null };
  } catch (err) {
    if (err.status) throw err;
    const metaMessage = err.response?.data?.error?.message;
    const e = new Error(metaMessage || err.message || 'Failed to send test message');
    e.status = 502;
    throw e;
  }
}
