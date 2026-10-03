import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Readiness must say "not ready" for each failure on its own: boot unfinished,
// database down, Redis down or hanging — without hanging itself.
const fake = { dbFails: false, redisStatus: 'ready', pingHangs: false, localWorker: false, consumers: 1 };

mock.module('./prisma.js', {
  namedExports: {
    prisma: {
      $queryRaw: async () => {
        if (fake.dbFails) throw new Error('connection refused');
        return [{ '?column?': 1 }];
      },
    },
  },
});

mock.module('./redis.js', {
  namedExports: {
    redis: {
      get status() { return fake.redisStatus; },
      ping: () => (fake.pingHangs ? new Promise(() => {}) : Promise.resolve('PONG')),
    },
  },
});

// Whether anything consumes the "webhooks" queue (WF-IN-13).
mock.module('./webhookConsumers.js', {
  namedExports: {
    webhookConsumerCount: async () => {
      if (fake.consumers instanceof Error) throw fake.consumers;
      return fake.consumers;
    },
  },
});
mock.module('../workers/webhook.worker.js', { namedExports: { isWebhookWorkerRunning: () => fake.localWorker } });

const { checkReadiness, markReady, markNotReady } = await import('./readiness.js');

function reset() {
  Object.assign(fake, { dbFails: false, redisStatus: 'ready', pingHangs: false, localWorker: false, consumers: 1 });
  markReady();
}

test('ready only once boot has finished and both stores answer', async () => {
  reset();
  markNotReady();
  let r = await checkReadiness();
  assert.equal(r.ready, false);
  assert.equal(r.checks.boot, 'starting');

  markReady();
  r = await checkReadiness();
  assert.equal(r.ready, true);
  assert.deepEqual(r.checks, { boot: 'ok', database: 'ok', redis: 'ok' });
});

test('a database failure makes the instance not ready', async () => {
  reset();
  fake.dbFails = true;
  const r = await checkReadiness();
  assert.equal(r.ready, false);
  assert.match(r.checks.database, /connection refused/);
  assert.equal(r.checks.redis, 'ok');
});

test('a disconnected Redis is reported without issuing a command', async () => {
  reset();
  fake.redisStatus = 'reconnecting';
  fake.pingHangs = true; // would hang if it were called
  const r = await checkReadiness({ timeoutMs: 50 });
  assert.equal(r.ready, false);
  assert.match(r.checks.redis, /reconnecting/);
});

test('a ping that never answers times out instead of hanging the probe', async () => {
  reset();
  fake.pingHangs = true;
  const r = await checkReadiness({ timeoutMs: 50 });
  assert.equal(r.ready, false);
  assert.match(r.checks.redis, /timed out/);
});

// ── WF-IN-13: a production instance with no webhook consumer is not ready ──

test('production: no consumer on the webhooks queue makes the instance not ready', async () => {
  reset();
  fake.consumers = 0;
  const r = await checkReadiness({ production: true });
  assert.equal(r.ready, false);
  assert.match(r.checks.webhookConsumers, /no consumer/);
});

test('production: a worker in this process, or one elsewhere on the same Redis, is enough', async () => {
  reset();
  fake.consumers = 0;
  fake.localWorker = true;
  assert.equal((await checkReadiness({ production: true })).ready, true);

  reset();
  fake.consumers = 2;
  const r = await checkReadiness({ production: true });
  assert.equal(r.ready, true);
  assert.equal(r.checks.webhookConsumers, 'ok');
});

test('production: WEBHOOK_CONSUMER_REQUIRED=false reports the missing consumer without failing readiness', async () => {
  reset();
  fake.consumers = 0;
  process.env.WEBHOOK_CONSUMER_REQUIRED = 'false';
  try {
    const r = await checkReadiness({ production: true });
    assert.equal(r.ready, true);
    assert.match(r.checks.webhookConsumers, /none/);
  } finally {
    delete process.env.WEBHOOK_CONSUMER_REQUIRED;
  }
});

test('outside production the consumer check is not part of readiness', async () => {
  reset();
  fake.consumers = 0;
  const r = await checkReadiness({ production: false });
  assert.equal(r.ready, true);
  assert.equal(r.checks.webhookConsumers, undefined);
});
