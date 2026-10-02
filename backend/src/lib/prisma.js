import { PrismaClient } from '@prisma/client';
import { createRequire } from 'module';

const globalForPrisma = globalThis;

// Optional pg driver adapter (WASM engine) — used when PRISMA_PG_ADAPTER=1,
// e.g. in sandboxed CI environments where Prisma's native engines cannot be
// downloaded. Production keeps the default native engine path.
function buildClient() {
  let dbUrl = process.env.DATABASE_URL || process.env.DIRECT_URL;

  // Per-process pool. One client serves the API and every in-process worker
  // (~19 concurrent job slots), which a pool of 3 starved into P2024 timeouts.
  // Each process sharing the database (web, `start:worker`, a second
  // deployment) holds its own pool, so their sum must stay under the
  // database's connection cap — with the Supabase session-mode pooler that is
  // the project's pool size. An explicit connection_limit in the URL wins.
  if (dbUrl && !dbUrl.includes('connection_limit')) {
    const poolSize = Number.parseInt(process.env.DATABASE_POOL_SIZE ?? '', 10);
    const sep = dbUrl.includes('?') ? '&' : '?';
    dbUrl = `${dbUrl}${sep}connection_limit=${poolSize > 0 ? poolSize : 5}`;
  }

  const options = {
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    ...(dbUrl ? { datasourceUrl: dbUrl } : {}),
  };
  if (process.env.PRISMA_PG_ADAPTER === '1') {
    const require = createRequire(import.meta.url);
    const { PrismaPg } = require('@prisma/adapter-pg');
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: dbUrl, max: 10, connectionTimeoutMillis: 15000 });
    options.adapter = new PrismaPg(pool);
  }
  return new PrismaClient(options);
}

export const prisma = globalForPrisma.prisma ?? buildClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
