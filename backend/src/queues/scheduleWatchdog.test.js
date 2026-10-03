import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// The schedule watchdog (WF-EV-6): repeatable jobs were registered only at
// boot, so a Redis wipe while the app ran lost every recovery sweep until the
// next deploy. These tests run the real registration functions of every queue
// against an in-memory BullMQ, wipe it, and check the watchdog puts back
// exactly what is missing.

const queues = new Map();
class FakeQueue {
  constructor(name) {
    this.name = name;
    this.repeats = new Map();
    this.adds = 0;
    this.broken = false;
    queues.set(name, this);
  }

  on() { return this; }

  async add(name, data, opts = {}) {
    this.adds += 1;
    if (opts.repeat) {
      const key = `${name}:${opts.jobId ?? ''}::${opts.repeat.pattern ?? opts.repeat.every}`;
      this.repeats.set(key, { key, name, id: opts.jobId ?? null, pattern: opts.repeat.pattern ?? null, every: opts.repeat.every ?? null });
    }
    return { id: opts.jobId ?? `${name}-${this.adds}` };
  }

  async getRepeatableJobs() {
    if (this.broken) throw new Error('Connection is closed.');
    return [...this.repeats.values()];
  }

  async getJob() { return null; }
}
class FakeWorker { on() { return this; } }

mock.module('bullmq', { namedExports: { Queue: FakeQueue, Worker: FakeWorker, UnrecoverableError: Error } });
mock.module('../lib/redis.js', {
  namedExports: {
    createQueueConnection: () => ({}),
    createBullConnection: () => ({}),
    logRedisError: () => {},
    redis: {},
  },
});

const { ensureSchedules, expectedSchedules, startScheduleWatchdog, stopScheduleWatchdog } = await import('./scheduleWatchdog.js');

const wipe = (...names) => { for (const n of names) queues.get(n)?.repeats.clear(); };
const quietly = async (fn) => {
  const warn = console.warn; const error = console.error;
  console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.warn = warn; console.error = error; }
};

test('on an empty Redis every expected schedule is registered, by its real registration function', async () => {
  const { restored, failed } = await quietly(() => ensureSchedules());
  assert.deepEqual(failed, []);
  assert.deepEqual(restored.sort(), ['CRM nightly maintenance', 'agent sweep', 'agent tick', 'billing cycle', 'sequence sweep', 'workflow sweep']);
  // And what they registered is exactly what the watchdog looks for.
  const second = await ensureSchedules();
  assert.deepEqual(second.restored, [], 'nothing is re-added while everything is in place');
  assert.deepEqual(
    [...queues.entries()].map(([name, q]) => [name, [...q.repeats.values()].map((r) => r.name).sort()]).sort(),
    [['agent', ['sweep', 'tick']], ['billing', ['cycle-reset']], ['crm-maintenance', ['nightly']], ['sequences', ['sweep']], ['workflows', ['sweep']]],
  );
});

test('after a Redis wipe only the missing schedules are put back, idempotently', async () => {
  await quietly(() => ensureSchedules());
  wipe('workflows', 'sequences');
  const before = queues.get('billing').adds;
  const { restored } = await quietly(() => ensureSchedules());
  assert.deepEqual(restored.sort(), ['sequence sweep', 'workflow sweep']);
  assert.equal(queues.get('billing').adds, before, 'a present schedule is not touched');
  assert.equal(queues.get('workflows').repeats.size, 1);
});

test('the agent tick and sweep share one registration', async () => {
  await quietly(() => ensureSchedules());
  wipe('agent');
  const before = queues.get('agent').adds;
  const { restored } = await quietly(() => ensureSchedules());
  assert.deepEqual(restored.sort(), ['agent sweep', 'agent tick']);
  assert.equal(queues.get('agent').adds - before, 2, 'startAgentSchedules ran once (two adds)');
});

test('a queue that cannot be read is reported and the others are still checked', async () => {
  await quietly(() => ensureSchedules());
  wipe('sequences');
  queues.get('workflows').broken = true;
  try {
    const { restored, failed } = await quietly(() => ensureSchedules());
    assert.deepEqual(failed, ['workflow sweep']);
    assert.deepEqual(restored, ['sequence sweep']);
  } finally {
    queues.get('workflows').broken = false;
  }
});

test('the periodic watchdog restores schedules and runs the recovery hook once Redis was wiped', async () => {
  await quietly(() => ensureSchedules());
  const recoveries = [];
  const warn = console.warn;
  console.warn = () => {};
  try {
    startScheduleWatchdog({ intervalMs: 10, entries: expectedSchedules(), onRestore: (labels) => recoveries.push(labels) });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(recoveries.length, 0, 'nothing missing, nothing to recover');
    wipe('crm-maintenance');
    await new Promise((r) => setTimeout(r, 60));
  } finally {
    stopScheduleWatchdog();
    console.warn = warn;
  }
  assert.deepEqual(recoveries, [['CRM nightly maintenance']]);
  assert.equal(queues.get('crm-maintenance').repeats.size, 1);
});
