import test from 'node:test';
import assert from 'node:assert/strict';

// The super-admin workspace picker (GET /admin/workspaces) pages (CF-048), so
// the number-assignment dialog searches on the server instead of filtering
// whatever first page it was sent. The database is a stub that records the
// query it receives.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;
for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY']) process.env[key] ||= 'x'.repeat(32);
for (const key of ['META_APP_ID', 'META_APP_SECRET', 'META_BUSINESS_ID', 'META_WABA_ID', 'META_SYSTEM_USER_ID',
  'META_SYSTEM_USER_TOKEN', 'META_DISPLAY_NAME', 'META_WEBHOOK_VERIFY_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
  process.env[key] ||= 'test';
}
process.env.ADMIN_EMAIL ||= 'admin@example.test';

const { prisma } = await import('../lib/prisma.js');
let lastQuery = null;
prisma.workspace.findMany = async (args) => {
  lastQuery = args;
  return [{ id: 'w1', name: 'Acme', members: [{ user: { id: 'u1', name: 'Asha', email: 'asha@acme.test' } }] }];
};

const { listWorkspaces } = await import('./admin.service.js');

test('a search is matched on the server, by workspace name or member name/email', async () => {
  const rows = await listWorkspaces({ search: '  acme ', limit: '50' });
  assert.equal(lastQuery.take, 50);
  assert.equal(lastQuery.skip, 0);
  const contains = { contains: 'acme', mode: 'insensitive' };
  assert.deepEqual(lastQuery.where, {
    OR: [
      { name: contains },
      { members: { some: { user: { OR: [{ name: contains }, { email: contains }] } } } },
    ],
  });
  assert.deepEqual(rows, [{ id: 'w1', name: 'Acme', owner: { id: 'u1', name: 'Asha', email: 'asha@acme.test' } }]);
});

test('no search lists every workspace, a page at a time', async () => {
  await listWorkspaces({ search: '   ', offset: '1000' });
  assert.equal(lastQuery.where, undefined);
  assert.equal(lastQuery.take, 1000);
  assert.equal(lastQuery.skip, 1000);
  await listWorkspaces();
  assert.equal(lastQuery.where, undefined);
  assert.equal(lastQuery.skip, 0);
});

test('a search term is capped in length and a non-string is ignored', async () => {
  await listWorkspaces({ search: 'x'.repeat(500) });
  assert.equal(lastQuery.where.OR[0].name.contains.length, 100);
  await listWorkspaces({ search: ['a', 'b'] });
  assert.equal(lastQuery.where, undefined);
});
