/**
 * ChatFlow as an OAuth authorization server.
 *
 * Everything else here called OAuth points the other way — ChatFlow as a client
 * of Google, Meta, Instagram. This is the outbound direction: another
 * application sends a user here, the user approves, and the application walks
 * away with a scoped ApiKey instead of copying one out of Settings by hand.
 *
 * ── The one rule that matters ────────────────────────────────────────────────
 * `redirect_uri` is compared by EXACT STRING against the client's registered
 * list, at both the authorize step and again at the token step. Nothing looser.
 * Prefix or same-origin matching is how this gets broken: anything that accepts
 * a near-miss lets an attacker point the authorization response at a listener
 * they control and redeem the code. And until a redirect_uri has been validated
 * we must not redirect to it at all — an invalid one gets an error page, never a
 * redirect, because redirecting is the thing being abused.
 */
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { prisma } from '../lib/prisma.js';
import { signState, verifyState } from '../lib/oauthState.js';
import { API_SCOPES } from '../lib/apiScopes.js';
import { createApiKey } from './apikeys.service.js';

/**
 * A signup detour — email OTP, workspace creation, connecting a WhatsApp number —
 * takes far longer than the 10 minutes oauthState defaults to. Thirty is enough
 * to read an email without leaving an approval sitting around all afternoon.
 */
const PENDING_REQUEST_MAX_AGE_MS = 30 * 60_000;

/**
 * RFC 6749 §4.1.2 recommends a maximum of ten minutes. Nothing here needs even
 * that: the code goes from a redirect straight into a server-to-server call with
 * no human in the loop.
 */
const CODE_TTL_MS = 2 * 60_000;

const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

const SCOPE_LABELS = new Map(API_SCOPES.map((s) => [s.id, s.label]));

/**
 * Errors the caller must NOT turn into a redirect — the redirect target itself
 * is what failed validation, so sending the browser there is the vulnerability.
 */
export class OAuthRenderError extends Error {
  constructor(message) { super(message); this.name = 'OAuthRenderError'; }
}

/** Errors that are safe to report back to an already-validated redirect_uri. */
export class OAuthRedirectError extends Error {
  constructor(code, description) {
    super(description || code);
    this.name = 'OAuthRedirectError';
    this.code = code;
  }
}

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') { try { const v = JSON.parse(value); return Array.isArray(v) ? v : []; } catch { return []; } }
  return [];
};

/**
 * Validate an incoming /oauth/authorize request.
 *
 * Order is deliberate: the client and the redirect URI are checked FIRST, and
 * their failures throw OAuthRenderError, because everything after them is
 * reported by redirecting to the redirect URI — which is only safe once it has
 * been proven to belong to the client.
 */
export async function validateAuthorizeRequest({ clientId, redirectUri, responseType, scope }) {
  if (!clientId) throw new OAuthRenderError('This link is missing the application it is for.');

  const client = await prisma.oAuthClient.findUnique({ where: { clientId: String(clientId) } });
  if (!client || client.disabledAt) {
    throw new OAuthRenderError('Unknown application. This link was not issued by anything ChatFlow recognises.');
  }

  const registered = parseJsonArray(client.redirectUris);
  if (!redirectUri || !registered.includes(String(redirectUri))) {
    throw new OAuthRenderError(`${client.name} asked to be sent somewhere ChatFlow has not registered for it. Nothing has been shared.`);
  }

  // Past this point the redirect URI is trusted, so failures can be reported there.
  if (responseType !== 'code') {
    throw new OAuthRedirectError('unsupported_response_type', 'Only the authorization code flow is supported.');
  }

  // Spandan sends scopes space-joined (its buildAuthUrl). Trim to what this
  // client is registered for rather than refusing outright: a newer version of
  // the client asking for one extra scope should degrade, not break, and the
  // consent screen only ever shows and grants the intersection.
  const requested = String(scope || '').split(/[\s,]+/).filter(Boolean);
  const allowed = parseJsonArray(client.allowedScopes);
  const scopes = requested.filter((s) => allowed.includes(s));
  if (scopes.length === 0) {
    throw new OAuthRedirectError('invalid_scope', 'None of the requested permissions are available to this application.');
  }

  return { client, scopes };
}

/**
 * Pack the request into a signed blob that survives the detour through signup,
 * workspace creation and number connection.
 *
 * There are no cookies anywhere in ChatFlow, so a server-side session is not an
 * option — the signed blob rides in the query string and every intermediate page
 * is responsible for carrying it. It is HMAC-signed, so a user who edits it in
 * the address bar gets a rejected request rather than an altered one.
 *
 * Note what is NOT in here: the user or the workspace. Those come from the JWT
 * at approval time. Trusting an identity carried in a blob minted before the
 * user had even signed up would let one user's link approve another's workspace.
 */
export function packPendingRequest({ clientId, redirectUri, scopes, state }) {
  return signState({ clientId, redirectUri, scopes, state, ts: Date.now() });
}

/** @returns the payload, or null when missing, tampered with or expired. */
export function readPendingRequest(req) {
  const payload = verifyState(req, PENDING_REQUEST_MAX_AGE_MS);
  if (!payload?.clientId || !payload?.redirectUri || !Array.isArray(payload.scopes)) return null;
  return payload;
}

/** Human-readable permissions for the consent screen. */
export function describeScopes(scopes) {
  return scopes.map((id) => ({ id, label: SCOPE_LABELS.get(id) ?? id }));
}

/**
 * Re-validate a pending request and describe it, for the consent screen.
 *
 * Re-validated server-side rather than trusted from the blob: the signature
 * proves nobody edited it, but the client could have been disabled or its
 * redirect URIs changed in the half hour since it was minted.
 */
export async function describePendingRequest(reqToken) {
  const pending = readPendingRequest(reqToken);
  if (!pending) throw new OAuthRenderError('This authorisation link has expired. Start again from the application that sent you.');

  const { client, scopes } = await validateAuthorizeRequest({
    clientId: pending.clientId,
    redirectUri: pending.redirectUri,
    responseType: 'code',
    scope: pending.scopes.join(' '),
  });

  return { client, scopes, state: pending.state ?? '', redirectUri: pending.redirectUri };
}

/**
 * Mint a single-use authorization code.
 *
 * `userId` and `workspaceId` come from the caller's verified JWT, never from the
 * pending blob — see packPendingRequest.
 */
export async function issueAuthorizationCode({ clientId, userId, workspaceId, scopes, redirectUri }) {
  const code = randomBytes(32).toString('hex');
  await prisma.oAuthAuthorizationCode.create({
    data: {
      code,
      clientId,
      userId,
      workspaceId,
      redirectUri,
      scopes,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  return code;
}

/** Remember the approval, so a reconnect need not ask again. */
export async function recordConsent({ userId, workspaceId, clientId, scopes }) {
  await prisma.oAuthConsent.upsert({
    where: { userId_workspaceId_clientId: { userId, workspaceId, clientId } },
    update: { scopes, revokedAt: null },
    create: { userId, workspaceId, clientId, scopes },
  });
}

/** Has this user already approved at least these scopes for this client here? */
export async function hasConsent({ userId, workspaceId, clientId, scopes }) {
  const row = await prisma.oAuthConsent.findUnique({
    where: { userId_workspaceId_clientId: { userId, workspaceId, clientId } },
  });
  if (!row || row.revokedAt) return false;
  const granted = parseJsonArray(row.scopes);
  return scopes.every((s) => granted.includes(s));
}

/** Build the URL the browser is sent back to. */
export function buildRedirect(redirectUri, params) {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * Exchange an authorization code for a scoped API key.
 *
 * The consume is ONE conditional write, not a read followed by an update. A
 * check-then-update pair races, and two simultaneous exchanges of the same code
 * would each pass the check and each mint a key.
 */
export async function exchangeAuthorizationCode({ code, clientId, clientSecret, redirectUri }) {
  if (!code || !/^[0-9a-f]{64}$/.test(String(code))) {
    throw new OAuthRedirectError('invalid_grant', 'Malformed authorization code.');
  }

  const client = await prisma.oAuthClient.findUnique({ where: { clientId: String(clientId || '') } });
  if (!client || client.disabledAt) throw new OAuthRedirectError('invalid_client', 'Unknown application.');

  // Constant-time: a byte-at-a-time comparison of a secret is recoverable.
  const given = Buffer.from(sha256(clientSecret || ''));
  const expected = Buffer.from(client.clientSecretHash);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new OAuthRedirectError('invalid_client', 'Client authentication failed.');
  }

  // Claim the code and check every condition in the same statement.
  const now = new Date();
  const claimed = await prisma.oAuthAuthorizationCode.updateMany({
    where: { code: String(code), clientId: client.clientId, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  if (claimed.count !== 1) {
    throw new OAuthRedirectError('invalid_grant', 'This authorization code has expired or has already been used.');
  }

  const row = await prisma.oAuthAuthorizationCode.findUnique({ where: { code: String(code) } });

  // The redirect_uri at token time must equal the one the code was issued for
  // (RFC 6749 §4.1.3) — this is what stops a code intercepted in transit from
  // being redeemed against a different callback.
  if (String(redirectUri || '') !== row.redirectUri) {
    throw new OAuthRedirectError('invalid_grant', 'redirect_uri does not match the one this code was issued for.');
  }

  const scopes = parseJsonArray(row.scopes);
  let created;
  try {
    created = await createApiKey(
      row.workspaceId,
      { name: `${client.name} (connected app)`, environment: 'production', scopes },
      null,
    );
  } catch (err) {
    // assertWithinLimit throws here when the workspace is at its plan's API key
    // limit. Reaching the user as a bare 500 mid-connect reads as nonsense, so
    // say the actual thing that is wrong.
    throw new OAuthRedirectError(
      'server_error',
      /limit/i.test(err.message || '')
        ? 'This ChatFlow workspace has reached its API key limit. Revoke an unused key and try connecting again.'
        : `Could not issue an API key: ${err.message}`,
    );
  }

  return {
    access_token: created.rawKey,
    token_type: 'Bearer',
    scope: scopes.join(' '),
    // Deliberately no expires_in: these keys do not expire, and returning a
    // number would have the client stamp a false expiry on it.
  };
}

/**
 * Revoke a key a client was issued. Called by the client when a user disconnects
 * on its side, so nothing live is left behind here.
 */
export async function revokeIssuedKey({ clientId, clientSecret, token }) {
  const client = await prisma.oAuthClient.findUnique({ where: { clientId: String(clientId || '') } });
  if (!client || client.disabledAt) throw new OAuthRedirectError('invalid_client', 'Unknown application.');

  const given = Buffer.from(sha256(clientSecret || ''));
  const expected = Buffer.from(client.clientSecretHash);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new OAuthRedirectError('invalid_client', 'Client authentication failed.');
  }

  const keyHash = sha256(String(token || ''));
  const result = await prisma.apiKey.updateMany({
    where: { keyHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  // Idempotent by design: revoking an already-revoked or unknown key is a
  // success from the caller's point of view — the key does not work either way,
  // and reporting "not found" would leak which key strings exist.
  return { revoked: result.count > 0 };
}
