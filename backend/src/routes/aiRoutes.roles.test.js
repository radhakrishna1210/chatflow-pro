import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

// The /ai/* and /onboarding/chat routers are not workspace-scoped, so the
// VIEWER/AGENT write floor that workspaceContext applies elsewhere never ran
// there. A Viewer could create templates and campaigns, cancel campaigns, and
// build workflows or delete templates through the onboarding chat.

const { env } = await import('../config/env.js');
const { prisma } = await import('../lib/prisma.js');
const aiRoutes = (await import('./ai.routes.js')).default;
const onboardingRoutes = (await import('./onboarding.routes.js')).default;

const app = express();
app.use(express.json());
app.use('/ai', aiRoutes);
app.use('/onboarding', onboardingRoutes);
let server; let base;
const tag = `airoles_${Date.now()}`;
let ws; const users = {};

const tokenFor = (user, role) => jwt.sign(
  { sub: user.id, workspaceId: ws.id, role, superAdmin: false, jti: randomUUID() },
  env.JWT_ACCESS_SECRET, { expiresIn: '5m' },
);
const post = (path, role, body) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(users[role], role)}` },
  body: JSON.stringify(body),
});

before(async () => {
  ws = await prisma.workspace.create({ data: { name: tag } });
  for (const role of ['VIEWER', 'AGENT', 'CLIENT']) {
    users[role] = await prisma.user.create({ data: { email: `${tag}_${role.toLowerCase()}@example.com`, name: role, passwordHash: 'x' } });
    await prisma.workspaceMember.create({ data: { userId: users[role].id, workspaceId: ws.id, role } });
  }
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await prisma.workspace.delete({ where: { id: ws.id } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
});

for (const role of ['VIEWER', 'AGENT']) {
  test(`${role} cannot write through /ai/*`, async () => {
    for (const [path, body] of [
      ['/ai/template/create', { name: 'x_tpl', body: 'Hello' }],
      ['/ai/campaign/create', { name: 'x', templateId: 'nope' }],
      ['/ai/campaign/update', { id: 'nope', status: 'CANCELLED' }],
      ['/ai/template/update', { id: 'nope', body: 'Hi' }],
    ]) {
      const res = await post(path, role, body);
      assert.equal(res.status, 403, `${role} ${path}`);
    }
    assert.equal(await prisma.template.count({ where: { workspaceId: ws.id } }), 0);
  });

  test(`${role} cannot build or delete through the onboarding chat`, async () => {
    const res = await post('/onboarding/chat', role, { message: 'build a workflow that replies when someone says HELP', workspaceId: ws.id });
    assert.equal(res.status, 403);
    assert.equal(await prisma.workflow.count({ where: { workspaceId: ws.id } }), 0);
  });
}

test('a member (CLIENT) still can use /ai/template/create', async () => {
  const res = await post('/ai/template/create', 'CLIENT', { name: 'x_tpl', body: 'Hello' });
  assert.equal(res.status, 200);
});
