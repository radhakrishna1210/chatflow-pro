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

const buckets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref();

function hitMemory(key, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return { count: bucket.count, resetAt: bucket.resetAt };
}

function peekMemory(key) {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= Date.now()) return null;
  return { count: bucket.count, resetAt: bucket.resetAt };
}

// Redis is authoritative when reachable so the limit holds across restarts and
// across every instance of the service. A failure here falls back to the
// in-memory counter rather than letting the request through uncounted.
async function hitRedis(key, windowMs) {
  const ttlSec = Math.ceil(windowMs / 1000);
  const [count] = await redis.multi().incr(key).expire(key, ttlSec, 'NX').exec()
    .then((replies) => replies.map(([err, value]) => { if (err) throw err; return value; }));
  const ttl = await redis.pttl(key);
  return { count: Number(count), resetAt: Date.now() + (ttl > 0 ? ttl : windowMs) };
}

async function peekRedis(key) {
  const [count, ttl] = await Promise.all([redis.get(key), redis.pttl(key)]);
  if (count === null) return null;
  return { count: Number(count), resetAt: Date.now() + (ttl > 0 ? ttl : 0) };
}

async function hit(key, windowMs) {
  try {
    if (redis.status === 'ready') return await hitRedis(key, windowMs);
  } catch { /* fall through to memory */ }
  return hitMemory(key, windowMs);
}

async function peek(key) {
  try {
    if (redis.status === 'ready') return await peekRedis(key);
  } catch { /* fall through to memory */ }
  return peekMemory(key);
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
 */
export function rateLimit({
  windowMs = 60_000,
  max = 20,
  keyPrefix = 'rl',
  countFailuresOnly = false,
  subject = null,
  subjectMax = null,
} = {}) {
  return async (req, res, next) => {
    // `req.ip` respects app.set('trust proxy', …) — it is only taken from
    // X-Forwarded-For for as many hops as we have actually configured.
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const ipKey = `rl:${keyPrefix}:ip:${ip}`;
    const subjectValue = subject ? subject(req) : null;
    const subjectKey = subjectValue ? `rl:${keyPrefix}:sub:${subjectValue}` : null;

    // Already over the line? Refuse before doing any work.
    const [ipState, subState] = await Promise.all([peek(ipKey), subjectKey ? peek(subjectKey) : null]);
    if (ipState && ipState.count >= max) return tooMany(res, ipState.resetAt);
    if (subState && subjectMax && subState.count >= subjectMax) return tooMany(res, subState.resetAt);

    if (!countFailuresOnly) {
      const hits = await hit(ipKey, windowMs);
      if (subjectKey) await hit(subjectKey, windowMs);
      if (hits.count > max) return tooMany(res, hits.resetAt);
      return next();
    }

    // Count only failures: a correct password must never spend a legitimate
    // user's allowance, but every wrong one has to be paid for.
    res.on('finish', () => {
      if (res.statusCode < 400 || res.statusCode === 429) return;
      hit(ipKey, windowMs).catch(() => {});
      if (subjectKey) hit(subjectKey, windowMs).catch(() => {});
    });
    next();
  };
}

// Shared subject extractor: the account an auth attempt names. Normalised the
// same way auth.service.js normalises emails, so "A@x.com" and "a@x.com" share
// one lockout rather than two.
export const emailSubject = (req) => {
  const email = req.body?.email;
  return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
};
