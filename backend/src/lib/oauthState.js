import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env.js';

// Signed `state` helpers shared by every OAuth flow that needs to bind the
// callback to the browser that started it (CSRF protection) without a
// server-side session, and optionally carry small bits of context (an
// inviteToken, a workspaceId, …) through the redirect round-trip.

export function signState(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', env.JWT_ACCESS_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyState(state, maxAgeMs = 10 * 60_000) {
  try {
    const [data, sig] = String(state || '').split('.');
    if (!data || !sig) return null;
    const expected = createHmac('sha256', env.JWT_ACCESS_SECRET).update(data).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!payload.ts || Date.now() - payload.ts > maxAgeMs) return null;
    return payload;
  } catch {
    return null;
  }
}
