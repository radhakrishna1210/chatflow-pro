import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'crypto';
import { prisma } from '../lib/prisma.js';
import { acceptInvitation, consumeInvitationAtomically } from './invitations.service.js';
import { assertWithinLimit } from './subscription.service.js';

let dbAvailable = false;
let workspaceId;
let inviterId;
const stamp = Date.now();
const created = [];

const hash = (t) => createHash('sha256').update(t).digest('hex');

async function makeUser(tag) {
  const u = await prisma.user.create({ data: { name: tag, email: `inv-${tag}-${stamp}@example.test` } });
  created.push(u.id);
  return u;
}

async function makeInvite(data) {
  const raw = randomBytes(32).toString('hex');
  await prisma.invitation.create({
    data: {
      workspaceId, role: 'CLIENT', tokenHash: hash(raw), invitedByUserId: inviterId,
      expiresAt: new Date(Date.now() + 3_600_000), ...data,
    },
  });
  return raw;
}

test.before(async () => {
  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    return;
  }
  workspaceId = (await prisma.workspace.create({ data: { name: `test-invites-${stamp}` } })).id;
  // Seat limits are not what is under test: put the workspace on a plan with
  // no member cap (or skip if the seed has none).
  const plan = await prisma.plan.findFirst({ where: { memberLimit: null } });
  if (!plan) { dbAvailable = false; return; }
  await prisma.subscription.create({
    data: { workspaceId, planId: plan.id, status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) },
  });
  inviterId = (await makeUser('inviter')).id;
  await prisma.workspaceMember.create({ data: { userId: inviterId, workspaceId, role: 'ADMIN' } });
  // Materialise the period's usage row once up front; its lazy creation is
  // itself racy (see subscription.service.js#getActiveSubscription) and is not
  // what these tests are about.
  await assertWithinLimit(workspaceId, 'member');
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: created } } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

test('a link capped at 2 uses admits at most 2 people accepting at once', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const raw = await makeInvite({ kind: 'LINK', email: null, maxUses: 2 });
  const people = await Promise.all([1, 2, 3, 4, 5].map((i) => makeUser(`link${i}`)));
  const results = await Promise.allSettled(people.map((u) => acceptInvitation(raw, u.id)));
  const joined = await prisma.workspaceMember.count({ where: { workspaceId, userId: { in: people.map((u) => u.id) } } });
  assert.equal(joined, 2, `results: ${results.map((r) => r.status).join(',')}`);
  for (const r of results.filter((x) => x.status === 'rejected')) assert.equal(r.reason.status, 410, r.reason.stack);
});

test('an email invite cannot be accepted by a different account', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const raw = await makeInvite({ kind: 'EMAIL', email: `inv-target-${stamp}@example.test` });
  const other = await makeUser('other');
  await assert.rejects(acceptInvitation(raw, other.id), { code: 'EMAIL_MISMATCH' });
});

test('a revoked or expired invite does not join anyone, even via signup', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const revoked = await makeInvite({ kind: 'LINK', email: null, status: 'REVOKED' });
  const expired = await makeInvite({ kind: 'LINK', email: null, expiresAt: new Date(Date.now() - 1000) });
  const u = await makeUser('late');
  await assert.rejects(acceptInvitation(revoked, u.id), { status: 410 });
  await assert.rejects(acceptInvitation(expired, u.id), { status: 410 });
  const joined = await prisma.$transaction((tx) => consumeInvitationAtomically(tx, revoked, u.email, u.id));
  assert.equal(joined, null);
  assert.equal(await prisma.workspaceMember.count({ where: { workspaceId, userId: u.id } }), 0);
});

test('signup through a capped link respects the cap', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const raw = await makeInvite({ kind: 'LINK', email: null, maxUses: 1 });
  const a = await makeUser('signupA');
  const b = await makeUser('signupB');
  const ra = await prisma.$transaction((tx) => consumeInvitationAtomically(tx, raw, a.email, a.id));
  const rb = await prisma.$transaction((tx) => consumeInvitationAtomically(tx, raw, b.email, b.id));
  assert.ok(ra);
  assert.equal(rb, null);
});
