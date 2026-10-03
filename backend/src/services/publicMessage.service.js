import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/encryption.js';
import { sendWhatsAppMessage, sendTextMessage } from '../lib/meta.js';
import { countVariables } from '../lib/templateParams.js';
import { assertNotOptedOut, normalizePhone } from './optout.service.js';
import { buildTemplateSendPayload } from './templatePayload.service.js';
import { chargeAndSend, recordOutboundMessage } from './meteredSend.service.js';

function fail(message, status, code) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

// The highest {{n}} any text component uses, i.e. how many values a send needs.
export function requiredVariableCount(template) {
  const components = Array.isArray(template?.components) ? template.components : [];
  return components.reduce((max, c) => Math.max(max, countVariables(c?.text)), 0);
}

// Resolves the stored template a public send names. Only an APPROVED template
// can be sent; the caller's object is never forwarded to Meta as-is, so what
// goes out is what Meta reviewed and the charge uses the stored category.
async function resolveApprovedTemplate(workspaceId, { name, language }) {
  const where = {
    workspaceId,
    name,
    ...(language?.code ? { language: language.code } : {}),
  };
  const approved = await prisma.template.findFirst({
    where: { ...where, status: 'APPROVED' },
    orderBy: { createdAt: 'desc' },
  });
  if (approved) return approved;

  const other = await prisma.template.findFirst({
    where: { ...where, status: { not: 'DELETED' } },
    select: { status: true },
  });
  if (other) {
    throw fail(
      `Template "${name}" is ${String(other.status).toLowerCase()} and cannot be sent. Only templates Meta has approved may be used.`,
      422, 'TEMPLATE_NOT_SENDABLE',
    );
  }
  throw fail(`Template "${name}" not found in this workspace`, 404, 'TEMPLATE_NOT_FOUND');
}

/**
 * POST /api/v1/public/messages. The body has already been validated by
 * publicApiSchemas.sendMessage.
 *
 * Returns Meta's response (as it always has) plus the id of the stored message.
 */
export async function sendPublicMessage(workspaceId, { to, template, type, body, waNumberId }) {
  const recipient = normalizePhone(to);
  if (recipient.length < 8) {
    throw fail('`to` must be a phone number in international format, e.g. +919876543210', 400);
  }

  await assertNotOptedOut(workspaceId, recipient);

  // Oldest first, matching the order GET /me lists numbers in, so "no
  // waNumberId" always means the same number rather than whichever row the
  // database happens to return.
  const waNumber = await prisma.waNumber.findFirst({
    where: { workspaceId, ...(waNumberId ? { id: waNumberId } : {}) },
    orderBy: { createdAt: 'asc' },
  });
  if (!waNumber) throw fail('No WhatsApp number found for this workspace', 404);

  const accessToken = decrypt(waNumber.encryptedAccessToken);
  const phoneNumberId = waNumber.metaPhoneNumberId;

  if (type === 'template') {
    const stored = await resolveApprovedTemplate(workspaceId, template);

    const required = requiredVariableCount(stored);
    const supplied = (template.variables || []).map((v) => String(v ?? ''));
    if (required > 0 && (supplied.length < required || supplied.slice(0, required).some((v) => !v.trim()))) {
      const e = fail(
        `Template "${stored.name}" needs ${required} variable value${required === 1 ? '' : 's'} in template.variables.`,
        422, 'TEMPLATE_VARIABLES_REQUIRED',
      );
      e.details = { requiredVariables: required };
      throw e;
    }

    const payload = await buildTemplateSendPayload(stored, {
      workspaceId,
      phoneNumberId,
      accessToken,
      resolve: (i) => supplied[Number(i)] ?? '',
      log: false,
    });

    const { result } = await chargeAndSend(workspaceId, {
      reason: 'API template message',
      messageCategory: stored.category ?? null,
      send: () => sendWhatsAppMessage(phoneNumberId, accessToken, recipient, payload),
    });
    const message = await recordOutboundMessage(workspaceId, {
      phone: recipient,
      waNumberId: waNumber.id,
      body: `[Template: ${stored.name}]`,
      type: 'TEMPLATE',
      metaMessageId: result?.messages?.[0]?.id ?? null,
    });
    return { ...result, messageId: message?.id ?? null };
  }

  if (type === 'text') {
    // Free-form text is only accepted by Meta inside the 24-hour window. As in
    // the inbox, Meta is the authority on that: a send outside it comes back
    // as 131047, the credit is released and the caller gets a 409.
    const { result } = await chargeAndSend(workspaceId, {
      reason: 'API text message',
      send: () => sendTextMessage(phoneNumberId, accessToken, recipient, body),
    });
    const message = await recordOutboundMessage(workspaceId, {
      phone: recipient,
      waNumberId: waNumber.id,
      body,
      type: 'TEXT',
      metaMessageId: result?.messages?.[0]?.id ?? null,
    });
    return { ...result, messageId: message?.id ?? null };
  }

  throw fail('Invalid message type. Supported: template, text', 400);
}
