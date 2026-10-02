import { prisma } from '../lib/prisma.js';

// A captured Razorpay payment can reach us twice: from the browser's verify
// call and from the server-to-server webhook (plus any retry of either). Each
// is applied inside one transaction that first inserts a GatewayPayment row
// keyed on the payment id. A second attempt blocks on that unique index until
// the first commits and then fails with P2002, so the side effects — wallet
// credit, invoice, plan change — happen exactly once, and never half-way.

// Same budget as wallet.service.js#TX_OPTS: a few round trips against a pooled
// remote Postgres, one of which may wait on the wallet row lock.
const TX_OPTS = { maxWait: 15_000, timeout: 30_000 };

export const isUniqueViolation = (err) => err?.code === 'P2002';

// `claim` is { workspaceId, paymentId, orderId, kind, amount, currency, source }.
// Resolves to { duplicate: false, result } with apply()'s return value, or
// { duplicate: true } when this payment was already applied.
export async function applyGatewayPaymentOnce(claim, apply, client = prisma) {
  try {
    const result = await client.$transaction(async (tx) => {
      await tx.gatewayPayment.create({
        data: {
          workspaceId: claim.workspaceId,
          gateway: 'razorpay',
          paymentId: claim.paymentId,
          orderId: claim.orderId,
          kind: claim.kind,
          amount: claim.amount,
          currency: claim.currency || 'INR',
          source: claim.source || 'VERIFY',
        },
      });
      return apply(tx);
    }, TX_OPTS);
    return { duplicate: false, result };
  } catch (err) {
    if (isUniqueViolation(err)) return { duplicate: true };
    throw err;
  }
}
