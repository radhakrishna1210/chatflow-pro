import { Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import { provisionTwilioNumbers } from '../services/admin.service.js';

async function processProvisioning(job) {
  if (job.data?.type === 'twilio-sync') {
    return provisionTwilioNumbers();
  }
  throw new Error(`Unknown provisioning job type: ${job.data?.type}`);
}

export function startProvisioningWorker() {
  const worker = new Worker('provisioning', processProvisioning, {
    connection: redis,
    concurrency: 1, // serialize: each number creates a WABA + polls OTP
  });

  worker.on('completed', (job, result) =>
    console.log(`[ProvisioningWorker] Job ${job.id} (${job.data?.type}) done:`, JSON.stringify(result).slice(0, 400)));
  worker.on('failed', (job, err) =>
    console.error(`[ProvisioningWorker] Job ${job?.id} failed:`, err.message));

  return worker;
}
