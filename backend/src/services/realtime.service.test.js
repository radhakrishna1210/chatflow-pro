import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import express from 'express';

// The SSE endpoint: who can open a stream, what reaches it, and that it is
// kept alive and cleaned up. Membership is faked; workspaceContext, the stream
// token, the bus and the HTTP stream are the real ones.

const members = new Map();
mock.module('../lib/prisma.js', {
  namedExports: {
    prisma: {
      workspaceMember: {
        findUnique: async ({ where }) => {
          const { userId, workspaceId } = where.userId_workspaceId;
          return members.get(`${userId}:${workspaceId}`) ?? null;
        },
      },
    },
  },
});

const { env } = await import('../config/env.js');
const { revokeAccessToken } = await import('../lib/tokenDenylist.js');
const { authenticate } = await import('../middleware/authenticate.js');
const { publishRealtime } = await import('../lib/realtimeBus.js');
const {
  mintStreamToken, authenticateStreamToken, createStreamHub, canReceive, closeRealtimeStreams,
} = await import('./realtime.service.js');
const { default: realtimeRoutes } = await import('../routes/realtime.routes.js');

function member(userId, workspaceId, role, workspace = {}) {
  members.set(`${userId}:${workspaceId}`, {
    userId, workspaceId, role,
    workspace: { id: workspaceId, suspended: false, subscription: { status: 'ACTIVE' }, ...workspace },
  });
}

function accessToken(userId, workspaceId, extra = {}) {
  return jwt.sign({ sub: userId, workspaceId, role: 'CLIENT', jti: randomUUID(), ...extra }, env.JWT_ACCESS_SECRET, { expiresIn: 900 });
}

function fakeRes() {
  const res = new EventEmitter();
  res.headers = {};
  res.chunks = [];
  res.ended = false;
  res.statusCode = null;
  res.writableLength = 0;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.flushHeaders = () => {};
  res.write = (chunk) => { res.chunks.push(chunk); return true; };
  res.end = () => { res.ended = true; res.emit('close'); };
  res.text = () => res.chunks.join('');
  return res;
}

function fakeReq({ userId = 'u1', workspaceId = 'wsA', role = 'CLIENT', superAdmin = false } = {}) {
  return { params: { workspaceId }, user: { id: userId, role, superAdmin }, socket: null };
}

// Events in SSE wire format, parsed back.
function eventsIn(text) {
  return text.split('\n\n').filter(Boolean).map((block) => {
    const out = {};
    for (const line of block.split('\n')) {
      const i = line.indexOf(':');
      const k = line.slice(0, i); const v = line.slice(i + 1).trimStart();
      if (k === '') out.comment = v; else out[k] = v;
    }
    return out;
  });
}

test.beforeEach(() => { members.clear(); });

// ─── The stream token ────────────────────────────────────────────────────────

async function runStreamAuth(token, workspaceId = 'wsA') {
  const req = { query: { token }, params: { workspaceId } };
  const res = fakeRes();
  let nexted = false;
  await authenticateStreamToken(req, res, () => { nexted = true; });
  return { req, res, nexted };
}

test('a stream token opens a stream for its own user and workspace only', async () => {
  const { token, expiresIn } = mintStreamToken({ id: 'u1', jti: 'j1' }, 'wsA');
  assert.equal(expiresIn, 60);

  const ok = await runStreamAuth(token, 'wsA');
  assert.equal(ok.nexted, true);
  assert.equal(ok.req.user.id, 'u1');
  assert.equal(ok.req.user.workspaceId, 'wsA');
  // The role is not trusted from the token; workspaceContext sets it.
  assert.equal(ok.req.user.role, null);

  const other = await runStreamAuth(token, 'wsB');
  assert.equal(other.nexted, false);
  assert.equal(other.res.statusCode, 403);
});

test('missing, forged, expired and access tokens are refused as stream tokens', async () => {
  assert.equal((await runStreamAuth(undefined)).res.statusCode, 401);
  assert.equal((await runStreamAuth('garbage')).res.statusCode, 401);

  // A normal access token is signed with the access secret, not the stream key.
  const asStream = await runStreamAuth(accessToken('u1', 'wsA'));
  assert.equal(asStream.res.statusCode, 401);

  const expired = jwt.sign({ typ: 'rt', sub: 'u1', ws: 'wsA' }, 'x'.repeat(40), { expiresIn: -10, audience: 'realtime-stream' });
  assert.equal((await runStreamAuth(expired)).res.statusCode, 401);
});

test('a stream token is not accepted as a Bearer access token', async () => {
  const { token } = mintStreamToken({ id: 'u1', jti: 'j1' }, 'wsA');
  const req = { headers: { authorization: `Bearer ${token}` }, method: 'GET', originalUrl: '/api/v1/workspaces/wsA/contacts' };
  const res = fakeRes();
  let nexted = false;
  await authenticate(req, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
});

test('signing out ends the ability to open a stream with a token minted from that session', async () => {
  const jti = randomUUID();
  const { token } = mintStreamToken({ id: 'u1', jti }, 'wsA');
  await revokeAccessToken(jti, Math.floor(Date.now() / 1000) + 600);
  const { nexted, res } = await runStreamAuth(token);
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
});

// ─── The hub: scoping, roles, heartbeat, caps, cleanup ──────────────────────

function hubWithSource(options = {}) {
  let listener = null;
  const hub = createStreamHub({
    subscribe: (fn) => { listener = fn; return () => { listener = null; }; },
    heartbeatMs: 60_000,
    ...options,
  });
  return { hub, emit: (e) => listener?.(e), subscribed: () => listener !== null };
}

test('a stream sends SSE headers with buffering and transforms off, then a ready event', () => {
  const { hub } = hubWithSource();
  const res = fakeRes();
  hub.open(fakeReq(), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /^text\/event-stream/);
  assert.equal(res.headers['x-accel-buffering'], 'no');
  assert.match(res.headers['cache-control'], /no-transform/);
  const evs = eventsIn(res.text());
  assert.equal(evs[0].retry, '5000');
  assert.equal(evs[1].event, 'ready');
  hub.closeAll();
});

test('events reach only the streams of their own workspace', () => {
  const { hub, emit } = hubWithSource();
  const a = fakeRes(); const b = fakeRes();
  hub.open(fakeReq({ userId: 'u1', workspaceId: 'wsA' }), a);
  hub.open(fakeReq({ userId: 'u2', workspaceId: 'wsB' }), b);
  emit({ id: 'e1', ws: 'wsA', type: 'message.created', data: { conversationId: 'c1' } });

  const got = eventsIn(a.text()).filter((e) => e.event === 'message.created');
  assert.equal(got.length, 1);
  assert.equal(got[0].id, 'e1');
  assert.deepEqual(JSON.parse(got[0].data), { conversationId: 'c1' });
  assert.equal(eventsIn(b.text()).filter((e) => e.event === 'message.created').length, 0);

  // A resync broadcast ('*') goes to everyone.
  emit({ id: 'e2', ws: '*', type: 'resync', data: {} });
  assert.equal(eventsIn(a.text()).filter((e) => e.event === 'resync').length, 1);
  assert.equal(eventsIn(b.text()).filter((e) => e.event === 'resync').length, 1);
  hub.closeAll();
});

test('event types are forwarded by role, and unknown types not at all', () => {
  for (const role of ['VIEWER', 'AGENT', 'CLIENT', 'ADMIN']) {
    assert.equal(canReceive({ role }, 'message.created'), true, role);
    assert.equal(canReceive({ role }, 'campaign.updated'), true, role);
    // Workflow run updates (contract C4) reach the same audience as campaigns.
    assert.equal(canReceive({ role }, 'workflow.run'), true, role);
  }
  assert.equal(canReceive({ role: 'ADMIN' }, 'wallet.debited'), false);
  assert.equal(canReceive({ role: null }, 'message.created'), false);
  assert.equal(canReceive({ role: null, superAdmin: true }, 'message.created'), true);

  const { hub, emit } = hubWithSource();
  const res = fakeRes();
  hub.open(fakeReq({ role: 'ADMIN' }), res);
  emit({ id: 'e1', ws: 'wsA', type: 'secret.thing', data: {} });
  assert.equal(eventsIn(res.text()).filter((e) => e.event === 'secret.thing').length, 0);
  hub.closeAll();
});

test('the heartbeat writes a comment line to every open stream', async () => {
  const { hub } = hubWithSource({ heartbeatMs: 15 });
  const res = fakeRes();
  hub.open(fakeReq(), res);
  await new Promise((r) => setTimeout(r, 50));
  const pings = eventsIn(res.text()).filter((e) => e.comment?.startsWith('ping'));
  assert.ok(pings.length >= 1, 'expected at least one heartbeat');
  hub.closeAll();
});

test('a stream past its lifetime is told to reconnect and closed', () => {
  let t = 1_000_000;
  const { hub } = hubWithSource({ now: () => t, maxStreamMs: 1000 });
  const res = fakeRes();
  hub.open(fakeReq(), res);
  t += 500; hub.tick();
  assert.equal(res.ended, false);
  t += 600; hub.tick();
  assert.equal(res.ended, true);
  assert.equal(eventsIn(res.text()).at(-1).event, 'reconnect');
  assert.equal(hub.size, 0);
});

test('one user is capped; the oldest stream is evicted', () => {
  const { hub } = hubWithSource({ maxStreamsPerUser: 2 });
  const first = fakeRes(); const second = fakeRes(); const third = fakeRes();
  hub.open(fakeReq(), first);
  hub.open(fakeReq(), second);
  hub.open(fakeReq(), third);
  assert.equal(first.ended, true);
  assert.equal(eventsIn(first.text()).at(-1).event, 'evicted');
  assert.equal(second.ended, false);
  assert.equal(third.ended, false);
  assert.equal(hub.streamsFor('u1'), 2);
  // Someone else is unaffected.
  hub.open(fakeReq({ userId: 'u2' }), fakeRes());
  assert.equal(hub.streamsFor('u2'), 1);
  hub.closeAll();
});

test('a closed connection is forgotten and no longer written to; closing all unsubscribes', () => {
  const { hub, emit, subscribed } = hubWithSource();
  const res = fakeRes();
  hub.open(fakeReq(), res);
  assert.equal(subscribed(), true);
  res.emit('close');
  assert.equal(hub.size, 0);
  const before = res.chunks.length;
  emit({ id: 'e1', ws: 'wsA', type: 'message.created', data: {} });
  assert.equal(res.chunks.length, before);
  hub.closeAll();
  assert.equal(subscribed(), false);
});

test('a reader that stops consuming is dropped instead of buffered forever', () => {
  const { hub, emit } = hubWithSource();
  const res = fakeRes();
  hub.open(fakeReq(), res);
  res.writableLength = 2 * 1024 * 1024;
  emit({ id: 'e1', ws: 'wsA', type: 'message.created', data: {} });
  assert.equal(res.ended, true);
  assert.equal(hub.size, 0);
});

// ─── End to end over HTTP ────────────────────────────────────────────────────

test('over HTTP: token, stream, membership check, and a published event arriving', async (t) => {
  member('u1', 'wsA', 'AGENT');
  const app = express();
  app.use('/api/v1/workspaces/:workspaceId/realtime', realtimeRoutes);
  const server = app.listen(0);
  t.after(() => { closeRealtimeStreams(); server.close(); });
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/workspaces`;

  // Not signed in.
  assert.equal((await fetch(`${base}/wsA/realtime/token`)).status, 401);
  // Not a member of wsB.
  const bearer = { authorization: `Bearer ${accessToken('u1', 'wsA')}` };
  assert.equal((await fetch(`${base}/wsB/realtime/token`, { headers: bearer })).status, 403);

  const tokenRes = await fetch(`${base}/wsA/realtime/token`, { headers: bearer });
  assert.equal(tokenRes.status, 200);
  assert.equal(tokenRes.headers.get('cache-control'), 'no-store');
  const { token } = await tokenRes.json();

  // A stream token opens the stream and nothing else — not even a new token.
  assert.equal((await fetch(`${base}/wsA/realtime/token?token=${encodeURIComponent(token)}`)).status, 401);
  // The token is bound to wsA.
  assert.equal((await fetch(`${base}/wsB/realtime/stream?token=${encodeURIComponent(token)}`)).status, 403);

  const ctrl = new AbortController();
  const stream = await fetch(`${base}/wsA/realtime/stream?token=${encodeURIComponent(token)}`, { signal: ctrl.signal });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /^text\/event-stream/);
  assert.equal(stream.headers.get('x-accel-buffering'), 'no');

  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const readUntil = async (pattern) => {
    while (!pattern.test(text)) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  };
  await readUntil(/event: ready/);

  publishRealtime('wsB', 'message.created', { conversationId: 'other-tenant' });
  publishRealtime('wsA', 'message.created', { conversationId: 'c1', messageId: 'm1', direction: 'INBOUND' });
  await readUntil(/event: message\.created/);
  assert.match(text, /"conversationId":"c1"/);
  assert.doesNotMatch(text, /other-tenant/);

  ctrl.abort();
  await reader.cancel().catch(() => {});
});

test('over HTTP: a member removed after minting cannot open the stream', async (t) => {
  member('u9', 'wsA', 'CLIENT');
  const app = express();
  app.use('/api/v1/workspaces/:workspaceId/realtime', realtimeRoutes);
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/workspaces`;

  const res = await fetch(`${base}/wsA/realtime/token`, { headers: { authorization: `Bearer ${accessToken('u9', 'wsA')}` } });
  const { token } = await res.json();
  members.delete('u9:wsA');
  assert.equal((await fetch(`${base}/wsA/realtime/stream?token=${encodeURIComponent(token)}`)).status, 403);
});
