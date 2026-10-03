import { createHmac, randomBytes, randomUUID } from 'crypto';
import { UnrecoverableError } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { safeRequest, UnsafeUrlError } from '../lib/safeUrl.js';

// Outgoing webhooks: telling the customer's own system what happened here.
//
// The workspace has carried `webhookUrl`, `webhookEvents` and
// `webhookVerifyToken` for a long time, the settings screen edits them, and
// there is a "Send test" button — but nothing ever dispatched a real event.
// Every production call site was missing, so a customer who wired up an
// endpoint received exactly one payload: the test one.
//
// Deliveries are signed, retried with backoff through the `outgoing-webhooks` queue
// (queues/outgoingWebhook.queue.js), and de-duplicated by a delivery id the receiver
// can key on.

export const WEBHOOK_EVENTS = Object.freeze([
  'message.received',
  'message.status',
  'campaign.completed',
  'template.status',
  'contact.created',
  'optout.created',
  // Raised by a workspace's own integration through /custom/events/:key/track.
  'custom.event',
]);

const isRetryable = (status) => !status || status >= 500 || status === 408 || status === 429;

// Signature scheme mirrors Meta's, so anyone who has already written a receiver
// for the inbound Meta webhook can reuse it: HMAC-SHA256 over the exact body,
// hex, prefixed with the algorithm.
//
// An empty key is refused: an HMAC keyed with "" is one anybody can compute,
// so a signature made with it proves nothing.
export function signPayload(body, secret) {
  if (!secret) throw new Error('Refusing to sign a webhook with an empty secret');
  return 'sha256=' + createHmac('sha256', String(secret)).update(body).digest('hex');
}

export const generateWebhookSecret = () => randomBytes(32).toString('hex');

// Workspaces whose URL was saved before secrets were generated have an empty
// `webhookVerifyToken`. Give them one on first use (the dashboard shows it as
// the Verify Token) rather than signing with a key everyone knows. The
// conditional write means concurrent first deliveries converge on one secret.
export async function ensureWebhookSecret(workspaceId, current) {
  if (current) return current;
  await prisma.workspace.updateMany({
    where: { id: workspaceId, webhookVerifyToken: '' },
    data: { webhookVerifyToken: generateWebhookSecret() },
  });
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { webhookVerifyToken: true } });
  return ws?.webhookVerifyToken || null;
}

// `webhookEvents` is saved as the categories the settings schema accepts
// (messages, deliveries, …), not as event names, so a selection used to match
// nothing at all. Each category stands for the events it covers.
const EVENT_CATEGORIES = {
  messages: ['message.received'],
  reactions: ['message.received'],
  referrals: ['message.received'],
  deliveries: ['message.status'],
  reads: ['message.status'],
};

// Which workspaces want this event. `webhookEvents` null means "everything",
// matching what the settings UI implies when nothing is selected.
function wantsEvent(workspace, event) {
  if (!workspace?.webhookUrl) return false;
  const selected = workspace.webhookEvents;
  if (selected == null) return true;
  if (!Array.isArray(selected)) return true;
  return selected.length === 0
    || selected.some((s) => s === event || EVENT_CATEGORIES[s]?.includes(event));
}

// The URL was vetted when it was saved, but DNS can change since: every
// attempt goes through the guarded transport, which refuses to connect to a
// non-public address and follows no redirects.
async function deliverOnce(url, body, headers, timeoutMs = 10_000) {
  try {
    const res = await safeRequest(url, {
      method: 'POST', data: body, headers, timeout: timeoutMs, maxBytes: 1024 * 1024,
    });
    return { status: res.status, ok: res.status >= 200 && res.status < 300 };
  } catch (err) {
    return { status: null, ok: false, error: err.message, unsafe: err instanceof UnsafeUrlError };
  }
}

const loadTarget = (workspaceId) => prisma.workspace.findUnique({
  where: { id: workspaceId },
  select: { webhookUrl: true, webhookEvents: true, webhookVerifyToken: true },
}).catch((err) => { console.error(`[Webhook] Could not load the webhook target for ${workspaceId}:`, err.message); return null; });

/**
 * Makes one delivery attempt of an already-built event. Returns
 * `{ delivered, retry, reason }`; never throws.
 *
 * The workspace is re-read on every attempt, so a URL changed or removed while
 * a retry was waiting is honoured, and the body is signed with the current
 * secret.
 */
export async function attemptDelivery({ workspaceId, event, deliveryId, body }) {
  const workspace = await loadTarget(workspaceId);
  if (!wantsEvent(workspace, event)) return { delivered: false, retry: false, reason: 'not_subscribed' };

  const secret = await ensureWebhookSecret(workspaceId, workspace.webhookVerifyToken).catch((err) => { console.error(`[Webhook] Could not load the signing secret for ${workspaceId}:`, err.message); return null; });
  if (!secret) return { delivered: false, retry: true, reason: 'no_secret' };

  const result = await deliverOnce(workspace.webhookUrl, body, {
    'Content-Type': 'application/json',
    'User-Agent': 'ChatFlowPro-Webhook/1',
    'X-ChatFlow-Event': event,
    'X-ChatFlow-Delivery': deliveryId,
    'X-ChatFlow-Signature-256': signPayload(body, secret),
  });
  if (result.ok) return { delivered: true, retry: false, status: result.status };
  // A non-public address will not become public on a retry, and a 4xx is the
  // receiver saying "this request is wrong" — repeating it cannot help.
  if (result.unsafe) return { delivered: false, retry: false, reason: 'unsafe_url' };
  if (!isRetryable(result.status)) return { delivered: false, retry: false, status: result.status, reason: 'rejected' };
  return { delivered: false, retry: true, status: result.status, reason: result.error || `status ${result.status}` };
}

// BullMQ processor for the `outgoing-webhooks` queue (workers/outgoingWebhook.worker.js).
// Throwing schedules the next retry; UnrecoverableError ends the job.
export async function deliverWebhookJob(job) {
  const outcome = await attemptDelivery(job.data);
  if (outcome.delivered) {
    if (job.attemptsMade > 0) console.log(`[Webhook:out] ${job.data.event} delivered on attempt ${job.attemptsMade + 1}`);
    return outcome;
  }
  if (!outcome.retry) {
    if (outcome.reason === 'not_subscribed') return outcome;
    throw new UnrecoverableError(`${outcome.reason}${outcome.status ? ` (${outcome.status})` : ''}`);
  }
  throw new Error(`Delivery attempt failed: ${outcome.reason}`);
}

// Without the queue (Redis down), one attempt is made in-process, and only so
// many at a time — a backlog is dropped and logged rather than allowed to
// accumulate sockets and memory in the API process.
const MAX_INLINE_DELIVERIES = 20;
let inlineDeliveries = 0;

async function deliverInline(job) {
  if (inlineDeliveries >= MAX_INLINE_DELIVERIES) {
    console.warn(`[Webhook:out] ${job.event} for ${job.workspaceId} dropped — delivery queue unavailable and ${MAX_INLINE_DELIVERIES} inline deliveries already in flight.`);
    return { delivered: false, reason: 'overloaded' };
  }
  inlineDeliveries += 1;
  try {
    return await attemptDelivery(job);
  } finally {
    inlineDeliveries -= 1;
  }
}

const QUEUE_ADD_TIMEOUT_MS = 3000;

async function enqueue(job) {
  const { outgoingWebhookQueue } = await import('../queues/outgoingWebhook.queue.js');
  let timer;
  try {
    // The delivery id doubles as the job id, so the same event is never queued twice.
    await Promise.race([
      outgoingWebhookQueue.add(job.event, job, { jobId: job.deliveryId }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('queue add timed out')), QUEUE_ADD_TIMEOUT_MS); }),
    ]);
    return true;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Builds an event for a workspace's configured endpoint and queues it for
 * delivery. Never throws: a customer's broken endpoint must not fail the
 * operation that produced the event.
 */
export async function dispatchWebhook(workspaceId, event, data) {
  if (!WEBHOOK_EVENTS.includes(event)) {
    console.warn(`[Webhook:out] Unknown event "${event}" — not sent.`);
    return { queued: false, reason: 'unknown_event' };
  }

  const workspace = await loadTarget(workspaceId);
  if (!wantsEvent(workspace, event)) return { queued: false, reason: 'not_subscribed' };

  // The delivery id is what makes retries safe for the receiver: the same id
  // arrives on every attempt of the same event, so they can discard repeats.
  const deliveryId = randomUUID();
  const body = JSON.stringify({ id: deliveryId, event, workspaceId, sentAt: new Date().toISOString(), data });
  const job = { workspaceId, event, deliveryId, body };

  try {
    await enqueue(job);
    return { queued: true, deliveryId };
  } catch (err) {
    console.warn(`[Webhook:out] Delivery queue unavailable (${err.message}) — sending ${event} once, without retries.`);
    const outcome = await deliverInline(job);
    return { queued: false, deliveryId, ...outcome };
  }
}

// Fire-and-forget wrapper for call sites in request/webhook paths, where the
// caller must not wait on a customer's endpoint and must never fail because
// of it.
export function emitWebhook(workspaceId, event, data) {
  dispatchWebhook(workspaceId, event, data).catch((err) => {
    console.error(`[Webhook:out] ${event} dispatch error:`, err.message);
  });
}
