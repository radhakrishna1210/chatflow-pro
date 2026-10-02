import { Queue } from 'bullmq';
import { createBullConnection } from '../lib/redis.js';

// Outgoing webhook deliveries (services/outgoingWebhook.service.js).
//
// Retries used to be setTimeout chains in the API process: a restart dropped
// every pending one, and concurrency was however many events had fired — a
// large campaign aimed at a dead endpoint held one sleeping chain and socket
// per status update. Here they are bounded by the worker's concurrency and
// rate limit, and survive a process restart.

// Delay before each retry; the first attempt is immediate. Short and finite on
// purpose: a receiver that is down for twenty minutes is down.
export const WEBHOOK_RETRY_DELAYS_MS = [2_000, 10_000, 60_000, 300_000];

export const webhookQueue = new Queue('webhooks', {
  connection: createBullConnection('webhook-queue'),
  defaultJobOptions: {
    attempts: WEBHOOK_RETRY_DELAYS_MS.length + 1,
    backoff: { type: 'webhook' },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 24 * 3600, count: 1000 },
  },
});

webhookQueue.on('error', () => {});

// attemptsMade counts the attempt that just failed, so the first retry is 1.
export function webhookBackoff(attemptsMade) {
  const i = Math.max(0, Number(attemptsMade || 1) - 1);
  return WEBHOOK_RETRY_DELAYS_MS[Math.min(i, WEBHOOK_RETRY_DELAYS_MS.length - 1)];
}
