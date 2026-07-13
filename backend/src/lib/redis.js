import { Redis } from 'ioredis';
import { env } from '../config/env.js';

// Shared connection for general-purpose commands (one-time codes, OAuth state).
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: false,
});

redis.on('error', (err) => {
  console.error('[Redis] Error:', err.message);
});

// BullMQ requires each Queue/Worker to own its own connection because it uses
// blocking commands (BRPOPLPUSH / pub-sub) that conflict on a shared client.
export function createBullConnection(label = 'bullmq') {
  const conn = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  conn.on('error', (err) => console.error(`[Redis:${label}] Error:`, err.message));
  return conn;
}

// Startup health check — surfaces Redis connectivity problems immediately
// instead of letting workers fail silently.
export async function assertRedisHealthy(timeoutMs = 5000) {
  const result = await Promise.race([
    redis.ping(),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`no PONG within ${timeoutMs}ms`)), timeoutMs)),
  ]);
  if (result !== 'PONG') throw new Error(`unexpected ping reply: ${result}`);
}
