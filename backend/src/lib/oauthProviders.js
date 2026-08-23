import { env } from '../config/env.js';

// Registry of OAuth 2.0 (authorization-code) providers for integrations.
// Each provider reads its client credentials from environment variables named
// <KEY>_CLIENT_ID / <KEY>_CLIENT_SECRET, so a new provider goes live simply by
// setting those env vars — no code change. `configured` reflects whether the
// credentials are actually present, which lets the UI/API be honest about
// which "Connect" buttons will really work.

const APP_URL = env.APP_URL || `http://localhost:${env.PORT}`;

function creds(key) {
  return {
    clientId: process.env[`${key}_CLIENT_ID`],
    clientSecret: process.env[`${key}_CLIENT_SECRET`],
  };
}

// provider id -> definition
const REGISTRY = {
  google: {
    label: 'Google',
    envKey: 'GOOGLE',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/spreadsheets.readonly',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  shopify: {
    label: 'Shopify',
    envKey: 'SHOPIFY',
    // Shopify auth URL is shop-specific; the shop domain is supplied at connect time.
    authUrl: (params) => `https://${params.shop}/admin/oauth/authorize`,
    tokenUrl: (params) => `https://${params.shop}/admin/oauth/access_token`,
    scope: 'read_products,read_orders,read_customers',
    needs: ['shop'],
  },
  hubspot: {
    label: 'HubSpot',
    envKey: 'HUBSPOT',
    authUrl: 'https://app.hubspot.com/oauth/authorize',
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    scope: 'crm.objects.contacts.read crm.objects.contacts.write',
  },
  slack: {
    label: 'Slack',
    envKey: 'SLACK',
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scope: 'chat:write,channels:read',
  },
  mailchimp: {
    label: 'Mailchimp',
    envKey: 'MAILCHIMP',
    authUrl: 'https://login.mailchimp.com/oauth2/authorize',
    tokenUrl: 'https://login.mailchimp.com/oauth2/token',
    scope: '',
  },
};

export function getProvider(id) {
  return REGISTRY[id] || null;
}

export function isOAuthProvider(id) {
  return !!REGISTRY[id];
}

export function providerConfigured(id) {
  const def = REGISTRY[id];
  if (!def) return false;
  const c = creds(def.envKey);
  return !!(c.clientId && c.clientSecret);
}

export function redirectUri(id) {
  return `${APP_URL}/api/v1/integrations/oauth/${id}/callback`;
}

// Build the provider authorize URL for a given signed state.
export function buildAuthUrl(id, state, params = {}) {
  const def = REGISTRY[id];
  if (!def) throw Object.assign(new Error('Unknown provider'), { status: 404 });
  const c = creds(def.envKey);
  if (!c.clientId) throw Object.assign(new Error(`${def.label} OAuth is not configured on this server`), { status: 400 });

  const base = typeof def.authUrl === 'function' ? def.authUrl(params) : def.authUrl;
  const url = new URL(base);
  url.searchParams.set('client_id', c.clientId);
  url.searchParams.set('redirect_uri', redirectUri(id));
  url.searchParams.set('response_type', 'code');
  if (def.scope) url.searchParams.set('scope', def.scope);
  url.searchParams.set('state', state);
  for (const [k, v] of Object.entries(def.extraAuthParams || {})) url.searchParams.set(k, v);
  return url.toString();
}

// Exchange the authorization code for tokens.
export async function exchangeCode(id, code, params = {}) {
  const def = REGISTRY[id];
  const c = creds(def.envKey);
  const tokenUrl = typeof def.tokenUrl === 'function' ? def.tokenUrl(params) : def.tokenUrl;

  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(id),
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error_description || data.error || `token exchange failed (${res.status})`;
    throw Object.assign(new Error(msg), { status: 400 });
  }
  return data; // { access_token, refresh_token?, expires_in?, ... }
}

// Public list for the UI: which providers exist and whether they're configured.
export function listProviders() {
  return Object.entries(REGISTRY).map(([id, def]) => ({
    id, label: def.label, configured: providerConfigured(id), needs: def.needs || [],
  }));
}
