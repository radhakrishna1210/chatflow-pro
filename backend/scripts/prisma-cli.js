#!/usr/bin/env node
/**
 * Prisma CLI wrapper that supplies the DIRECT_URL fallback.
 *
 * schema.prisma declares `directUrl = env("DIRECT_URL")`, which Prisma treats as
 * required at schema-validation time (P1012). src/config/env.js already defaults
 * it to DATABASE_URL — but that runs only when the *app* boots, so a standalone
 * `prisma generate` or `prisma migrate deploy` fails before Node gets there.
 *
 * Hosts that hand out a single, non-pooled connection string (Render Postgres)
 * therefore need DIRECT_URL === DATABASE_URL, which is what this sets. A host
 * with a real pooler still works: an explicitly-set DIRECT_URL is left alone.
 *
 * Usage: node scripts/prisma-cli.js migrate deploy
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  console.log('[prisma] DIRECT_URL not set — falling back to DATABASE_URL.');
}

const backendDir = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('[prisma] No command given, e.g. `node scripts/prisma-cli.js migrate deploy`');
  process.exit(2);
}

const require = createRequire(import.meta.url);
let command;
try {
  // Invoke the CLI entrypoint with the current node binary — avoids npm/shell
  // quoting differences and the Windows .cmd shim restriction in Node 20+.
  command = [process.execPath, [require.resolve('prisma/build/index.js'), ...args]];
} catch {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  command = [npm, ['exec', '--', 'prisma', ...args]];
}

try {
  execFileSync(command[0], command[1], {
    cwd: backendDir,
    stdio: 'inherit',
    shell: command[0].endsWith('.cmd'),
  });
} catch (err) {
  process.exit(typeof err.status === 'number' ? err.status : 1);
}
