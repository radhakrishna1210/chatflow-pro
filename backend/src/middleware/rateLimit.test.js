import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Redis is "down", so the in-memory buckets are what is exercised.
mock.module('../lib/redis.js', { namedExports: { redis: { status: 'end' } } });

const { rateLimit, apiKeyIdentity, recipientIdentity } = await import('./rateLimit.js');

async function call(mw, req) {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json() { return this; },
  };
  let passed = false;
  await mw({ ip: '10.0.0.1', socket: {}, ...req }, res, () => { passed = true; });
  return passed ? 200 : res.statusCode;
}

test('a `by` identity gives each API key its own budget, whatever the address', async () => {
  const mw = rateLimit({ windowMs: 60_000, max: 2, keyPrefix: `t-by-${Date.now()}`, by: apiKeyIdentity });
  const a = { apiKey: { id: 'A' } };
  const b = { apiKey: { id: 'B' } };
  assert.equal(await call(mw, a), 200);
  assert.equal(await call(mw, a), 200);
  assert.equal(await call(mw, a), 429);
  assert.equal(await call(mw, b), 200, 'key B is not charged for key A');
});

test('the recipient bucket stops one number being flooded across keys', async () => {
  const mw = rateLimit({ windowMs: 60_000, max: 100, keyPrefix: `t-to-${Date.now()}`, by: apiKeyIdentity, subject: recipientIdentity('to'), subjectMax: 2 });
  const send = (key, to) => call(mw, { apiKey: { id: key }, workspaceId: 'ws', body: { to } });
  assert.equal(await send('A', '+91 98765 43210'), 200);
  assert.equal(await send('B', '919876543210'), 200);
  assert.equal(await send('C', '919876543210'), 429);
  assert.equal(await send('A', '919999999999'), 200, 'other recipients are unaffected');
});

test('recipientIdentity is scoped to the workspace', () => {
  const id = recipientIdentity('to');
  assert.notEqual(id({ workspaceId: 'w1', body: { to: '91 1' } }), id({ workspaceId: 'w2', body: { to: '911' } }));
  assert.equal(id({ workspaceId: 'w1', body: {} }), null);
});
