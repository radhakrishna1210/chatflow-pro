import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

let answerVerifyChallenge;

test.before(async () => {
  mock.module('../config/env.js', { namedExports: { env: { META_WEBHOOK_VERIFY_TOKEN: 'verify-me' } } });
  mock.module('../services/webhook.service.js', { namedExports: { processWebhook: async () => {} } });
  ({ answerVerifyChallenge } = await import('./webhook.controller.js'));
});

function call(query) {
  const res = {
    statusCode: null, contentType: null, body: null,
    status(c) { this.statusCode = c; return this; },
    type(t) { this.contentType = t; return this; },
    send(b) { this.body = b; return this; },
    json(b) { this.body = b; return this; },
  };
  answerVerifyChallenge({ query }, res);
  return res;
}

test('the challenge is echoed as plain text, never HTML', () => {
  const res = call({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '<script>x</script>' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.contentType, 'text/plain');
  assert.equal(res.body, '<script>x</script>');
});

test('a wrong, missing or differently sized token is refused', () => {
  for (const token of ['verify-mf', undefined, 'verify', ['verify-me']]) {
    assert.equal(call({ 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': '1' }).statusCode, 403);
  }
  assert.equal(call({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '1' }).statusCode, 403);
});
