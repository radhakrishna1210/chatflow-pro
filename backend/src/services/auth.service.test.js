import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { prisma } from '../lib/prisma.js';
import { login, refresh, findOrCreateGoogleUser, startPasswordReset, startSignup } from './auth.service.js';

let dbAvailable = false;
const stamp = Date.now();
const email = `authsvc-${stamp}@example.test`;
let userId;

test.before(async () => {
  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    return;
  }
  const { default: bcrypt } = await import('bcryptjs');
  userId = (await prisma.user.create({
    data: { name: 'Auth Svc', email, passwordHash: await bcrypt.hash('password123', 4) },
  })).id;
});

test.after(async () => {
  await prisma.emailOtp.deleteMany({ where: { email: { contains: `${stamp}@example.test` } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { contains: `${stamp}@example.test` } } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

test('concurrent refreshes with one token: exactly one wins, the rest are 401 (not 500)', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const { refreshToken } = await login({ email, password: 'password123' });
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => refresh(refreshToken)));
  const ok = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected');
  assert.equal(ok.length, 1);
  for (const f of failed) assert.equal(f.reason.status, 401);
  // And the used token stays dead.
  await assert.rejects(refresh(refreshToken), { status: 401 });
});

test('Google sign-in with an unverified email does not take over an existing account', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await assert.rejects(
    findOrCreateGoogleUser({ googleId: `g-evil-${stamp}`, email: email.toUpperCase(), name: 'Evil', emailVerified: false }),
    { code: 'email_unverified' },
  );
  const user = await prisma.user.findUnique({ where: { id: userId } });
  assert.equal(user.googleId, null, 'the attacker googleId must not be linked');
});

test('Google sign-in with an unverified email cannot claim the platform admin address', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const { env } = await import('../config/env.js');
  const existing = await prisma.user.findUnique({ where: { email: env.ADMIN_EMAIL.toLowerCase() } });
  await assert.rejects(
    findOrCreateGoogleUser({ googleId: `g-admin-${stamp}`, email: env.ADMIN_EMAIL, name: 'Evil', emailVerified: false }),
    { code: 'email_unverified' },
  );
  const after = await prisma.user.findUnique({ where: { email: env.ADMIN_EMAIL.toLowerCase() } });
  assert.equal(after?.googleId ?? null, existing?.googleId ?? null);
});

test('a verified Google email links, and a new Google user is stored with a normalised address', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const linked = await findOrCreateGoogleUser({ googleId: `g-ok-${stamp}`, email, name: 'Auth Svc', emailVerified: true });
  assert.equal(linked.user.id, userId);

  const mixed = `New.Google-${stamp}@Example.Test`;
  const created = await findOrCreateGoogleUser({ googleId: `g-new-${stamp}`, email: mixed, name: 'New', emailVerified: true });
  assert.equal(created.user.email, mixed.toLowerCase());
});

test('password-reset cooldown answers exactly like a fresh send (no enumeration oracle)', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await prisma.emailOtp.create({
    data: {
      email, purpose: 'PASSWORD_RESET', codeHash: createHash('sha256').update('000000').digest('hex'),
      name: 'x', expiresAt: new Date(Date.now() + 600_000),
    },
  });
  const known = await startPasswordReset({ email });
  const unknown = await startPasswordReset({ email: `nobody-${stamp}@example.test` });
  assert.deepEqual(known, unknown);
});

test('signup cooldown answers like a fresh send', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const fresh = `signup-${stamp}@example.test`;
  await prisma.emailOtp.create({
    data: {
      email: fresh, purpose: 'SIGNUP', codeHash: createHash('sha256').update('000000').digest('hex'),
      name: 'x', passwordHash: 'x', expiresAt: new Date(Date.now() + 600_000),
    },
  });
  const r = await startSignup({ name: 'Someone', email: fresh, password: 'password123' });
  assert.equal(r.message, 'Verification code sent');
});
