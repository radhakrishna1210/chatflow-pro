import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';

// Outgoing webhooks against a real local HTTP receiver. The database is an
// in-memory workspace row, so what the receiver sees is exactly what a
// customer's endpoint would.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;

const { prisma } = await import('../lib/prisma.js');
const { dispatchWebhook, signPayload, assertDeliverableUrl } = await import('./outgoingWebhook.service.js');

let workspace;
prisma.workspace.findUnique = async () => ({ ...workspace });
prisma.workspace.updateMany = async ({ where, data }) => {
  if (workspace.webhookVerifyToken === where.webhookVerifyToken) Object.assign(workspace, data);
  return { count: 1 };
};

const received = [];
let respondWith = 200;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    received.push({ headers: req.headers, raw });
    res.writeHead(respondWith, respondWith === 301 ? { Location: 'https://elsewhere.example/' } : {});
    res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/hook`;
test.after(() => server.close());

const reset = (over = {}) => {
  received.length = 0;
  respondWith = 200;
  workspace = { webhookUrl: url, webhookEvents: null, webhookVerifyToken: 'secret-token', ...over };
};

test('delivers a signed payload the receiver can verify with the Verify Token', async () => {
  reset();
  const result = await dispatchWebhook('ws_1', 'message.received', { body: 'hi' });
  assert.equal(result.delivered, true);
  assert.equal(received.length, 1);
  const { headers, raw } = received[0];
  const expected = 'sha256=' + createHmac('sha256', 'secret-token').update(raw).digest('hex');
  assert.equal(headers['x-chatflow-signature-256'], expected);
  assert.equal(headers['x-chatflow-event'], 'message.received');
  const payload = JSON.parse(raw);
  assert.equal(payload.event, 'message.received');
  assert.equal(payload.id, headers['x-chatflow-delivery']);
  assert.deepEqual(payload.data, { body: 'hi' });
});

test('a workspace with no token gets one minted instead of signing with an empty key', async () => {
  reset({ webhookVerifyToken: '' });
  await dispatchWebhook('ws_1', 'message.status', { status: 'READ' });
  assert.match(workspace.webhookVerifyToken, /^[0-9a-f]{64}$/);
  const { headers, raw } = received[0];
  assert.equal(headers['x-chatflow-signature-256'], signPayload(raw, workspace.webhookVerifyToken));
  assert.notEqual(headers['x-chatflow-signature-256'], signPayload(raw, ''));
});

test('the event filter uses the dispatched event names', async () => {
  reset({ webhookEvents: ['message.status'] });
  assert.equal((await dispatchWebhook('ws_1', 'message.received', {})).reason, 'not_subscribed');
  assert.equal((await dispatchWebhook('ws_1', 'message.status', {})).delivered, true);
});

test('a 4xx or a redirect is not retried', async () => {
  reset();
  respondWith = 401;
  const rejected = await dispatchWebhook('ws_1', 'message.received', {});
  assert.equal(rejected.delivered, false);
  assert.equal(rejected.attempts, 1);

  reset();
  respondWith = 301;
  const redirected = await dispatchWebhook('ws_1', 'message.received', {});
  assert.equal(redirected.delivered, false);
  assert.equal(redirected.status, 301);
  assert.equal(received.length, 1);
});

test('no workspace URL means nothing is sent', async () => {
  reset({ webhookUrl: null });
  assert.equal((await dispatchWebhook('ws_1', 'message.received', {})).reason, 'not_subscribed');
  assert.equal(received.length, 0);
});

test('URL guard refuses non-http schemes', async () => {
  await assert.rejects(() => assertDeliverableUrl('ftp://example.com/x'), /http or https/);
  await assert.rejects(() => assertDeliverableUrl('not a url'), /not a valid URL/);
});
