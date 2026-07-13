import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env.js';
import { processWebhook } from '../services/webhook.service.js';

export function verify(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.META_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.status(403).json({ error: 'Verification failed' });
}

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

  console.log('[Webhook] Signature OK. Payload preview:', JSON.stringify(req.body).slice(0, 400));
  res.status(200).json({ status: 'ok' });

  processWebhook(req.body).catch((err) => {
    console.error('[Webhook] Processing error:', err);
  });
}
