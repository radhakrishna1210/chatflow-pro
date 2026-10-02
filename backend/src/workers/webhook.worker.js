import { Worker } from 'bullmq';
import { createBullConnection, redis } from '../lib/redis.js';
import { acquireKeyLock } from '../lib/keyLock.js';
import { processWebhook } from '../services/webhook.service.js';

// Processes queued Meta webhook events (queues/webhook.queue.js).
//
// Several events run in parallel, but never two for the same customer on the
// same number: each job holds a Redis lock on its key for the duration. Two
// messages sent in quick succession used to run the whole automation chain
// concurrently — both passed the "already welcomed?" check before either reply
// was stored, and the customer got two welcomes or two AI answers. The lock
// spans processes, so it holds with more than one server instance too.
//
// Kept small: every slot competes with the API for the same Prisma pool.
const CONCURRENCY = 3;

let running = false;

// The HTTP handler falls back to processing inline when no worker is running
// (a development server started without Redis), rather than queueing events
// nothing will ever pick up.
export const isWebhookWorkerRunning = () => running;

export async function processWebhookJob(job, { lockClient = redis, handle = processWebhook } = {}) {
  const { key, payload } = job.data;
  const release = await acquireKeyLock(lockClient, `webhook__${key}`);
  try {
    await handle(payload);
  } finally {
    await release().catch((err) => console.error(`[Webhook] Could not release lock for ${key}:`, err.message));
  }
}

export function startWebhookWorker() {
  const worker = new Worker('webhooks', (job) => processWebhookJob(job), {
    connection: createBullConnection('webhook-worker'),
    concurrency: CONCURRENCY,
  });

  worker.on('failed', (job, err) => {
    if (!job) return;
    const attempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade >= attempts) {
      console.error(`[Webhook] Event ${job.id} (${job.data?.key}) failed after ${job.attemptsMade} attempts — `
        + 'kept in the failed set of the "webhooks" queue for inspection:', err);
    } else {
      console.warn(`[Webhook] Event ${job.id} attempt ${job.attemptsMade}/${attempts} failed, will retry: ${err.message}`);
    }
  });
  worker.on('error', () => {});

  running = true;
  worker.on('closed', () => { running = false; });
  return worker;
}
