import Razorpay from 'razorpay';
import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env.js';

// Keyed on the credentials, so keys rotated from the admin screen are picked
// up on the next call rather than held until a restart.
let client = null;
let clientKeyId = null;
let clientKeySecret = null;

export function getRazorpayClient() {
  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    const e = new Error('Razorpay is not configured on this server'); e.status = 503; e.expose = true; throw e;
  }
  if (!client || clientKeyId !== keyId || clientKeySecret !== keySecret) {
    client = new Razorpay({ key_id: keyId, key_secret: keySecret });
    clientKeyId = keyId;
    clientKeySecret = keySecret;
  }
  return client;
}

// Verifies the checkout handler's payment signature per Razorpay's documented
// scheme: HMAC-SHA256("<order_id>|<payment_id>", key_secret) must equal the
// signature returned to the browser. Never trust the client-supplied planId —
// callers should instead read back the order's `notes` (see subscription.service.js).
export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  const secret = env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    const e = new Error('Razorpay is not configured on this server'); e.status = 503; e.expose = true; throw e;
  }
  const expected = createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return safeEqualHex(expected, signature);
}

// Razorpay signs a webhook as HMAC-SHA256(raw request body, webhook secret) in
// the X-Razorpay-Signature header. The body must be the exact bytes received,
// not a re-serialised object.
export function verifyWebhookSignature(rawBody, signature) {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    const e = new Error('Razorpay webhook is not configured on this server'); e.status = 503; e.expose = true; throw e;
  }
  if (typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}

// Constant-time comparison of two hex digests. A length mismatch (including a
// missing signature) is simply "not equal" — timingSafeEqual would throw.
export function safeEqualHex(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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
