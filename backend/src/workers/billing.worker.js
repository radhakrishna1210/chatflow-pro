import { Worker } from 'bullmq';
import { createBullConnection, logRedisError } from '../lib/redis.js';
import { env } from '../config/env.js';
import { runBillingCycleSweep } from '../services/subscription.service.js';

async function processBillingCycle(job) {
  const result = await runBillingCycleSweep();
  console.log(`[BillingWorker] Job ${job.id}: processed=${result.processed} renewed=${result.renewed} cancelled=${result.cancelled} failed=${result.failed}`);
}

export function startBillingWorker() {
  const worker = new Worker('billing', processBillingCycle, {
    connection: createBullConnection('billing-worker'),
    concurrency: 1,
    drainDelay: env.WORKER_DRAIN_DELAY_SEC,
    stalledInterval: env.WORKER_STALLED_INTERVAL_MS,
  });

  // Connection-level faults (quota exhaustion, dropped TLS) arrive here rather
  // than on 'failed'. Without a listener BullMQ dumps the raw ReplyError on
  // every retry, several times a second.
  worker.on('error', (err) => logRedisError('billing-worker', err));
  worker.on('completed', (job) => console.log(`[BillingWorker] Job ${job.id} completed`));
  worker.on('failed', (job, err) => console.error(`[BillingWorker] Job ${job?.id} failed:`, err.message));

  return worker;
}
