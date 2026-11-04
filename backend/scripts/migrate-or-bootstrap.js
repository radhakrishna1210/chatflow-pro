#!/usr/bin/env node
/**
 * Brings the database schema up to date at deploy time.
 *
 * The migration history in prisma/migrations cannot build a database on its
 * own: the core tables (Workspace, Contact, the whole CRM) were created with
 * `prisma db push` and the hand-run files in prisma/manual/, and the first
 * tracked migration already ALTERs tables that no migration creates. So
 * `prisma migrate deploy` on an empty database fails with
 * `relation "Contact" does not exist`, and a new environment could not start.
 *
 * Rewriting history would break every database that has already applied it,
 * so this handles the two cases separately:
 *
 *   - Existing database (the Workspace table is there): run
 *     `prisma migrate deploy`, exactly as before.
 *   - Empty database: build it straight from schema.prisma with `db push`,
 *     then record every existing migration as applied, so the next deploy
 *     only runs migrations added after today.
 *
 * Usage: node scripts/migrate-or-bootstrap.js
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const backendDir = path.resolve(import.meta.dirname, '..');
const cli = path.join(backendDir, 'scripts', 'prisma-cli.js');
const prisma = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: backendDir, stdio: 'inherit', env: process.env });

async function schemaExists(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(`SELECT to_regclass('public."Workspace"') IS NOT NULL AS present`);
    return rows[0].present === true;
  } finally {
    await client.end();
  }
}

export function migrationNames(dir = path.join(backendDir, 'prisma', 'migrations')) {
  return readdirSync(dir)
    .filter((name) => statSync(path.join(dir, name)).isDirectory())
    .sort();
}

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('[migrate] DATABASE_URL is not set.');
    process.exit(1);
  }

  if (await schemaExists(url)) {
    console.log('[migrate] Existing schema found — running prisma migrate deploy.');
    prisma('migrate', 'deploy');
    return;
  }

  console.log('[migrate] Empty database — creating the schema from schema.prisma.');
  prisma('db', 'push', '--skip-generate');
  for (const name of migrationNames()) {
    prisma('migrate', 'resolve', '--applied', name);
  }
  console.log('[migrate] Bootstrap complete; existing migrations recorded as applied.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[migrate] Failed:', err.message);
    process.exit(1);
  });
}
