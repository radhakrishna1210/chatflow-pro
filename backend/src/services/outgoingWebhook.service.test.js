import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

let workspace;
let requests;
let nextStatus;
let queued;
let queueFails;

const prisma = {
  workspace: {
    findUnique: async () => workspace,
    updateMany: async ({ where, data }) => {
      if (workspace.webhookVerifyToken === where.webhookVerifyToken) Object.assign(workspace, data);
      return { count: 1 };
    },
  },
};

class UnsafeUrlError extends Error {}

mock.module('../lib/prisma.js', { namedExports: { prisma } });
mock.module('../lib/safeUrl.js', {
  namedExports: {
    UnsafeUrlError,
    safeRequest: async (url, opts) => {
      requests.push({ url, ...opts });
      if (nextStatus === 'unsafe') throw new UnsafeUrlError('nope');
      return { status: nextStatus, headers: {}, data: Buffer.alloc(0), url };
    },
  },
});
mock.module('../queues/webhook.queue.js', {
  namedExports: {
    webhookQueue: {
      add: async (name, data, opts) => {
        if (queueFails) throw new Error('redis down');
        queued.push({ name, data, opts });
      },
    },
  },
});

const svc = await import('./outgoingWebhook.service.js');

function reset() {
  workspace = { webhookUrl: 'https://hooks.example.com/in', webhookEvents: null, webhookVerifyToken: 'sekret' };
  requests = [];
  nextStatus = 200;
  queued = [];
  queueFails = false;
}

test('an event is queued with a stable delivery id, not delivered inline', async () => {
  reset();
  const out = await svc.dispatchWebhook('ws_1', 'message.received', { text: 'hi' });
  assert.equal(out.queued, true);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].opts.jobId, out.deliveryId);
  assert.equal(JSON.parse(queued[0].data.body).id, out.deliveryId);
  assert.equal(requests.length, 0);
});

test('nothing is queued for a workspace not subscribed to the event', async () => {
  reset();
  workspace.webhookEvents = ['template.status'];
  assert.equal((await svc.dispatchWebhook('ws_1', 'message.received', {})).queued, false);
  workspace.webhookUrl = null;
  assert.equal((await svc.dispatchWebhook('ws_1', 'template.status', {})).queued, false);
  assert.equal(queued.length, 0);
});

test('a delivery is signed with the workspace secret', async () => {
  reset();
  const body = '{"x":1}';
  const out = await svc.attemptDelivery({ workspaceId: 'ws_1', event: 'message.received', deliveryId: 'd1', body });
  assert.equal(out.delivered, true);
  const expected = 'sha256=' + createHmac('sha256', 'sekret').update(body).digest('hex');
  assert.equal(requests[0].headers['X-ChatFlow-Signature-256'], expected);
  assert.equal(requests[0].method, 'POST');
});

test('an empty secret is replaced with a generated one before signing', async () => {
  reset();
  workspace.webhookVerifyToken = '';
  await svc.attemptDelivery({ workspaceId: 'ws_1', event: 'message.received', deliveryId: 'd1', body: '{}' });
  assert.match(workspace.webhookVerifyToken, /^[0-9a-f]{64}$/);
  assert.throws(() => svc.signPayload('{}', ''));
});

test('5xx and network failures retry; 4xx and non-public addresses do not', async () => {
  reset();
  const job = (attemptsMade = 0) => ({ attemptsMade, data: { workspaceId: 'ws_1', event: 'message.received', deliveryId: 'd1', body: '{}' } });

  nextStatus = 503;
  await assert.rejects(svc.deliverWebhookJob(job()), (err) => err.name !== 'UnrecoverableError');
  nextStatus = 429;
  await assert.rejects(svc.deliverWebhookJob(job()), (err) => err.name !== 'UnrecoverableError');
  nextStatus = 404;
  await assert.rejects(svc.deliverWebhookJob(job()), (err) => err.name === 'UnrecoverableError');
  nextStatus = 'unsafe';
  await assert.rejects(svc.deliverWebhookJob(job()), (err) => err.name === 'UnrecoverableError');
  nextStatus = 200;
  assert.equal((await svc.deliverWebhookJob(job(2))).delivered, true);
});

test('with the queue unavailable an event gets one inline attempt, not a retry loop', async () => {
  reset();
  queueFails = true;
  nextStatus = 500;
  const warn = mock.method(console, 'warn', () => {});
  try {
    const out = await svc.dispatchWebhook('ws_1', 'message.received', {});
    assert.equal(out.queued, false);
    assert.equal(requests.length, 1);
  } finally {
    warn.mock.restore();
  }
});

test('a saved category selection matches the events it stands for', async () => {
  reset();
  workspace.webhookEvents = ['messages', 'deliveries'];
  assert.equal((await svc.dispatchWebhook('ws_1', 'message.received', {})).queued, true);
  assert.equal((await svc.dispatchWebhook('ws_1', 'message.status', {})).queued, true);
  assert.equal((await svc.dispatchWebhook('ws_1', 'campaign.completed', {})).queued, false);
});
