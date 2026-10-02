import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Readiness must say "not ready" for each failure on its own: boot unfinished,
// database down, Redis down or hanging — without hanging itself.
const fake = { dbFails: false, redisStatus: 'ready', pingHangs: false };

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

const { checkReadiness, markReady, markNotReady } = await import('./readiness.js');

function reset() {
  Object.assign(fake, { dbFails: false, redisStatus: 'ready', pingHangs: false });
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
