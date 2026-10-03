import { randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

// Push notifications for the dashboard: "something in this workspace changed".
//
// The inbox, campaign and template screens used to learn about changes only by
// polling. Every write that matters to them now publishes a small event here,
// and the SSE endpoint (services/realtime.service.js) forwards it to the
// browsers of that workspace, which refetch what changed.
//
// Events cross processes through Redis pub/sub. A write can happen in a worker
// process (a campaign send, an inbound webhook) while the browser is connected
// to a web process — on Render and on the VPS the two may be separate
// (`npm run start:worker`, RUN_WORKERS). Without Redis, or while it is down,
// events are delivered inside the publishing process only; the browser's
// fallback polling covers whatever that misses.
//
// Events are invalidation hints, not data: ids and a status, never a message
// body or a phone number. The browser refetches through the ordinary REST
// routes, so what a person sees is still decided by those routes' own checks.
//
// Publishing never throws and never waits: a write must not fail, or slow down,
// because nobody is listening.

export const REALTIME_CHANNEL = 'chatflow:realtime:v1';

// A burst of updates to one thing — a campaign's counters move once per
// recipient — is sent at most once per window: the first at once, the latest
// at the end of the window. Browsers refetch on each, so this bounds the load
// a 10,000-recipient send puts on every open campaign screen.
const DEFAULT_COALESCE_MS = 1000;

let seq = 0;
const idPrefix = randomBytes(3).toString('hex');
function nextId() {
  seq = (seq + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now().toString(36)}-${idPrefix}-${seq.toString(36)}`;
}

// `publisher` is a connected ioredis client (or anything with `status` and
// `publish`); `createSubscriber` returns a fresh one for SUBSCRIBE, which takes
// a connection over. Both are optional: without them the bus is in-process.
export function createRealtimeBus({
  publisher = null,
  createSubscriber = null,
  coalesceMs = DEFAULT_COALESCE_MS,
  onError = () => {},
} = {}) {
  const listeners = new Set();
  const windows = new Map(); // coalesce key -> { latest, timer }
  let subscriber = null;
  let subscriberReady = false;
  let subscribedBefore = false;
  let closed = false;

  function deliverLocal(event) {
    for (const listener of [...listeners]) {
      try { listener(event); } catch (err) { onError(err); }
    }
  }

  function transmit(event) {
    if (closed) return;
    const viaRedis = Boolean(publisher) && publisher.status === 'ready';
    // Local listeners hear it directly when Redis cannot carry it back to them:
    // no Redis, or this process's own subscription is not connected right now.
    const local = !viaRedis || (listeners.size > 0 && !subscriberReady);
    if (local) deliverLocal(event);
    if (viaRedis) {
      Promise.resolve()
        .then(() => publisher.publish(REALTIME_CHANNEL, JSON.stringify(event)))
        .catch((err) => { onError(err); if (!local) deliverLocal(event); });
    }
  }

  function publish(workspaceId, type, data = {}, { coalesce = null } = {}) {
    if (closed || !workspaceId || !type) return null;
    const event = { id: nextId(), ws: String(workspaceId), type, data: data ?? {}, at: Date.now() };
    if (coalesce == null) {
      transmit(event);
      return event;
    }
    const key = `${event.ws}|${type}|${coalesce}`;
    const open = windows.get(key);
    if (open) {
      open.latest = event;
      return event;
    }
    transmit(event);
    const slot = { latest: null, timer: null };
    slot.timer = setTimeout(() => {
      windows.delete(key);
      if (slot.latest) transmit(slot.latest);
    }, coalesceMs);
    slot.timer.unref?.();
    windows.set(key, slot);
    return event;
  }

  function ensureSubscriber() {
    if (subscriber || !createSubscriber || closed) return;
    try {
      subscriber = createSubscriber();
    } catch (err) {
      onError(err);
      subscriber = null;
      return;
    }
    subscriber.on('message', (channel, raw) => {
      if (channel !== REALTIME_CHANNEL) return;
      let event;
      try { event = JSON.parse(raw); } catch { return; }
      // '*' is reserved for this process's own resync broadcast below.
      if (!event || typeof event.ws !== 'string' || event.ws === '*' || typeof event.type !== 'string') return;
      deliverLocal(event);
    });
    subscriber.on('ready', () => {
      subscriberReady = true;
      // Anything published while the subscription was down is gone. Telling
      // every connected browser to refetch is how they recover from it.
      if (subscribedBefore) deliverLocal({ id: nextId(), ws: '*', type: 'resync', data: {}, at: Date.now() });
      subscribedBefore = true;
    });
    const down = () => { subscriberReady = false; };
    subscriber.on('close', down);
    subscriber.on('end', down);
    Promise.resolve()
      .then(() => subscriber.subscribe(REALTIME_CHANNEL))
      .catch((err) => onError(err));
  }

  function subscribe(listener) {
    listeners.add(listener);
    ensureSubscriber();
    return () => { listeners.delete(listener); };
  }

  async function close() {
    closed = true;
    for (const slot of windows.values()) clearTimeout(slot.timer);
    windows.clear();
    listeners.clear();
    if (subscriber) {
      const s = subscriber;
      subscriber = null;
      subscriberReady = false;
      await Promise.resolve().then(() => s.quit()).catch(() => s.disconnect?.());
    }
  }

  return {
    publish,
    subscribe,
    close,
    get listenerCount() { return listeners.size; },
    get subscriberReady() { return subscriberReady; },
  };
}

// ─── The process-wide bus ────────────────────────────────────────────────────
//
// Redis is loaded lazily, on the first publish or subscribe, so a service that
// emits events does not open a Redis connection merely by being imported (unit
// tests import most services with no Redis about). Tests run in-process.

let bus = null;
let loading = null;
const queued = [];
const queuedSubscribers = [];

function useRedis() {
  return env.NODE_ENV !== 'test' && env.REALTIME_ENABLED;
}

function loadBus() {
  if (bus || loading) return;
  if (!useRedis()) {
    bus = createRealtimeBus();
    return;
  }
  loading = import('./redis.js')
    .then(({ redis, createBullConnection, logRedisError }) => {
      bus = createRealtimeBus({
        publisher: redis,
        createSubscriber: () => createBullConnection('realtime'),
        onError: (err) => logRedisError('realtime', err),
      });
    })
    .catch((err) => {
      console.error('[Realtime] Redis transport unavailable, delivering in-process only:', err.message);
      bus = createRealtimeBus();
    })
    .finally(() => {
      loading = null;
      for (const [listener, holder] of queuedSubscribers.splice(0)) holder.off = bus.subscribe(listener);
      for (const args of queued.splice(0)) bus.publish(...args);
    });
}

export function publishRealtime(workspaceId, type, data = {}, options = {}) {
  if (!env.REALTIME_ENABLED) return;
  try {
    loadBus();
    if (bus) bus.publish(workspaceId, type, data, options);
    else if (queued.length < 1000) queued.push([workspaceId, type, data, options]);
  } catch (err) {
    console.error('[Realtime] publish failed:', err.message);
  }
}

export function subscribeRealtime(listener) {
  loadBus();
  if (bus) return bus.subscribe(listener);
  const holder = { off: null };
  queuedSubscribers.push([listener, holder]);
  return () => {
    const i = queuedSubscribers.findIndex(([l]) => l === listener);
    if (i !== -1) queuedSubscribers.splice(i, 1);
    holder.off?.();
  };
}

export async function closeRealtimeBus() {
  if (loading) await loading.catch(() => {}); // a failed load already fell back to in-process delivery
  if (bus) await bus.close();
}

// ─── What the screens listen for ─────────────────────────────────────────────
//
// One line at each write point. `conversationId` lets an inbox tell whether
// the open thread is the one that changed.

export const realtime = {
  messageCreated(workspaceId, conversationId, { messageId = null, direction = null } = {}) {
    publishRealtime(workspaceId, 'message.created', { conversationId, messageId, direction });
  },
  messageStatus(workspaceId, conversationId, { messageId = null, status = null } = {}) {
    publishRealtime(workspaceId, 'message.status', { conversationId, messageId, status });
  },
  conversationUpdated(workspaceId, conversationId, change = null) {
    publishRealtime(workspaceId, 'conversation.updated', { conversationId, change });
  },
  // Coalesced per campaign: progress counters move once per recipient.
  campaignUpdated(workspaceId, campaignId, { status = null } = {}) {
    publishRealtime(workspaceId, 'campaign.updated', { campaignId: campaignId ?? null, status }, { coalesce: campaignId ?? 'all' });
  },
  // `templateId` null means "several may have changed" (a sync).
  templateUpdated(workspaceId, templateId = null, { status = null } = {}) {
    publishRealtime(workspaceId, 'template.updated', { templateId, status }, { coalesce: templateId ?? 'all' });
  },
  // A workflow run started, changed status or finished. Coalesced per workflow
  // like campaign progress: a busy keyword workflow can start runs faster than
  // the Workflows tab needs to refetch.
  workflowRun(workspaceId, workflowId, { runId = null, status = null } = {}) {
    publishRealtime(workspaceId, 'workflow.run', { workflowId: workflowId ?? null, runId, status }, { coalesce: workflowId ?? 'all' });
  },
};
