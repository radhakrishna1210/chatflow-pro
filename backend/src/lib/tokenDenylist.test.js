import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Redis is down for the whole file: revocations made by this instance must
// still hold instead of the check quietly allowing every token.

let deny;

test.before(async () => {
  mock.module('./redis.js', {
    namedExports: {
      redis: {
        status: 'reconnecting',
        set: async () => { throw new Error('ECONNREFUSED'); },
        mget: async () => { throw new Error('ECONNREFUSED'); },
      },
    },
  });
  deny = await import('./tokenDenylist.js');
});

const inFuture = () => Math.floor(Date.now() / 1000) + 600;

test('a logged-out token stays revoked while Redis is unreachable', async () => {
  await deny.revokeAccessToken('jti-1', inFuture());
  assert.equal(await deny.isAccessTokenRevoked('jti-1'), true);
  assert.equal(await deny.isAccessTokenRevoked('jti-2'), false);
});

test('sign out everywhere refuses every token issued before it', async () => {
  const issuedEarlier = Math.floor(Date.now() / 1000) - 5;
  await deny.revokeAllUserAccessTokens('user-1', 900);
  assert.equal(await deny.isAccessTokenRevoked('jti-a', { userId: 'user-1', iat: issuedEarlier }), true);
  assert.equal(await deny.isAccessTokenRevoked('jti-b', { userId: 'user-1', iat: issuedEarlier + 3600 }), false);
  assert.equal(await deny.isAccessTokenRevoked('jti-c', { userId: 'user-2', iat: issuedEarlier }), false);
});
