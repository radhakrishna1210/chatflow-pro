import { getRazorpayClient, normalizeRazorpayError } from '../lib/razorpay.js';
import { applyTopupPayment } from './wallet.service.js';
import { applyCheckoutPayment, retryPastDueRenewal } from './subscription.service.js';
import { applyAddonPayment } from './addons.service.js';
import { notifyWorkspace } from './notification.service.js';

// Server-to-server reconciliation for Razorpay. If the customer's browser
// closes after the payment is captured but before /checkout/verify runs, this
// is what still credits the wallet / applies the plan / activates the add-on.
// It shares the apply* functions — and so the GatewayPayment claim — with the
// verify endpoints, so whichever arrives second is a no-op.

const HANDLED_EVENTS = new Set(['payment.captured', 'order.paid']);

// `event` is the parsed, already signature-verified webhook body.
export async function handleRazorpayEvent(event) {
  if (!HANDLED_EVENTS.has(event?.event)) return { handled: false, reason: 'event not handled' };

  const payment = event.payload?.payment?.entity;
  if (!payment?.id || !payment.order_id) return { handled: false, reason: 'no payment/order id' };
  if (payment.status !== 'captured') return { handled: false, reason: `payment status ${payment.status}` };

  // order.paid carries the order (with its notes) in the signed payload;
  // payment.captured does not, so read it back from the gateway.
  let order = event.payload?.order?.entity;
  if (!order || order.id !== payment.order_id) {
    order = await getRazorpayClient().orders.fetch(payment.order_id).catch(normalizeRazorpayError);
  }

  const workspaceId = order.notes?.workspaceId;
  if (!workspaceId) return { handled: false, reason: 'order has no workspace' };
  if (Number(payment.amount) !== Number(order.amount)) {
    console.warn(`[RazorpayWebhook] Payment ${payment.id} amount ${payment.amount} != order ${order.id} amount ${order.amount}; not applied`);
    return { handled: false, reason: 'amount mismatch' };
  }

  const type = order.notes?.type;
  if (type === 'wallet_topup') {
    const result = await applyTopupPayment(workspaceId, order, payment.id, 'WEBHOOK');
    if (!result.alreadyProcessed) {
      retryPastDueRenewal(workspaceId)
        .catch((err) => console.error(`[RazorpayWebhook] Renewal retry after top-up failed for ${workspaceId}:`, err.message));
      notifyWorkspace(workspaceId, {
        type: 'WALLET_RECHARGE',
        title: 'Wallet recharged',
        body: `₹${Number(result.transaction.amount).toFixed(2)} was added to your wallet. New balance: ₹${Number(result.balance).toFixed(2)}.`,
        link: 'payments',
      }).catch((err) => console.error('[RazorpayWebhook] Recharge notification failed:', err.message));
    }
    return { handled: true, kind: 'WALLET_TOPUP', alreadyProcessed: !!result.alreadyProcessed };
  }
  if (type === 'addon') {
    await applyAddonPayment(workspaceId, order, payment.id, 'WEBHOOK');
    return { handled: true, kind: 'ADDON' };
  }
  // Plan orders created before notes carried a type have only a planId.
  if (type === 'plan' || (!type && order.notes?.planId)) {
    const result = await applyCheckoutPayment(workspaceId, order, payment.id, 'WEBHOOK');
    return { handled: true, kind: 'PLAN', applied: result.applied };
  }
  return { handled: false, reason: `unknown order type ${type}` };
}
