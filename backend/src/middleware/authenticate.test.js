import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const SECRET = 's'.repeat(40);
let authenticate;
let isForbiddenWhileImpersonating;

test.before(async () => {
  mock.module('../config/env.js', { namedExports: { env: { JWT_ACCESS_SECRET: SECRET } } });
  mock.module('../lib/tokenDenylist.js', { namedExports: { isAccessTokenRevoked: async () => false } });
  ({ authenticate, isForbiddenWhileImpersonating } = await import('./authenticate.js'));
});

function run(token, method = 'GET', originalUrl = '/api/v1/users/me') {
  const req = { headers: { authorization: `Bearer ${token}` }, method, originalUrl };
  let status = null;
  let body = null;
  let nexted = false;
  const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
  return authenticate(req, res, () => { nexted = true; }).then(() => ({ req, status, body, nexted }));
}

test('an impersonation token is marked on req.user', async () => {
  const token = jwt.sign({ sub: 'u1', workspaceId: 'w1', role: 'ADMIN', imp: 'admin1', jti: 'j' }, SECRET);
  const { req, nexted } = await run(token);
  assert.equal(nexted, true);
  assert.equal(req.user.impersonatedBy, 'admin1');
  assert.equal(req.user.superAdmin, false);
});

test('a normal token has no impersonator', async () => {
  const { req } = await run(jwt.sign({ sub: 'u1', jti: 'j' }, SECRET));
  assert.equal(req.user.impersonatedBy, null);
});

test('an impersonation token cannot mint lasting credentials', async () => {
  const token = jwt.sign({ sub: 'u1', workspaceId: 'w1', role: 'ADMIN', imp: 'admin1', jti: 'j' }, SECRET);
  for (const [method, url] of [
    ['POST', '/api/v1/workspaces/w1/switch'],
    ['POST', '/api/v1/workspaces'],
    ['POST', '/api/v1/invitations/tok/accept'],
    ['POST', '/api/v1/workspaces/w1/api-keys'],
    ['POST', '/api/v1/workspaces/w1/api-keys/k1/rotate'],
    ['GET', '/api/v1/workspaces/w1/api-keys/authentication'],
    ['POST', '/api/v1/oauth/consent/decide'],
    ['POST', '/api/v1/users/me/password'],
    ['DELETE', '/api/v1/users/me'],
  ]) {
    const { status, nexted } = await run(token, method, url);
    assert.equal(status, 403, `${method} ${url}`);
    assert.equal(nexted, false);
  }
});

test('an impersonation token still works inside the workspace', async () => {
  const token = jwt.sign({ sub: 'u1', workspaceId: 'w1', role: 'ADMIN', imp: 'admin1', jti: 'j' }, SECRET);
  assert.equal((await run(token, 'GET', '/api/v1/workspaces/w1/api-keys')).nexted, true);
  assert.equal((await run(token, 'POST', '/api/v1/workspaces/w1/conversations/c1/messages')).nexted, true);
  assert.equal(isForbiddenWhileImpersonating('GET', '/api/v1/users/me?x=1'), false);
});

test('the same routes are open to a normal session', async () => {
  const { nexted } = await run(jwt.sign({ sub: 'u1', jti: 'j' }, SECRET), 'POST', '/api/v1/workspaces/w1/switch');
  assert.equal(nexted, true);
});
