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
//
// Compared in constant time (a plain === leaks how many leading characters
// matched), and fails closed when no secret is configured instead of throwing
// from inside createHmac.
export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  const secret = env.RAZORPAY_KEY_SECRET;
  if (!secret || typeof signature !== 'string' || !orderId || !paymentId) return false;
  const expected = createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Serialises everything done for one gateway payment id: two verify calls for
// the same payment (a double click, a retried request) run one after the other
// inside their transactions rather than both passing a "not processed yet"
// check. Transaction-scoped, so it is released on commit or rollback.
export async function lockPayment(tx, paymentId) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rzp:${paymentId}`}))`;
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
