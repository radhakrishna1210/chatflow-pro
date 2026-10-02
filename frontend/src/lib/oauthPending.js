// A consent request parked in sessionStorage while a visitor signs up, so App
// can bring them back to /oauth/consent afterwards (see OAuthConsent.jsx).

/** Matches the 30-minute signed-blob window on the server. */
const PENDING_KEY = 'oauth.pendingRequest';
const PENDING_MAX_AGE_MS = 30 * 60_000;

export function stashPendingOAuthRequest(req) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ req, ts: Date.now() }));
  } catch { /* private mode; the URL copy is still the primary carrier */ }
}

/** @returns the blob, or null when absent or too old. Does not clear it. */
export function peekPendingOAuthRequest() {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const { req, ts } = JSON.parse(raw);
    if (!req || !ts || Date.now() - ts > PENDING_MAX_AGE_MS) {
      sessionStorage.removeItem(PENDING_KEY);
      return null;
    }
    return req;
  } catch { return null; }
}

export function clearPendingOAuthRequest() {
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* nothing to do */ }
}
