#!/usr/bin/env node
/**
 * Refuses to proceed unless DATABASE_URL points at a local database.
 *
 * This exists because a stale credential in a backup file once pointed the
 * backend at a shared Supabase instance holding real customer workspaces. Any
 * script that migrates, seeds, resets or truncates must run this first, so a
 * mistyped host cannot reach production.
 *
 * Run directly:      node scripts/assert-local-db.js
 * Or import:         import { assertLocalDatabase } from './assert-local-db.js'
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal']);

// Substrings that indicate a managed/remote provider even if the host somehow
// resolves locally. Checked against the whole URL, not just the hostname.
const REMOTE_MARKERS = [
  'supabase', 'neon.tech', 'amazonaws.com', 'rds.', 'azure', 'gcp',
  'render.com', 'railway.app', 'heroku', 'planetscale', 'cockroachlabs',
  'digitalocean', 'timescale', 'aiven',
];

export function assertLocalDatabase(rawUrl = process.env.DATABASE_URL, { label = 'DATABASE_URL' } = {}) {
  if (!rawUrl) {
    throw new Error(`${label} is not set — refusing to run a database operation without knowing the target.`);
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label} is not a parseable URL — refusing to proceed.`);
  }

  const host = url.hostname.toLowerCase();
  const lower = rawUrl.toLowerCase();

  const marker = REMOTE_MARKERS.find((m) => lower.includes(m));
  if (marker) {
    throw new Error(
      `${label} points at what looks like a managed provider ("${marker}"). ` +
      'This branch is configured for a local database only — refusing to proceed.',
    );
  }

  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `${label} host is "${host}", which is not local. ` +
      `Expected one of: ${[...LOCAL_HOSTS].join(', ')}. Refusing to proceed.`,
    );
  }

  return {
    ok: true,
    host,
    port: url.port || '5432',
    database: url.pathname.replace(/^\//, '') || '(default)',
    user: url.username || '(none)',
  };
}

// When run directly, report and exit non-zero on failure so it can gate a
// shell pipeline: `node scripts/assert-local-db.js && npx prisma migrate deploy`
const isDirect = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isDirect) {
  try {
    const info = assertLocalDatabase();
    console.log(`[db-guard] OK — local database confirmed: ${info.user}@${info.host}:${info.port}/${info.database}`);
    process.exit(0);
  } catch (err) {
    console.error(`[db-guard] BLOCKED — ${err.message}`);
    process.exit(1);
  }
}
