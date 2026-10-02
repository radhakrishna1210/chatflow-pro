import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const env = { RAZORPAY_KEY_SECRET: 'key_secret' };
mock.module('../config/env.js', { namedExports: { env } });

const { verifyPaymentSignature, safeEqualHex } = await import('./razorpay.js');

const sign = (body, secret) => createHmac('sha256', secret).update(body).digest('hex');

test('verifyPaymentSignature accepts the documented order|payment HMAC', () => {
  env.RAZORPAY_KEY_SECRET = 'key_secret';
  const signature = sign('order_1|pay_1', 'key_secret');
  assert.equal(verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature }), true);
});

test('verifyPaymentSignature rejects a wrong, truncated or missing signature', () => {
  env.RAZORPAY_KEY_SECRET = 'key_secret';
  const signature = sign('order_1|pay_1', 'key_secret');
  assert.equal(verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_2', signature }), false);
  assert.equal(verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: signature.slice(0, 10) }), false);
  assert.equal(verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: undefined }), false);
});

test('verifyPaymentSignature is a 503 when Razorpay is not configured', () => {
  env.RAZORPAY_KEY_SECRET = undefined;
  assert.throws(
    () => verifyPaymentSignature({ orderId: 'o', paymentId: 'p', signature: 'x' }),
    (e) => e.status === 503,
  );
  env.RAZORPAY_KEY_SECRET = 'key_secret';
});

test('verifyWebhookSignature checks the HMAC of the exact raw body', async () => {
  const { verifyWebhookSignature } = await import('./razorpay.js');
  env.RAZORPAY_WEBHOOK_SECRET = 'hook_secret';
  const body = '{"event":"payment.captured","payload":{}}';
  assert.equal(verifyWebhookSignature(body, sign(body, 'hook_secret')), true);
  assert.equal(verifyWebhookSignature(body, sign(body, 'key_secret')), false);
  assert.equal(verifyWebhookSignature(`${body} `, sign(body, 'hook_secret')), false);
  assert.equal(verifyWebhookSignature(undefined, sign(body, 'hook_secret')), false);
});

test('verifyWebhookSignature is a 503 without RAZORPAY_WEBHOOK_SECRET', async () => {
  const { verifyWebhookSignature } = await import('./razorpay.js');
  env.RAZORPAY_WEBHOOK_SECRET = undefined;
  assert.throws(() => verifyWebhookSignature('{}', 'x'), (e) => e.status === 503);
});

test('safeEqualHex handles unequal lengths and non-strings without throwing', () => {
  assert.equal(safeEqualHex('abcd', 'abcd'), true);
  assert.equal(safeEqualHex('abcd', 'abc'), false);
  assert.equal(safeEqualHex('abcd', null), false);
  assert.equal(safeEqualHex(undefined, 'abcd'), false);
});
