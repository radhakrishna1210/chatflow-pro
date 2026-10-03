import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env.js';
import { processWebhook } from '../services/webhook.service.js';
import { splitWebhook } from '../services/webhookEvents.js';
import { enqueueWebhook } from '../queues/webhook.queue.js';
import { isWebhookWorkerRunning, processWebhookJob } from '../workers/webhook.worker.js';
import { webhookQueueHasNoConsumer } from '../lib/webhookConsumers.js';

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

  // Development without Redis: no worker will ever drain the queue, so process
  // in place as before, one event at a time so one failure cannot drop the rest.
  if (!isWebhookWorkerRunning() && env.NODE_ENV !== 'production') {
    res.status(200).json({ status: 'ok' });
    for (const { payload } of splitWebhook(req.body)) {
      // eslint-disable-next-line no-await-in-loop
      await processWebhook(payload).catch((err) => {
        console.error('[Webhook] Processing error — event not fully handled:', err);
      });
    }
    return;
  }

  // Production, and no process anywhere consumes the queue (this one runs
  // with RUN_WORKERS=false and no worker service reads the same Redis).
  // Queueing would ACK Meta and lose the message — and every workflow it
  // would start — without a trace (WF-IN-13). Process it here instead, under
  // the same per-customer lock the worker uses, and only then answer, so a
  // failure still gets Meta's redelivery.
  if (!isWebhookWorkerRunning() && await webhookQueueHasNoConsumer()) {
    console.error('[Webhook] No consumer on the "webhooks" queue — processing this event inline. '
      + 'Start a worker (RUN_WORKERS=true) on the same REDIS_URL; see DEPLOY.md §4.');
    try {
      for (const unit of splitWebhook(req.body)) {
        // eslint-disable-next-line no-await-in-loop
        await processWebhookJob({ data: unit });
      }
    } catch (err) {
      console.error('[Webhook] Inline processing failed — asking Meta to redeliver:', err);
      return res.status(503).json({ error: 'Temporarily unavailable' });
    }
    return res.status(200).json({ status: 'ok' });
  }

  // Queue first, ACK second. If the event cannot be persisted, Meta gets a
  // non-200 and redelivers it later instead of it being lost.
  try {
    const queued = await withTimeout(enqueueWebhook(req.body), ENQUEUE_TIMEOUT_MS);
    console.log(`[Webhook] Queued ${queued} event(s).`);
  } catch (err) {
    console.error('[Webhook] Could not queue event — asking Meta to redeliver:', err.message);
    return res.status(503).json({ error: 'Temporarily unavailable' });
  }
  res.status(200).json({ status: 'ok' });
}

// Meta waits a limited time for the 200; an unreachable Redis must turn into
// a prompt 503 rather than a hung request.
const ENQUEUE_TIMEOUT_MS = 5_000;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`queue did not respond within ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}
