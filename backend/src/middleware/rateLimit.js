import { redis } from '../lib/redis.js';

// Fixed-window rate limiting, backed by Redis with an in-memory fallback.
//
// Three things were wrong with the previous implementation, and all three made
// the brute-force protection ineffective rather than merely weak:
//
//   1. It read `x-forwarded-for` straight off the request. That header is
//      attacker-controlled unless a trusted proxy rewrote it, so rotating it
//      per request gave every attempt its own bucket — 30 out of 30 wrong
//      passwords sailed past a limiter set to 20. Now the client address comes
//      from `req.ip`, which Express derives from the header only as far as the
//      configured `trust proxy` hop count (see app.js).
//   2. It counted *successful* requests too, so an office behind one NAT
//      locked its own users out after 20 sign-ins in 15 minutes. Limiters that
//      exist to stop credential guessing now count only failures.
//   3. It was per-IP only. A password spray from a botnet never hits the same
//      bucket twice, so the account under attack was never protected. Limiters
//      can now add a second, subject-scoped bucket (the email being tried).
//
// In-memory state is kept as the fallback because Redis is allowed to be down
// in development, and a limiter that fails open on an unreachable cache is a
// limiter that is not there at all.

// The in-memory fallback, with the same semantics as the Redis path: a fixed
// window per key that starts at the first hit, an increment that returns the
// new count in the same step (INCR), and a refund that never goes below zero
// or touches a later window. Every operation is synchronous, so two requests
// on one event loop can never interleave between the read and the write of a
// counter. Memory is bounded: past `maxKeys` the expired windows are swept,
// then the oldest windows are evicted (Map iteration order is insertion order,
// and a key is re-inserted whenever its window restarts).
export class MemoryRateStore {
  constructor({ maxKeys = 50_000, now = Date.now } = {}) {
    this.maxKeys = maxKeys;
    this.now = now;
    this.buckets = new Map();
  }

  get size() { return this.buckets.size; }

  // Increment-and-return in one step. `windowId` identifies the window the
  // hit landed in, so a later refund can be matched to it.
  hit(key, windowMs) {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (bucket) this.buckets.delete(key);
      else if (this.buckets.size >= this.maxKeys) this.evict(now);
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return { count: bucket.count, resetAt: bucket.resetAt, windowId: bucket.resetAt };
  }

  // Refund one hit. Without a matching `windowId` a refund that arrives after
  // the window rolled over would spend down the next window's attempts.
  unhit(key, windowId = null) {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= this.now() || bucket.count <= 0) return;
    if (windowId !== null && bucket.resetAt !== windowId) return;
    bucket.count -= 1;
  }

  peek(key) {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= this.now()) return null;
    return { count: bucket.count, resetAt: bucket.resetAt };
  }

  sweep(now = this.now()) {
    for (const [key, b] of this.buckets) {
      if (b.resetAt <= now) this.buckets.delete(key);
    }
  }

  evict(now) {
    this.sweep(now);
    // Still full of live windows (a flood of distinct addresses): drop the
    // oldest tenth in one go so the sweep is not repeated on every new key.
    if (this.buckets.size < this.maxKeys) return;
    let drop = Math.max(1, Math.ceil(this.maxKeys / 10));
    for (const key of this.buckets.keys()) {
      this.buckets.delete(key);
      drop -= 1;
      if (drop === 0) break;
    }
  }
}

const memory = new MemoryRateStore();
setInterval(() => memory.sweep(), 60_000).unref();

// Redis is authoritative when reachable so the limit holds across restarts and
// across every instance of the service. A failure here falls back to the
// in-memory counter rather than letting the request through uncounted.
//
// INCR, the first-hit expiry and the TTL read go in one MULTI so a failure
// cannot land between an increment and the read that follows it (which used
// to count the attempt in Redis *and* again in memory).
async function hitRedis(key, windowMs) {
  const ttlSec = Math.ceil(windowMs / 1000);
  const [count, , ttl] = await redis.multi().incr(key).expire(key, ttlSec, 'NX').pttl(key).exec()
    .then((replies) => replies.map(([err, value]) => { if (err) throw err; return value; }));
  return { count: Number(count), resetAt: Date.now() + (ttl > 0 ? ttl : windowMs), windowId: null };
}

// Never below zero, and never on a key that has already expired — a bare DECR
// there would create a counter with no TTL.
const UNHIT_SCRIPT = "local v = redis.call('GET', KEYS[1]) if v and tonumber(v) > 0 then return redis.call('DECR', KEYS[1]) end return 0";

async function unhitRedis(key) {
  await redis.eval(UNHIT_SCRIPT, 1, key);
}

async function peekRedis(key) {
  const [count, ttl] = await Promise.all([redis.get(key), redis.pttl(key)]);
  if (count === null) return null;
  return { count: Number(count), resetAt: Date.now() + (ttl > 0 ? ttl : 0) };
}

// The catches below are deliberately quiet: a Redis outage is already
// reported by the connection's error listener, and the request is still
// counted, in memory.
async function hit(key, windowMs) {
  try {
    if (redis.status === 'ready') return await hitRedis(key, windowMs);
  } catch { /* fall through to memory */ }
  return memory.hit(key, windowMs);
}

// `state` is the value hit() returned, so a refund goes back to the store and
// the window that took the hit.
async function unhit(key, state) {
  if (state && state.windowId !== null) return memory.unhit(key, state.windowId);
  try {
    if (redis.status === 'ready') return await unhitRedis(key);
  } catch { /* fall through to memory */ }
  return memory.unhit(key);
}

async function peek(key) {
  try {
    if (redis.status === 'ready') return await peekRedis(key);
  } catch { /* fall through to memory */ }
  return memory.peek(key);
}

// The bucket a request's client address falls into.
//
// IPv4-mapped IPv6 (`::ffff:1.2.3.4`) collapses to the IPv4 address so a
// dual-stack listener does not give one client two buckets. A native IPv6
// client is bucketed by its /64: a single subscriber is routinely handed a
// whole /64, so keying on the full address would let them rotate through
// 2^64 fresh buckets.
export function clientBucket(ip) {
  if (typeof ip !== 'string' || !ip) return 'unknown';
  let addr = ip.trim().toLowerCase();
  const zone = addr.indexOf('%');
  if (zone !== -1) addr = addr.slice(0, zone);
  if (addr.startsWith('::ffff:') && addr.includes('.')) return addr.slice(7);
  if (!addr.includes(':')) return addr;

  const [head, tail = ''] = addr.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = addr.includes('::') ? 8 - headGroups.length - tailGroups.length : 0;
  const groups = [...headGroups, ...Array(Math.max(0, missing)).fill('0'), ...tailGroups];
  if (groups.length < 4) return addr;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

// Behind a proxy with `trust proxy` left at 0, req.ip is the proxy itself and
// every user shares one bucket. Say so once, loudly, the first time we see a
// forwarded request — the boot-time check in app.js only covers production.
let warnedUntrustedForward = false;
function warnIfForwardedButUntrusted(req) {
  if (warnedUntrustedForward || !req.headers?.['x-forwarded-for']) return;
  const trust = req.app?.get?.('trust proxy');
  if (trust && trust !== 0) return;
  warnedUntrustedForward = true;
  console.warn(
    '[RateLimit] Requests arrive with X-Forwarded-For but TRUST_PROXY_HOPS is 0: every client is being '
    + 'rate-limited as the proxy address. Set TRUST_PROXY_HOPS to the number of proxies in front of the app.',
  );
}

function tooMany(res, resetAt) {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  res.setHeader('Retry-After', String(retryAfter));
  return res.status(429).json({
    error: 'Too many attempts. Please wait a moment and try again.',
    retryAfterSeconds: retryAfter,
  });
}

/**
 * @param {object}   opts
 * @param {number}   opts.windowMs
 * @param {number}   opts.max            attempts allowed per window
 * @param {string}   opts.keyPrefix
 * @param {boolean}  opts.countFailuresOnly  only count responses with status >= 400
 * @param {(req) => string|null} opts.subject  optional second bucket (e.g. the
 *                                             email being tried), so a spray
 *                                             across many IPs still trips.
 * @param {number}   opts.subjectMax     allowance for the subject bucket
 * @param {(req) => string|null} opts.by  replaces the client address as the
 *                                        primary bucket (e.g. the API key), for
 *                                        callers whose identity is not an IP.
 *                                        Falls back to the address when it
 *                                        returns nothing.
 */
export function rateLimit({
  windowMs = 60_000,
  max = 20,
  keyPrefix = 'rl',
  countFailuresOnly = false,
  subject = null,
  subjectMax = null,
  by = null,
} = {}) {
  return async (req, res, next) => {
    // `req.ip` respects app.set('trust proxy', …) — it is only taken from
    // X-Forwarded-For for as many hops as we have actually configured.
    warnIfForwardedButUntrusted(req);
    // `by` keys the limit to an identity (an API key) instead of the address.
    const identity = by ? by(req) : null;
    const ip = clientBucket(req.ip || req.socket?.remoteAddress);
    const ipKey = identity ? `rl:${keyPrefix}:id:${identity}` : `rl:${keyPrefix}:ip:${ip}`;
    const subjectValue = subject ? subject(req) : null;
    const subjectKey = subjectValue ? `rl:${keyPrefix}:sub:${subjectValue}` : null;

    // Already over the line? Refuse before doing any work.
    const [ipState, subState] = await Promise.all([peek(ipKey), subjectKey ? peek(subjectKey) : null]);
    if (ipState && ipState.count >= max) return tooMany(res, ipState.resetAt);
    if (subState && subjectMax && subState.count >= subjectMax) return tooMany(res, subState.resetAt);

    // The decision is always taken on the count the increment itself
    // returned, never on the peek above: a parallel burst all passes the peek
    // together, but each request gets its own distinct count back.
    if (!countFailuresOnly) {
      const [hits, subHits] = await Promise.all([hit(ipKey, windowMs), subjectKey ? hit(subjectKey, windowMs) : null]);
      if (hits.count > max) return tooMany(res, hits.resetAt);
      if (subHits && subjectMax && subHits.count > subjectMax) return tooMany(res, subHits.resetAt);
      return next();
    }

    // Count only failures: a correct password must never spend a legitimate
    // user's allowance, but every wrong one has to be paid for. The attempt is
    // counted *before* it runs and refunded if it succeeds — counting after
    // the response let a parallel burst all pass the check before any of its
    // failures had been recorded.
    const [ipHits, subHits] = await Promise.all([hit(ipKey, windowMs), subjectKey ? hit(subjectKey, windowMs) : null]);
    // A failed refund only over-counts (fails closed), and Redis errors are
    // already logged by the client, so these are best-effort.
    const refund = () => {
      unhit(ipKey, ipHits).catch(() => {});
      if (subjectKey) unhit(subjectKey, subHits).catch(() => {});
    };
    if (ipHits.count > max) { refund(); return tooMany(res, ipHits.resetAt); }
    if (subHits && subjectMax && subHits.count > subjectMax) { refund(); return tooMany(res, subHits.resetAt); }

    res.on('finish', () => {
      if (res.statusCode < 400 || res.statusCode === 429) refund();
    });
    next();
  };
}

// The API key a request authenticated with, as a rateLimit `by` identity, so a
// public-API limit follows the key rather than whichever address it calls from.
// authenticateApiKey must run first.
export const apiKeyIdentity = (req) => (req.apiKey?.id ? `key:${req.apiKey.id}` : null);

// The phone number named in body[field], scoped to the sending workspace, so
// one recipient cannot be flooded however many keys or addresses are used.
export const recipientIdentity = (field) => (req) => {
  const digits = String(req.body?.[field] ?? '').replace(/\D/g, '');
  return digits && req.workspaceId ? `${req.workspaceId}:${digits}` : null;
};

// Shared subject extractor: the account an auth attempt names. Normalised the
// same way auth.service.js normalises emails, so "A@x.com" and "a@x.com" share
// one lockout rather than two.
export const emailSubject = (req) => {
  const email = req.body?.email;
  return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
};
