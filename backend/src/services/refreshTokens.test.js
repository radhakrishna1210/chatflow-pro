import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

// Session refresh against an in-memory RefreshToken table: hashing at rest,
// legacy plaintext rows, rotation, reuse detection and workspace scope.

const SECRET = 'r'.repeat(40);
let rows = [];
let seq = 0;
const members = [];
const users = [{ id: 'u1', email: 'user@example.test', name: 'U' }];

function matches(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return cond.some((c) => matches(row, c));
    const value = row[key] ?? null;
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('not' in cond) return value !== cond.not && value !== null;
      if ('lt' in cond) return value < cond.lt;
      if ('gt' in cond) return value > cond.gt;
      if ('in' in cond) return cond.in.includes(value);
    }
    return value === (cond ?? null);
  });
}

const fakePrisma = {
  refreshToken: {
    create: async ({ data }) => { const r = { id: `rt${++seq}`, token: null, rotatedAt: null, createdAt: new Date(), ...data }; rows.push(r); return r; },
    findFirst: async ({ where }) => rows.find((r) => matches(r, where)) ?? null,
    updateMany: async ({ where, data }) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    deleteMany: async ({ where }) => {
      const before = rows.length;
      rows = rows.filter((r) => !matches(r, where));
      return { count: before - rows.length };
    },
  },
  user: { findUnique: async ({ where }) => users.find((u) => u.id === where.id) ?? null },
  workspace: { findUnique: async ({ where }) => ({ id: where.id, name: where.id.toUpperCase() }) },
  workspaceMember: {
    findUnique: async ({ where }) => {
      const { userId, workspaceId } = where.userId_workspaceId;
      const m = members.find((x) => x.userId === userId && x.workspaceId === workspaceId);
      return m ? { ...m, workspace: { id: m.workspaceId, name: m.workspaceId.toUpperCase() } } : null;
    },
    findFirst: async ({ where }) => {
      const m = members.filter((x) => x.userId === where.userId).sort((a, b) => a.joinedAt - b.joinedAt)[0];
      return m ? { ...m, workspace: { id: m.workspaceId, name: m.workspaceId.toUpperCase() } } : null;
    },
  },
};

let auth;
let store;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: fakePrisma } });
  mock.module('../config/env.js', {
    namedExports: {
      env: {
        JWT_ACCESS_SECRET: 'a'.repeat(40),
        JWT_REFRESH_SECRET: SECRET,
        JWT_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '7d',
        ADMIN_EMAIL: 'admin@example.test',
        BCRYPT_SALT_ROUNDS: 4,
      },
    },
  });
  mock.module('./email.service.js', { namedExports: { queueWelcomeEmail: async () => {}, sendOtpEmailNow: async () => {} } });
  mock.module('./invitations.service.js', { namedExports: { consumeInvitationAtomically: async () => null } });
  mock.module('../lib/redis.js', { namedExports: { redis: { status: 'end' } } });
  store = await import('./refreshTokens.js');
  auth = await import('./auth.service.js');
});

test.beforeEach(() => {
  rows = [];
  members.length = 0;
  members.push(
    { userId: 'u1', workspaceId: 'wsa', role: 'ADMIN', joinedAt: new Date('2025-01-01') },
    { userId: 'u1', workspaceId: 'wsb', role: 'AGENT', joinedAt: new Date('2025-06-01') },
  );
});

const mintRefresh = () => jwt.sign({ sub: 'u1', jti: String(Math.random()) }, SECRET, { expiresIn: '7d' });
const future = () => new Date(Date.now() + 86_400_000);

test('only a hash of the token is stored', async () => {
  const token = mintRefresh();
  await store.storeRefreshToken({ userId: 'u1', token, expiresAt: future(), workspaceId: 'wsb' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token, null);
  assert.equal(rows[0].tokenHash, store.hashRefreshToken(token));
  assert.ok(!JSON.stringify(rows).includes(token));
});

test('refresh keeps the session workspace instead of the earliest one', async () => {
  const token = mintRefresh();
  await store.storeRefreshToken({ userId: 'u1', token, expiresAt: future(), workspaceId: 'wsb' });
  const out = await auth.refresh(token);
  assert.equal(jwt.decode(out.accessToken).workspaceId, 'wsb');
  assert.equal(jwt.decode(out.accessToken).role, 'AGENT');
  assert.equal(out.workspace.id, 'wsb');
});

test('refresh falls back to the earliest workspace after leaving the scoped one', async () => {
  const token = mintRefresh();
  await store.storeRefreshToken({ userId: 'u1', token, expiresAt: future(), workspaceId: 'gone' });
  const out = await auth.refresh(token);
  assert.equal(jwt.decode(out.accessToken).workspaceId, 'wsa');
});

test('a legacy plaintext row still refreshes and is hashed on use', async () => {
  const token = mintRefresh();
  rows.push({ id: 'legacy', userId: 'u1', token, tokenHash: null, familyId: null, workspaceId: null, rotatedAt: null, expiresAt: future() });
  const out = await auth.refresh(token);
  assert.ok(out.refreshToken);
  const legacy = rows.find((r) => r.id === 'legacy');
  assert.equal(legacy.token, null);
  assert.equal(legacy.tokenHash, store.hashRefreshToken(token));
  assert.ok(legacy.rotatedAt);
  assert.ok(!JSON.stringify(rows).includes(token));
  // The successor joins the legacy row's family.
  const successor = rows.find((r) => r.tokenHash === store.hashRefreshToken(out.refreshToken));
  assert.equal(successor.familyId, legacy.familyId);
});

test('a concurrent second use within the grace window is refused without revoking', async () => {
  const token = mintRefresh();
  await store.storeRefreshToken({ userId: 'u1', token, expiresAt: future() });
  const first = await auth.refresh(token);
  await assert.rejects(auth.refresh(token), (e) => e.status === 401 && e.code === 'REFRESH_TOKEN_ROTATED');
  // The winner's session survives.
  const again = await auth.refresh(first.refreshToken);
  assert.ok(again.accessToken);
});

test('replaying a rotated token later revokes the whole family', async () => {
  const token = mintRefresh();
  await store.storeRefreshToken({ userId: 'u1', token, expiresAt: future() });
  const other = mintRefresh();
  await store.storeRefreshToken({ userId: 'u1', token: other, expiresAt: future() });
  const stolenChain = await auth.refresh(token);

  // Age the rotation past the grace window.
  rows.find((r) => r.tokenHash === store.hashRefreshToken(token)).rotatedAt = new Date(Date.now() - store.ROTATION_GRACE_MS - 1000);

  await assert.rejects(auth.refresh(token), (e) => e.status === 401 && e.code === 'REFRESH_TOKEN_REUSED');
  await assert.rejects(auth.refresh(stolenChain.refreshToken), (e) => e.status === 401);
  // An unrelated sign-in of the same user is untouched.
  assert.ok((await auth.refresh(other)).accessToken);
});

test('an unknown or mis-signed token is a plain 401', async () => {
  await assert.rejects(auth.refresh(mintRefresh()), (e) => e.status === 401);
  await assert.rejects(auth.refresh('not-a-jwt'), (e) => e.status === 401);
});

test('logout ends the family including rotated predecessors', async () => {
  const token = mintRefresh();
  await store.storeRefreshToken({ userId: 'u1', token, expiresAt: future() });
  const next = await auth.refresh(token);
  await auth.logout(next.refreshToken);
  assert.equal(rows.length, 0);
});

test('revoking other sessions keeps the caller\'s family', async () => {
  const mine = mintRefresh();
  const theirs = mintRefresh();
  await store.storeRefreshToken({ userId: 'u1', token: mine, expiresAt: future() });
  await store.storeRefreshToken({ userId: 'u1', token: theirs, expiresAt: future() });
  const mineNext = await auth.refresh(mine);
  const revoked = await store.revokeOtherFamilies('u1', mineNext.refreshToken);
  assert.equal(revoked, 1);
  assert.ok((await auth.refresh(mineNext.refreshToken)).accessToken);
  await assert.rejects(auth.refresh(theirs), (e) => e.status === 401);
});

test('impersonation mints a short, marked access token and no refresh token', async () => {
  const out = await auth.impersonateUser('u1', { impersonatorId: 'admin1' });
  assert.equal(out.refreshToken, null);
  assert.equal(rows.length, 0, 'nothing appears in the session list of the target');
  const claims = jwt.decode(out.accessToken);
  assert.equal(claims.imp, 'admin1');
  assert.equal(claims.superAdmin, false);
  assert.ok(claims.exp - claims.iat <= 30 * 60);
  assert.equal(out.workspace.id, 'wsa');
});

test('impersonation requires the impersonator', async () => {
  await assert.rejects(auth.impersonateUser('u1'), (e) => e.status === 400);
});

test('a disabled account cannot refresh and its family is revoked', async () => {
  const token = mintRefresh();
  await store.storeRefreshToken({ userId: 'u1', token, expiresAt: future() });
  users[0].disabledAt = new Date();
  try {
    await assert.rejects(auth.refresh(token), (e) => e.status === 401 && e.code === 'ACCOUNT_DISABLED');
    assert.equal(rows.length, 0);
  } finally {
    users[0].disabledAt = null;
  }
});
