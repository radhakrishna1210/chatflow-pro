import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// authenticate() awaits the revocation check on every request, so during a
// Redis outage it must neither hang in ioredis' offline queue nor forget the
// revocations this instance made itself.
const fake = { status: 'ready', store: new Map(), calls: 0 };

mock.module('./redis.js', {
  namedExports: {
    logRedisError: () => {},
    redis: {
      get status() { return fake.status; },
      set: async (key, value) => {
        fake.calls += 1;
        if (fake.status !== 'ready') return new Promise(() => {}); // what the offline queue does
        fake.store.set(key, value);
        return 'OK';
      },
      mget: async (...keys) => {
        fake.calls += 1;
        if (fake.status !== 'ready') return new Promise(() => {});
        return keys.map((k) => fake.store.get(k) ?? null);
      },
    },
  },
});

const deny = await import('./tokenDenylist.js');
const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

test('a revoked token is reported while Redis is up', async () => {
  fake.status = 'ready';
  assert.equal(await deny.revokeAccessToken('jti-1', inAnHour()), true);
  assert.equal(await deny.isAccessTokenRevoked('jti-1'), true);
  assert.equal(await deny.isAccessTokenRevoked('jti-2'), false);
});

test('with Redis down nothing waits on a command, and local revocations still hold', async () => {
  fake.status = 'reconnecting';
  fake.calls = 0;
  assert.equal(await deny.revokeAccessToken('jti-3', inAnHour()), false);
  assert.equal(await deny.isAccessTokenRevoked('jti-3'), true);
  assert.equal(await deny.isAccessTokenRevoked('jti-1'), true);
  assert.equal(await deny.isAccessTokenRevoked('jti-unknown'), false);
  assert.equal(fake.calls, 0);
});

test('sign out everywhere refuses every token issued before it', async () => {
  fake.status = 'reconnecting';
  const issuedEarlier = Math.floor(Date.now() / 1000) - 5;
  await deny.revokeAllUserAccessTokens('user-1', 900);
  assert.equal(await deny.isAccessTokenRevoked('jti-a', { userId: 'user-1', iat: issuedEarlier }), true);
  assert.equal(await deny.isAccessTokenRevoked('jti-b', { userId: 'user-1', iat: issuedEarlier + 3600 }), false);
  assert.equal(await deny.isAccessTokenRevoked('jti-c', { userId: 'user-2', iat: issuedEarlier }), false);
});
