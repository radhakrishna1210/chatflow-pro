import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { isAccessTokenRevoked } from '../lib/tokenDenylist.js';
import { authenticate } from '../middleware/authenticate.js';
import { subscribeRealtime } from '../lib/realtimeBus.js';
import { roleAtLeast } from '../middleware/roleCapabilities.js';

// The browser end of lib/realtimeBus.js: a Server-Sent Events stream per open
// dashboard tab, scoped to one workspace.
//
// Authentication. EventSource cannot send an Authorization header, and the
// session lives in localStorage rather than a cookie, so the stream is opened
// with a short-lived stream token in the query string instead. It is minted by
// an ordinary authenticated request (GET …/realtime/token), lives a minute, is
// bound to one user and one workspace, and is signed with a key derived from
// — not equal to — the access-token secret, so it can never be replayed as a
// Bearer token. Opening the stream re-checks revocation of the session it was
// minted from, and the route then runs workspaceContext, so membership,
// suspension and the inactive-subscription block apply exactly as they do to
// every other workspace route, and the role comes from the membership row.
//
// A stream lives at most MAX_STREAM_MS; the browser then reconnects with a
// fresh token. That is what bounds how long a removed member or a revoked
// session keeps receiving events.

const STREAM_TOKEN_TTL_SEC = 60;
const STREAM_TOKEN_AUDIENCE = 'realtime-stream';
const MAX_STREAM_MS = 15 * 60 * 1000;
// A browser that stops reading (a frozen tab behind a proxy that buffers)
// would otherwise grow this process's memory without bound.
const MAX_BUFFERED_BYTES = 1024 * 1024;

const streamKey = () => createHmac('sha256', env.JWT_ACCESS_SECRET).update('chatflow:realtime-stream-token:v1').digest();

export function mintStreamToken(user, workspaceId) {
  const token = jwt.sign(
    {
      typ: 'rt',
      sub: user.id,
      ws: workspaceId,
      // The session the token was minted from, so signing out ends the stream
      // for the next connection, too.
      pj: user.jti ?? null,
      ...(user.superAdmin === true ? { sa: true } : {}),
      ...(user.impersonatedBy ? { imp: user.impersonatedBy } : {}),
    },
    streamKey(),
    { expiresIn: STREAM_TOKEN_TTL_SEC, audience: STREAM_TOKEN_AUDIENCE },
  );
  return { token, expiresIn: STREAM_TOKEN_TTL_SEC };
}

// Route middleware for the stream: the counterpart of authenticate(). Leaves
// req.user without a role — workspaceContext, which runs next, sets it from
// the membership row.
export async function authenticateStreamToken(req, res, next) {
  const token = typeof req.query?.token === 'string' ? req.query.token : '';
  if (!token) return res.status(401).json({ error: 'Missing stream token' });

  let payload;
  try {
    payload = jwt.verify(token, streamKey(), { audience: STREAM_TOKEN_AUDIENCE });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired stream token' });
  }
  if (payload.typ !== 'rt' || typeof payload.sub !== 'string') {
    return res.status(401).json({ error: 'Invalid or expired stream token' });
  }
  if (payload.ws !== req.params.workspaceId) {
    return res.status(403).json({ error: 'Access denied to this workspace' });
  }
  if (await isAccessTokenRevoked(payload.pj, { userId: payload.sub, iat: payload.iat })) {
    return res.status(401).json({ error: 'Session ended. Please sign in again.' });
  }

  req.user = {
    id: payload.sub,
    workspaceId: payload.ws,
    role: null,
    superAdmin: payload.sa === true,
    impersonatedBy: typeof payload.imp === 'string' ? payload.imp : null,
    jti: payload.pj ?? null,
    exp: payload.exp ?? null,
  };
  next();
}

// The guard for the realtime router: the stream path takes a stream token and
// nothing else; every other path takes the ordinary Bearer session.
export function authenticateSessionOrStream(req, res, next) {
  if (req.method === 'GET' && req.path === '/stream') return authenticateStreamToken(req, res, next);
  return authenticate(req, res, next);
}

// Who may hear what. Every screen these events refresh is readable by every
// workspace role today (the read-only roles keep GET access — see
// middleware/roleCapabilities.js), and the payloads are ids and statuses only.
// An event type missing here is not forwarded at all, so a new one has to be
// placed deliberately.
export const EVENT_MIN_ROLE = Object.freeze({
  'message.created': 'VIEWER',
  'message.status': 'VIEWER',
  'conversation.updated': 'VIEWER',
  'campaign.updated': 'VIEWER',
  'template.updated': 'VIEWER',
  // Same audience as campaign progress: the Workflows tab is readable by every role.
  'workflow.run': 'VIEWER',
});

export function canReceive(client, type) {
  if (type === 'resync') return true;
  const minimum = EVENT_MIN_ROLE[type];
  if (!minimum) return false;
  if (client.superAdmin) return true;
  return roleAtLeast(client.role, minimum);
}

function frame({ id = null, event = null, data = undefined }) {
  let out = '';
  if (id) out += `id: ${id}\n`;
  if (event) out += `event: ${event}\n`;
  out += `data: ${JSON.stringify(data ?? {})}\n\n`;
  return out;
}

// Every open stream on this process. A factory so tests get their own, with
// their own timers and their own event source.
export function createStreamHub({
  subscribe = subscribeRealtime,
  heartbeatMs = env.REALTIME_HEARTBEAT_MS,
  maxStreamsPerUser = env.REALTIME_MAX_STREAMS_PER_USER,
  maxStreamMs = MAX_STREAM_MS,
  now = () => Date.now(),
} = {}) {
  const clients = new Set();
  const byWorkspace = new Map(); // workspaceId -> Set<client>
  const byUser = new Map();      // userId -> client[] (oldest first)
  let unsubscribe = null;
  let heartbeat = null;
  let nextConnection = 0;

  function write(client, chunk) {
    if (client.closed) return;
    try {
      client.res.write(chunk);
      if ((client.res.writableLength ?? 0) > MAX_BUFFERED_BYTES) end(client, 'slow');
    } catch {
      end(client, 'error');
    }
  }

  function detach(client) {
    clients.delete(client);
    const ws = byWorkspace.get(client.workspaceId);
    if (ws) { ws.delete(client); if (ws.size === 0) byWorkspace.delete(client.workspaceId); }
    const mine = byUser.get(client.userId);
    if (mine) {
      const i = mine.indexOf(client);
      if (i !== -1) mine.splice(i, 1);
      if (mine.length === 0) byUser.delete(client.userId);
    }
    if (clients.size === 0) stopHeartbeat();
  }

  // `reason` is sent as a last event so the browser knows whether to come
  // straight back (lifetime reached, server restarting) or to back off.
  function end(client, reason = null) {
    if (client.closed) return;
    if (reason && reason !== 'error' && reason !== 'slow') {
      try { client.res.write(frame({ event: reason === 'evicted' ? 'evicted' : 'reconnect', data: { reason } })); } catch { /* closing anyway */ }
    }
    client.closed = true;
    detach(client);
    try { client.res.end(); } catch { /* already gone */ }
  }

  function dispatch(event) {
    if (!event || typeof event.type !== 'string') return;
    const targets = event.ws === '*' ? clients : byWorkspace.get(event.ws);
    if (!targets || targets.size === 0) return;
    const chunk = frame({ id: event.id, event: event.type, data: event.data });
    for (const client of [...targets]) {
      if (canReceive(client, event.type)) write(client, chunk);
    }
  }

  function tick() {
    const t = now();
    for (const client of [...clients]) {
      if (t - client.openedAt >= maxStreamMs) end(client, 'lifetime');
      // A comment line: ignored by EventSource, but it is traffic, which is
      // what keeps Render's and nginx's idle timeouts from cutting the stream.
      else write(client, `: ping ${t}\n\n`);
    }
  }

  function startHeartbeat() {
    if (heartbeat) return;
    heartbeat = setInterval(tick, heartbeatMs);
    heartbeat.unref?.();
  }

  function stopHeartbeat() {
    if (!heartbeat) return;
    clearInterval(heartbeat);
    heartbeat = null;
  }

  // Express handler. Expects req.user from authenticateStreamToken +
  // workspaceContext.
  function open(req, res) {
    if (!unsubscribe) unsubscribe = subscribe(dispatch);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    // no-transform: a proxy must not compress or rewrite the stream.
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // nginx buffers proxied responses by default, which holds every event
    // back until the buffer fills. This header turns that off per response.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    req.socket?.setTimeout?.(0);
    req.socket?.setNoDelay?.(true);
    req.socket?.setKeepAlive?.(true);

    const client = {
      id: `${now().toString(36)}-${(nextConnection += 1)}`,
      userId: req.user.id,
      workspaceId: req.params.workspaceId,
      role: req.user.role,
      superAdmin: req.user.superAdmin === true,
      openedAt: now(),
      res,
      closed: false,
    };

    // Per-user cap: the oldest stream goes, since that is usually a tab long
    // since forgotten, or one whose connection died without the server noticing.
    const mine = byUser.get(client.userId) ?? [];
    while (mine.length >= maxStreamsPerUser) end(mine[0], 'evicted');
    mine.push(client);
    byUser.set(client.userId, mine);
    clients.add(client);
    if (!byWorkspace.has(client.workspaceId)) byWorkspace.set(client.workspaceId, new Set());
    byWorkspace.get(client.workspaceId).add(client);
    startHeartbeat();

    const cleanup = () => { if (!client.closed) { client.closed = true; detach(client); } };
    // res, not req: since Node 16 a request's 'close' fires once its (empty)
    // body has been read, not when the connection goes away.
    res.on?.('close', cleanup);
    res.on?.('error', cleanup);

    // How long the browser's own EventSource waits before reconnecting, should
    // it ever do so itself; the app's client normally handles reconnects.
    write(client, 'retry: 5000\n\n');
    write(client, frame({ event: 'ready', data: { connectionId: client.id, heartbeatMs, maxStreamMs } }));
    return client;
  }

  function closeAll(reason = 'shutdown') {
    for (const client of [...clients]) end(client, reason);
    stopHeartbeat();
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  }

  return {
    open,
    dispatch,
    closeAll,
    tick,
    get size() { return clients.size; },
    streamsFor(userId) { return (byUser.get(userId) ?? []).length; },
  };
}

let hub = null;
export function streamHub() {
  if (!hub) hub = createStreamHub();
  return hub;
}

// Called on shutdown before the HTTP server closes: server.close() waits for
// every open connection, and an event stream never ends on its own.
export function closeRealtimeStreams() {
  if (hub) hub.closeAll('shutdown');
}
