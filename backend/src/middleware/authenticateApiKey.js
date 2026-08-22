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
      select: { id: true, name: true, workspaceId: true, scopes: true }
    });

    if (!apiKey) {
      return res.status(401).json({ error: 'Invalid or revoked API key' });
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
