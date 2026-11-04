import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { resolveGrantingWorkspace } from './oauth.service.js';

let dbAvailable = false;
let workspaceId;
const users = {};
const stamp = Date.now();

test.before(async () => {
  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    return;
  }
  workspaceId = (await prisma.workspace.create({ data: { name: `test-oauth-${stamp}` } })).id;
  for (const role of ['ADMIN', 'CLIENT', 'AGENT', 'VIEWER']) {
    users[role] = (await prisma.user.create({ data: { name: role, email: `oauth-${role}-${stamp}@example.test` } })).id;
    await prisma.workspaceMember.create({ data: { userId: users[role], workspaceId, role } });
  }
  users.outsider = (await prisma.user.create({ data: { name: 'out', email: `oauth-out-${stamp}@example.test` } })).id;
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

test('members who may create API keys may approve an OAuth app', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  for (const role of ['ADMIN', 'CLIENT']) {
    const { workspace } = await resolveGrantingWorkspace(users[role], workspaceId);
    assert.equal(workspace.id, workspaceId);
  }
});

test('viewers and agents cannot mint an API key through the consent screen', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  for (const role of ['AGENT', 'VIEWER']) {
    await assert.rejects(resolveGrantingWorkspace(users[role], workspaceId), { status: 403, code: 'ROLE_NOT_PERMITTED' });
  }
});

test('a JWT still naming a workspace the user has left is refused', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await assert.rejects(resolveGrantingWorkspace(users.outsider, workspaceId), { status: 403, code: 'NOT_A_MEMBER' });
  await assert.rejects(resolveGrantingWorkspace(users.outsider, null), { status: 409, code: 'NO_WORKSPACE' });
});

test('a suspended workspace cannot be connected', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await prisma.workspace.update({ where: { id: workspaceId }, data: { suspended: true } });
  try {
    await assert.rejects(resolveGrantingWorkspace(users.ADMIN, workspaceId), { code: 'WORKSPACE_SUSPENDED' });
  } finally {
    await prisma.workspace.update({ where: { id: workspaceId }, data: { suspended: false } });
  }
});
