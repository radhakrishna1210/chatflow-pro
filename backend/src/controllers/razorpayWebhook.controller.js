import { verifyWebhookSignature } from '../lib/razorpay.js';
import { handleRazorpayEvent } from '../services/razorpayWebhook.service.js';

// POST /api/v1/webhook/razorpay. Verified against the exact raw body captured
// by express.json's `verify` hook in app.js.
export async function receive(req, res) {
  const signature = req.get('x-razorpay-signature');
  if (!signature || typeof req.rawBody !== 'string') {
    return res.status(400).json({ error: 'Missing signature or body' });
  }
  // Throws a 503 when RAZORPAY_WEBHOOK_SECRET is not configured.
  if (!verifyWebhookSignature(req.rawBody, signature)) {
    console.warn('[RazorpayWebhook] REJECTED — signature mismatch');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    const result = await handleRazorpayEvent(req.body);
    if (!result.handled) console.log(`[RazorpayWebhook] ${req.body?.event} ignored: ${result.reason}`);
    return res.json({ ok: true, ...result });
  } catch (err) {
    // A client error (unknown plan, deleted workspace) will not succeed on
    // retry, so acknowledge it; anything else is a 500 so Razorpay retries.
    console.error(`[RazorpayWebhook] ${req.body?.event} failed:`, err.message);
    if (err.status && err.status < 500) return res.json({ ok: false, error: err.message });
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
