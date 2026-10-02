import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('../lib/prisma.js', { namedExports: { prisma: {} } });
const { applyGatewayPaymentOnce } = await import('./gatewayPayment.service.js');

// A fake client whose unique index on paymentId behaves like Postgres: the
// second insert of the same id fails with P2002, and a failed transaction
// leaves no claim behind.
function fakeClient() {
  const claimed = new Map();
  return {
    claimed,
    async $transaction(fn) {
      const pending = [];
      const tx = {
        gatewayPayment: {
          create: async ({ data }) => {
            if (claimed.has(data.paymentId) || pending.some((p) => p.paymentId === data.paymentId)) {
              const e = new Error('Unique constraint failed'); e.code = 'P2002'; throw e;
            }
            pending.push(data);
            return data;
          },
        },
      };
      const result = await fn(tx);
      for (const p of pending) claimed.set(p.paymentId, p);
      return result;
    },
  };
}

const claim = { workspaceId: 'ws_1', paymentId: 'pay_1', orderId: 'order_1', kind: 'PLAN', amount: 1500, currency: 'INR', source: 'VERIFY' };

test('a payment is applied once; the second attempt is reported as a duplicate', async () => {
  const client = fakeClient();
  let applied = 0;
  const first = await applyGatewayPaymentOnce(claim, async () => { applied += 1; return 'done'; }, client);
  const second = await applyGatewayPaymentOnce({ ...claim, source: 'WEBHOOK' }, async () => { applied += 1; return 'done'; }, client);
  assert.deepEqual(first, { duplicate: false, result: 'done' });
  assert.deepEqual(second, { duplicate: true });
  assert.equal(applied, 1);
  assert.equal(client.claimed.get('pay_1').source, 'VERIFY');
});

test('a failure while applying propagates and leaves the payment unclaimed', async () => {
  const client = fakeClient();
  await assert.rejects(
    () => applyGatewayPaymentOnce(claim, async () => { const e = new Error('boom'); e.status = 500; throw e; }, client),
    /boom/,
  );
  assert.equal(client.claimed.has('pay_1'), false);
  const retry = await applyGatewayPaymentOnce(claim, async () => 'ok', client);
  assert.deepEqual(retry, { duplicate: false, result: 'ok' });
});
