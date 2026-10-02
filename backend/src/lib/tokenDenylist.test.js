import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// During a Redis outage the revocation check must fail open at once rather
// than wait in ioredis' offline queue — authenticate() awaits it on every
// request, so a hang there is an outage of the whole authenticated API.
const fake = { status: 'ready', revoked: new Set(), calls: 0 };

mock.module('./redis.js', {
  namedExports: {
    logRedisError: () => {},
    redis: {
      get status() { return fake.status; },
      exists: async (key) => {
        fake.calls += 1;
        if (fake.status !== 'ready') return new Promise(() => {}); // what the offline queue does
        return fake.revoked.has(key) ? 1 : 0;
      },
      set: async (key) => {
        fake.calls += 1;
        if (fake.status !== 'ready') return new Promise(() => {});
        fake.revoked.add(key);
        return 'OK';
      },
    },
  },
});

const { isAccessTokenRevoked, revokeAccessToken } = await import('./tokenDenylist.js');
const inAnHour = Math.floor(Date.now() / 1000) + 3600;

test('a revoked token is reported while Redis is up', async () => {
  fake.status = 'ready';
  assert.equal(await revokeAccessToken('jti-1', inAnHour), true);
  assert.equal(await isAccessTokenRevoked('jti-1'), true);
  assert.equal(await isAccessTokenRevoked('jti-2'), false);
});

test('with Redis down the check fails open without issuing a command', async () => {
  fake.status = 'reconnecting';
  fake.calls = 0;
  assert.equal(await isAccessTokenRevoked('jti-1'), false);
  assert.equal(await revokeAccessToken('jti-3', inAnHour), false);
  assert.equal(fake.calls, 0);
});
