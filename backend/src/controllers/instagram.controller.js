import { randomUUID } from 'crypto';
import { answerChallenge, checkMetaSignature } from './webhook.controller.js';
import { env } from '../config/env.js';
import { redis } from '../lib/redis.js';
import * as ig from '../services/instagram.service.js';
import { parkOAuthCallback, claimOAuthCallback } from '../lib/oauthPending.js';

const STATE_TTL_SEC = 600;

export async function connection(req, res) {
  try {
    // The configuration status rides along, so the screen can explain why the
    // Connect button will not work rather than letting the user discover it on
    // instagram.com as an "incorrect password" error.
    const [connection, config] = [await ig.getConnection(req.params.workspaceId), ig.instagramConfigStatus()];
    res.json({ ...connection, setup: config });
  } catch (err) {
    console.error('[Instagram] connection error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to read connection' });
  }
}

// Returns the URL for the client to open. The OAuth `state` is minted here and
// stored in Redis so the callback can tell which workspace it belongs to —
// the client ID no longer lives hardcoded in the frontend bundle.
export async function authUrl(req, res) {
  try {
    if (!ig.instagramConfigured()) {
      const status = ig.instagramConfigStatus();
      return res.status(503).json({
        error: `Instagram is not configured on this server — ${status.missing.join(' and ')} ${status.missing.length > 1 ? 'are' : 'is'} missing. `
          + 'These are the Instagram app credentials, not the Facebook ones used for WhatsApp.',
        code: 'INSTAGRAM_NOT_CONFIGURED',
        setup: status,
      });
    }
    const state = randomUUID();
    const { url, redirectUri } = ig.buildAuthUrl(req.params.workspaceId, state);
    await redis.set(`ig:oauth:${state}`, JSON.stringify({ workspaceId: req.params.workspaceId, userId: req.user.id, redirectUri }), 'EX', STATE_TTL_SEC);
    res.json({ url });
  } catch (err) {
    console.error('[Instagram] authUrl error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to build auth URL' });
  }
}

// The browser comes back here from instagram.com with no bearer token, so this
// cannot tell who is holding the code. It parks it (lib/oauthPending.js) and
// hands the app a one-time reference; `complete` below links the account only
// for the user and workspace that started the flow.
export async function oauthCallback(req, res) {
  const fail = (reason) => res.redirect(`${env.CLIENT_URL}/dashboard/automation?tab=ig-quick&instagram_error=${encodeURIComponent(reason)}`);
  const { code, state } = req.query;
  if (!code || typeof code !== 'string') return fail('missing_code');
  if (!state || typeof state !== 'string') return fail('missing_state');

  try {
    const raw = await redis.getdel(`ig:oauth:${state}`);
    if (!raw) return fail('expired_state');
    const { workspaceId, userId, redirectUri } = JSON.parse(raw);
    if (!userId) return fail('expired_state');

    const pending = await parkOAuthCallback({ kind: 'instagram', workspaceId, userId, data: { code, redirectUri } });
    return res.redirect(`${env.CLIENT_URL}/dashboard/automation?tab=ig-quick&instagram_pending=${encodeURIComponent(pending)}`);
  } catch (err) {
    console.error('[Instagram] OAuth callback failed:', err.message);
    return fail('exchange_failed');
  }
}

// POST /workspaces/:id/instagram/complete { pending }
export async function completeConnection(req, res) {
  try {
    const { code, redirectUri } = await claimOAuthCallback(req.body?.pending, {
      kind: 'instagram', workspaceId: req.params.workspaceId, userId: req.user?.id,
    });
    await ig.completeOAuth(req.params.workspaceId, code, redirectUri);
    res.json(await ig.getConnection(req.params.workspaceId));
  } catch (err) {
    if (err.code?.startsWith?.('OAUTH_PENDING')) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error('[Instagram] OAuth exchange failed:', err.response?.data || err.message);
    res.status(err.status && err.expose ? err.status : 502).json({ error: err.expose ? err.message : 'Instagram did not accept the authorization. Try connecting again.' });
  }
}

export async function disconnect(req, res) {
  try {
    await ig.disconnect(req.params.workspaceId);
    res.status(204).send();
  } catch (err) {
    console.error('[Instagram] disconnect error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to disconnect' });
  }
}

export async function listFlows(req, res) {
  try {
    res.json(await ig.listFlows(req.params.workspaceId));
  } catch (err) {
    console.error('[Instagram] list flows error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to list flows' });
  }
}

export async function createFlow(req, res) {
  try {
    res.status(201).json(await ig.createFlow(req.params.workspaceId, req.body));
  } catch (err) {
    console.error('[Instagram] create flow error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to create flow' });
  }
}

export async function updateFlow(req, res) {
  try {
    res.json(await ig.updateFlow(req.params.workspaceId, req.params.id, req.body));
  } catch (err) {
    console.error('[Instagram] update flow error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to update flow' });
  }
}

export async function deleteFlow(req, res) {
  try {
    await ig.deleteFlow(req.params.workspaceId, req.params.id);
    res.status(204).send();
  } catch (err) {
    console.error('[Instagram] delete flow error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to delete flow' });
  }
}

// ── Public webhook (Meta) ──────────────────────────────────────────────────

export function verifyWebhook(req, res) {
  return answerChallenge(req, res, env.META_WEBHOOK_VERIFY_TOKEN).send();
}

export async function receiveWebhook(req, res) {
  const problem = checkMetaSignature(req, env.INSTAGRAM_APP_SECRET || env.META_APP_SECRET);
  if (problem) {
    console.warn(`[Instagram] REJECTED — ${problem}.`);
    return res.status(401).json({ error: problem });
  }

  // Meta retries anything not answered within seconds — ack first, work after.
  res.status(200).json({ status: 'ok' });
  ig.processInstagramWebhook(req.body).catch((err) => {
    console.error('[Instagram] Processing error:', err);
  });
}
