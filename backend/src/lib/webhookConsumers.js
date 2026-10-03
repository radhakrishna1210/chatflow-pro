// Is anything consuming the `webhooks` queue? (WF-IN-13)
//
// In production the webhook controller only verifies and enqueues; a worker
// (workers/webhook.worker.js) does the work. A web process started with
// RUN_WORKERS=false, and no worker service reading the same Redis, still
// answered Meta 200 and queued every event into a queue nothing read — no
// message stored, no workflow run, no error anywhere. BullMQ can list the
// workers connected to a queue; this asks it, and caches the answer briefly
// because the controller asks on every webhook.

const CACHE_MS = 30_000;

let cached = null; // { count, at }
let inflight = null;

async function defaultCounter() {
  // Imported lazily: loading the queue module opens a Redis connection, which
  // a process that never needs this check (or a test) should not pay for.
  const { webhookQueue } = await import('../queues/webhook.queue.js');
  const workers = await webhookQueue.getWorkers();
  return Array.isArray(workers) ? workers.length : 0;
}

let counter = defaultCounter;

/** For tests: replace how the consumer count is read, and clear the cache. */
export function setWebhookConsumerCounter(fn) {
  counter = fn || defaultCounter;
  cached = null;
  inflight = null;
}

/**
 * Number of workers connected to the `webhooks` queue, cached for 30 seconds.
 * Rejects when Redis cannot be asked (the caller decides what that means).
 */
export async function webhookConsumerCount({ fresh = false, now = Date.now() } = {}) {
  if (!fresh && cached && now - cached.at < CACHE_MS) return cached.count;
  if (!inflight) {
    inflight = Promise.resolve()
      .then(() => counter())
      .then((count) => { cached = { count, at: Date.now() }; return count; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/**
 * True only when Redis answered and reported no consumer. An unknown answer
 * (Redis unreachable) is false: enqueueing will fail too, and the controller
 * then asks Meta to redeliver.
 */
export async function webhookQueueHasNoConsumer() {
  try {
    return (await webhookConsumerCount()) === 0;
  } catch {
    return false;
  }
}

/**
 * Boot-time check. Logs loudly when no process consumes the queue; called
 * after this process has (or has not) started its own worker.
 */
export async function warnIfNoWebhookConsumer({ log = console } = {}) {
  try {
    const count = await webhookConsumerCount({ fresh: true });
    if (count === 0) {
      log.error('');
      log.error('  ┌─ NO WEBHOOK CONSUMER ──────────────────────────────────────────┐');
      log.error('  │ Nothing is consuming the "webhooks" queue on this Redis.         │');
      log.error('  │ Inbound WhatsApp messages will be processed inline by the web   │');
      log.error('  │ process, and /health/ready reports not ready until a worker      │');
      log.error('  │ (npm run start:worker, RUN_WORKERS=true) connects to the SAME    │');
      log.error('  │ REDIS_URL. See DEPLOY.md §4 "Workflow automation fixes".         │');
      log.error('  └──────────────────────────────────────────────────────────────────┘');
      log.error('');
    } else {
      log.log(`[Webhook] ${count} consumer(s) connected to the "webhooks" queue.`);
    }
    return count;
  } catch (err) {
    log.warn('[Webhook] Could not check for webhook queue consumers:', err.message);
    return null;
  }
}
