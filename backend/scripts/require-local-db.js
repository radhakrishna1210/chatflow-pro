/**
 * Side-effect guard: `import './require-local-db.js'` as the FIRST import of any
 * test bootstrap, check, seed or reset script. It exits the process unless
 * every database URL this process could end up using is local.
 *
 * It has to run before anything loads src/config/env.js or @prisma/client:
 * both fill unset variables from backend/.env (dotenv and Prisma's own env
 * loader), so checking process.env alone would miss a production URL that only
 * .env holds. Each candidate file is therefore checked too.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { assertLocalDatabase } from './assert-local-db.js';

const backendDir = path.resolve(import.meta.dirname, '..');
const NAMES = ['DATABASE_URL', 'DIRECT_URL'];

function candidateEnvFiles() {
  const files = [
    process.env.DOTENV_CONFIG_PATH,
    path.resolve(process.cwd(), '.env'),
    path.join(backendDir, '.env'),
    path.join(backendDir, 'prisma', '.env'),
  ].filter(Boolean).map((f) => path.resolve(f));
  return [...new Set(files)].filter((f) => existsSync(f));
}

// Every URL that could be used: the process value wins when set (no loader
// overrides it); otherwise any env file in the lookup chain could supply it.
export function collectDatabaseUrls() {
  const found = [];
  const parsedFiles = candidateEnvFiles().map((file) => {
    try {
      return { file, vars: dotenv.parse(readFileSync(file)) };
    } catch {
      return { file, vars: {} };
    }
  });
  for (const name of NAMES) {
    if (process.env[name]) {
      found.push({ name, source: 'process.env', url: process.env[name] });
      continue;
    }
    for (const { file, vars } of parsedFiles) {
      if (vars[name]) found.push({ name, source: path.relative(process.cwd(), file) || file, url: vars[name] });
    }
  }
  return found;
}

const urls = collectDatabaseUrls();
try {
  for (const { name, source, url } of urls) {
    assertLocalDatabase(url, { label: `${name} (from ${source})` });
  }
} catch (err) {
  console.error(`[db-guard] BLOCKED — ${err.message}`);
  console.error('[db-guard] Tests and check/seed scripts only run against a local database. '
    + 'Put a local DATABASE_URL in backend/.env.test (tests) or export one before running.');
  process.exit(1);
}
