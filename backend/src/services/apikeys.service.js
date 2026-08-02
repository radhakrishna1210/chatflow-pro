import { prisma } from '../lib/prisma.js';
import { randomBytes, createHash } from 'crypto';
import { queueApiKeyCreatedEmail } from './email.service.js';
import { assertWithinLimit } from './subscription.service.js';
import { assertNotOptedOut, normalizePhone } from './optout.service.js';
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

// Highest {{n}} placeholder index in a piece of template text — that is how
// many parameters Meta expects for that component.
const countVariables = (text) => {
  const nums = [...String(text || '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => parseInt(m[1], 10));
  return nums.length ? Math.max(...nums) : 0;
};

// Builds the `components` payload Meta wants, filling each {{n}} from the
// caller-supplied `variables` array (1-indexed to match {{1}}). Only HEADER
// and BODY take text parameters in this flow.
function buildTemplateComponents(components, variables) {
  return (components || [])
    .filter((c) => /\{\{\d+\}\}/.test(c?.text || ''))
    .map((c) => ({
      type: String(c.type || 'body').toLowerCase(),
      parameters: Array.from({ length: countVariables(c.text) }, (_, i) => ({
        type: 'text',
        text: String(variables[i] ?? '').trim() || ' ',
      })),
    }));
}

// Powers the "Send Test Message" button in the API Playground. Sends a real
// WhatsApp message through the workspace's connected number — a template (by
// name, with or without variables) or plain text — mirroring the shape of the
// public /messages endpoint (whatsapp.service.js#sendPublicMessage) without
// requiring a raw API key in the browser.
export async function sendTestMessage(workspaceId, { to, templateId, message, variables = [] }) {
  // Meta only accepts bare digits. Sending the number exactly as typed
  // ("+91 8625818751") is what made this endpoint fail with a bare
  // "Request failed with status code 400" from the Graph API.
  const recipient = normalizePhone(to);
  if (recipient.length < 8) {
    const e = new Error('Enter the recipient in international format, e.g. +919876543210');
    e.status = 400;
    throw e;
  }

  await assertNotOptedOut(workspaceId, recipient);

  const waNumber = await prisma.waNumber.findFirst({ where: { workspaceId } });
  if (!waNumber) { const e = new Error('Connect a WhatsApp number first'); e.status = 404; throw e; }

  const accessToken = decrypt(waNumber.encryptedAccessToken);
  const { sendWhatsAppMessage, sendTextMessage } = await import('../lib/meta.js');

  try {
    if (templateId) {
      const name = String(templateId).trim();
      const template = await prisma.template.findFirst({ where: { workspaceId, name, status: { not: 'DELETED' } } });
      if (!template) {
        const e = new Error(`Template not found: "${name}". Use the template's name exactly as it appears on the Templates page (e.g. welcome_new_customer).`);
        e.status = 404;
        throw e;
      }
      if (template.status === 'PENDING' || template.status === 'REJECTED') {
        const e = new Error(`Template "${name}" is ${template.status.toLowerCase()} on Meta and cannot be sent yet.`);
        e.status = 422;
        throw e;
      }

      const components = Array.isArray(template.components) ? template.components : [];
      // Templates with {{1}}-style variables are sendable from the playground
      // now — the caller supplies the values instead of being turned away.
      const required = components.reduce((max, c) => Math.max(max, countVariables(c?.text)), 0);
      const supplied = (Array.isArray(variables) ? variables : []).map((v) => String(v ?? ''));
      if (required > 0 && supplied.filter((v) => v.trim()).length < required) {
        const e = new Error(`This template needs ${required} variable value${required === 1 ? '' : 's'} ({{1}}${required > 1 ? `–{{${required}}}` : ''}). Fill them in and try again.`);
        e.status = 422;
        e.code = 'TEMPLATE_VARIABLES_REQUIRED';
        e.details = { requiredVariables: required };
        throw e;
      }

      const payload = { name: template.name, language: { code: template.language } };
      if (required > 0) payload.components = buildTemplateComponents(components, supplied);

      const result = await sendWhatsAppMessage(waNumber.metaPhoneNumberId, accessToken, recipient, payload);
      return { ok: true, messageId: result?.messages?.[0]?.id ?? null };
    }

    const result = await sendTextMessage(waNumber.metaPhoneNumberId, accessToken, recipient, message);
    return { ok: true, messageId: result?.messages?.[0]?.id ?? null };
  } catch (err) {
    if (err.status) throw err;
    const metaErr = err.response?.data?.error;
    // Surface Meta's own explanation rather than axios' "Request failed with
    // status code 400", which told the user nothing about what to fix.
    const detail = metaErr
      ? `${metaErr.message}${metaErr.error_data?.details ? ` — ${metaErr.error_data.details}` : ''} (code ${metaErr.code}${metaErr.error_subcode ? `/${metaErr.error_subcode}` : ''})`
      : err.message || 'Failed to send test message';
    const e = new Error(detail);
    e.status = 502;
    throw e;
  }
}
