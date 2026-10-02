import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Connecting an application mints a permanent API key, so the consent step
// re-reads membership and role from the database instead of trusting the JWT.

let member;
const prisma = {
  workspaceMember: { findUnique: async () => member },
};
mock.module('../lib/prisma.js', { namedExports: { prisma } });
mock.module('../lib/oauthState.js', { namedExports: { signState: () => '', verifyState: () => null } });
mock.module('./apikeys.service.js', { namedExports: { createApiKey: async () => ({ rawKey: 'cfp_x' }) } });

const { grantRefusal } = await import('./oauth.service.js');

const ws = (over = {}) => ({ suspended: false, subscription: { status: 'ACTIVE' }, ...over });

test('an ADMIN of an active workspace may connect an app', async () => {
  member = { role: 'ADMIN', workspace: ws() };
  assert.equal(await grantRefusal('u', 'w'), null);
});

test('a removed member is refused even with a live token', async () => {
  member = null;
  assert.equal((await grantRefusal('u', 'w')).code, 'NOT_A_MEMBER');
});

for (const role of ['VIEWER', 'AGENT', 'CLIENT']) {
  test(`${role} cannot mint a key through consent`, async () => {
    member = { role, workspace: ws() };
    assert.equal((await grantRefusal('u', 'w')).code, 'ROLE_NOT_PERMITTED');
  });
}

test('a suspended workspace cannot gain new credentials', async () => {
  member = { role: 'ADMIN', workspace: ws({ suspended: true }) };
  assert.equal((await grantRefusal('u', 'w')).code, 'WORKSPACE_SUSPENDED');
});

test('an expired subscription cannot gain new credentials', async () => {
  member = { role: 'ADMIN', workspace: ws({ subscription: { status: 'EXPIRED' } }) };
  assert.equal((await grantRefusal('u', 'w')).code, 'SUBSCRIPTION_INACTIVE');
});
