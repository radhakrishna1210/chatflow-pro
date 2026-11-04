import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { impersonateUser, switchWorkspace, IMPERSONATION_TTL_SEC } from './auth.service.js';
import { authenticate } from '../middleware/authenticate.js';

let dbAvailable = false;
const ids = { users: [], workspaces: [] };

test.before(async () => {
  try { await prisma.$connect(); dbAvailable = true; } catch { /* skip */ }
});
test.after(async () => {
  await prisma.workspace.deleteMany({ where: { id: { in: ids.workspaces } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

test('impersonation: short access token marked impersonatedBy, no refresh token, and switching keeps both', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const stamp = Date.now();
  const user = await prisma.user.create({ data: { name: 'Target', email: `imp-${stamp}@example.test` } });
  ids.users.push(user.id);
  const ws1 = await prisma.workspace.create({ data: { name: `imp-a-${stamp}` } });
  const ws2 = await prisma.workspace.create({ data: { name: `imp-b-${stamp}` } });
  ids.workspaces.push(ws1.id, ws2.id);
  await prisma.workspaceMember.create({ data: { userId: user.id, workspaceId: ws1.id, role: 'CLIENT', joinedAt: new Date(stamp - 5000) } });
  await prisma.workspaceMember.create({ data: { userId: user.id, workspaceId: ws2.id, role: 'ADMIN' } });

  const result = await impersonateUser(user.id, 'admin-user-id');
  assert.equal(result.refreshToken, null);
  assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), 0, 'no refresh token stored');
  const claims = jwt.verify(result.accessToken, env.JWT_ACCESS_SECRET);
  assert.equal(claims.impersonatedBy, 'admin-user-id');
  assert.equal(claims.superAdmin, false);
  const now = Math.floor(Date.now() / 1000);
  assert.ok(claims.exp <= now + IMPERSONATION_TTL_SEC && claims.exp > now);

  // Through the real middleware: the claim reaches req.user.
  const req = { headers: { authorization: `Bearer ${result.accessToken}` }, method: 'POST', originalUrl: '/x' };
  await authenticate(req, {}, () => {});
  assert.equal(req.user.impersonatedBy, 'admin-user-id');

  // A session minted from it inherits the marker and cannot outlive it.
  const switched = await switchWorkspace(user.id, ws2.id, req.user);
  assert.equal(switched.refreshToken, null);
  const c2 = jwt.verify(switched.accessToken, env.JWT_ACCESS_SECRET);
  assert.equal(c2.impersonatedBy, 'admin-user-id');
  assert.ok(c2.exp <= claims.exp);
  assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), 0);

  // An ordinary switch still gets a normal, renewable session.
  const normal = await switchWorkspace(user.id, ws2.id, null);
  assert.ok(normal.refreshToken);
  assert.equal(jwt.decode(normal.accessToken).impersonatedBy, undefined);
});

test('impersonation requires the acting admin id', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const user = await prisma.user.create({ data: { name: 'T2', email: `imp2-${Date.now()}@example.test` } });
  ids.users.push(user.id);
  await assert.rejects(() => impersonateUser(user.id), /acting admin/);
});
