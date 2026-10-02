import { Queue } from 'bullmq';
import { createBullConnection } from '../lib/redis.js';
import { splitWebhook } from '../services/webhookEvents.js';

// Inbound Meta webhook events. The HTTP handler only verifies the signature
// and enqueues; the worker (workers/webhook.worker.js) does the processing
// with retries. Before this the POST was ACKed and processed fire-and-forget,
// so a database blip or a throw lost the customer's message for good — Meta
// only redelivers on a non-200, and it had already been given a 200.
export const webhookQueue = new Queue('webhooks', {
  connection: createBullConnection('webhook-queue'),
  defaultJobOptions: {
    // Exponential from 5s: about ten minutes of retries in total, enough to
    // ride out a database restart or a pool exhaustion spike.
    attempts: 8,
    backoff: { type: 'exponential', delay: 5_000 },
    // Kept for a while so a redelivery of the same event (same jobId) is
    // recognised as already queued.
    removeOnComplete: { age: 24 * 3600, count: 5000 },
    // Failed events are the dead-letter set: kept for a week so they can be
    // inspected and retried rather than vanishing.
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

webhookQueue.on('error', () => {});

// Returns the number of events queued.
export async function enqueueWebhook(body) {
  const units = splitWebhook(body);
  if (units.length === 0) return 0;
  const receivedAt = new Date().toISOString();
  await webhookQueue.addBulk(units.map((u) => ({
    name: 'meta-event',
    data: { key: u.key, payload: u.payload, receivedAt },
    opts: u.jobId ? { jobId: u.jobId } : {},
  })));
  return units.length;
}
