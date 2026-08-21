import { redis } from '../lib/redis.js';

// Revoked access tokens, by `jti`.
//
// Access tokens are stateless and short-lived, so signing out used to leave the
// current one working until it expired on its own — up to JWT_EXPIRES_IN after
// the user pressed "Sign out". That is the whole gap this closes: logout adds
// the token's jti here, and authenticate() refuses anything listed.
//
// Entries expire exactly when the token would have, so the list can never grow
// beyond the tokens that are still live.

const KEY = (jti) => `revoked:at:${jti}`;

// `exp` is the JWT's own expiry in seconds since the epoch. Anything already
// past it needs no entry — the signature check rejects it anyway.
export async function revokeAccessToken(jti, exp) {
  if (!jti) return false;
  const ttlSec = Math.ceil((Number(exp) * 1000 - Date.now()) / 1000);
  if (!Number.isFinite(ttlSec) || ttlSec <= 0) return false;
  try {
    await redis.set(KEY(jti), '1', 'EX', ttlSec);
    return true;
  } catch (err) {
    console.error('[auth] Could not revoke access token:', err.message);
    return false;
  }
}

// Fails open when Redis is unreachable, and says so.
//
// The alternative — refusing every request whose revocation status cannot be
// read — turns a cache outage into a total outage for authenticated users.
// Production will not start without Redis (see server.js), so the open case is
// confined to local development, where the degraded-start banner already warns
// that queue-backed behaviour is off.
export async function isAccessTokenRevoked(jti) {
  if (!jti) return false;
  try {
    return (await redis.exists(KEY(jti))) === 1;
  } catch (err) {
    console.error('[auth] Revocation check unavailable, allowing token:', err.message);
    return false;
  }
}
