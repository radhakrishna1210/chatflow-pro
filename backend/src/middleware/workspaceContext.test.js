import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Tenant isolation at the one choke point every /workspaces/:id route goes
// through. Membership is faked; the role-capability floor is the real one.

const members = new Map();
const lookups = [];
mock.module('../lib/prisma.js', {
  namedExports: {
    prisma: {
      workspaceMember: {
        findUnique: async ({ where }) => {
          const { userId, workspaceId } = where.userId_workspaceId;
          lookups.push({ userId, workspaceId });
          return members.get(`${userId}:${workspaceId}`) ?? null;
        },
      },
    },
  },
});

const { workspaceContext } = await import('./workspaceContext.js');

function member(userId, workspaceId, role, workspace = {}) {
  members.set(`${userId}:${workspaceId}`, {
    userId, workspaceId, role,
    workspace: { id: workspaceId, suspended: false, subscription: { status: 'ACTIVE' }, ...workspace },
  });
}

async function run({ user, workspaceId, method = 'GET', baseUrl, path: subPath = '/' }) {
  const req = {
    params: { workspaceId },
    user: { ...user },
    method,
    baseUrl: baseUrl ?? `/api/v1/workspaces/${workspaceId}/contacts`,
    path: subPath,
  };
  let status = null;
  let body = null;
  let nexted = false;
  const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
  await workspaceContext(req, res, () => { nexted = true; });
  return { req, status, body, nexted };
}

test.beforeEach(() => { members.clear(); lookups.length = 0; });

test('a member gets through with the role from their membership row', async () => {
  member('u1', 'wsA', 'CLIENT');
  const { nexted, req } = await run({ user: { id: 'u1', role: 'ADMIN', workspaceId: 'wsA' }, workspaceId: 'wsA' });
  assert.equal(nexted, true);
  // The JWT said ADMIN; the membership row says CLIENT, and that is what counts.
  assert.equal(req.user.role, 'CLIENT');
  assert.equal(req.user.workspaceId, 'wsA');
  assert.equal(req.user.workspaceRoleVerified, true);
});

test('a token scoped to workspace A cannot open workspace B', async () => {
  member('u1', 'wsA', 'ADMIN');
  member('u2', 'wsB', 'ADMIN');
  const { status, nexted } = await run({ user: { id: 'u1', role: 'ADMIN', workspaceId: 'wsA' }, workspaceId: 'wsB' });
  assert.equal(status, 403);
  assert.equal(nexted, false);
  // The lookup is keyed on the caller and the URL's workspace, never the JWT's.
  assert.deepEqual(lookups.at(-1), { userId: 'u1', workspaceId: 'wsB' });
});

test('membership elsewhere does not leak: same user, workspace they never joined', async () => {
  member('u1', 'wsA', 'ADMIN');
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const { status } = await run({ user: { id: 'u1', role: 'ADMIN' }, workspaceId: 'wsZ', method });
    assert.equal(status, 403, method);
  }
});

test('a suspended workspace is closed to its own admin but open to a super admin', async () => {
  member('u1', 'wsA', 'ADMIN', { suspended: true });
  const blocked = await run({ user: { id: 'u1' }, workspaceId: 'wsA' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.suspended, true);

  const reviewed = await run({ user: { id: 'u1', superAdmin: true }, workspaceId: 'wsA' });
  assert.equal(reviewed.nexted, true);
});

test('an inactive subscription blocks everything except billing screens', async () => {
  for (const status of ['CANCELLED', 'EXPIRED']) {
    member('u1', 'wsA', 'ADMIN', { subscription: { status } });
    const contacts = await run({ user: { id: 'u1' }, workspaceId: 'wsA' });
    assert.equal(contacts.status, 403, status);
    assert.equal(contacts.body.code, 'SUBSCRIPTION_INACTIVE');

    for (const surface of ['subscription', 'wallet']) {
      const billing = await run({ user: { id: 'u1' }, workspaceId: 'wsA', baseUrl: `/api/v1/workspaces/wsA/${surface}` });
      assert.equal(billing.nexted, true, `${status} ${surface}`);
    }
  }
});

test('PAST_DUE keeps working (grace period)', async () => {
  member('u1', 'wsA', 'CLIENT', { subscription: { status: 'PAST_DUE' } });
  assert.equal((await run({ user: { id: 'u1' }, workspaceId: 'wsA' })).nexted, true);
});

test('the read-only roles are held to the capability floor here', async () => {
  member('v', 'wsA', 'VIEWER');
  member('a', 'wsA', 'AGENT');
  const viewerRead = await run({ user: { id: 'v' }, workspaceId: 'wsA' });
  assert.equal(viewerRead.nexted, true);

  const viewerWrite = await run({ user: { id: 'v' }, workspaceId: 'wsA', method: 'POST' });
  assert.equal(viewerWrite.status, 403);
  assert.equal(viewerWrite.body.code, 'ROLE_NOT_PERMITTED');

  const agentReply = await run({
    user: { id: 'a' }, workspaceId: 'wsA', method: 'POST',
    baseUrl: '/api/v1/workspaces/wsA/conversations', path: '/c1/messages',
  });
  assert.equal(agentReply.nexted, true);

  const agentDeleteContact = await run({
    user: { id: 'a' }, workspaceId: 'wsA', method: 'DELETE', path: '/c1',
  });
  assert.equal(agentDeleteContact.status, 403);
});

test('without a :workspaceId param it does nothing (account-level routes)', async () => {
  const { nexted } = await run({ user: { id: 'u1' }, workspaceId: undefined });
  assert.equal(nexted, true);
  assert.equal(lookups.length, 0);
});

// Structural sweep: every router mounted under /workspaces/:workspaceId must
// run authenticate + workspaceContext before any of its routes, or a new
// route file would be reachable with a foreign workspace id.
test('every workspace-scoped router runs authenticate + workspaceContext before its routes', () => {
  const routesDir = path.resolve(import.meta.dirname, '../routes');
  const index = fs.readFileSync(path.join(routesDir, 'index.js'), 'utf8').split('\n// import')[0];
  const imports = new Map();
  for (const m of index.matchAll(/import\s+(\w+)(?:,\s*\{[^}]*\})?\s+from\s+'([^']+)'/g)) imports.set(m[1], m[2]);

  const mounted = [...index.matchAll(/^ws\.use\('([^']+)',\s*(\w+)\)/gm)].map(([, prefix, name]) => ({ prefix, name }));
  assert.ok(mounted.length >= 50, `expected the workspace routers, found ${mounted.length}`);

  const unguarded = [];
  for (const { prefix, name } of mounted) {
    const rel = imports.get(name);
    assert.ok(rel, `no import for ${name}`);
    const src = fs.readFileSync(path.resolve(routesDir, rel), 'utf8');
    // authenticateSessionOrStream (realtime.routes.js) is authenticate() for
    // every path but the event stream, which EventSource opens with a stream
    // token instead of a header (services/realtime.service.js).
    const guard = src.search(/^router\.use\(\s*(authenticate|authenticateSessionOrStream)\s*,\s*workspaceContext\b/m);
    const firstRoute = src.search(/^router\.(get|post|put|patch|delete|all)\(/m);
    if (guard === -1 || (firstRoute !== -1 && firstRoute < guard)) unguarded.push(`${prefix} (${rel})`);
  }
  assert.deepEqual(unguarded, []);
});
