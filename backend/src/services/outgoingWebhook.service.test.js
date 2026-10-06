import test, { mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Outgoing `message.received` is how EduOS learns a WhatsApp message arrived.
// It failed silently in production: a dropped Supabase connection during the
// workspace lookup was swallowed and reported as "not subscribed", with nothing
// in the logs. These tests pin down every non-delivery path and its reason.

const WS = 'ws-test';
const URL = 'https://eduos.example/webhooks/chatflow';
const FAST = { retryDelaysMs: [0, 0, 0], lookupRetryDelaysMs: [0, 0, 0] };

let findUnique;
let post;
let dispatchWebhook;

const workspace = (overrides = {}) => ({
  webhookUrl: URL, webhookEvents: null, webhookVerifyToken: 'secret', ...overrides,
});

const dbError = (code, message = `db error ${code}`) => Object.assign(new Error(message), { code });

test.before(async () => {
  mock.module('../lib/prisma.js', {
    namedExports: {
      prisma: { workspace: {
        findUnique: (...a) => findUnique(...a),
        updateMany: async () => { throw new Error('token minting must not run: fixtures carry a token'); },
      } },
    },
  });
  mock.module('axios', {
    defaultExport: { post: (...a) => post(...a) },
  });
  ({ dispatchWebhook } = await import('./outgoingWebhook.service.js'));
});

beforeEach(() => {
  findUnique = async () => workspace();
  post = async () => ({ status: 200 });
});

const payload = { message: { id: 'wamid.1', body: 'Hi' } };

test('message.received is delivered when webhookEvents is NULL (all events)', async () => {
  const sent = [];
  post = async (url, body, opts) => { sent.push({ url, body: JSON.parse(body), opts }); return { status: 200 }; };

  const res = await dispatchWebhook(WS, 'message.received', payload, FAST);

  assert.equal(res.delivered, true);
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, URL);
  assert.equal(sent[0].body.event, 'message.received');
  assert.deepEqual(sent[0].body.data, payload);
  assert.equal(sent[0].opts.headers['X-ChatFlow-Event'], 'message.received');
  assert.match(sent[0].opts.headers['X-ChatFlow-Signature-256'], /^sha256=[0-9a-f]{64}$/);
});

test('message.received is delivered when webhookEvents is an empty array', async () => {
  findUnique = async () => workspace({ webhookEvents: [] });
  const res = await dispatchWebhook(WS, 'message.received', payload, FAST);
  assert.equal(res.delivered, true);
});

test('message.received is delivered when explicitly subscribed', async () => {
  findUnique = async () => workspace({ webhookEvents: ['message.status', 'message.received'] });
  const res = await dispatchWebhook(WS, 'message.received', payload, FAST);
  assert.equal(res.delivered, true);
});

// What workspaces that saved Settings before the validator fix still store
// (production workspace cmrt8hesi000l5lejtvocvic7 among them).
const LEGACY_EVENTS = ['messages', 'reactions', 'deliveries', 'reads', 'referrals'];

test('message.received is delivered for legacy Meta-style names saved by the old settings validator', async () => {
  findUnique = async () => workspace({ webhookEvents: LEGACY_EVENTS });
  const res = await dispatchWebhook(WS, 'message.received', payload, FAST);
  assert.equal(res.delivered, true);
});

test('legacy aliases map narrowly: "deliveries" alone does not subscribe to message.received', async (t) => {
  t.mock.method(console, 'warn', () => {});
  findUnique = async () => workspace({ webhookEvents: ['deliveries', 'reads'] });
  assert.equal((await dispatchWebhook(WS, 'message.received', payload, FAST)).reason, 'not_subscribed');
  assert.equal((await dispatchWebhook(WS, 'message.status', payload, FAST)).delivered, true);
});

test('message.received is skipped, and logged, when not subscribed', async (t) => {
  findUnique = async () => workspace({ webhookEvents: ['message.status'] });
  let posted = false;
  post = async () => { posted = true; return { status: 200 }; };
  const warn = t.mock.method(console, 'warn', () => {});

  const res = await dispatchWebhook(WS, 'message.received', payload, FAST);

  assert.deepEqual(res, { delivered: false, reason: 'not_subscribed' });
  assert.equal(posted, false);
  const line = warn.mock.calls.map((c) => c.arguments.join(' ')).find((l) => l.includes('skipped'));
  assert.ok(line, 'skip must be logged');
  assert.match(line, /message\.received skipped for ws-test/);
  assert.match(line, /events=\["message\.status"\]/);
});

test('message.received is skipped, and logged, when no webhookUrl is set', async (t) => {
  findUnique = async () => workspace({ webhookUrl: null });
  const warn = t.mock.method(console, 'warn', () => {});
  const res = await dispatchWebhook(WS, 'message.received', payload, FAST);
  assert.equal(res.reason, 'not_subscribed');
  assert.ok(warn.mock.calls.some((c) => c.arguments.join(' ').includes('url=false')));
});

test('a transient DB failure (P1001) during lookup is retried and the event still delivered', async (t) => {
  t.mock.method(console, 'error', () => {});
  let calls = 0;
  findUnique = async () => {
    calls += 1;
    if (calls === 1) throw dbError('P1001', "Can't reach database server at aws-1-ap-southeast-1.pooler.supabase.com");
    return workspace();
  };

  const res = await dispatchWebhook(WS, 'message.received', payload, FAST);

  assert.equal(calls, 2);
  assert.equal(res.delivered, true);
});

test('a persistent DB failure is reported as workspace_lookup_failed, not not_subscribed', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  let calls = 0;
  findUnique = async () => { calls += 1; throw dbError('P1001', "Can't reach database server"); };
  let posted = false;
  post = async () => { posted = true; return { status: 200 }; };

  const res = await dispatchWebhook(WS, 'message.received', payload, FAST);

  assert.equal(calls, FAST.lookupRetryDelaysMs.length);
  assert.equal(res.delivered, false);
  assert.equal(res.reason, 'workspace_lookup_failed');
  assert.equal(res.code, 'P1001');
  assert.equal(posted, false);
  assert.ok(error.mock.calls.some((c) => c.arguments.join(' ').includes('workspace lookup failed')));
});

test('a non-connection DB error is not retried', async (t) => {
  t.mock.method(console, 'error', () => {});
  let calls = 0;
  findUnique = async () => { calls += 1; throw dbError('P2022', 'column does not exist'); };
  const res = await dispatchWebhook(WS, 'message.received', payload, FAST);
  assert.equal(calls, 1);
  assert.equal(res.reason, 'workspace_lookup_failed');
});

test('successful delivery logs "delivered (200)"', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  await dispatchWebhook(WS, 'message.received', payload, FAST);
  assert.ok(log.mock.calls.some((c) => c.arguments.join(' ').includes('[Webhook:out] message.received delivered (200)')));
});

test('delivery failure: 5xx is retried, then reported after the last attempt', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  let attempts = 0;
  post = async () => { attempts += 1; return { status: 503 }; };

  const res = await dispatchWebhook(WS, 'message.received', payload, FAST);

  assert.equal(attempts, FAST.retryDelaysMs.length);
  assert.equal(res.delivered, false);
  assert.equal(res.status, 503);
  assert.ok(error.mock.calls.some((c) => c.arguments.join(' ').includes('failed after 3 attempts')));
});

test('delivery failure: network error is retried and recovers', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});
  let attempts = 0;
  post = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('ECONNRESET');
    return { status: 200 };
  };
  const res = await dispatchWebhook(WS, 'message.received', payload, FAST);
  assert.equal(res.delivered, true);
  assert.equal(res.attempts, 2);
});

test('delivery failure: 4xx is not retried', async (t) => {
  t.mock.method(console, 'warn', () => {});
  let attempts = 0;
  post = async () => { attempts += 1; return { status: 401 }; };
  const res = await dispatchWebhook(WS, 'message.received', payload, FAST);
  assert.equal(attempts, 1);
  assert.equal(res.delivered, false);
  assert.equal(res.status, 401);
});
