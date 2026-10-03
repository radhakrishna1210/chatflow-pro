/**
 * Register the applications allowed to ask ChatFlow users for access.
 *
 *   node src/scripts/seedOAuthClients.js
 *
 * Idempotent on `clientId`: re-running updates the name, redirect URIs and
 * allowed scopes of an existing client without touching its secret, so a
 * deployment can safely run it every time.
 *
 * The secret is generated here and printed ONCE. Nothing stores it in the clear —
 * only its sha256 goes to the database, exactly as ApiKey does — so if the
 * printout is lost the only remedy is rotating it with --rotate. That is the
 * intended trade: a secret this script could read back is a secret anyone with
 * database access could use to impersonate the application.
 *
 * Copy the printed value into Spandan's .env as CHATFLOW_CLIENT_SECRET.
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';

const prisma = new PrismaClient();

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/**
 * The registered applications.
 *
 * `redirectUris` are compared by exact string at both the authorize and token
 * steps, so every environment that needs to connect must be listed here in full —
 * including the port in development. A missing entry is a refused connect, which
 * is the correct failure: the alternative is prefix matching, and prefix matching
 * is how authorization codes get delivered to somebody else.
 */
const CLIENTS = [
  {
    clientId: 'spandan',
    name: 'Spandan',
    redirectUris: [
      'https://spandan.mannmate.com/api/v1/integrations/chatflow/callback',
      // Local development against a ChatFlow on the same machine.
      'http://localhost:5173/api/v1/integrations/chatflow/callback',
      'http://localhost:4300/api/v1/integrations/chatflow/callback',
    ],
    // The ceiling, not the request. Spandan asks for these four today; anything
    // beyond this list is refused server-side however Spandan is configured.
    allowedScopes: ['templates:read', 'templates:write', 'messages:send', 'webhooks:write'],
  },
  // A public client (SPA, mobile, desktop app) is listed with
  // `publicClient: true`. It gets no secret, and ChatFlow refuses any of its
  // authorizations that do not use PKCE (code_challenge_method=S256).
];

async function main() {
  const rotate = process.argv.includes('--rotate');
  const results = [];

  for (const c of CLIENTS) {
    const existing = await prisma.oAuthClient.findUnique({ where: { clientId: c.clientId } });
    const publicClient = Boolean(c.publicClient);

    if (existing && !rotate && existing.publicClient === publicClient) {
      await prisma.oAuthClient.update({
        where: { clientId: c.clientId },
        data: { name: c.name, redirectUris: c.redirectUris, allowedScopes: c.allowedScopes, disabledAt: null },
      });
      results.push({ clientId: c.clientId, action: 'updated (secret unchanged)', secret: null });
      continue;
    }

    const secret = publicClient ? null : `cfs_${randomBytes(32).toString('hex')}`;
    const data = {
      clientId: c.clientId,
      clientSecretHash: secret ? sha256(secret) : null,
      publicClient,
      name: c.name,
      redirectUris: c.redirectUris,
      allowedScopes: c.allowedScopes,
      disabledAt: null,
    };

    const kind = publicClient ? ' (public client: no secret, PKCE required)' : '';
    if (existing) {
      await prisma.oAuthClient.update({ where: { clientId: c.clientId }, data });
      results.push({ clientId: c.clientId, action: `${publicClient ? 'updated' : 'ROTATED — the previous secret no longer works'}${kind}`, secret, publicClient });
    } else {
      await prisma.oAuthClient.create({ data });
      results.push({ clientId: c.clientId, action: `created${kind}`, secret, publicClient });
    }
  }

  console.log('\nOAuth clients\n');
  for (const r of results) {
    console.log(`  ${r.clientId}: ${r.action}`);
    if (r.secret) {
      console.log(`    CHATFLOW_CLIENT_ID=${r.clientId}`);
      console.log(`    CHATFLOW_CLIENT_SECRET=${r.secret}`);
      console.log('    ^ shown once and never again. Put it in Spandan\'s .env now.\n');
    }
  }
  if (!results.some((r) => r.secret || r.publicClient)) {
    console.log('\n  No secret printed: the client already existed. Re-run with --rotate to issue a new one.\n');
  }
}

main()
  .catch((err) => {
    console.error('Seeding OAuth clients failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
