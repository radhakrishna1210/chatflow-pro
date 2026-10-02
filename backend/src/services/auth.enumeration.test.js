import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Account enumeration: the forgot-password and signup endpoints must answer a
// quick second request the same way whether or not the address has an account.

const accounts = new Map([['known@example.test', { id: 'u1', name: 'K', email: 'known@example.test', passwordHash: null }]]);
const sent = [];

const fakePrisma = {
  user: { findUnique: async ({ where }) => accounts.get(where.email) ?? null },
  emailOtp: {
    findFirst: async () => null,
    updateMany: async () => ({ count: 0 }),
    create: async () => ({}),
    deleteMany: () => Promise.resolve({ count: 0 }),
  },
};

let auth;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: fakePrisma } });
  mock.module('../lib/redis.js', { namedExports: { redis: { status: 'end' } } });
  mock.module('../config/env.js', {
    namedExports: {
      env: {
        JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'r'.repeat(40),
        JWT_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '7d', ADMIN_EMAIL: 'admin@example.test', BCRYPT_SALT_ROUNDS: 4,
      },
    },
  });
  mock.module('./email.service.js', {
    namedExports: { queueWelcomeEmail: async () => {}, sendOtpEmailNow: async (type, p) => { sent.push([type, p.email]); return { ok: true }; } },
  });
  mock.module('./invitations.service.js', { namedExports: { consumeInvitationAtomically: async () => null } });
  mock.module('./refreshTokens.js', { namedExports: { storeRefreshToken: async () => {} } });
  auth = await import('./auth.service.js');
});

async function outcome(promise) {
  try { await promise; return 200; } catch (e) { return e.status; }
}

test('forgot-password: the cooldown applies to unknown addresses too', async () => {
  const known = [await outcome(auth.startPasswordReset({ email: 'known@example.test' })),
    await outcome(auth.startPasswordReset({ email: 'Known@example.test ' }))];
  const unknown = [await outcome(auth.startPasswordReset({ email: 'nobody@example.test' })),
    await outcome(auth.startPasswordReset({ email: 'nobody@example.test' }))];
  assert.deepEqual(known, [200, 429]);
  assert.deepEqual(unknown, known);
});

test('signup: an existing account and a new address answer a repeat identically', async () => {
  const existing = [await outcome(auth.startSignup({ name: 'K', email: 'known@example.test', password: 'pw-123456' })),
    await outcome(auth.startSignup({ name: 'K', email: 'known@example.test', password: 'pw-123456' }))];
  const fresh = [await outcome(auth.startSignup({ name: 'N', email: 'new@example.test', password: 'pw-123456' })),
    await outcome(auth.startSignup({ name: 'N', email: 'new@example.test', password: 'pw-123456' }))];
  assert.deepEqual(existing, [200, 429]);
  assert.deepEqual(fresh, existing);
});

test('login: no account and no password both fail as invalid credentials', async () => {
  await assert.rejects(auth.login({ email: 'nobody@example.test', password: 'x' }), (e) => e.status === 401);
  await assert.rejects(auth.login({ email: 'known@example.test', password: 'x' }), (e) => e.status === 401);
});
