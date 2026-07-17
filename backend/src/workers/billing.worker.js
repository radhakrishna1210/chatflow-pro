import { Worker } from 'bullmq';
import { createBullConnection } from '../lib/redis.js';
import { runBillingCycleSweep } from '../services/subscription.service.js';

async function processBillingCycle(job) {
  const result = await runBillingCycleSweep();
  console.log(`[BillingWorker] Job ${job.id}: processed=${result.processed} renewed=${result.renewed} cancelled=${result.cancelled} failed=${result.failed}`);
}

export function startBillingWorker() {
  const worker = new Worker('billing', processBillingCycle, {
    connection: createBullConnection('billing-worker'),
    concurrency: 1,
  });

  worker.on('completed', (job) => console.log(`[BillingWorker] Job ${job.id} completed`));
  worker.on('failed', (job, err) => console.error(`[BillingWorker] Job ${job?.id} failed:`, err.message));

  return worker;
}
