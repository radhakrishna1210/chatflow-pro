import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { isAccessTokenRevoked } from '../lib/tokenDenylist.js';

function userFromPayload(payload) {
  return {
    id: payload.sub,
    workspaceId: payload.workspaceId,
    role: payload.role,
    superAdmin: payload.superAdmin === true,
    // Set only on a super admin's impersonation token: the admin's user id.
    impersonatedBy: typeof payload.imp === 'string' ? payload.imp : null,
    jti: payload.jti ?? null,
    exp: payload.exp ?? null,
  };
}

// What an impersonation session may not do: anything that would mint a
// credential outliving it (a full session, an API key, an OAuth grant) or that
// changes the account itself rather than working inside it.
const IMPERSONATION_FORBIDDEN = [
  ['POST', /^\/api\/v1\/workspaces$/],
  ['POST', /^\/api\/v1\/workspaces\/[^/]+\/switch$/],
  ['POST', /^\/api\/v1\/invitations\/[^/]+\/accept$/],
  ['*', /^\/api\/v1\/workspaces\/[^/]+\/api-keys\/authentication$/],
  ['WRITE', /^\/api\/v1\/workspaces\/[^/]+\/api-keys(\/.*)?$/],
  ['POST', /^\/api\/v1\/oauth\/consent\/decide$/],
  ['POST', /^\/api\/v1\/users\/me\/password$/],
  ['POST', /^\/api\/v1\/users\/me\/sessions\/revoke-others$/],
  ['DELETE', /^\/api\/v1\/users\/me$/],
];

export function isForbiddenWhileImpersonating(method, url) {
  const path = String(url || '').split('?')[0].replace(/\/+$/, '');
  return IMPERSONATION_FORBIDDEN.some(([m, re]) => (
    (m === '*' || m === method || (m === 'WRITE' && method !== 'GET' && method !== 'HEAD'))
    && re.test(path)
  ));
}

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

  req.user = userFromPayload(payload);

  if (req.user.impersonatedBy && isForbiddenWhileImpersonating(req.method, req.originalUrl)) {
    return res.status(403).json({
      error: 'Not available while impersonating. Return to admin first.',
      code: 'IMPERSONATION_FORBIDDEN',
    });
  }
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
    req.user = userFromPayload(payload);
  } catch {
    // An expired or malformed token is not an error here — there is simply
    // nothing to revoke.
  }
  next();
}
