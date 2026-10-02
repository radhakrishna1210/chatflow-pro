import { randomUUID } from 'node:crypto';

// A short-lived mutual-exclusion lock on a Redis key, shared by every process
// that talks to the same Redis. Used to run one customer's webhook events one
// at a time while other customers' events proceed in parallel.
//
// The TTL is a safety net for a process that dies holding the lock; it is
// generous because processing an inbound message can include an LLM reply.

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0`;

export class LockTimeoutError extends Error {
  constructor(key) {
    super(`Timed out waiting for lock ${key}`);
    this.name = 'LockTimeoutError';
  }
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Waits until the lock on `key` is free, takes it, and returns a release
 * function. Throws LockTimeoutError after `waitMs`.
 */
export async function acquireKeyLock(client, key, { ttlMs = 5 * 60_000, waitMs = 60_000, pollMs = 100 } = {}) {
  const lockKey = `lock:${key}`;
  const token = randomUUID();
  const deadline = Date.now() + waitMs;
  let delay = pollMs;

  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await client.set(lockKey, token, 'PX', ttlMs, 'NX');
    if (ok === 'OK') break;
    if (Date.now() >= deadline) throw new LockTimeoutError(lockKey);
    // eslint-disable-next-line no-await-in-loop
    await sleep(delay);
    delay = Math.min(delay * 2, 1_000);
  }

  let released = false;
  return async function release() {
    if (released) return;
    released = true;
    await client.eval(RELEASE_SCRIPT, 1, lockKey, token);
  };
}
