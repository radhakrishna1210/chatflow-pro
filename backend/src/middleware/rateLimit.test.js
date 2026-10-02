import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

let clientBucket;

test.before(async () => {
  // Keep the limiter on its in-memory path; no Redis is needed to test keys.
  mock.module('../lib/redis.js', { namedExports: { redis: { status: 'end' } } });
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
