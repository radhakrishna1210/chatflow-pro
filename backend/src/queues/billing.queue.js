import { Queue } from 'bullmq';
import { createBullConnection } from '../lib/redis.js';

export const billingQueue = new Queue('billing', {
  connection: createBullConnection('billing-queue'),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

// Repeatable job: sweep for subscriptions whose billing cycle ended (README
// §12.6), daily at 02:00. `jobId` makes re-adding this on every boot a no-op
// (BullMQ dedupes identical repeat configs by key) instead of stacking jobs.
export async function scheduleBillingCycleJob() {
  await billingQueue.add('cycle-reset', {}, {
    repeat: { pattern: '0 2 * * *' },
    jobId: 'billing-cycle-reset',
  });
}
