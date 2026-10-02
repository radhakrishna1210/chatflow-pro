import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env.js';

// Signed `state` helpers shared by the OAuth flows, carrying small bits of
// context (a workspaceId, an encrypted invite token, …) through the redirect
// round-trip without a server-side session.
//
// A signature proves the state was minted here, not that the browser
// returning it is the one that started the flow — that needs a cookie (see
// the Google routes). States are signed with a key derived from
// JWT_ACCESS_SECRET for this purpose only, so the access-token key is never
// used to sign anything else.

let stateKey = null;
const key = () => {
  stateKey ||= createHmac('sha256', env.JWT_ACCESS_SECRET).update('chatflow:oauth-state:v1').digest();
  return stateKey;
};

export function signState(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', key()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyState(state, maxAgeMs = 10 * 60_000) {
  try {
    const [data, sig] = String(state || '').split('.');
    if (!data || !sig) return null;
    const expected = createHmac('sha256', key()).update(data).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!payload.ts || Date.now() - payload.ts > maxAgeMs) return null;
    return payload;
  } catch {
    return null;
  }
}

// Reads one cookie off the request without a cookie-parser dependency.
export function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

export function nonceMatches(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string' || !expected) return false;
  const a = Buffer.from(expected), b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}
