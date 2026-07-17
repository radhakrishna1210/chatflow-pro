import Razorpay from 'razorpay';
import { createHmac } from 'crypto';
import { env } from '../config/env.js';

let client = null;

export function getRazorpayClient() {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    const e = new Error('Razorpay is not configured on this server'); e.status = 503; throw e;
  }
  if (!client) {
    client = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  }
  return client;
}

// Verifies the checkout handler's payment signature per Razorpay's documented
// scheme: HMAC-SHA256("<order_id>|<payment_id>", key_secret) must equal the
// signature returned to the browser. Never trust the client-supplied planId —
// callers should instead read back the order's `notes` (see subscription.service.js).
export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  const expected = createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return expected === signature;
}

// The Razorpay SDK rejects with a plain { statusCode, error: { description } }
// object, not an Error — errorHandler.js can't extract a useful message from
// that, so it falls back to a generic "Internal server error". Normalize it
// into a real Error so callers see what actually went wrong (e.g. a receipt
// length or amount validation failure).
export function normalizeRazorpayError(err) {
  const description = err?.error?.description;
  const e = new Error(description || 'Payment gateway request failed');
  e.status = err?.statusCode && err.statusCode < 500 ? err.statusCode : 502;
  throw e;
}
