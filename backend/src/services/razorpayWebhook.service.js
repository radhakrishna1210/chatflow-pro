import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env.js';
import { getRazorpayClient, normalizeRazorpayError } from '../lib/razorpay.js';
import { applyTopupPayment } from './wallet.service.js';
import { applyCheckoutPayment } from './subscription.service.js';
import { applyAddonPayment } from './addons.service.js';
import { notifyWorkspace } from './notification.service.js';

// Server-to-server confirmation of Razorpay payments.
//
// Without it, crediting depended entirely on the browser calling a /verify
// endpoint after checkout: a buyer who paid and closed the tab (or lost their
// connection) was charged and got nothing. This credits through the very same
// apply* functions the verify endpoints use, each of which is idempotent per
// payment id behind a per-payment advisory lock — so verify and webhook, in
// either order, concurrently, or with the webhook redelivered, credit once.

export const HANDLED_EVENTS = new Set(['payment.captured', 'order.paid']);

// X-Razorpay-Signature is hex HMAC-SHA256(raw request body, webhook secret).
// Returns null when valid, or the reason it is not.
export function checkWebhookSignature(rawBody, signature, secret = env.RAZORPAY_WEBHOOK_SECRET) {
  if (!secret) return 'not_configured';
  if (!signature || typeof signature !== 'string' || !rawBody) return 'invalid';
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'), 'utf8');
  const given = Buffer.from(signature.trim(), 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given) ? null : 'invalid';
}

// Handles one verified event. Returns a short outcome for the log/response.
// Throws only for transient failures (gateway or database unreachable), which
// the controller turns into a 5xx so Razorpay retries the delivery.
export async function handleRazorpayEvent(body) {
  const event = body?.event;
  if (!HANDLED_EVENTS.has(event)) return { outcome: 'ignored', reason: 'unhandled_event' };

  const payment = body?.payload?.payment?.entity;
  const paymentId = payment?.id;
  const orderId = payment?.order_id || body?.payload?.order?.entity?.id;
  if (!paymentId || !orderId) return { outcome: 'ignored', reason: 'no_order_or_payment' };
  if (body?.payload?.order?.entity?.id && payment?.order_id && body.payload.order.entity.id !== payment.order_id) {
    return { outcome: 'ignored', reason: 'payment_order_mismatch' };
  }
  if (event === 'payment.captured' && payment.status && payment.status !== 'captured') {
    return { outcome: 'ignored', reason: 'not_captured' };
  }

  // What was bought, for whom and for how much is read from the order as
  // Razorpay holds it — the same read the verify endpoints make — never from
  // the webhook body.
  const order = await getRazorpayClient().orders.fetch(orderId).catch(normalizeRazorpayError);
  const notes = order?.notes || {};
  const workspaceId = notes.workspaceId;
  if (!workspaceId) return { outcome: 'ignored', reason: 'order_not_ours' };

  try {
    if (notes.type === 'wallet_topup') {
      const result = await applyTopupPayment(workspaceId, order, paymentId);
      if (!result.alreadyProcessed) {
        notifyWorkspace(workspaceId, {
          type: 'WALLET_RECHARGE',
          title: 'Wallet recharged',
          body: `₹${Number(result.transaction.amount).toFixed(2)} was added to your wallet. New balance: ₹${Number(result.balance).toFixed(2)}.`,
          link: 'payments',
        }).catch(() => {});
      }
      return { outcome: result.alreadyProcessed ? 'already_processed' : 'credited', kind: 'wallet_topup', workspaceId };
    }
    if (notes.type === 'addon') {
      const result = await applyAddonPayment(workspaceId, order, paymentId);
      return { outcome: result.alreadyProcessed ? 'already_processed' : 'credited', kind: 'addon', workspaceId };
    }
    if (notes.planId && !notes.type) {
      const result = await applyCheckoutPayment(workspaceId, order, paymentId);
      return { outcome: result.applied === 'already_processed' ? 'already_processed' : 'credited', kind: 'plan', workspaceId };
    }
    return { outcome: 'ignored', reason: 'unknown_order_type' };
  } catch (err) {
    // A 4xx from an apply function (workspace or subscription gone, unknown
    // add-on) will fail the same way on every retry; acknowledge it and leave
    // it in the log for a person to reconcile instead of having Razorpay
    // retry for a day.
    if (err?.status && err.status < 500) {
      return { outcome: 'rejected', reason: err.message, workspaceId };
    }
    throw err;
  }
}
