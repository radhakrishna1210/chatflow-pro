import axios from 'axios';
import { createHmac, randomUUID, randomBytes } from 'crypto';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';

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
  // Raised by a workspace's own integration through /custom/events/:key/track.
  'custom.event',
]);

// Attempt schedule. Deliberately short and finite: a receiver that is down for
// twenty minutes is down, and queueing indefinitely would hold Redis memory for
// something the customer can re-request.
const RETRY_DELAYS_MS = [0, 2_000, 10_000, 60_000, 300_000];

const isRetryable = (status) => !status || status >= 500 || status === 408 || status === 429;

// The workspace lookup runs against the Supabase pooler, which intermittently
// refuses connections (P1001). It used to be `.catch(() => null)`, which turned
// a dropped connection into a silent "not subscribed" and lost the event. Retry
// only the connection-level failures; anything else is a real error.
const LOOKUP_RETRY_DELAYS_MS = [0, 1_000, 3_000];
const TRANSIENT_DB_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Signature scheme mirrors Meta's, so anyone who has already written a receiver
// for the inbound Meta webhook can reuse it: HMAC-SHA256 over the exact body,
// hex, prefixed with the algorithm.
export function signPayload(body, secret) {
  return 'sha256=' + createHmac('sha256', String(secret || '')).update(body).digest('hex');
}

// The signing secret. The column defaults to "" and nothing ever filled it, so
// a workspace created after the column was added signed every delivery with an
// empty HMAC key — a signature anyone can forge — and the settings screen hid
// the Verify Token box entirely because it had nothing to show.
export async function ensureVerifyToken(workspaceId, current) {
  if (current) return current;
  const token = randomBytes(32).toString('hex');
  // Conditional so two concurrent callers cannot each write a different token
  // and leave the receiver holding the wrong one.
  await prisma.workspace.updateMany({ where: { id: workspaceId, webhookVerifyToken: '' }, data: { webhookVerifyToken: token } });
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { webhookVerifyToken: true } });
  return ws?.webhookVerifyToken || token;
}

const isPrivateAddress = (ip) => {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127);
};

// The server POSTs to whatever URL a workspace saves, so without this any
// member could point it at the VPS's own services (Redis, the PM2 apps on
// localhost) or a cloud metadata endpoint. Local development legitimately
// targets localhost receivers, so the check applies in production only.
export async function assertDeliverableUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch {
    const e = new Error('Webhook URL is not a valid URL'); e.status = 400; e.expose = true; throw e;
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    const e = new Error('Webhook URL must use http or https'); e.status = 400; e.expose = true; throw e;
  }
  if (env.NODE_ENV !== 'production') return;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((r) => r.address);
  if (addresses.length === 0) {
    const e = new Error(`Webhook host "${host}" does not resolve`); e.status = 400; e.expose = true; throw e;
  }
  if (addresses.some(isPrivateAddress)) {
    const e = new Error('Webhook URL points to a private or internal address'); e.status = 400; e.expose = true; throw e;
  }
}

// The settings validator used to accept only Meta-style names ('messages',
// 'deliveries', ...), so workspaces that saved a selection before it was fixed
// still store them. Matched literally, none of them equals a dispatched event
// and those workspaces silently received nothing. Honour what they meant.
const LEGACY_EVENT_ALIASES = Object.freeze({
  messages: ['message.received'],
  // Reactions and click-to-WhatsApp referrals arrive as inbound messages.
  reactions: ['message.received'],
  referrals: ['message.received'],
  deliveries: ['message.status'],
  reads: ['message.status'],
});

// Which workspaces want this event. `webhookEvents` null means "everything",
// matching what the settings UI implies when nothing is selected.
export function wantsEvent(workspace, event) {
  if (!workspace?.webhookUrl) return false;
  const selected = workspace.webhookEvents;
  if (selected == null) return true;
  if (!Array.isArray(selected)) return true;
  if (selected.length === 0) return true;
  return selected.some((name) => name === event || LEGACY_EVENT_ALIASES[name]?.includes(event));
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

async function loadWebhookConfig(workspaceId, retryDelaysMs) {
  for (let attempt = 0; ; attempt += 1) {
    if (retryDelaysMs[attempt] > 0) await sleep(retryDelaysMs[attempt]);
    try {
      return await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { webhookUrl: true, webhookEvents: true, webhookVerifyToken: true },
      });
    } catch (err) {
      const transient = TRANSIENT_DB_CODES.has(err.code);
      const last = attempt >= retryDelaysMs.length - 1;
      console.error(
        `[Webhook:out] workspace lookup failed for ${workspaceId} ` +
        `(attempt ${attempt + 1}/${retryDelaysMs.length}, code=${err.code ?? 'none'}): ${err.message}`
      );
      if (!transient || last) throw err;
    }
  }
}

/**
 * Sends one event to a workspace's configured endpoint, retrying transient
 * failures. Never throws: a customer's broken endpoint must not fail the
 * operation that produced the event. Every path that does not deliver logs why.
 *
 * `opts` exists for tests: { retryDelaysMs, lookupRetryDelaysMs }.
 */
export async function dispatchWebhook(workspaceId, event, data, opts = {}) {
  const retryDelaysMs = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
  const lookupRetryDelaysMs = opts.lookupRetryDelaysMs ?? LOOKUP_RETRY_DELAYS_MS;

  if (!WEBHOOK_EVENTS.includes(event)) {
    console.warn(`[Webhook:out] Unknown event "${event}" — not sent.`);
    return { delivered: false, reason: 'unknown_event' };
  }

  let workspace;
  try {
    workspace = await loadWebhookConfig(workspaceId, lookupRetryDelaysMs);
  } catch (err) {
    console.error(`[Webhook:out] ${event} NOT sent for ${workspaceId} — workspace lookup failed: ${err.message}`);
    return { delivered: false, reason: 'workspace_lookup_failed', error: err.message, code: err.code };
  }

  if (!workspace) {
    console.warn(`[Webhook:out] ${event} skipped — workspace ${workspaceId} not found.`);
    return { delivered: false, reason: 'workspace_not_found' };
  }

  if (!wantsEvent(workspace, event)) {
    console.warn(
      `[Webhook:out] ${event} skipped for ${workspaceId} — ` +
      `url=${Boolean(workspace.webhookUrl)} ` +
      `events=${JSON.stringify(workspace.webhookEvents ?? null)}`
    );
    return { delivered: false, reason: 'not_subscribed' };
  }

  try {
    await assertDeliverableUrl(workspace.webhookUrl);
  } catch (err) {
    console.warn(`[Webhook:out] ${event} not sent for workspace ${workspaceId}: ${err.message}`);
    return { delivered: false, reason: 'blocked_url' };
  }
  const secret = await ensureVerifyToken(workspaceId, workspace.webhookVerifyToken);

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
    'X-ChatFlow-Signature-256': signPayload(body, secret),
  };

  let lastResult = null;
  for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
    if (retryDelaysMs[attempt] > 0) await sleep(retryDelaysMs[attempt]);
    const result = await deliverOnce(workspace.webhookUrl, body, headers);
    lastResult = result;
    if (result.ok) {
      // Logged on every success, not only retried ones: a silent first-attempt
      // success left no trace at all, so "is my webhook working?" had no answer
      // in the server logs.
      console.log(`[Webhook:out] ${event} delivered (${result.status}) on attempt ${attempt + 1} — delivery ${deliveryId}`);
      return { delivered: true, attempts: attempt + 1, status: result.status, deliveryId };
    }
    if (result.status >= 300 && result.status < 400) {
      // Redirects are not followed (a redirect would replay a signed body to a
      // host the workspace never configured), so name it plainly — the usual
      // cause is an http:// URL whose server redirects to https://.
      console.warn(`[Webhook:out] ${event} got redirect ${result.status} from ${workspace.webhookUrl} — save the final URL instead; not retrying.`);
      return { delivered: false, attempts: attempt + 1, status: result.status, deliveryId };
    }
    if (!isRetryable(result.status)) {
      // A 4xx is the receiver saying "this request is wrong". Repeating it
      // cannot help, so stop rather than spending four more attempts.
      console.warn(`[Webhook:out] ${event} rejected with ${result.status} — not retrying.`);
      return { delivered: false, attempts: attempt + 1, status: result.status, deliveryId };
    }
    console.warn(`[Webhook:out] ${event} attempt ${attempt + 1} failed (${result.status ?? result.error}) — will retry.`);
  }

  console.error(`[Webhook:out] ${event} to ${workspace.webhookUrl} failed after ${retryDelaysMs.length} attempts.`);
  return { delivered: false, attempts: retryDelaysMs.length, status: lastResult?.status ?? null, deliveryId };
}

// Fire-and-forget wrapper for call sites in request/webhook paths, where the
// caller must not wait on a customer's endpoint (retries alone can take five
// minutes) and must never fail because of it.
export function emitWebhook(workspaceId, event, data) {
  dispatchWebhook(workspaceId, event, data).catch((err) => {
    console.error(`[Webhook:out] ${event} dispatch error:`, err.message);
  });
}
