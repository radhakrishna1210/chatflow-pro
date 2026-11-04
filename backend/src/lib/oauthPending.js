import { randomBytes } from 'crypto';
import { redis } from './redis.js';

// Binds an OAuth callback to the signed-in user who started the flow.
//
// A provider's callback is a plain browser redirect: it carries no bearer
// token, so all it can prove is that *someone* holds a valid `state`. Signing
// the state (or keeping it in Redis) proves we minted it — not that the browser
// arriving with it belongs to the person we minted it for. An attacker could
// start a connection in their own workspace, send the authorize URL to a
// victim, and the victim's Instagram / Google / HubSpot account would be
// linked into the attacker's workspace (and the reverse, sending a victim the
// attacker's own completed callback, plants the attacker's account in theirs).
//
// So the callback no longer finishes the connection. It parks the authorization
// code here under a fresh one-time id and redirects to the app, which — signed
// in — calls a `complete` endpoint with that id. The connection is made only if
// the authenticated user and workspace on that call are the ones that started
// the flow. Unlike a cookie nonce this does not depend on the API and the SPA
// sharing a hostname.

const TTL_SEC = 600;
const key = (id) => `oauth:pending:${id}`;

export async function parkOAuthCallback({ kind, workspaceId, userId, data }) {
  const id = randomBytes(24).toString('base64url');
  await redis.set(key(id), JSON.stringify({ kind, workspaceId, userId, data, ts: Date.now() }), 'EX', TTL_SEC);
  return id;
}

const refuse = (status, message, code) => {
  const e = new Error(message);
  e.status = status; e.code = code; e.expose = true;
  return e;
};

// Single use: the record is deleted on the first claim, whoever makes it, so a
// leaked id is burned by the first wrong caller rather than left for retries.
export async function claimOAuthCallback(id, { kind, workspaceId, userId }) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
    throw refuse(400, 'Missing or malformed connection reference.', 'OAUTH_PENDING_INVALID');
  }
  const raw = await redis.getdel(key(id));
  if (!raw) throw refuse(410, 'This connection request has expired or was already used — start again.', 'OAUTH_PENDING_EXPIRED');
  let rec;
  try { rec = JSON.parse(raw); } catch { rec = null; }
  if (!rec || rec.kind !== kind) throw refuse(400, 'This connection reference is not for this integration.', 'OAUTH_PENDING_INVALID');
  if (!userId || rec.userId !== userId || rec.workspaceId !== workspaceId) {
    console.warn(`[oauth:${kind}] refused a callback completed by a different user/workspace (possible OAuth CSRF)`);
    throw refuse(403, 'This connection was started by a different account or workspace, so it was not completed. Start the connection again from this account.', 'OAUTH_PENDING_MISMATCH');
  }
  return rec.data;
}
