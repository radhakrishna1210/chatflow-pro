import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { updateMemberRole, removeMember } from './members.service.js';

let dbAvailable = false;
let workspaceId;
const users = {};

test.before(async () => {
  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    return;
  }
  const stamp = Date.now();
  workspaceId = (await prisma.workspace.create({ data: { name: `test-members-${stamp}` } })).id;
  for (const name of ['owner', 'admin2', 'admin3', 'member']) {
    users[name] = (await prisma.user.create({ data: { name, email: `${name}-${stamp}@example.test` } })).id;
  }
  // joinedAt decides who the owner is, so stagger them.
  let t = Date.now() - 10_000;
  for (const [name, role] of [['owner', 'ADMIN'], ['admin2', 'ADMIN'], ['admin3', 'ADMIN'], ['member', 'CLIENT']]) {
    await prisma.workspaceMember.create({ data: { userId: users[name], workspaceId, role, joinedAt: new Date(t += 1000) } });
  }
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

test('another admin cannot demote or remove the workspace owner', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await assert.rejects(updateMemberRole(workspaceId, users.owner, 'CLIENT', users.admin2), { code: 'OWNER_PROTECTED' });
  await assert.rejects(removeMember(workspaceId, users.owner, users.admin2), { code: 'OWNER_PROTECTED' });
  const owner = await prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId: users.owner, workspaceId } } });
  assert.equal(owner.role, 'ADMIN');
});

test('nobody can demote themselves, and the owner can still manage other admins', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await assert.rejects(updateMemberRole(workspaceId, users.admin2, 'CLIENT', users.admin2), { code: 'CANNOT_CHANGE_OWN_ROLE' });
  const demoted = await updateMemberRole(workspaceId, users.admin3, 'CLIENT', users.owner);
  assert.equal(demoted.role, 'CLIENT');
  await updateMemberRole(workspaceId, users.admin3, 'ADMIN', users.owner);
});

test('two admins demoting each other at once cannot leave the workspace without an admin', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  // A workspace with exactly two admins and no protected owner among the targets.
  const stamp = Date.now();
  const ws = (await prisma.workspace.create({ data: { name: `test-members-race-${stamp}` } })).id;
  const a = (await prisma.user.create({ data: { name: 'a', email: `ra-${stamp}@example.test` } })).id;
  const b = (await prisma.user.create({ data: { name: 'b', email: `rb-${stamp}@example.test` } })).id;
  try {
    await prisma.workspaceMember.create({ data: { userId: a, workspaceId: ws, role: 'ADMIN' } });
    await prisma.workspaceMember.create({ data: { userId: b, workspaceId: ws, role: 'ADMIN' } });
    // Unattributed calls (no acting user) skip the owner rule, isolating the
    // last-admin check that the row lock protects.
    const results = await Promise.allSettled([
      updateMemberRole(ws, a, 'CLIENT'),
      updateMemberRole(ws, b, 'CLIENT'),
    ]);
    const admins = await prisma.workspaceMember.count({ where: { workspaceId: ws, role: 'ADMIN' } });
    assert.equal(admins, 1, `expected one admin left, results: ${results.map((r) => r.status).join(',')}`);
    assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  } finally {
    await prisma.workspace.delete({ where: { id: ws } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [a, b] } } }).catch(() => {});
  }
});

test('the last admin cannot be removed', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const stamp = Date.now();
  const ws = (await prisma.workspace.create({ data: { name: `test-members-last-${stamp}` } })).id;
  const a = (await prisma.user.create({ data: { name: 'a', email: `la-${stamp}@example.test` } })).id;
  try {
    await prisma.workspaceMember.create({ data: { userId: a, workspaceId: ws, role: 'ADMIN' } });
    await assert.rejects(removeMember(ws, a, a), { code: 'LAST_ADMIN' });
  } finally {
    await prisma.workspace.delete({ where: { id: ws } }).catch(() => {});
    await prisma.user.delete({ where: { id: a } }).catch(() => {});
  }
});
