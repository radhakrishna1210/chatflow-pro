import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

// RFC 7636 PKCE on the OAuth provider (CF-225). The code store is an in-memory
// stand-in that evaluates the same conditional claim the service sends, so the
// test exercises the real where-clause, PKCE condition included.

const sha256hex = (s) => createHash('sha256').update(String(s)).digest('hex');

const clients = new Map();
const codes = new Map();

const matches = (row, where) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && 'gt' in v) return row[k] > v.gt;
  return (row[k] ?? null) === v;
});

const prisma = {
  oAuthClient: { findUnique: async ({ where }) => clients.get(where.clientId) ?? null },
  oAuthAuthorizationCode: {
    create: async ({ data }) => { codes.set(data.code, { consumedAt: null, ...data }); return data; },
    updateMany: async ({ where, data }) => {
      const row = codes.get(where.code);
      if (!row || !matches(row, where)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
    findUnique: async ({ where }) => codes.get(where.code) ?? null,
  },
  workspaceMember: {
    findUnique: async () => ({ role: 'ADMIN', workspace: { suspended: false, subscription: { status: 'ACTIVE' } } }),
  },
};
mock.module('../lib/prisma.js', { namedExports: { prisma } });
mock.module('../lib/oauthState.js', {
  namedExports: { signState: (p) => JSON.stringify(p), verifyState: (s) => { try { return JSON.parse(s); } catch { return null; } } },
});
mock.module('./apikeys.service.js', { namedExports: { createApiKey: async () => ({ rawKey: 'cfp_issued' }) } });

const oauth = await import('./oauth.service.js');

const REDIRECT = 'https://app.example/callback';
clients.set('confidential', {
  clientId: 'confidential', clientSecretHash: sha256hex('s3cret'), publicClient: false,
  name: 'Conf', redirectUris: [REDIRECT], allowedScopes: ['messages:send'],
});
clients.set('spa', {
  clientId: 'spa', clientSecretHash: null, publicClient: true,
  name: 'Spa', redirectUris: [REDIRECT], allowedScopes: ['messages:send'],
});

const newVerifier = () => randomBytes(32).toString('base64url'); // 43 chars
const challengeOf = (v) => createHash('sha256').update(v).digest('base64url');

async function authorizeAndIssue(clientId, pkceParams = {}) {
  const { pkce } = await oauth.validateAuthorizeRequest({
    clientId, redirectUri: REDIRECT, responseType: 'code', scope: 'messages:send', ...pkceParams,
  });
  // The signed pending blob round-trips the challenge to the consent step.
  const blob = oauth.packPendingRequest({ clientId, redirectUri: REDIRECT, scopes: ['messages:send'], state: 'x', pkce });
  const described = await oauth.describePendingRequest(blob);
  return oauth.issueAuthorizationCode({
    clientId, userId: 'u1', workspaceId: 'w1', scopes: described.scopes, redirectUri: REDIRECT, pkce: described.pkce,
  });
}

const exchange = (args) => oauth.exchangeAuthorizationCode({ redirectUri: REDIRECT, ...args });
const rejectsWith = (p, code) => assert.rejects(p, (e) => e instanceof oauth.OAuthRedirectError && e.code === code);

test('s256Challenge matches the RFC 7636 appendix B example', () => {
  assert.equal(oauth.s256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('a public client must send a code_challenge at authorize', async () => {
  await rejectsWith(authorizeAndIssue('spa'), 'invalid_request');
});

test('only S256 is accepted, and a malformed challenge is refused', async () => {
  const challenge = challengeOf(newVerifier());
  await rejectsWith(authorizeAndIssue('spa', { codeChallenge: challenge }), 'invalid_request');
  await rejectsWith(authorizeAndIssue('spa', { codeChallenge: challenge, codeChallengeMethod: 'plain' }), 'invalid_request');
  await rejectsWith(authorizeAndIssue('spa', { codeChallenge: 'short', codeChallengeMethod: 'S256' }), 'invalid_request');
  await rejectsWith(authorizeAndIssue('confidential', { codeChallengeMethod: 'S256' }), 'invalid_request');
});

test('a public client redeems with the right code_verifier and no secret', async () => {
  const verifier = newVerifier();
  const code = await authorizeAndIssue('spa', { codeChallenge: challengeOf(verifier), codeChallengeMethod: 'S256' });
  assert.equal(codes.get(code).codeChallengeMethod, 'S256');
  const out = await exchange({ code, clientId: 'spa', codeVerifier: verifier });
  assert.equal(out.access_token, 'cfp_issued');
});

test('a wrong verifier is refused and does not burn the code', async () => {
  const verifier = newVerifier();
  const code = await authorizeAndIssue('spa', { codeChallenge: challengeOf(verifier), codeChallengeMethod: 'S256' });
  await rejectsWith(exchange({ code, clientId: 'spa', codeVerifier: newVerifier() }), 'invalid_grant');
  assert.equal(codes.get(code).consumedAt, null);
  await exchange({ code, clientId: 'spa', codeVerifier: verifier });
  await rejectsWith(exchange({ code, clientId: 'spa', codeVerifier: verifier }), 'invalid_grant');
});

test('a public client without a verifier is refused', async () => {
  const code = await authorizeAndIssue('spa', { codeChallenge: challengeOf(newVerifier()), codeChallengeMethod: 'S256' });
  await rejectsWith(exchange({ code, clientId: 'spa' }), 'invalid_grant');
});

test('a malformed verifier is refused before anything is claimed', async () => {
  const code = await authorizeAndIssue('spa', { codeChallenge: challengeOf(newVerifier()), codeChallengeMethod: 'S256' });
  await rejectsWith(exchange({ code, clientId: 'spa', codeVerifier: 'too-short' }), 'invalid_grant');
  await rejectsWith(exchange({ code, clientId: 'spa', codeVerifier: `${'a'.repeat(43)} ` }), 'invalid_grant');
});

test('a confidential client may omit PKCE and still needs its secret', async () => {
  const code = await authorizeAndIssue('confidential');
  assert.equal(codes.get(code).codeChallenge, null);
  await rejectsWith(exchange({ code, clientId: 'confidential', clientSecret: 'wrong' }), 'invalid_client');
  const out = await exchange({ code, clientId: 'confidential', clientSecret: 's3cret' });
  assert.equal(out.access_token, 'cfp_issued');
});

test('a confidential client that used PKCE is held to it', async () => {
  const verifier = newVerifier();
  const code = await authorizeAndIssue('confidential', { codeChallenge: challengeOf(verifier), codeChallengeMethod: 'S256' });
  await rejectsWith(exchange({ code, clientId: 'confidential', clientSecret: 's3cret' }), 'invalid_grant');
  await exchange({ code, clientId: 'confidential', clientSecret: 's3cret', codeVerifier: verifier });
});

test('a verifier sent for a code issued without a challenge is refused (no downgrade games)', async () => {
  const code = await authorizeAndIssue('confidential');
  await rejectsWith(exchange({ code, clientId: 'confidential', clientSecret: 's3cret', codeVerifier: newVerifier() }), 'invalid_grant');
});

test('PKCE does not stand in for a confidential client\'s secret', async () => {
  const verifier = newVerifier();
  const code = await authorizeAndIssue('confidential', { codeChallenge: challengeOf(verifier), codeChallengeMethod: 'S256' });
  await rejectsWith(exchange({ code, clientId: 'confidential', codeVerifier: verifier }), 'invalid_client');
});
