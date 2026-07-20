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
      }
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
    
    // Mock req.user for controllers that rely on the dashboard authenticate middleware
    req.user = {
      id: 'api-key-caller',
      workspaceId: apiKey.workspaceId,
      role: 'ADMIN',
      superAdmin: false
    };

    next();
  } catch (error) {
    console.error('[ApiKeyAuth] Error:', error);
    return res.status(500).json({ error: 'Internal server error during authentication' });
  }
}
