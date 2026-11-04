import { checkWebhookSignature, handleRazorpayEvent } from '../services/razorpayWebhook.service.js';

// POST /api/v1/webhooks/razorpay — unauthenticated; the signature is the auth.
// Razorpay retries any non-2xx delivery, so: 503 while no webhook secret is
// configured (nothing can be verified), 401 for a bad signature, 5xx for a
// transient failure worth retrying, and 200 for everything else — including
// events this app does not handle.
export async function receive(req, res) {
  const problem = checkWebhookSignature(req.rawBody, req.get('x-razorpay-signature'));
  if (problem === 'not_configured') {
    return res.status(503).json({ error: 'Razorpay webhook is not configured on this server' });
  }
  if (problem) return res.status(401).json({ error: 'Invalid signature' });

  try {
    const result = await handleRazorpayEvent(req.body);
    if (result.outcome !== 'credited' && result.outcome !== 'already_processed') {
      console.warn(`[RazorpayWebhook] ${req.body?.event} ${result.outcome}: ${result.reason}`);
    }
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    if (err?.status && err.status < 500) {
      console.warn(`[RazorpayWebhook] ${req.body?.event} rejected: ${err.message}`);
      return res.status(200).json({ ok: true, outcome: 'rejected', reason: err.message });
    }
    console.error('[RazorpayWebhook] failed, Razorpay will retry:', err?.message || err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
