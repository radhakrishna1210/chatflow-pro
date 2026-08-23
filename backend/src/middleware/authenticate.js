import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { isAccessTokenRevoked } from '../lib/tokenDenylist.js';

export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  const token = authHeader.slice(7);

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Signing out revokes the access token by jti (lib/tokenDenylist.js). A valid
  // signature is no longer sufficient on its own — the token must also not have
  // been handed back.
  if (await isAccessTokenRevoked(payload.jti)) {
    return res.status(401).json({ error: 'Session ended. Please sign in again.' });
  }

  req.user = {
    id: payload.sub,
    workspaceId: payload.workspaceId,
    role: payload.role,
    superAdmin: payload.superAdmin === true,
    jti: payload.jti ?? null,
    exp: payload.exp ?? null,
  };
  next();
}

// Identifies the caller when a usable token is present, and lets the request
// through when it is not. Only for endpoints that must work either way —
// signing out is the case this exists for: the session has to be destroyable
// even once the access token has already expired, but when it is still live we
// need its jti in order to revoke it.
export function authenticateOptional(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next();
  try {
    const payload = jwt.verify(authHeader.slice(7), env.JWT_ACCESS_SECRET);
    req.user = {
      id: payload.sub,
      workspaceId: payload.workspaceId,
      role: payload.role,
      superAdmin: payload.superAdmin === true,
      jti: payload.jti ?? null,
      exp: payload.exp ?? null,
    };
  } catch {
    // An expired or malformed token is not an error here — there is simply
    // nothing to revoke.
  }
  next();
}
