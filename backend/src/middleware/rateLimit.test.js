import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

let clientBucket;

test.before(async () => {
  // Keep the limiter on its in-memory path; no Redis is needed to test keys.
  mock.module('../lib/redis.js', { namedExports: { redis: { status: 'end' }, logRedisError: () => {} } });
  ({ clientBucket } = await import('./rateLimit.js'));
});

test('IPv4 addresses are their own bucket', () => {
  assert.equal(clientBucket('203.0.113.7'), '203.0.113.7');
});

test('IPv4-mapped IPv6 collapses to the IPv4 address', () => {
  assert.equal(clientBucket('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(clientBucket('::FFFF:203.0.113.7'), '203.0.113.7');
});

test('native IPv6 is bucketed by /64 so a subscriber cannot rotate addresses', () => {
  const a = clientBucket('2001:db8:abcd:12::1');
  const b = clientBucket('2001:0db8:abcd:0012:ffff:ffff:ffff:ffff');
  assert.equal(a, '2001:db8:abcd:12::/64');
  assert.equal(a, b);
  assert.notEqual(a, clientBucket('2001:db8:abcd:13::1'));
});

test('compressed and zoned IPv6 forms are normalised', () => {
  assert.equal(clientBucket('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(clientBucket('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(clientBucket('::1'), '0:0:0:0::/64');
});

test('a missing address falls back to a fixed bucket', () => {
  assert.equal(clientBucket(undefined), 'unknown');
  assert.equal(clientBucket(''), 'unknown');
});

function fakeExchange(ip) {
  const listeners = {};
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    on(event, fn) { listeners[event] = fn; },
    finish(code) { this.statusCode = code; listeners.finish?.(); },
  };
  return { req: { ip, headers: {}, body: {} }, res };
}

test('a parallel burst of failures cannot exceed a failure-only limit', async () => {
  const { rateLimit } = await import('./rateLimit.js');
  const limiter = rateLimit({ windowMs: 60_000, max: 3, keyPrefix: `burst-${Date.now()}`, countFailuresOnly: true });
  const exchanges = Array.from({ length: 10 }, () => fakeExchange('198.51.100.1'));
  let reachedHandler = 0;
  await Promise.all(exchanges.map(({ req, res }) => limiter(req, res, () => { reachedHandler += 1; })));
  assert.equal(reachedHandler, 3);
  assert.equal(exchanges.filter(({ res }) => res.statusCode === 429).length, 7);
});

test('successes are refunded and never spend the allowance', async () => {
  const { rateLimit } = await import('./rateLimit.js');
  const limiter = rateLimit({ windowMs: 60_000, max: 2, keyPrefix: `ok-${Date.now()}`, countFailuresOnly: true });
  for (let i = 0; i < 5; i += 1) {
    const { req, res } = fakeExchange('198.51.100.2');
    let passed = false;
    await limiter(req, res, () => { passed = true; });
    assert.equal(passed, true, `attempt ${i + 1}`);
    res.finish(200);
  }
  // Two failures use the allowance up; the third attempt is refused.
  for (let i = 0; i < 2; i += 1) {
    const { req, res } = fakeExchange('198.51.100.2');
    await limiter(req, res, () => {});
    res.finish(401);
  }
  const { req, res } = fakeExchange('198.51.100.2');
  let passed = false;
  await limiter(req, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 429);
});

async function call(mw, req) {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json() { return this; },
    on() {},
  };
  let passed = false;
  await mw({ ip: '10.0.0.1', socket: {}, headers: {}, ...req }, res, () => { passed = true; });
  return passed ? 200 : res.statusCode;
}

test('a `by` identity gives each API key its own budget, whatever the address', async () => {
  const { rateLimit, apiKeyIdentity } = await import('./rateLimit.js');
  const mw = rateLimit({ windowMs: 60_000, max: 2, keyPrefix: `t-by-${Date.now()}`, by: apiKeyIdentity });
  const a = { apiKey: { id: 'A' } };
  const b = { apiKey: { id: 'B' } };
  assert.equal(await call(mw, a), 200);
  assert.equal(await call(mw, a), 200);
  assert.equal(await call(mw, a), 429);
  assert.equal(await call(mw, b), 200, 'key B is not charged for key A');
});

test('the recipient bucket stops one number being flooded across keys', async () => {
  const { rateLimit, apiKeyIdentity, recipientIdentity } = await import('./rateLimit.js');
  const mw = rateLimit({ windowMs: 60_000, max: 100, keyPrefix: `t-to-${Date.now()}`, by: apiKeyIdentity, subject: recipientIdentity('to'), subjectMax: 2 });
  const send = (key, to) => call(mw, { apiKey: { id: key }, workspaceId: 'ws', body: { to } });
  assert.equal(await send('A', '+91 98765 43210'), 200);
  assert.equal(await send('B', '919876543210'), 200);
  assert.equal(await send('C', '919876543210'), 429);
  assert.equal(await send('A', '919999999999'), 200, 'other recipients are unaffected');
});

test('recipientIdentity is scoped to the workspace', async () => {
  const { recipientIdentity } = await import('./rateLimit.js');
  const id = recipientIdentity('to');
  assert.notEqual(id({ workspaceId: 'w1', body: { to: '91 1' } }), id({ workspaceId: 'w2', body: { to: '911' } }));
  assert.equal(id({ workspaceId: 'w1', body: {} }), null);
});
