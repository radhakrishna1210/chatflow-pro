import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// A key must stop working the moment its workspace is suspended or its
// subscription lapses — the same gates the dashboard applies.

const RAW = 'cfp_' + 'a'.repeat(64);
const hash = createHash('sha256').update(RAW).digest('hex');
let workspace;

const prisma = {
  apiKey: {
    findFirst: async ({ where }) => (where.keyHash === hash
      ? { id: 'k_1', name: 'k', workspaceId: 'ws_1', scopes: ['messages:send'], workspace }
      : null),
    update: async () => ({}),
  },
};
mock.module('../lib/prisma.js', { namedExports: { prisma } });

const { authenticateApiKey } = await import('./authenticateApiKey.js');

function run(key = RAW) {
  const req = { headers: { 'x-api-key': key } };
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  let nexted = false;
  return authenticateApiKey(req, res, () => { nexted = true; }).then(() => ({ req, res, nexted }));
}

test('an active workspace key authenticates as CLIENT with its scopes', async () => {
  workspace = { suspended: false, subscription: { status: 'ACTIVE' } };
  const { req, nexted } = await run();
  assert.equal(nexted, true);
  assert.equal(req.workspaceId, 'ws_1');
  assert.equal(req.user.role, 'CLIENT');
});

test('PAST_DUE still works — it is the grace period', async () => {
  workspace = { suspended: false, subscription: { status: 'PAST_DUE' } };
  assert.equal((await run()).nexted, true);
});

test('a suspended workspace is refused', async () => {
  workspace = { suspended: true, subscription: { status: 'ACTIVE' } };
  const { res, nexted } = await run();
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.suspended, true);
});

for (const status of ['CANCELLED', 'EXPIRED']) {
  test(`a ${status} subscription is refused`, async () => {
    workspace = { suspended: false, subscription: { status } };
    const { res, nexted } = await run();
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'SUBSCRIPTION_INACTIVE');
  });
}

test('an unknown key is a 401', async () => {
  const { res, nexted } = await run('cfp_nope');
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
});
