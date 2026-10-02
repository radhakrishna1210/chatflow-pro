import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireKeyLock, LockTimeoutError } from './keyLock.js';

// The two Redis commands the lock uses, in memory.
function fakeRedis() {
  const store = new Map();
  return {
    store,
    async set(key, value, px, ttl, nx) {
      assert.equal(px, 'PX');
      assert.equal(nx, 'NX');
      if (store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    async eval(script, numKeys, key, token) {
      if (store.get(key) === token) { store.delete(key); return 1; }
      return 0;
    },
  };
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

test('work under the same key runs one at a time; other keys run alongside', async () => {
  const client = fakeRedis();
  const log = [];
  const job = async (key, name) => {
    const release = await acquireKeyLock(client, key, { pollMs: 5 });
    log.push(`start ${name}`);
    await sleep(30);
    log.push(`end ${name}`);
    await release();
  };

  await Promise.all([job('contact_1', 'a1'), job('contact_1', 'a2'), job('contact_2', 'b1')]);

  const a = log.filter((l) => l.endsWith('a1') || l.endsWith('a2'));
  // Each a-job ends before the other starts.
  assert.ok(a[1].startsWith('end'), `overlapping a-jobs: ${a.join(', ')}`);
  // b1 started while an a-job was running.
  assert.ok(log.indexOf('start b1') < log.indexOf('end a1') || log.indexOf('start b1') < log.indexOf('end a2'));
  assert.equal(client.store.size, 0);
});

test('a lock held elsewhere times out with LockTimeoutError so the job is retried', async () => {
  const client = fakeRedis();
  await acquireKeyLock(client, 'busy');
  await assert.rejects(acquireKeyLock(client, 'busy', { waitMs: 30, pollMs: 5 }), LockTimeoutError);
});

test('release only removes the lock it took', async () => {
  const client = fakeRedis();
  const release = await acquireKeyLock(client, 'k');
  client.store.set('lock:k', 'someone-else');
  await release();
  assert.equal(client.store.get('lock:k'), 'someone-else');
});
