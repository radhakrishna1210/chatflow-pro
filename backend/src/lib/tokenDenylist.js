import { redis } from '../lib/redis.js';

// Revoked access tokens, by `jti`, and per-user "signed out everywhere" marks.
//
// Access tokens are stateless and short-lived, so signing out used to leave the
// current one working until it expired on its own — up to JWT_EXPIRES_IN after
// the user pressed "Sign out". That is the whole gap this closes: logout adds
// the token's jti here, and authenticate() refuses anything listed. Disabling
// an account or "sign out everywhere" records a time instead, and every token
// the user was issued before it is refused.
//
// Entries expire exactly when the tokens they cover would have, so the list
// can never grow beyond the tokens that are still live.
//
// Every revocation is also kept in this process's memory. Redis is the shared
// record; the local copy means a revocation made here still holds while Redis
// is unreachable, instead of the check silently allowing everything.

const KEY = (jti) => `revoked:at:${jti}`;
const USER_KEY = (userId) => `revoked:user:${userId}`;

const localJti = new Map();       // jti -> expiresAtMs
const localUsers = new Map();     // userId -> { before: sec, expiresAtMs }

function pruneLocal(now = Date.now()) {
  for (const [k, until] of localJti) if (until <= now) localJti.delete(k);
  for (const [k, v] of localUsers) if (v.expiresAtMs <= now) localUsers.delete(k);
}

const redisReady = () => redis.status === 'ready';

// `exp` is the JWT's own expiry in seconds since the epoch. Anything already
// past it needs no entry — the signature check rejects it anyway.
export async function revokeAccessToken(jti, exp) {
  if (!jti) return false;
  const ttlSec = Math.ceil((Number(exp) * 1000 - Date.now()) / 1000);
  if (!Number.isFinite(ttlSec) || ttlSec <= 0) return false;
  pruneLocal();
  localJti.set(jti, Date.now() + ttlSec * 1000);
  try {
    await redis.set(KEY(jti), '1', 'EX', ttlSec);
    return true;
  } catch (err) {
    console.error('[auth] Could not record access-token revocation in Redis (kept locally):', err.message);
    return false;
  }
}

// Refuses every access token issued to `userId` before now. `ttlSec` must be at
// least the access-token lifetime.
export async function revokeAllUserAccessTokens(userId, ttlSec) {
  if (!userId) return false;
  const before = Math.floor(Date.now() / 1000);
  pruneLocal();
  localUsers.set(userId, { before, expiresAtMs: Date.now() + ttlSec * 1000 });
  try {
    await redis.set(USER_KEY(userId), String(before), 'EX', ttlSec);
    return true;
  } catch (err) {
    console.error('[auth] Could not record user sign-out in Redis (kept locally):', err.message);
    return false;
  }
}

function revokedLocally(jti, userId, iat) {
  const now = Date.now();
  if (jti && localJti.get(jti) > now) return true;
  const mark = userId ? localUsers.get(userId) : null;
  return Boolean(mark && mark.expiresAtMs > now && Number(iat) <= mark.before);
}

// Whether a presented access token has been revoked — by its own jti, or by
// a sign-out-everywhere for its user issued at or after the token's `iat`.
export async function isAccessTokenRevoked(jti, { userId = null, iat = null } = {}) {
  if (!jti && !userId) return false;
  if (revokedLocally(jti, userId, iat)) return true;
  if (!redisReady()) return false;
  try {
    const [byJti, userBefore] = await redis.mget(jti ? KEY(jti) : '__none__', userId ? USER_KEY(userId) : '__none__');
    if (byJti) return true;
    return userBefore != null && iat != null && Number(iat) <= Number(userBefore);
  } catch (err) {
    console.error('[auth] Revocation check unavailable, using this instance\'s list only:', err.message);
    return false;
  }
}
