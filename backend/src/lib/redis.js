import { Redis } from 'ioredis';
import { env } from '../config/env.js';

// A dead or rate-limited Redis produces one error per retry, and BullMQ's worker
// loop retries several times a second — enough to bury every other log line and,
// on a metered host, to keep spending quota on failing commands. Collapse repeats
// into one line per source per interval, with a running count.
const LOG_INTERVAL_MS = 30_000;
const lastLogged = new Map();

export function logRedisError(label, err) {
  const msg = err?.message || String(err);
  const key = `${label}|${msg.slice(0, 80)}`;
  const now = Date.now();
  const prev = lastLogged.get(key);

  if (prev && now - prev.at < LOG_INTERVAL_MS) {
    prev.suppressed += 1;
    return;
  }
  lastLogged.set(key, { at: now, suppressed: 0 });

  const repeat = prev?.suppressed ? ` (+${prev.suppressed} identical in the last ${LOG_INTERVAL_MS / 1000}s)` : '';
  console.error(`[Redis:${label}] ${msg}${repeat}`);

  // Quota exhaustion is not a transient fault — retrying cannot clear it, so say
  // what actually needs to happen instead of letting it look like a blip.
  if (/max requests limit exceeded|max daily request limit/i.test(msg)) {
    console.error(
      `[Redis:${label}] Upstash request quota is exhausted. Queues (campaigns, emails, billing) ` +
      'are stopped until the quota resets, the plan is upgraded, or REDIS_URL points elsewhere. ' +
      'See DEPLOY.md > "Things that will bite you".'
    );
  }
}

// Shared connection for general-purpose commands (one-time codes, OAuth state).
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: false,
});

redis.on('error', (err) => logRedisError('shared', err));

// BullMQ requires each Queue/Worker to own its own connection because it uses
// blocking commands (BRPOPLPUSH / pub-sub) that conflict on a shared client.
export function createBullConnection(label = 'bullmq') {
  const conn = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  conn.on('error', (err) => logRedisError(label, err));
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
