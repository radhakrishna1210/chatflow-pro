import { PrismaClient } from '@prisma/client';
import { createRequire } from 'module';

const globalForPrisma = globalThis;

// Optional pg driver adapter (WASM engine) — used when PRISMA_PG_ADAPTER=1,
// e.g. in sandboxed CI environments where Prisma's native engines cannot be
// downloaded. Production keeps the default native engine path.
function buildClient() {
  let dbUrl = (process.env.NODE_ENV === 'development' && process.env.DIRECT_URL)
    ? process.env.DIRECT_URL
    : (process.env.DATABASE_URL || process.env.DIRECT_URL);

  if (dbUrl && !dbUrl.includes('connection_limit')) {
    const sep = dbUrl.includes('?') ? '&' : '?';
    dbUrl = `${dbUrl}${sep}connection_limit=3`;
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
