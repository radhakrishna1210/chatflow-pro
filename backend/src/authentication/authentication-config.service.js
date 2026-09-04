import { prisma } from '../lib/prisma.js';

const AUTHENTICATION_OTP_EXPIRATION_MINUTES = 10;

function createError(message, status = 400, code = null) {
  const error = new Error(message);
  error.status = status;

  if (code) {
    error.code = code;
  }

  return error;
}

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
 * Return the current Authentication configuration
 * together with the workspace resources that can be selected.
 */
export async function getAuthenticationConfiguration(
  workspaceId
) {
  if (!workspaceId) {
    throw createError('Workspace is required.', 400);
  }

  const [config, numbers, templates] =
    await Promise.all([
      prisma.authenticationConfig.findUnique({
        where: { workspaceId },
        select: {
          id: true,
          workspaceId: true,
          enabled: true,
          templateId: true,
          waNumberId: true,
          createdAt: true,
          updatedAt: true,
          apiKeyId: true,
        },
      }),

      prisma.waNumber.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          phoneNumber: true,
          displayName: true,
        },
      }),

      prisma.template.findMany({
        where: {
          workspaceId,
          status: 'APPROVED',
          category: 'AUTHENTICATION',
        },
        orderBy: [
          { name: 'asc' },
          { language: 'asc' },
        ],
        select: {
          id: true,
          name: true,
          language: true,
          category: true,
          status: true,
          waNumberId: true,
          components: true,
        },
      }),
    ]);

  const eligibleTemplates = templates.filter(
    isCopyCodeAuthenticationTemplate
  );

  return {
    enabled: config?.enabled ?? false,

    templateId: config?.templateId ?? null,

    waNumberId: config?.waNumberId ?? null,

    otpExpirationMinutes:
      AUTHENTICATION_OTP_EXPIRATION_MINUTES,

    apiKeyId: config?.apiKeyId ?? null,

    numbers,

    templates: eligibleTemplates.map(template => ({
      id: template.id,
      name: template.name,
      language: template.language,
      category: template.category,
      status: template.status,
      waNumberId: template.waNumberId,
    })),
  };
}

/**
 * Save Authentication configuration for a workspace.
 *
 * The selected WhatsApp number and template must belong
 * to the same workspace.
 */
export async function updateAuthenticationConfiguration(
  workspaceId,
  {
    enabled,
    templateId,
    waNumberId,
  }
) {
  if (!workspaceId) {
    throw createError('Workspace is required.', 400);
  }

  if (
    enabled !== undefined &&
    typeof enabled !== 'boolean'
  ) {
    throw createError(
      '`enabled` must be a boolean.',
      400
    );
  }

  if (!templateId) {
    throw createError(
      'Authentication template is required.',
      400
    );
  }

  if (!waNumberId) {
    throw createError(
      'Authentication WhatsApp number is required.',
      400
    );
  }

  const [template, waNumber] = await Promise.all([
    prisma.template.findFirst({
      where: {
        id: templateId,
        workspaceId,
        status: 'APPROVED',
      },
      select: {
        id: true,
        name: true,
        category: true,
        status: true,
        components: true,
        waNumberId: true,
      },
    }),

    prisma.waNumber.findFirst({
      where: {
        id: waNumberId,
        workspaceId,
      },
      select: {
        id: true,
        phoneNumber: true,
        displayName: true,
      },
    }),
  ]);

  if (!waNumber) {
    throw createError(
      'The selected WhatsApp number does not belong to this workspace.',
      422
    );
  }

  if (!template) {
    throw createError(
      'The selected authentication template is not approved or does not exist.',
      422
    );
  }

  if (
    String(template.category || '').toUpperCase() !==
    'AUTHENTICATION'
  ) {
    throw createError(
      'The selected template is not an AUTHENTICATION template.',
      422
    );
  }

  if (!isCopyCodeAuthenticationTemplate(template)) {
    throw createError(
      'Only approved COPY_CODE authentication templates are supported.',
      422
    );
  }

  /*
   * A template belongs to a WhatsApp number in ChatFlow.
   * Prevent configuration from pairing the template with
   * a different number.
   */
  if (
    template.waNumberId &&
    template.waNumberId !== waNumber.id
  ) {
    throw createError(
      'The selected authentication template belongs to a different WhatsApp number.',
      422
    );
  }

  const config =
    await prisma.authenticationConfig.upsert({
      where: {
        workspaceId,
      },
      create: {
        workspaceId,
        enabled: enabled ?? false,
        templateId,
        waNumberId,
      },
      update: {
        ...(enabled !== undefined
          ? { enabled }
          : {}),
        templateId,
        waNumberId,
      },
      select: {
        id: true,
        workspaceId: true,
        enabled: true,
        templateId: true,
        waNumberId: true,
        apiKeyId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

  return {
    ...config,
    otpExpirationMinutes:
      AUTHENTICATION_OTP_EXPIRATION_MINUTES,
  };
}