import axios from 'axios';
import { createHmac, randomUUID } from 'crypto';
import { prisma } from '../lib/prisma.js';

// Outgoing webhooks: telling the customer's own system what happened here.
//
// The workspace has carried `webhookUrl`, `webhookEvents` and
// `webhookVerifyToken` for a long time, the settings screen edits them, and
// there is a "Send test" button — but nothing ever dispatched a real event.
// Every production call site was missing, so a customer who wired up an
// endpoint received exactly one payload: the test one.
//
// Deliveries are signed, retried with backoff, and de-duplicated by a delivery
// id the receiver can key on.

export const WEBHOOK_EVENTS = Object.freeze([
  'message.received',
  'message.status',
  'campaign.completed',
  'template.status',
  'contact.created',
  'optout.created',
]);

// Attempt schedule. Deliberately short and finite: a receiver that is down for
// twenty minutes is down, and queueing indefinitely would hold Redis memory for
// something the customer can re-request.
const RETRY_DELAYS_MS = [0, 2_000, 10_000, 60_000, 300_000];

const isRetryable = (status) => !status || status >= 500 || status === 408 || status === 429;

// Signature scheme mirrors Meta's, so anyone who has already written a receiver
// for the inbound Meta webhook can reuse it: HMAC-SHA256 over the exact body,
// hex, prefixed with the algorithm.
export function signPayload(body, secret) {
  return 'sha256=' + createHmac('sha256', String(secret || '')).update(body).digest('hex');
}

// Which workspaces want this event. `webhookEvents` null means "everything",
// matching what the settings UI implies when nothing is selected.
function wantsEvent(workspace, event) {
  if (!workspace?.webhookUrl) return false;
  const selected = workspace.webhookEvents;
  if (selected == null) return true;
  if (!Array.isArray(selected)) return true;
  return selected.length === 0 || selected.includes(event);
}

async function deliverOnce(url, body, headers, timeoutMs = 10_000) {
  try {
    const res = await axios.post(url, body, {
      headers, timeout: timeoutMs,
      // We validate the status ourselves so a 4xx does not throw and lose the
      // response we want to record.
      validateStatus: () => true,
      maxRedirects: 0,
    });
    return { status: res.status, ok: res.status >= 200 && res.status < 300 };
  } catch (err) {
    return { status: null, ok: false, error: err.message };
  }
}

/**
 * Sends one event to a workspace's configured endpoint, retrying transient
 * failures. Never throws: a customer's broken endpoint must not fail the
 * operation that produced the event.
 */
export async function dispatchWebhook(workspaceId, event, data) {
  if (!WEBHOOK_EVENTS.includes(event)) {
    console.warn(`[Webhook:out] Unknown event "${event}" — not sent.`);
    return { delivered: false, reason: 'unknown_event' };
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { webhookUrl: true, webhookEvents: true, webhookVerifyToken: true },
  }).catch(() => null);

  if (!wantsEvent(workspace, event)) return { delivered: false, reason: 'not_subscribed' };

  // The delivery id is what makes retries safe for the receiver: the same id
  // arrives on every attempt of the same event, so they can discard repeats.
  const deliveryId = randomUUID();
  const payload = { id: deliveryId, event, workspaceId, sentAt: new Date().toISOString(), data };
  const body = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'ChatFlowPro-Webhook/1',
    'X-ChatFlow-Event': event,
    'X-ChatFlow-Delivery': deliveryId,
    'X-ChatFlow-Signature-256': signPayload(body, workspace.webhookVerifyToken),
  };

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    if (RETRY_DELAYS_MS[attempt] > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
    const result = await deliverOnce(workspace.webhookUrl, body, headers);
    if (result.ok) {
      if (attempt > 0) console.log(`[Webhook:out] ${event} delivered on attempt ${attempt + 1}`);
      return { delivered: true, attempts: attempt + 1, deliveryId };
    }
    if (!isRetryable(result.status)) {
      // A 4xx is the receiver saying "this request is wrong". Repeating it
      // cannot help, so stop rather than spending four more attempts.
      console.warn(`[Webhook:out] ${event} rejected with ${result.status} — not retrying.`);
      return { delivered: false, attempts: attempt + 1, status: result.status, deliveryId };
    }
  }

  console.error(`[Webhook:out] ${event} to ${workspace.webhookUrl} failed after ${RETRY_DELAYS_MS.length} attempts.`);
  return { delivered: false, attempts: RETRY_DELAYS_MS.length, deliveryId };
}

// Fire-and-forget wrapper for call sites in request/webhook paths, where the
// caller must not wait on a customer's endpoint (retries alone can take five
// minutes) and must never fail because of it.
export function emitWebhook(workspaceId, event, data) {
  dispatchWebhook(workspaceId, event, data).catch((err) => {
    console.error(`[Webhook:out] ${event} dispatch error:`, err.message);
  });
}
