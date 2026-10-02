import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';

// Accepting an invitation: one use per claim, the seat check inside the same
// transaction, and nothing written when either fails. The database lock that
// serialises concurrent accepts is emulated by running the fake transactions
// one at a time.

const hash = (t) => createHash('sha256').update(t).digest('hex');
let invitations;
let members;
let users;
let seatLimit;

function snapshot() {
  return { invitations: structuredClone(invitations), members: structuredClone(members) };
}

const model = (rowsRef) => ({
  updateMany: async ({ where, data }) => {
    const hit = rowsRef().filter((r) => r.id === where.id
      && (!where.status || r.status === where.status)
      && (!where.expiresAt || r.expiresAt > where.expiresAt.gt)
      && (!where.useCount || ('lt' in where.useCount ? r.useCount < where.useCount.lt : r.useCount >= where.useCount.gte)));
    for (const r of hit) {
      for (const [k, v] of Object.entries(data)) r[k] = v?.increment ? r[k] + v.increment : v;
    }
    return { count: hit.length };
  },
});

const fakePrisma = {
  invitation: {
    findUnique: async ({ where }) => structuredClone(invitations.find((i) => i.tokenHash === where.tokenHash) ?? null),
    update: async () => {},
    ...model(() => invitations),
  },
  user: { findUnique: async ({ where }) => users.find((u) => u.id === where.id) ?? null },
  workspaceMember: {
    findUnique: async ({ where }) => members.find((m) => m.userId === where.userId_workspaceId.userId
      && m.workspaceId === where.userId_workspaceId.workspaceId) ?? null,
    create: async ({ data }) => {
      if (members.some((m) => m.userId === data.userId && m.workspaceId === data.workspaceId)) {
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      }
      members.push({ ...data });
      return { ...data };
    },
  },
  $queryRaw: async () => [],
  // All-or-nothing, and one at a time — what the workspace row lock gives the
  // real transactions.
  $transaction: (fn) => {
    const run = txQueue.then(async () => {
      const before = snapshot();
      try {
        return await fn(fakePrisma);
      } catch (err) {
        invitations = before.invitations;
        members = before.members;
        throw err;
      }
    });
    txQueue = run.catch(() => {});
    return run;
  },
};
let txQueue = Promise.resolve();

let acceptInvitation;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: fakePrisma } });
  mock.module('../config/env.js', { namedExports: { env: { CLIENT_URL: 'http://x' } } });
  mock.module('./email.service.js', { namedExports: { queueWorkspaceInviteEmail: async () => {} } });
  mock.module('./notification.service.js', { namedExports: { notifyUser: async () => {} } });
  mock.module('./subscription.service.js', {
    namedExports: {
      assertWithinLimit: async (workspaceId, kind, { db }) => {
        assert.equal(db, fakePrisma, 'seat count runs on the transaction client');
        const teammates = members.filter((m) => m.workspaceId === workspaceId).length - 1;
        if (teammates + 1 > seatLimit) throw Object.assign(new Error('Plan full'), { status: 403, code: 'PLAN_LIMIT_REACHED' });
      },
    },
  });
  ({ acceptInvitation } = await import('./invitations.service.js'));
});

test.beforeEach(() => {
  seatLimit = 10;
  users = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, email: `${id}@x.test` }));
  members = [{ userId: 'owner', workspaceId: 'w1', role: 'ADMIN' }];
  invitations = [
    { id: 'link', tokenHash: hash('link-token'), kind: 'LINK', workspaceId: 'w1', role: 'AGENT', status: 'PENDING', maxUses: 1, useCount: 0, expiresAt: new Date(Date.now() + 1e7) },
    { id: 'mail', tokenHash: hash('mail-token'), kind: 'EMAIL', email: 'a@x.test', workspaceId: 'w1', role: 'CLIENT', status: 'PENDING', maxUses: null, useCount: 0, expiresAt: new Date(Date.now() + 1e7) },
  ];
});

test('a single-use link admits exactly one of several concurrent redeemers', async () => {
  const results = await Promise.allSettled(['a', 'b', 'c', 'd', 'e'].map((u) => acceptInvitation('link-token', u)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.status === 410));
  assert.equal(members.length, 2);
  const link = invitations.find((i) => i.id === 'link');
  assert.equal(link.useCount, 1);
  assert.equal(link.status, 'ACCEPTED');
});

test('a full plan burns no use and creates no member', async () => {
  seatLimit = 0;
  await assert.rejects(acceptInvitation('link-token', 'a'), (e) => e.code === 'PLAN_LIMIT_REACHED');
  assert.equal(invitations.find((i) => i.id === 'link').useCount, 0);
  assert.equal(members.length, 1);
});

test('a double-submitted email invite converges on one membership', async () => {
  const [one, two] = await Promise.all([acceptInvitation('mail-token', 'a'), acceptInvitation('mail-token', 'a')]);
  assert.deepEqual(one, { workspaceId: 'w1', role: 'CLIENT' });
  assert.deepEqual(two, { workspaceId: 'w1', role: 'CLIENT' });
  assert.equal(members.filter((m) => m.userId === 'a').length, 1);
  const mail = invitations.find((i) => i.id === 'mail');
  assert.equal(mail.status, 'ACCEPTED');
  assert.equal(mail.useCount, 1);
});
