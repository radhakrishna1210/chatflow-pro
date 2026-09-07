import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/encryption.js';
import { sendWhatsAppMessage } from '../lib/meta.js';

import {
  createAuthenticationTransaction,
  attachMetaMessageId,
  invalidateAuthenticationTransaction,
  verifyAuthenticationTransaction,
} from './otp.service.js';

import {
  assertNotOptedOut,
  normalizePhone,
} from '../services/optout.service.js';

const AUTHENTICATION_OTP_EXPIRATION_MINUTES = 10;

/**
 * Authentication OTPs are valid for ten minutes.
 *
 * This value controls the ChatFlow verification transaction.
 * The configured Meta Authentication template controls
 * the expiry information displayed to the customer.
 */
function getExpirationMinutes() {
  return AUTHENTICATION_OTP_EXPIRATION_MINUTES;
}

/**
 * Verify that a template is an approved
 * AUTHENTICATION / COPY_CODE template.
 */
function isCopyCodeAuthenticationTemplate(template) {
  if (
    String(template?.category || '').toUpperCase() !==
    'AUTHENTICATION'
  ) {
    return false;
  }

  const buttons = (template.components || []).find(
    component =>
      String(component?.type || '').toUpperCase() ===
      'BUTTONS'
  )?.buttons;

  if (!Array.isArray(buttons) || buttons.length !== 1) {
    return false;
  }

  const button = buttons[0] || {};

  const type = String(button.type || '').toUpperCase();

  if (type === 'OTP') {
    return (
      String(button.otp_type || '').toUpperCase() ===
      'COPY_CODE'
    );
  }

  return (
    type === 'URL' &&
    /otp_type=COPY_CODE/i.test(
      String(button.url || '')
    )
  );
}

/**
 * Resolve the Authentication configuration for a workspace.
 *
 * The workspace configuration determines which approved
 * Authentication template and WhatsApp number are used.
 *
 * The API caller does NOT provide templateId or waNumberId.
 */
async function resolveAuthenticationConfiguration(
  workspaceId
) {
  if (!workspaceId) {
    const error = new Error('Workspace is required.');
    error.status = 400;
    throw error;
  }

  const config =
    await prisma.authenticationConfig.findUnique({
      where: {
        workspaceId,
      },
    });

  if (!config) {
    const error = new Error(
      'Authentication is not configured for this workspace.'
    );
    error.status = 409;
    throw error;
  }

  if (!config.enabled) {
    const error = new Error(
      'Authentication is disabled for this workspace.'
    );
    error.status = 409;
    throw error;
  }

  if (!config.templateId) {
    const error = new Error(
      'Authentication template is not configured.'
    );
    error.status = 409;
    throw error;
  }

  if (!config.waNumberId) {
    const error = new Error(
      'Authentication WhatsApp number is not configured.'
    );
    error.status = 409;
    throw error;
  }

  const template = await prisma.template.findFirst({
    where: {
      id: config.templateId,
      workspaceId,
      status: 'APPROVED',
    },
  });

  if (!template) {
    const error = new Error(
      'The configured authentication template is not approved or no longer exists.'
    );
    error.status = 409;
    throw error;
  }

  if (
    String(template.category || '').toUpperCase() !==
    'AUTHENTICATION'
  ) {
    const error = new Error(
      'The configured template is not an AUTHENTICATION template.'
    );
    error.status = 422;
    throw error;
  }

  if (!isCopyCodeAuthenticationTemplate(template)) {
    const error = new Error(
      'Only approved COPY_CODE authentication templates are supported.'
    );
    error.status = 422;
    throw error;
  }

  const waNumber = await prisma.waNumber.findFirst({
    where: {
      id: config.waNumberId,
      workspaceId,
    },
  });

  if (!waNumber) {
    const error = new Error(
      'The configured authentication WhatsApp number no longer exists.'
    );
    error.status = 409;
    throw error;
  }

  return {
    config,
    template,
    waNumber,
  };
}

/**
 * Build the Meta Authentication template payload.
 *
 * The generated OTP is used for the Authentication message.
 */
function buildAuthenticationPayload(template, otp) {
  return {
    name: template.name,
    language: {
      code: template.language || 'en',
    },
    components: [
      {
        type: 'body',
        parameters: [
          {
            type: 'text',
            text: String(otp),
          },
        ],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [
          {
            type: 'text',
            text: String(otp),
          },
        ],
      },
    ],
  };
}

/**
 * Generate and send a ChatFlow Authentication OTP.
 *
 * Production Mode 1:
 * - ChatFlow generates the OTP.
 * - ChatFlow stores only the OTP hash.
 * - ChatFlow sends the OTP through the configured
 *   Authentication template and WhatsApp number.
 * - The raw OTP is NEVER returned to the API caller.
 */
export async function sendAuthenticationOtp(
  workspaceId,
  { to, campaignId = null }
) {
  if (!workspaceId) {
    const error = new Error('Workspace is required.');
    error.status = 400;
    throw error;
  }

  if (!to || typeof to !== 'string') {
    const error = new Error('Phone number is required.');
    error.status = 400;
    throw error;
  }

  const recipient = normalizePhone(to);

  if (recipient.length < 8) {
    const error = new Error(
      '`to` must be a phone number in international format, e.g. +919876543210'
    );
    error.status = 400;
    throw error;
  }

  await assertNotOptedOut(
    workspaceId,
    recipient
  );

  const {
    template,
    waNumber,
  } = await resolveAuthenticationConfiguration(
    workspaceId
  );

  // `campaignId` is internal worker metadata only. Verify it belongs to this
  // workspace and is an Authentication campaign before persisting the link.
  // The public controller never supplies this value.
  if (campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        workspaceId,
        template: { category: { equals: 'AUTHENTICATION', mode: 'insensitive' } },
      },
      select: { id: true },
    });
    if (!campaign) {
      const error = new Error('Authentication campaign not found.');
      error.status = 404;
      throw error;
    }
  }

  const generated =
    await createAuthenticationTransaction({
      workspaceId,
      templateId: template.id,
      waNumberId: waNumber.id,
      campaignId,
      phone: recipient,
      expiresInMinutes:
        getExpirationMinutes(),
    });

  const accessToken = decrypt(
    waNumber.encryptedAccessToken
  );

  try {
    const result = await sendWhatsAppMessage(
      waNumber.metaPhoneNumberId,
      accessToken,
      recipient,
      buildAuthenticationPayload(
        template,
        generated.code
      )
    );
    const metaMessageId = result?.messages?.[0]?.id || null;

    // Meta accepted the message; inability to record its optional provider ID
    // must not make an otherwise delivered code unusable.
    await attachMetaMessageId(generated.transactionId, metaMessageId)
      .catch(error => console.error('[Authentication] Failed to store Meta message ID:', error));

    return {
      status: 'SENT',
      phone: recipient,
      templateName: template.name,
      expiresAt: generated.expiresAt.toISOString(),
      expiresIn: Math.max(0, Math.floor((generated.expiresAt.getTime() - Date.now()) / 1000)),
      metaMessageId,
      mode: 'CHATFLOW_GENERATED',
    };
  } catch (error) {
    // A generated code which Meta did not accept must not remain verifiable.
    await invalidateAuthenticationTransaction(generated.transactionId)
      .catch(invalidationError => console.error('[Authentication] Failed to invalidate undelivered OTP:', invalidationError));
    throw error;
  }
}

/**
 * Verify a ChatFlow-generated Authentication OTP.
 */
export async function verifyAuthenticationOtp(
  workspaceId,
  phone,
  code
) {
  if (!workspaceId) {
    const error = new Error('Workspace is required.');
    error.status = 400;
    throw error;
  }

  if (!phone || typeof phone !== 'string') {
    const error = new Error(
      'Phone number is required.'
    );
    error.status = 400;
    throw error;
  }

  if (
    code === undefined ||
    code === null ||
    String(code).trim() === ''
  ) {
    const error = new Error('OTP is required.');
    error.status = 400;
    throw error;
  }

  const recipient = normalizePhone(phone);
  const normalizedCode = String(code).trim();

  if (!/^\d{6}$/.test(normalizedCode)) {
    const error = new Error(
      'OTP must be exactly 6 digits.'
    );
    error.status = 400;
    throw error;
  }

  return verifyAuthenticationTransaction(
    workspaceId,
    recipient,
    normalizedCode
  );
}
