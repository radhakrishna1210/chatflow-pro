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

/**
 * Workspace-scoped Authentication API/OTP usage.
 *
 * AuthenticationTransaction is the source of truth here: direct API requests
 * intentionally have campaignId = NULL and must be visible alongside OTPs
 * issued by Authentication campaigns. A Meta message id proves acceptance,
 * not delivery, so delivery stays unavailable until a delivery receipt is
 * stored against AuthenticationTransaction.
 */
export async function getAuthenticationUsage(workspaceId) {
  if (!workspaceId) {
    throw createError('Workspace is required.', 400);
  }

  const now = new Date();
  const [statusRows, pendingExpired, acceptedByWhatsApp, recent] = await Promise.all([
    prisma.authenticationTransaction.groupBy({
      by: ['status'],
      where: { workspaceId },
      _count: { _all: true },
    }),
    // Expiry is a fact of time even if the customer never submits the code and
    // therefore never drives otp.service.js through its EXPIRED transition.
    prisma.authenticationTransaction.count({
      where: { workspaceId, status: 'PENDING', expiresAt: { lte: now } },
    }),
    prisma.authenticationTransaction.count({
      where: { workspaceId, metaMessageId: { not: null } },
    }),
    prisma.authenticationTransaction.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        templateId: true,
        campaignId: true,
        status: true,
        expiresAt: true,
        verifiedAt: true,
        createdAt: true,
        metaMessageId: true,
        campaign: { select: { id: true, name: true } },
      },
    }),
  ]);

  const templateIds = [...new Set(recent.map((transaction) => transaction.templateId))];
  const templates = templateIds.length
    ? await prisma.template.findMany({
        where: { workspaceId, id: { in: templateIds } },
        select: { id: true, name: true },
      })
    : [];
  const templateNameById = new Map(templates.map((template) => [template.id, template.name]));

  const counts = Object.fromEntries(statusRows.map((row) => [row.status, row._count._all]));
  const otpRequests = statusRows.reduce((total, row) => total + row._count._all, 0);
  const verified = counts.VERIFIED || 0;

  return {
    metrics: {
      otpRequests,
      // Meta acceptance is useful operational data, but deliberately not
      // labelled as delivery: a delivery webhook is not persisted for direct
      // Authentication API sends.
      acceptedByWhatsApp,
      delivered: null,
      verified,
      expired: (counts.EXPIRED || 0) + pendingExpired,
      failed: counts.FAILED || 0,
      verificationRate: otpRequests > 0
        ? Number(((verified / otpRequests) * 100).toFixed(1))
        : null,
      deliveryTrackingAvailable: false,
      cost: null,
    },
    recent: recent.map((transaction) => ({
      id: transaction.id,
      templateId: transaction.templateId,
      templateName: templateNameById.get(transaction.templateId) ?? null,
      campaignId: transaction.campaignId,
      campaignName: transaction.campaign?.name ?? null,
      source: transaction.campaignId ? 'CAMPAIGN' : 'API',
      status: transaction.status,
      expiresAt: transaction.expiresAt,
      verifiedAt: transaction.verifiedAt,
      createdAt: transaction.createdAt,
      acceptedByWhatsApp: Boolean(transaction.metaMessageId),
    })),
  };
}
