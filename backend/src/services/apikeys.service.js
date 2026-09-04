import { prisma } from '../lib/prisma.js';
import { randomBytes, createHash } from 'crypto';
import { queueApiKeyCreatedEmail } from './email.service.js';
import { assertWithinLimit } from './subscription.service.js';
import { assertNotOptedOut, normalizePhone } from './optout.service.js';
import { decrypt } from '../lib/encryption.js';
import { countVariables } from '../lib/templateParams.js';
import { buildTemplateSendPayload } from './templatePayload.service.js';
import { normaliseScopes, API_SCOPES } from '../lib/apiScopes.js';

function generateKey() {
  const raw = 'cfp_' + randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 12);

  return {
    raw,
    hash,
    prefix,
  };
}

/**
 * Get the workspace's dedicated Authentication API key.
 *
 * The raw secret is returned only when a new key is provisioned.
 * Existing secrets are never stored in plaintext and cannot be recovered.
 */
export async function getOrCreateAuthenticationApiKey(workspaceId) {
  if (!workspaceId) {
    const error = new Error('Workspace ID is required');
    error.status = 400;
    throw error;
  }

  /*
   * Fast path:
   * AuthenticationConfig already points to an active Authentication key.
   */
  const existingConfig = await prisma.authenticationConfig.findUnique({
    where: { workspaceId },
    select: {
      apiKeyId: true,
    },
  });

  if (existingConfig?.apiKeyId) {
    const existingKey = await prisma.apiKey.findFirst({
      where: {
        id: existingConfig.apiKeyId,
        workspaceId,
        revokedAt: null,
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        environment: true,
        scopes: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });

    if (existingKey) {
      return existingKey;
    }
  }

  /*
   * Generate the secret before entering the transaction.
   * It is returned only if this request actually creates the key.
   */
  const { raw, hash, prefix } = generateKey();

  const result = await prisma.$transaction(
    async (tx) => {
      /*
       * Make sure the AuthenticationConfig exists.
       *
       * apiKeyId is intentionally nullable because existing workspaces
       * may already have an AuthenticationConfig created before the
       * Authentication API key feature was introduced.
       */
      const config = await tx.authenticationConfig.upsert({
        where: { workspaceId },
        create: {
          workspaceId,
        },
        update: {},
        select: {
          apiKeyId: true,
        },
      });

      /*
       * Another request may have provisioned the key while this request
       * was starting. Reuse that key instead of creating another one.
       */
      if (config.apiKeyId) {
        const existingKey = await tx.apiKey.findFirst({
          where: {
            id: config.apiKeyId,
            workspaceId,
            revokedAt: null,
          },
          select: {
            id: true,
            name: true,
            keyPrefix: true,
            environment: true,
            scopes: true,
            lastUsedAt: true,
            createdAt: true,
          },
        });

        if (existingKey) {
          return {
            key: existingKey,
            rawKey: null,
          };
        }
      }

      /*
       * Create a dedicated API key with ONLY the Authentication scope.
       *
       * Do not use createApiKey() here because Authentication keys are
       * provisioned by the Authentication system rather than manually
       * created through the normal API-key UI.
       */
      const key = await tx.apiKey.create({
        data: {
          workspaceId,
          name: 'Authentication API Key',
          keyHash: hash,
          keyPrefix: prefix,
          environment: 'production',
          scopes: ['authentication:send'],
        },
        select: {
          id: true,
          name: true,
          keyPrefix: true,
          environment: true,
          scopes: true,
          lastUsedAt: true,
          createdAt: true,
        },
      });

      /*
       * Link the newly-created key to the workspace Authentication
       * configuration.
       */
      await tx.authenticationConfig.update({
        where: { workspaceId },
        data: {
          apiKeyId: key.id,
        },
      });

      return {
        key,
        rawKey: raw,
      };
    },
    {
      /*
       * Serializable isolation protects the get-or-create operation
       * against concurrent provisioning requests.
       */
      isolationLevel: 'Serializable',
    }
  );

  return {
    ...result.key,
    ...(result.rawKey
      ? {
          rawKey: result.rawKey,
        }
      : {}),
  };
}
/**
 * Rotate the workspace's dedicated Authentication API key.
 *
 * The Authentication key is resolved through AuthenticationConfig,
 * so callers never need to know or provide the internal ApiKey ID.
 *
 * The newly generated raw secret is returned once.
 */
export async function rotateAuthenticationApiKey(workspaceId) {
  if (!workspaceId) {
    const error = new Error('Workspace ID is required');
    error.status = 400;
    throw error;
  }

  const config = await prisma.authenticationConfig.findUnique({
    where: { workspaceId },
    select: {
      apiKeyId: true,
    },
  });

  if (!config?.apiKeyId) {
    const error = new Error(
      'Authentication API key has not been provisioned'
    );
    error.status = 404;
    error.code = 'AUTHENTICATION_API_KEY_NOT_FOUND';
    throw error;
  }

  return rotateApiKey(
    workspaceId,
    config.apiKeyId
  );
}

/**
 * List active API keys for the workspace.
 *
 * Raw API secrets are never returned.
 */
export async function listApiKeys(workspaceId) {
  return prisma.apiKey.findMany({
    where: {
      workspaceId,
      revokedAt: null,
    },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      environment: true,
      scopes: true,
      lastUsedAt: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
}

/*
 * The catalogue the UI renders its scope checkboxes from, so the two
 * cannot drift out of step.
 */
export function listApiScopes() {
  return API_SCOPES;
}

/**
 * Create a normal user-managed API key.
 *
 * Authentication API keys should be provisioned through
 * getOrCreateAuthenticationApiKey() instead.
 */
export async function createApiKey(
  workspaceId,
  { name, environment = 'production', scopes },
  user
) {
  await assertWithinLimit(workspaceId, 'apiKey');

  const granted = normaliseScopes(scopes);
  const { raw, hash, prefix } = generateKey();

  await prisma.apiKey.create({
    data: {
      workspaceId,
      name,
      keyHash: hash,
      keyPrefix: prefix,
      environment,
      scopes: granted,
    },
  });

  if (user) {
    queueApiKeyCreatedEmail({
      userEmail: user.email,
      userName: user.name,
      keyName: name,
      environment,
      keyPrefix: prefix,
    }).catch(() => {});
  }

  return {
    rawKey: raw,
    keyPrefix: prefix,
    name,
    environment,
    scopes: granted,
  };
}

/**
 * Rotate an API key.
 *
 * Rotation replaces only the secret. Existing permissions are preserved.
 */
export async function rotateApiKey(workspaceId, id) {
  const key = await prisma.apiKey.findFirst({
    where: {
      id,
      workspaceId,
      revokedAt: null,
    },
  });

  if (!key) {
    const error = new Error('API key not found');
    error.status = 404;
    throw error;
  }

  const { raw, hash, prefix } = generateKey();

  await prisma.apiKey.update({
    where: {
      id,
    },
    data: {
      keyHash: hash,
      keyPrefix: prefix,
    },
  });

  return {
    rawKey: raw,
    keyPrefix: prefix,
    scopes: key.scopes ?? null,
  };
}

/**
 * Revoke an API key.
 */
export async function revokeApiKey(workspaceId, id) {
  const key = await prisma.apiKey.findFirst({
    where: {
      id,
      workspaceId,
    },
  });

  if (!key) {
    const error = new Error('API key not found');
    error.status = 404;
    throw error;
  }

  await prisma.apiKey.update({
    where: {
      id,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}

/*
 * Powers the "Send Test Message" button in the API Playground.
 *
 * Sends a real WhatsApp message through the workspace's connected number.
 * This functionality is unrelated to Authentication API-key provisioning
 * and is intentionally preserved.
 */
export async function sendTestMessage(
  workspaceId,
  { to, templateId, message, variables = [] }
) {
  /*
   * Meta only accepts bare digits. Normalize numbers such as:
   * "+91 8625818751" → "918625818751"
   */
  const recipient = normalizePhone(to);

  if (recipient.length < 8) {
    const error = new Error(
      'Enter the recipient in international format, e.g. +919876543210'
    );
    error.status = 400;
    throw error;
  }

  await assertNotOptedOut(workspaceId, recipient);

  const waNumber = await prisma.waNumber.findFirst({
    where: {
      workspaceId,
    },
  });

  if (!waNumber) {
    const error = new Error('Connect a WhatsApp number first');
    error.status = 404;
    throw error;
  }

  const accessToken = decrypt(waNumber.encryptedAccessToken);

  const {
    sendWhatsAppMessage,
    sendTextMessage,
  } = await import('../lib/meta.js');

  try {
    if (templateId) {
      const name = String(templateId).trim();

      const template = await prisma.template.findFirst({
        where: {
          workspaceId,
          name,
          status: {
            not: 'DELETED',
          },
        },
      });

      if (!template) {
        const error = new Error(
          `Template not found: "${name}". Use the template's name exactly as it appears on the Templates page (e.g. welcome_new_customer).`
        );
        error.status = 404;
        throw error;
      }

      if (
        template.status === 'PENDING' ||
        template.status === 'REJECTED'
      ) {
        const error = new Error(
          `Template "${name}" is ${template.status.toLowerCase()} on Meta and cannot be sent yet.`
        );
        error.status = 422;
        throw error;
      }

      const components = Array.isArray(template.components)
        ? template.components
        : [];

      /*
       * Templates with {{1}}-style variables are supported by the
       * playground. The caller supplies those values.
       */
      const required = components.reduce(
        (max, component) =>
          Math.max(max, countVariables(component?.text)),
        0
      );

      const supplied = (
        Array.isArray(variables) ? variables : []
      ).map((value) => String(value ?? ''));

      if (
        required > 0 &&
        supplied.filter((value) => value.trim()).length < required
      ) {
        const error = new Error(
          `This template needs ${required} variable value${
            required === 1 ? '' : 's'
          } ({{1}}${
            required > 1 ? `–{{${required}}}` : ''
          }). Fill them in and try again.`
        );

        error.status = 422;
        error.code = 'TEMPLATE_VARIABLES_REQUIRED';
        error.details = {
          requiredVariables: required,
        };

        throw error;
      }

      /*
       * Use the same payload builder as campaign sends so the playground
       * remains compatible with template headers, buttons and carousels.
       */
      const payload = await buildTemplateSendPayload(template, {
        phoneNumberId: waNumber.metaPhoneNumberId,
        accessToken,

        resolve: (i) =>
          String(supplied[i] ?? '').trim() || ' ',
      });

      const result = await sendWhatsAppMessage(
        waNumber.metaPhoneNumberId,
        accessToken,
        recipient,
        payload
      );

      return {
        ok: true,
        messageId: result?.messages?.[0]?.id ?? null,
      };
    }

    const result = await sendTextMessage(
      waNumber.metaPhoneNumberId,
      accessToken,
      recipient,
      message
    );

    return {
      ok: true,
      messageId: result?.messages?.[0]?.id ?? null,
    };
  } catch (err) {
    if (err.status) {
      throw err;
    }

    const metaErr = err.response?.data?.error;

    /*
     * Surface Meta's actual error instead of the generic Axios
     * "Request failed with status code 400".
     */
    const detail = metaErr
      ? `${metaErr.message}${
          metaErr.error_data?.details
            ? ` — ${metaErr.error_data.details}`
            : ''
        } (code ${metaErr.code}${
          metaErr.error_subcode
            ? `/${metaErr.error_subcode}`
            : ''
        })`
      : err.message || 'Failed to send test message';

    const error = new Error(detail);
    error.status = 502;

    throw error;
  }
}