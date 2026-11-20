import { redis } from './redis.js';

/**
 * Reads a key and deletes it in one atomic step, returning its value (or null
 * when it is not there). For one-time secrets — a sign-in code, an OAuth
 * state — where two concurrent readers must not both get the value.
 *
 * This is what GETDEL does, but GETDEL only exists from Redis 6.2. On an older
 * server it answers "ERR unknown command", which here meant every Google
 * sign-in and every OAuth connection failed with a 500. MULTI/EXEC has the
 * same guarantee (the two commands run together, nothing in between) and
 * works on every Redis version this app can meet.
 */
export async function takeKey(key) {
  const results = await redis.multi().get(key).del(key).exec();
  // exec() answers [[error, value], [error, deleted]], or null if the
  // transaction was discarded.
  const [error, value] = Array.isArray(results) && results[0] ? results[0] : [null, null];
  if (error) throw error;
  return value ?? null;
}
