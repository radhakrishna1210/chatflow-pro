import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { rateLimit, emailSubject } from './rateLimit.js';

// Minimal req/res doubles: enough for the limiter, which only reads req.ip /
// req.body and writes status/json/headers, and listens for 'finish'.
function fakeReq(body = {}) {
  return { ip: '203.0.113.7', body, socket: {} };
}
function fakeRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (s) => { res.statusCode = s; return res; };
  res.json = () => res;
  return res;
}

// Runs one request through the limiter. `outcome` is the status the handler
// would answer with if it is reached.
function attempt(limiter, body, outcome, { finishDelayMs = 0 } = {}) {
  return new Promise((resolve) => {
    const req = fakeReq(body);
    const res = fakeRes();
    let reached = false;
    limiter(req, res, () => {
      reached = true;
      setTimeout(() => { res.statusCode = outcome; res.emit('finish'); resolve({ reached, status: outcome }); }, finishDelayMs);
    }).then(() => { if (!reached) resolve({ reached, status: res.statusCode }); });
  });
}

test('countFailuresOnly: a burst of simultaneous failures cannot exceed the allowance', async () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 5, keyPrefix: `t-burst-${Date.now()}`, countFailuresOnly: true });
  // Every handler is still "running" when the next request arrives — the shape
  // of an attacker firing hundreds of guesses at once.
  const results = await Promise.all(Array.from({ length: 30 }, () => attempt(limiter, {}, 401, { finishDelayMs: 50 })));
  assert.equal(results.filter((r) => r.reached).length, 5);
  assert.equal(results.filter((r) => r.status === 429).length, 25);
});

test('countFailuresOnly: successful attempts are refunded', async () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 3, keyPrefix: `t-refund-${Date.now()}`, countFailuresOnly: true });
  for (let i = 0; i < 10; i++) {
    const r = await attempt(limiter, {}, 200);
    assert.equal(r.reached, true, `success #${i + 1} was limited`);
    await new Promise((resolve) => setTimeout(resolve, 5)); // let the refund land
  }
});

test('subject bucket trips for one account even across fresh IP buckets', async () => {
  const prefix = `t-subject-${Date.now()}`;
  const limiter = rateLimit({ windowMs: 60_000, max: 100, keyPrefix: prefix, countFailuresOnly: true, subject: emailSubject, subjectMax: 3 });
  const outcomes = [];
  for (let i = 0; i < 6; i++) outcomes.push((await attempt(limiter, { email: 'Victim@Example.com ' }, 401)).status);
  assert.deepEqual(outcomes, [401, 401, 401, 429, 429, 429]);
});
