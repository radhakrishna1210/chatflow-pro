import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/encryption.js';
import { sendWhatsAppMessage } from '../lib/meta.js';

import {
  createAuthenticationTransaction,
  attachMetaMessageId,
  verifyAuthenticationTransaction,
} from './otp.service.js';

import {
  assertNotOptedOut,
  normalizePhone,
} from '../services/optout.service.js';

const DEFAULT_EXPIRATION_MINUTES = 5;

/**
 * Get the OTP expiration configured on the approved
 * Meta Authentication template.
 */
function getExpirationMinutes(template) {
  const components = Array.isArray(template?.components)
    ? template.components
    : [];

  const footer = components.find(
    component =>
      String(component?.type || '').toUpperCase() === 'FOOTER'
  );

  const value = Number(footer?.code_expiration_minutes);

  return Number.isInteger(value) &&
    value >= 1 &&
    value <= 90
    ? value
    : DEFAULT_EXPIRATION_MINUTES;
}

/**
 * Verify that the template is an approved
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
 * Resolve an approved Authentication template and
 * the WhatsApp number belonging to the workspace.
 */
async function resolveTemplateAndNumber(
  workspaceId,
  templateId,
  waNumberId
) {
  if (!workspaceId) {
    const error = new Error('Workspace is required.');
    error.status = 400;
    throw error;
  }

  if (!templateId) {
    const error = new Error(
      'Authentication template is required.'
    );
    error.status = 400;
    throw error;
  }

  const template = await prisma.template.findFirst({
    where: {
      workspaceId,
      OR: [
        { id: templateId },
        { name: templateId },
      ],
      status: 'APPROVED',
    },
  });

  if (!template) {
    const error = new Error(
      'Approved authentication template not found in this workspace.'
    );
    error.status = 404;
    throw error;
  }

  if (
    String(template.category || '').toUpperCase() !==
    'AUTHENTICATION'
  ) {
    const error = new Error(
      'The selected template is not an AUTHENTICATION template.'
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

  const numberId =
    waNumberId || template.waNumberId;

  if (!numberId) {
    const error = new Error(
      'No WhatsApp number is configured for this authentication template.'
    );
    error.status = 404;
    throw error;
  }

  const waNumber = await prisma.waNumber.findFirst({
    where: {
      id: numberId,
      workspaceId,
    },
  });

  if (!waNumber) {
    const error = new Error(
      'No WhatsApp number is connected to this authentication template.'
    );
    error.status = 404;
    throw error;
  }

  return {
    template,
    waNumber,
  };
}

/**
 * Build the Meta Authentication template payload.
 *
 * The SAME OTP is inserted into the body and
 * COPY_CODE button.
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
 * Send an Authentication OTP.
 *
 * Supported modes:
 *
 * CHATFLOW_GENERATED
 * ------------------
 * No OTP supplied.
 * ChatFlow generates and stores the OTP inside
 * AuthenticationTransaction.
 *
 * CLIENT_GENERATED
 * ----------------
 * OTP supplied by the client.
 * ChatFlow sends it through Meta but does not
 * verify it.
 */
export async function sendAuthenticationOtp(
  workspaceId,
  {
    templateId,
    to,
    otp,
    waNumberId,
  }
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
  } = await resolveTemplateAndNumber(
    workspaceId,
    templateId,
    waNumberId
  );

  const clientGenerated =
    otp !== undefined &&
    otp !== null;

  let code;
  let expiresAt;
  let transactionId = null;

  if (clientGenerated) {
    code = String(otp).trim();

    if (!/^\d{6}$/.test(code)) {
      const error = new Error(
        'OTP must be exactly 6 digits.'
      );
      error.status = 400;
      throw error;
    }

    expiresAt = new Date(
      Date.now() +
        getExpirationMinutes(template) *
          60 *
          1000
    );
  } else {
    const generated =
      await createAuthenticationTransaction({
        workspaceId,
        templateId: template.id,
        waNumberId: waNumber.id,
        phone: recipient,
        expiresInMinutes:
          getExpirationMinutes(template),
      });

    code = generated.code;
    expiresAt = generated.expiresAt;
    transactionId = generated.transactionId;
  }

  const accessToken = decrypt(
    waNumber.encryptedAccessToken
  );

  const result = await sendWhatsAppMessage(
    waNumber.metaPhoneNumberId,
    accessToken,
    recipient,
    buildAuthenticationPayload(
      template,
      code
    )
  );

  const metaMessageId =
    result?.messages?.[0]?.id || null;

  if (transactionId) {
    await attachMetaMessageId(
      transactionId,
      metaMessageId
    );
  }

  return {
    status: 'SENT',
    phone: recipient,
    templateName: template.name,
    expiresAt: expiresAt.toISOString(),
    expiresIn: Math.max(
      0,
      Math.floor(
        (expiresAt.getTime() - Date.now()) /
          1000
      )
    ),
    metaMessageId,

    ...(clientGenerated
      ? {}
      : {
          otp: code,
          transactionId,
        }),

    mode: clientGenerated
      ? 'CLIENT_GENERATED'
      : 'CHATFLOW_GENERATED',
  };
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
    const error = new Error(
      'Workspace is required.'
    );
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
    const error = new Error(
      'OTP is required.'
    );
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

  return verifyAuthenticationTransaction({
    workspaceId,
    phone: recipient,
    code: normalizedCode,
  });
}