import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env.js';
import { processWebhook } from '../services/webhook.service.js';

function verifyTokenMatches(token) {
  const expected = Buffer.from(String(env.META_WEBHOOK_VERIFY_TOKEN || ''));
  const given = Buffer.from(typeof token === 'string' ? token : '');
  return expected.length > 0 && given.length === expected.length && timingSafeEqual(given, expected);
}

// Meta's subscription handshake, shared by the WhatsApp and Instagram
// webhooks. The challenge is echoed as text/plain: sent as a bare string it
// went out as text/html on the app's own origin, a reflection point for script.
export function answerVerifyChallenge(req, res) {
  const mode = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && verifyTokenMatches(req.query['hub.verify_token']) && typeof challenge === 'string') {
    return res.status(200).type('text/plain').send(challenge);
  }
  res.status(403).json({ error: 'Verification failed' });
}

export const verify = answerVerifyChallenge;

export async function receive(req, res) {
  console.log('[Webhook] POST /meta hit at', new Date().toISOString());

  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    console.warn('[Webhook] REJECTED — missing X-Hub-Signature-256 header');
    return res.status(401).json({ error: 'Missing signature' });
  }

  const rawBody = req.rawBody;
  const expected = 'sha256=' + createHmac('sha256', env.META_APP_SECRET).update(rawBody).digest('hex');

  try {
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      console.warn('[Webhook] REJECTED — signature mismatch. Check META_APP_SECRET matches the App Secret in Meta Dashboard.');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } catch (err) {
    console.warn('[Webhook] REJECTED — signature verification threw:', err.message);
    return res.status(401).json({ error: 'Signature verification error' });
  }

  console.log('[Webhook] Signature verified. Payload preview:', JSON.stringify(req.body).slice(0, 400));
  res.status(200).json({ status: 'ok' });

  processWebhook(req.body).catch((err) => {
    console.error('[Webhook] Processing error — message not fully handled:', err);
  });
}
