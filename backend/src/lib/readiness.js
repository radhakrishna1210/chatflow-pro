import { prisma } from './prisma.js';
import { redis } from './redis.js';
import { webhookConsumerCount } from './webhookConsumers.js';
import { isWebhookWorkerRunning } from '../workers/webhook.worker.js';

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

// Production only: something must consume the `webhooks` queue, or inbound
// messages (and every workflow they start) depend on the web process's inline
// fallback (WF-IN-13). A worker in this process counts without asking Redis.
// WEBHOOK_CONSUMER_REQUIRED=false reports a missing consumer without failing
// readiness, for deployments that accept the inline fallback.
async function checkWebhookConsumers(timeoutMs) {
  if (isWebhookWorkerRunning()) return 'ok';
  const count = await withTimeout(webhookConsumerCount(), timeoutMs, 'webhook consumer check');
  if (count > 0) return 'ok';
  return process.env.WEBHOOK_CONSUMER_REQUIRED === 'false' ? 'ok (none — processing inline)' : 'no consumer on the "webhooks" queue';
}

export async function checkReadiness({ timeoutMs = 2000, production = process.env.NODE_ENV === 'production' } = {}) {
  const [db, cache, consumers] = await Promise.allSettled([
    checkDatabase(timeoutMs),
    checkRedis(timeoutMs),
    production ? checkWebhookConsumers(timeoutMs) : Promise.resolve(null),
  ]);
  const checks = {
    boot: booted ? 'ok' : 'starting',
    database: db.status === 'fulfilled' ? 'ok' : db.reason?.message || 'unavailable',
    redis: cache.status === 'fulfilled' ? 'ok' : cache.reason?.message || 'unavailable',
  };
  if (production) {
    checks.webhookConsumers = consumers.status === 'fulfilled' ? consumers.value : consumers.reason?.message || 'unavailable';
  }
  const ready = Object.values(checks).every((v) => v === 'ok' || String(v).startsWith('ok '));
  return { ready, checks };
}
