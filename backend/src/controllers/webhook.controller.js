import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env.js';
import { processWebhook } from '../services/webhook.service.js';

// Constant-time string equality. `===` on a secret leaks, through timing, how
// many leading characters matched.
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

// The hub.challenge handshake Meta performs when a webhook URL is saved.
// Shared by the WhatsApp and Instagram endpoints.
//
// The challenge is echoed as text/plain: sent with Express's default
// text/html, a request carrying the verify token and a `<script>` challenge
// was reflected as a page on the API origin.
export function answerChallenge(req, res, expectedToken) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const ok = mode === 'subscribe'
    && typeof challenge === 'string'
    && Boolean(expectedToken)
    && safeEqual(token, expectedToken);
  if (ok) return { ok, send: () => res.status(200).type('text/plain').send(challenge) };
  return { ok, send: () => res.status(403).json({ error: 'Verification failed' }) };
}

// X-Hub-Signature-256 is "sha256=" + HMAC-SHA256(app secret, raw body).
// Returns null when it is valid, or the reason it is not.
export function checkMetaSignature(req, secret) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || typeof signature !== 'string') return 'Missing signature';
  if (!secret) return 'Webhook secret not configured';
  // No raw body means the request was not JSON (express.json never ran its
  // verify hook), so there is nothing that could carry a valid signature.
  if (!req.rawBody) return 'Invalid signature';
  const expected = 'sha256=' + createHmac('sha256', secret).update(req.rawBody).digest('hex');
  return safeEqual(signature.trim().toLowerCase(), expected) ? null : 'Invalid signature';
}

export function verify(req, res) {
  const envToken = env.META_WEBHOOK_VERIFY_TOKEN;
  const result = answerChallenge(req, res, envToken);
  // Safe diagnostic logging — never logs the actual token value.
  console.log(
    '[Webhook] GET /meta verify — '
    + `mode=${req.query['hub.mode'] ?? 'MISSING'} `
    + `challenge_present=${!!req.query['hub.challenge']} `
    + `env_token_set=${!!envToken} `
    + `match=${result.ok}`,
  );
  return result.send();
}

export async function receive(req, res) {
  const problem = checkMetaSignature(req, env.META_APP_SECRET);
  if (problem) {
    console.warn(`[Webhook] REJECTED — ${problem}. Check META_APP_SECRET matches the App Secret in Meta Dashboard.`);
    return res.status(401).json({ error: problem });
  }

  console.log('[Webhook] Signature verified. Payload preview:', JSON.stringify(req.body).slice(0, 400));
  res.status(200).json({ status: 'ok' });

  processWebhook(req.body).catch((err) => {
    console.error('[Webhook] Processing error — message not fully handled:', err);
  });
}
