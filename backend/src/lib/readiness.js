import { prisma } from './prisma.js';
import { redis } from './redis.js';

// Readiness, as opposed to liveness (/health): can this instance do real work
// right now? The server starts listening before its boot sequence finishes, so
// boot completion is part of the answer, alongside a live database and Redis.
let booted = false;

export function markReady() {
  booted = true;
}

export function markNotReady() {
  booted = false;
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function checkDatabase(timeoutMs) {
  await withTimeout(prisma.$queryRaw`SELECT 1`, timeoutMs, 'database');
}

async function checkRedis(timeoutMs) {
  // Commands issued while disconnected wait in ioredis' offline queue instead
  // of failing, so a down Redis has to be read from the client status.
  if (redis.status !== 'ready') throw new Error(`redis is ${redis.status}`);
  const reply = await withTimeout(redis.ping(), timeoutMs, 'redis');
  if (reply !== 'PONG') throw new Error(`unexpected redis reply: ${reply}`);
}

export async function checkReadiness({ timeoutMs = 2000 } = {}) {
  const [db, cache] = await Promise.allSettled([checkDatabase(timeoutMs), checkRedis(timeoutMs)]);
  const checks = {
    boot: booted ? 'ok' : 'starting',
    database: db.status === 'fulfilled' ? 'ok' : db.reason?.message || 'unavailable',
    redis: cache.status === 'fulfilled' ? 'ok' : cache.reason?.message || 'unavailable',
  };
  return { ready: Object.values(checks).every((v) => v === 'ok'), checks };
}
