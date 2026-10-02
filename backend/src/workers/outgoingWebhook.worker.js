import { Worker } from 'bullmq';
import { createBullConnection, logRedisError } from '../lib/redis.js';
import { env } from '../config/env.js';
import { deliverWebhookJob } from '../services/outgoingWebhook.service.js';
import { OUTGOING_WEBHOOK_QUEUE, webhookBackoff } from '../queues/outgoingWebhook.queue.js';

export function startOutgoingWebhookWorker() {
  const worker = new Worker(OUTGOING_WEBHOOK_QUEUE, deliverWebhookJob, {
    connection: createBullConnection('outgoing-webhook-worker'),
    // Each attempt can wait up to its 10 s timeout on a slow receiver; these
    // bound how many sockets and requests per second that can ever amount to.
    concurrency: 10,
    limiter: { max: 50, duration: 1000 },
    drainDelay: env.WORKER_DRAIN_DELAY_SEC,
    stalledInterval: env.WORKER_STALLED_INTERVAL_MS,
    settings: { backoffStrategy: (attemptsMade) => webhookBackoff(attemptsMade) },
  });

  worker.on('error', (err) => logRedisError('outgoing-webhook-worker', err));
  worker.on('failed', (job, err) => {
    const final = !job || job.attemptsMade >= (job.opts?.attempts ?? 1) || err?.name === 'UnrecoverableError';
    if (final) {
      console.error(`[Webhook:out] ${job?.data?.event} for ${job?.data?.workspaceId} not delivered after ${job?.attemptsMade ?? '?'} attempt(s): ${err?.message}`);
    }
  });

  return worker;
}
