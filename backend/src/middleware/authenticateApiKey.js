import { createHash } from 'crypto';
import { prisma } from '../lib/prisma.js';

export async function authenticateApiKey(req, res, next) {
  let rawKey = req.headers['x-api-key'];
  if (Array.isArray(rawKey)) rawKey = rawKey[0];
  
  if (!rawKey || typeof rawKey !== 'string' || rawKey.trim() === '') {
    return res.status(401).json({ error: 'Missing x-api-key header' });
  }

  rawKey = rawKey.trim();

  try {
    const hash = createHash('sha256').update(rawKey).digest('hex');

    const apiKey = await prisma.apiKey.findFirst({
      where: {
        keyHash: hash,
        revokedAt: null
      },
      select: {
        id: true, name: true, workspaceId: true, scopes: true,
        workspace: { select: { suspended: true, subscription: { select: { status: true } } } },
      }
    });

    if (!apiKey) {
      return res.status(401).json({ error: 'Invalid or revoked API key' });
    }

    // The same gate workspaceContext applies to the dashboard. Without it a
    // suspended workspace — or one whose plan has lapsed — was locked out of
    // the UI but could keep sending messages and launching campaigns through
    // any key it had already issued.
    if (apiKey.workspace?.suspended) {
      return res.status(403).json({ error: 'This workspace has been suspended. Please contact support.', code: 'WORKSPACE_SUSPENDED' });
    }
    if (['CANCELLED', 'EXPIRED'].includes(apiKey.workspace?.subscription?.status)) {
      return res.status(403).json({ error: "This workspace's subscription is inactive. Renew the plan to use the API.", code: 'SUBSCRIPTION_INACTIVE' });
    }

    // Update lastUsedAt asynchronously (fire and forget to not block the request)
    prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() }
    }).catch(err => console.error('[ApiKey] Failed to update lastUsedAt:', err));

    // Attach to request
    req.workspaceId = apiKey.workspaceId;
    req.apiKey = { id: apiKey.id, name: apiKey.name, scopes: apiKey.scopes ?? null };

    // Stands in for req.user so controllers written for the dashboard's
    // authenticate middleware work unchanged.
    //
    // The role is CLIENT, not ADMIN. Every key used to be handed ADMIN, which
    // is the role that guards spending money and granting access — neither of
    // which any public endpoint offers, so the elevation bought nothing and
    // would have been the blast radius of a leaked key. What a key may actually
    // do is decided by its scopes (lib/apiScopes.js).
    req.user = {
      id: `api-key:${apiKey.id}`,
      workspaceId: apiKey.workspaceId,
      role: 'CLIENT',
      superAdmin: false,
    };

    next();
  } catch (error) {
    console.error('[ApiKeyAuth] Error:', error);
    return res.status(500).json({ error: 'Internal server error during authentication' });
  }
}
