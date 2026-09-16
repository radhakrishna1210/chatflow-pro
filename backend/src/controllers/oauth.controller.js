/**
 * The OAuth authorization endpoints.
 *
 * `authorize` and `token` are public — an authorization request arrives as a
 * browser navigation from another application, and the token exchange is a
 * server-to-server call authenticated by the client's own secret. `consentInfo`
 * and `decide` require a logged-in ChatFlow user, because they are the point at
 * which a real person grants access to a workspace they belong to.
 *
 * See services/oauth.service.js for why an unvalidated redirect_uri gets an
 * error page rather than a redirect.
 */
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import * as oauth from '../services/oauth.service.js';
import { OAuthRenderError, OAuthRedirectError } from '../services/oauth.service.js';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/**
 * The one case where we must not redirect: the destination is what failed
 * validation. Plain HTML because there is no trusted app to hand the user to.
 */
function renderError(res, message, status = 400) {
  res.status(status).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorisation failed</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1312;color:#e8edeb;
       font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .card{max-width:34rem;padding:2rem 2.25rem;background:#161c1a;border:1px solid #262e2c;border-radius:12px}
  h1{margin:0 0 .5rem;font-size:1.25rem}
  p{margin:0;color:#8b9793}
</style></head>
<body><div class="card">
  <h1>Authorisation failed</h1>
  <p>${escapeHtml(message)}</p>
</div></body></html>`);
}

/**
 * GET /oauth/authorize
 *
 * Validates, then hands off to the SPA rather than rendering consent here — the
 * user may still need to sign up, create a workspace and connect a number before
 * they can approve anything, and all of that lives in the frontend. The signed
 * `req` blob is what survives that detour.
 */
export async function authorize(req, res) {
  const { client_id: clientId, redirect_uri: redirectUri, response_type: responseType, scope, state } = req.query;

  let validated;
  try {
    validated = await oauth.validateAuthorizeRequest({ clientId, redirectUri, responseType, scope });
  } catch (err) {
    if (err instanceof OAuthRenderError) return renderError(res, err.message);
    if (err instanceof OAuthRedirectError) {
      return res.redirect(oauth.buildRedirect(String(redirectUri), {
        error: err.code, error_description: err.message, state,
      }));
    }
    throw err;
  }

  const pending = oauth.packPendingRequest({
    clientId: validated.client.clientId,
    redirectUri: String(redirectUri),
    scopes: validated.scopes,
    state: state ? String(state) : '',
  });

  res.redirect(`${env.CLIENT_URL}/oauth/consent?req=${encodeURIComponent(pending)}`);
}

/**
 * GET /oauth/consent-info?req=…   (authenticated)
 *
 * Everything the consent screen shows. Re-derived server-side from the signed
 * blob rather than decoded in the browser: the signature proves nobody edited
 * it, but only the server should decide what a given blob actually authorises.
 */
export async function consentInfo(req, res) {
  let described;
  try {
    described = await oauth.describePendingRequest(req.query.req);
  } catch (err) {
    if (err instanceof OAuthRenderError) return res.status(400).json({ error: err.message });
    if (err instanceof OAuthRedirectError) return res.status(400).json({ error: err.message, code: err.code });
    throw err;
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: req.user.workspaceId },
    select: { id: true, name: true },
  });

  // A user with no workspace cannot grant anything — the frontend guard should
  // have sent them to setup, but say so plainly if they arrive here anyway.
  if (!workspace) {
    return res.status(409).json({
      error: 'Create a workspace before connecting an application.',
      code: 'NO_WORKSPACE',
    });
  }

  const alreadyGranted = await oauth.hasConsent({
    userId: req.user.id,
    workspaceId: workspace.id,
    clientId: described.client.clientId,
    scopes: described.scopes,
  });

  res.json({
    client: { name: described.client.name },
    workspace: { id: workspace.id, name: workspace.name },
    scopes: oauth.describeScopes(described.scopes),
    alreadyGranted,
  });
}

/**
 * POST /oauth/consent/decide   { req, decision }   (authenticated)
 *
 * The user and workspace come from the verified JWT, never from the blob — a
 * blob minted before the user had even signed up must not be able to name whose
 * workspace is being connected.
 */
export async function decide(req, res) {
  const { req: reqToken, decision } = req.body ?? {};

  let described;
  try {
    described = await oauth.describePendingRequest(reqToken);
  } catch (err) {
    if (err instanceof OAuthRenderError || err instanceof OAuthRedirectError) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }

  if (decision !== 'approve') {
    return res.json({
      redirectUrl: oauth.buildRedirect(described.redirectUri, {
        error: 'access_denied',
        error_description: 'The request was declined.',
        state: described.state,
      }),
    });
  }

  const workspaceId = req.user.workspaceId;
  if (!workspaceId) {
    return res.status(409).json({ error: 'Create a workspace before connecting an application.', code: 'NO_WORKSPACE' });
  }

  await oauth.recordConsent({
    userId: req.user.id,
    workspaceId,
    clientId: described.client.clientId,
    scopes: described.scopes,
  });

  const code = await oauth.issueAuthorizationCode({
    clientId: described.client.clientId,
    userId: req.user.id,
    workspaceId,
    scopes: described.scopes,
    redirectUri: described.redirectUri,
  });

  res.json({
    redirectUrl: oauth.buildRedirect(described.redirectUri, { code, state: described.state }),
  });
}

/**
 * POST /oauth/token
 *
 * Form-encoded in, JSON out — that is what a standard OAuth client expects, and
 * specifically what Spandan's generic `exchangeCode` sends and parses.
 */
export async function token(req, res) {
  const {
    grant_type: grantType,
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  } = req.body ?? {};

  if (grantType !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  try {
    const payload = await oauth.exchangeAuthorizationCode({ code, clientId, clientSecret, redirectUri });
    // No-store is required for token responses (RFC 6749 §5.1) — this body
    // contains a credential and must not sit in any intermediary's cache.
    res.set('Cache-Control', 'no-store').json(payload);
  } catch (err) {
    if (err instanceof OAuthRedirectError) {
      const status = err.code === 'invalid_client' ? 401 : err.code === 'server_error' ? 500 : 400;
      return res.status(status).json({ error: err.code, error_description: err.message });
    }
    throw err;
  }
}

/**
 * POST /oauth/revoke   { client_id, client_secret, token }
 *
 * Called by the client when a user disconnects on its side, so a working key is
 * not left behind here. Idempotent: revoking an unknown or already-revoked key
 * reports success rather than confirming which key strings exist.
 */
export async function revoke(req, res) {
  const { client_id: clientId, client_secret: clientSecret, token: tokenValue } = req.body ?? {};
  try {
    const out = await oauth.revokeIssuedKey({ clientId, clientSecret, token: tokenValue });
    res.json(out);
  } catch (err) {
    if (err instanceof OAuthRedirectError) {
      return res.status(401).json({ error: err.code, error_description: err.message });
    }
    throw err;
  }
}
