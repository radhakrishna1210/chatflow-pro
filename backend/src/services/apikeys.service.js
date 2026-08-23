import { prisma } from '../lib/prisma.js';
import { randomBytes, createHash } from 'crypto';
import { queueApiKeyCreatedEmail } from './email.service.js';
import { assertWithinLimit } from './subscription.service.js';
import { assertNotOptedOut, normalizePhone } from './optout.service.js';
import { decrypt } from '../lib/encryption.js';
import { countVariables, buildTextComponents, buildButtonComponents } from '../lib/templateParams.js';
import { headerImageComponent, carouselComponent } from './templateImage.service.js';
import { normaliseScopes, API_SCOPES } from '../lib/apiScopes.js';

function generateKey() {
  const raw = 'cfp_' + randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 12);
  return { raw, hash, prefix };
}

export async function listApiKeys(workspaceId) {
  return prisma.apiKey.findMany({
    where: { workspaceId, revokedAt: null },
    select: { id: true, name: true, keyPrefix: true, environment: true, scopes: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

// The catalogue the UI renders its scope checkboxes from, so the two cannot
// drift out of step.
export function listApiScopes() {
  return API_SCOPES;
}

export async function createApiKey(workspaceId, { name, environment = 'production', scopes }, user) {
  await assertWithinLimit(workspaceId, 'apiKey');
  const granted = normaliseScopes(scopes);
  const { raw, hash, prefix } = generateKey();
  await prisma.apiKey.create({ data: { workspaceId, name, keyHash: hash, keyPrefix: prefix, environment, scopes: granted } });

  if (user) {
    queueApiKeyCreatedEmail({
      userEmail: user.email,
      userName: user.name,
      keyName: name,
      environment,
      keyPrefix: prefix,
    }).catch(() => {});
  }

  return { rawKey: raw, keyPrefix: prefix, name, environment, scopes: granted };
}

export async function rotateApiKey(workspaceId, id) {
  const key = await prisma.apiKey.findFirst({ where: { id, workspaceId, revokedAt: null } });
  if (!key) { const e = new Error('API key not found'); e.status = 404; throw e; }

  // Rotation replaces the secret, never the permissions — a rotated key must
  // keep doing exactly what the integration using it already does.
  const { raw, hash, prefix } = generateKey();
  await prisma.apiKey.update({ where: { id }, data: { keyHash: hash, keyPrefix: prefix } });
  return { rawKey: raw, keyPrefix: prefix, scopes: key.scopes ?? null };
}

export async function revokeApiKey(workspaceId, id) {
  const key = await prisma.apiKey.findFirst({ where: { id, workspaceId } });
  if (!key) { const e = new Error('API key not found'); e.status = 404; throw e; }
  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
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

      // Assembled exactly like a campaign send (lib/templateParams.js), because
      // a playground test that skips the image header or a link button's
      // parameter fails on Meta for a reason the template itself never shows —
      // and then "it worked in the playground" stops meaning anything.
      const payload = { name: template.name, language: { code: template.language } };
      const header = await headerImageComponent(template, {
        phoneNumberId: waNumber.metaPhoneNumberId,
        accessToken,
      });
      const resolve = (i) => String(supplied[i] ?? '').trim() || ' ';
      const carousel = await carouselComponent(template, {
        phoneNumberId: waNumber.metaPhoneNumberId,
        accessToken,
        resolve,
      });
      const parts = [
        ...(header ? [header] : []),
        ...(required > 0 ? buildTextComponents(components, resolve) : []),
        // Button values come from the template's own examples, so the caller
        // never has to supply them.
        ...buildButtonComponents(components),
        // Carousel cards carry their own media and buttons.
        ...(carousel ? [carousel] : []),
      ];
      if (parts.length) payload.components = parts;

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
