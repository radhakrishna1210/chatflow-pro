import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';

const SECRET = 'k'.repeat(40);
let st;

test.before(async () => {
  mock.module('../config/env.js', { namedExports: { env: { JWT_ACCESS_SECRET: SECRET } } });
  st = await import('./oauthState.js');
});

test('a signed state round-trips and expires', () => {
  const state = st.signState({ n: 'abc', ts: Date.now() });
  assert.equal(st.verifyState(state).n, 'abc');
  assert.equal(st.verifyState(st.signState({ n: 'x', ts: Date.now() - 11 * 60_000 })), null);
  assert.equal(st.verifyState(`${state}x`), null);
});

test('states are not signed with the raw access-token secret', () => {
  const data = Buffer.from(JSON.stringify({ n: 'abc', ts: Date.now() })).toString('base64url');
  const withRawSecret = `${data}.${createHmac('sha256', SECRET).update(data).digest('base64url')}`;
  assert.equal(st.verifyState(withRawSecret), null);
});

test('cookies are read by exact name', () => {
  const req = { headers: { cookie: 'a=1; g_oauth_nonce=deadbeef; g_oauth_nonce_x=nope' } };
  assert.equal(st.readCookie(req, 'g_oauth_nonce'), 'deadbeef');
  assert.equal(st.readCookie(req, 'missing'), null);
  assert.equal(st.readCookie({ headers: {} }, 'a'), null);
});

test('the nonce must match exactly, and a missing cookie never matches', () => {
  assert.equal(st.nonceMatches('deadbeef', 'deadbeef'), true);
  assert.equal(st.nonceMatches('deadbeef', 'deadbeee'), false);
  assert.equal(st.nonceMatches('deadbeef', null), false);
  assert.equal(st.nonceMatches(undefined, undefined), false);
});
