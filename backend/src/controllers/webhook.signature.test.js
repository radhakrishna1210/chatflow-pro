import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

// POST /webhook/meta: nothing is queued or processed unless the
// X-Hub-Signature-256 HMAC over the exact raw body matches META_APP_SECRET,
// and in production the 200 is only sent once the event is durably queued.

const SECRET = 'meta-app-secret';
const env = { META_APP_SECRET: SECRET, META_WEBHOOK_VERIFY_TOKEN: 't', NODE_ENV: 'production' };
const queued = [];
const processed = [];
let enqueueImpl = async (body) => { queued.push(body); return 1; };
let workerRunning = true;

mock.module('../config/env.js', { namedExports: { env } });
mock.module('../services/webhook.service.js', {
  namedExports: { processWebhook: async (payload) => { processed.push(payload); } },
});
mock.module('../services/webhookEvents.js', {
  namedExports: { splitWebhook: (body) => [{ payload: body }] },
});
mock.module('../queues/webhook.queue.js', { namedExports: { enqueueWebhook: (body) => enqueueImpl(body) } });
mock.module('../workers/webhook.worker.js', { namedExports: { isWebhookWorkerRunning: () => workerRunning } });

const { receive } = await import('./webhook.controller.js');

const sign = (raw, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

async function post({ raw, signature }) {
  const req = {
    headers: signature === undefined ? {} : { 'x-hub-signature-256': signature },
    rawBody: raw,
    body: JSON.parse(raw),
  };
  const res = {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  await receive(req, res);
  return res;
}

const RAW = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'waba1', changes: [] }] });

test.beforeEach(() => {
  queued.length = 0;
  processed.length = 0;
  enqueueImpl = async (body) => { queued.push(body); return 1; };
  workerRunning = true;
  env.NODE_ENV = 'production';
});

test('a missing signature is a 401 and nothing is queued', async () => {
  const res = await post({ raw: RAW, signature: undefined });
  assert.equal(res.statusCode, 401);
  assert.equal(queued.length, 0);
});

test('a signature made with another secret is a 401', async () => {
  const res = await post({ raw: RAW, signature: sign(RAW, 'not-the-secret') });
  assert.equal(res.statusCode, 401);
  assert.equal(queued.length + processed.length, 0);
});

test('a valid signature over a different body is a 401 (signature binds the raw bytes)', async () => {
  const tampered = RAW.replace('waba1', 'waba2');
  const res = await post({ raw: tampered, signature: sign(RAW) });
  assert.equal(res.statusCode, 401);
  assert.equal(queued.length, 0);
});

test('truncated, unprefixed or garbage signatures are refused without throwing', async () => {
  const good = sign(RAW);
  for (const signature of [good.slice(0, -2), good.replace('sha256=', ''), 'sha256=', 'x'.repeat(200), '']) {
    const res = await post({ raw: RAW, signature });
    assert.equal(res.statusCode, 401, JSON.stringify(signature));
  }
  assert.equal(queued.length, 0);
});

test('a correctly signed event is queued, then acknowledged', async () => {
  const res = await post({ raw: RAW, signature: sign(RAW) });
  assert.equal(res.statusCode, 200);
  assert.equal(queued.length, 1);
  assert.equal(processed.length, 0, 'processing belongs to the worker, not the request');
});

test('if the event cannot be queued Meta gets a 503 so it redelivers', async () => {
  enqueueImpl = async () => { throw new Error('redis down'); };
  const res = await post({ raw: RAW, signature: sign(RAW) });
  assert.equal(res.statusCode, 503);
});

test('production never falls back to inline processing, even with no worker running', async () => {
  workerRunning = false;
  const res = await post({ raw: RAW, signature: sign(RAW) });
  assert.equal(res.statusCode, 200);
  assert.equal(queued.length, 1);
  assert.equal(processed.length, 0);
});

test('development without a worker processes inline, still only after verification', async () => {
  env.NODE_ENV = 'development';
  workerRunning = false;
  const bad = await post({ raw: RAW, signature: sign(RAW, 'nope') });
  assert.equal(bad.statusCode, 401);
  assert.equal(processed.length, 0);

  const ok = await post({ raw: RAW, signature: sign(RAW) });
  assert.equal(ok.statusCode, 200);
  assert.equal(processed.length, 1);
  assert.equal(queued.length, 0);
});
