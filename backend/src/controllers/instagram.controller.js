import { createHmac, timingSafeEqual, randomUUID } from 'crypto';
import { env } from '../config/env.js';
import { redis } from '../lib/redis.js';
import * as ig from '../services/instagram.service.js';

const STATE_TTL_SEC = 600;

export async function connection(req, res) {
  try {
    res.json(await ig.getConnection(req.params.workspaceId));
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
      return res.status(503).json({
        error: 'Instagram is not configured on this server. Set INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET.',
        code: 'INSTAGRAM_NOT_CONFIGURED',
      });
    }
    const state = randomUUID();
    const { url, redirectUri } = ig.buildAuthUrl(req.params.workspaceId, state);
    await redis.set(`ig:oauth:${state}`, JSON.stringify({ workspaceId: req.params.workspaceId, redirectUri }), 'EX', STATE_TTL_SEC);
    res.json({ url });
  } catch (err) {
    console.error('[Instagram] authUrl error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to build auth URL' });
  }
}

export async function oauthCallback(req, res) {
  const fail = (reason) => res.redirect(`${env.CLIENT_URL}/dashboard/automation?tab=ig-quick&instagram_error=${encodeURIComponent(reason)}`);
  const { code, state } = req.query;
  if (!code) return fail('missing_code');
  if (!state) return fail('missing_state');

  try {
    const raw = await redis.get(`ig:oauth:${state}`);
    if (!raw) return fail('expired_state');
    await redis.del(`ig:oauth:${state}`);
    const { workspaceId, redirectUri } = JSON.parse(raw);

    await ig.completeOAuth(workspaceId, code, redirectUri);
    return res.redirect(`${env.CLIENT_URL}/dashboard/automation?tab=ig-quick&instagram=connected`);
  } catch (err) {
    console.error('[Instagram] OAuth exchange failed:', err.response?.data || err.message);
    return fail('exchange_failed');
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
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  if (mode === 'subscribe' && token === env.META_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.status(403).json({ error: 'Verification failed' });
}

export async function receiveWebhook(req, res) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return res.status(401).json({ error: 'Missing signature' });

  const secret = env.INSTAGRAM_APP_SECRET || env.META_APP_SECRET;
  const expected = 'sha256=' + createHmac('sha256', secret).update(req.rawBody).digest('hex');
  try {
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      console.warn('[Instagram] REJECTED — signature mismatch.');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } catch (err) {
    return res.status(401).json({ error: 'Signature verification error' });
  }

  // Meta retries anything not answered within seconds — ack first, work after.
  res.status(200).json({ status: 'ok' });
  ig.processInstagramWebhook(req.body).catch((err) => {
    console.error('[Instagram] Processing error:', err);
  });
}
