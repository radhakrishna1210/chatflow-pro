import { prisma } from '../lib/prisma.js';
import { randomBytes, createHash } from 'crypto';
import { queueApiKeyCreatedEmail } from './email.service.js';
import { assertWithinLimit } from './subscription.service.js';
import { normalizePhone } from './optout.service.js';
import { normaliseScopes, API_SCOPES, DEFAULT_SCOPES } from '../lib/apiScopes.js';

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
  // `default` says which ones a key gets when the caller chooses nothing, so the
  // UI can tick exactly those and stay in step with normaliseScopes() instead of
  // hardcoding a second opinion about what a sensible key looks like.
  return API_SCOPES.map((s) => ({ ...s, default: DEFAULT_SCOPES.includes(s.id) }));
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

  // req.user (from the JWT) carries only an id — no email or name — so the
  // security notice was being queued to `undefined` and never arrived.
  if (user?.id && !user.email) {
    user = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true, name: true } }).catch(() => null);
  }

  if (user?.email) {
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
 */
export async function sendTestMessage(
  workspaceId,
  { to, templateId, message, variables = [] }
) {
  /*
   * A test send is a real send, so it takes the same path as the public API
   * and the inbox: 24-hour window for free text, opt-out, approved templates
   * only, required variables, wallet credit (refunded if Meta refuses) and a
   * stored message in the conversation. It used to call Meta directly and
   * skip every one of those.
   */
  const recipient = normalizePhone(to);
  if (recipient.length < 8) {
    const error = new Error('Enter the recipient in international format, e.g. +919876543210');
    error.status = 400;
    throw error;
  }

  const { sendPublicMessage } = await import('./whatsapp.service.js');

  let result;
  if (templateId) {
    const name = String(templateId).trim();
    const template = await prisma.template.findFirst({
      where: { workspaceId, name, status: { not: 'DELETED' } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!template) {
      const error = new Error(
        `Template not found: "${name}". Use the template's name exactly as it appears on the Templates page (e.g. welcome_new_customer).`
      );
      error.status = 404;
      throw error;
    }
    const supplied = (Array.isArray(variables) ? variables : []).map((value) => String(value ?? ''));
    result = await sendPublicMessage(workspaceId, {
      to: recipient,
      type: 'template',
      template: { name, language: template.language, variables: supplied },
    });
  } else {
    if (!message || !String(message).trim()) {
      const error = new Error('Enter a message to send');
      error.status = 400;
      throw error;
    }
    result = await sendPublicMessage(workspaceId, { to: recipient, type: 'text', body: String(message) });
  }

  return {
    ok: true,
    messageId: result?.messages?.[0]?.id ?? null,
    conversationId: result?.conversationId ?? null,
  };
}
