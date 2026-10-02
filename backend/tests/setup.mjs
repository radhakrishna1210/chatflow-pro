// Test bootstrap, loaded with `node --import ./tests/setup.mjs` (see the npm
// test scripts). The service tests create and deleteMany real rows, so they
// must never reach a shared or production database.
//
// backend/.env.test, when present, replaces backend/.env for the whole run:
// it is loaded here and handed to dotenv (src/config/env.js) so .env is never
// read. Without it, .env is still used — but only if its database is local.
import { existsSync } from 'node:fs';
import path from 'node:path';

const testEnvFile = path.resolve(import.meta.dirname, '..', '.env.test');
if (existsSync(testEnvFile)) {
  process.loadEnvFile(testEnvFile);
  process.env.DOTENV_CONFIG_PATH ??= testEnvFile;
  // Same fallback env.js applies, made here so a DIRECT_URL left in .env is
  // never picked up next to the test database.
  if (process.env.DATABASE_URL) process.env.DIRECT_URL ??= process.env.DATABASE_URL;
}

// Set before dotenv can apply .env's (usually "development") value. In test
// mode Redis gives up reconnecting at once instead of holding every test
// process open while it retries.
process.env.NODE_ENV ??= 'test';

await import('../scripts/require-local-db.js');
