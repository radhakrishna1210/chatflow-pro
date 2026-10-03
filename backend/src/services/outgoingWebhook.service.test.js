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
mock.module('../queues/outgoingWebhook.queue.js', {
  namedExports: {
    outgoingWebhookQueue: {
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
});

// WF-EV-7: the categories (messages, reactions, deliveries, reads, referrals)
// only describe message traffic. Choosing some used to turn off every other
// event too, which no category can select back.
test('a category selection filters message traffic only; other events still arrive', async () => {
  reset();
  workspace.webhookEvents = ['messages'];
  assert.equal((await svc.dispatchWebhook('ws_1', 'message.received', {})).queued, true);
  assert.equal((await svc.dispatchWebhook('ws_1', 'message.status', {})).queued, false, 'deliveries/reads were not selected');
  for (const event of ['campaign.completed', 'template.status', 'contact.created', 'optout.created', 'custom.event']) {
    assert.equal((await svc.dispatchWebhook('ws_1', event, {})).queued, true, event);
  }
});

test('a selection naming events explicitly is honoured exactly', () => {
  const ws = { webhookUrl: 'https://hooks.example.com/x' };
  assert.equal(svc.wantsEvent({ ...ws, webhookEvents: ['contact.created'] }, 'contact.created'), true);
  assert.equal(svc.wantsEvent({ ...ws, webhookEvents: ['contact.created'] }, 'campaign.completed'), false);
  assert.equal(svc.wantsEvent({ ...ws, webhookEvents: ['contact.created', 'messages'] }, 'message.received'), true);
  assert.equal(svc.wantsEvent({ ...ws, webhookEvents: [] }, 'optout.created'), true);
  assert.equal(svc.wantsEvent({ webhookUrl: '', webhookEvents: null }, 'contact.created'), false);
});

// WF-EV-7: contact.created was offered but never raised.
test('contact.created carries the new contact and where it came from', async () => {
  reset();
  svc.emitContactCreated('ws_1', { id: 'c1', name: 'Asha', phoneNumber: '+919800000000', email: null, tags: ['vip'], createdAt: new Date('2026-10-03T10:00:00Z') }, { source: 'manual' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(queued.length, 1);
  assert.equal(queued[0].name, 'contact.created');
  const body = JSON.parse(queued[0].data.body);
  assert.deepEqual(body.data, { id: 'c1', name: 'Asha', phoneNumber: '+919800000000', email: null, tags: ['vip'], createdAt: '2026-10-03T10:00:00.000Z', source: 'manual' });
});

test('a bulk contact.created reads the workspace once and queues one event per contact', async () => {
  reset();
  let reads = 0;
  const real = prisma.workspace.findUnique;
  prisma.workspace.findUnique = async () => { reads += 1; return workspace; };
  try {
    const out = await svc.dispatchWebhooks('ws_1', 'contact.created', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    assert.equal(out.queued, 3);
    assert.equal(reads, 1);
    assert.equal(new Set(queued.map((q) => q.opts.jobId)).size, 3, 'each has its own delivery id');
  } finally {
    prisma.workspace.findUnique = real;
  }
  reset();
  workspace.webhookUrl = '';
  assert.equal((await svc.dispatchWebhooks('ws_1', 'contact.created', [{ id: 'a' }])).queued, 0);
});
