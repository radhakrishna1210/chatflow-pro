import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import * as service from '../services/integrations.service.js';
import { prisma } from '../lib/prisma.js';
import { encrypt } from '../lib/encryption.js';
import { env } from '../config/env.js';
import { hasFeature } from '../services/subscription.service.js';
import { pricingForCatalogId, pricingForOAuthProvider } from '../config/integrationCatalog.js';
import {
  isOAuthProvider, providerConfigured, buildAuthUrl, exchangeCode, listProviders,
} from '../lib/oauthProviders.js';

// Free integrations are usable on every plan; paid ones require the plan's
// `integrations` feature flag (PRO/ENTERPRISE in the seed data).
async function assertIntegrationAccess(workspaceId, pricing) {
  if (pricing !== 'paid') return;
  const allowed = await hasFeature(workspaceId, 'integrations');
  if (!allowed) {
    const e = new Error('This integration requires a paid plan. Upgrade to Pro to connect it.');
    e.status = 403;
    e.code = 'PLAN_FEATURE_LOCKED';
    e.feature = 'integrations';
    throw e;
  }
}

export async function list(req, res) {
  res.json(await service.listIntegrations(req.params.workspaceId));
}

export async function connect(req, res) {
  const { provider } = req.params;
  await assertIntegrationAccess(req.params.workspaceId, pricingForCatalogId(provider));
  const row = await service.connectIntegration(req.params.workspaceId, provider, req.body || {});
  res.status(201).json(row);
}

export async function disconnect(req, res) {
  res.json(await service.disconnectIntegration(req.params.workspaceId, req.params.provider));
}

// ─── Per-provider OAuth 2.0 flow ─────────────────────────────────────────────
// Signed HMAC state binds the callback to the workspace + admin that started
// the flow (same pattern as the Meta/Google flows in auth.routes.js).

function signState(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', env.JWT_ACCESS_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyState(state, maxAgeMs = 15 * 60_000) {
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

// GET /integrations/oauth/providers — which providers exist + are configured.
// Lets the UI show a real "Authorize" only where it will actually work.
export async function oauthProviders(req, res) {
  res.json(listProviders());
}

// POST /integrations/oauth/:provider/start — returns the provider authorize URL.
export async function oauthStart(req, res) {
  const { provider, workspaceId } = req.params;
  if (!isOAuthProvider(provider)) {
    return res.status(404).json({ error: `"${provider}" does not support OAuth. Use an API-key connection instead.` });
  }
  await assertIntegrationAccess(workspaceId, pricingForOAuthProvider(provider));
  if (!providerConfigured(provider)) {
    return res.status(400).json({
      error: `OAuth for this provider is not configured on this server. Set ${provider.toUpperCase()}_CLIENT_ID and ${provider.toUpperCase()}_CLIENT_SECRET, then retry.`,
      configured: false,
    });
  }
  // Provider-specific params (e.g. Shopify shop domain) come from the body.
  const extra = {};
  if (provider === 'shopify') {
    const shop = String(req.body?.shop || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
      return res.status(400).json({ error: 'Provide your shop domain, e.g. mystore.myshopify.com' });
    }
    extra.shop = shop;
  }
  const state = signState({ workspaceId, userId: req.user.id, provider, extra, n: randomBytes(8).toString('hex'), ts: Date.now() });
  const url = buildAuthUrl(provider, state, extra);
  res.json({ url });
}

// GET /integrations/oauth/:provider/callback — provider redirects here.
// Unauthenticated by nature (browser redirect), so the signed state carries the
// workspace binding; token exchange happens server-side and the encrypted
// tokens never touch the client.
export async function oauthCallback(req, res) {
  const { provider } = req.params;
  const { code, state, error: providerError } = req.query;
  const fail = (reason) => res.redirect(`${env.CLIENT_URL}/dashboard/integrations?oauth_error=${encodeURIComponent(reason)}&provider=${encodeURIComponent(provider)}`);

  if (providerError) return fail(String(providerError));
  if (!code) return fail('missing_code');
  const payload = verifyState(state);
  if (!payload?.workspaceId || payload.provider !== provider) return fail('invalid_state');

  try {
    const tokens = await exchangeCode(provider, code, payload.extra || {});
    // Store tokens encrypted at rest; expose only "connected" to the client.
    await prisma.workspaceIntegration.upsert({
      where: { workspaceId_provider: { workspaceId: payload.workspaceId, provider } },
      create: {
        workspaceId: payload.workspaceId, provider, type: 'oauth', status: 'CONNECTED',
        encryptedCredentials: encrypt(JSON.stringify(tokens)),
        config: { oauth: true, ...(payload.extra || {}), connectedBy: payload.userId },
      },
      update: {
        type: 'oauth', status: 'CONNECTED',
        encryptedCredentials: encrypt(JSON.stringify(tokens)),
        config: { oauth: true, ...(payload.extra || {}), connectedBy: payload.userId },
      },
    });
    return res.redirect(`${env.CLIENT_URL}/dashboard/integrations?oauth_connected=${encodeURIComponent(provider)}`);
  } catch (err) {
    console.error(`[oauth:${provider}]`, err.message);
    return fail('exchange_failed');
  }
}
