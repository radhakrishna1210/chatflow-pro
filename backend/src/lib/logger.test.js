import test from 'node:test';
import assert from 'node:assert/strict';
import { redactUrl } from './logger.js';

test('invite tokens in the path are redacted', () => {
  assert.equal(redactUrl('/api/v1/invitations/abc123secret'), '/api/v1/invitations/[redacted]');
  assert.equal(redactUrl('/api/v1/invitations/abc123secret/accept'), '/api/v1/invitations/[redacted]/accept');
  // A workspace's own invitation ids are not secrets and keep their place.
  assert.equal(redactUrl('/api/v1/workspaces/w1/invitations/i1/resend'), '/api/v1/workspaces/w1/invitations/i1/resend');
});

test('credential query values are redacted, others kept', () => {
  assert.equal(
    redactUrl('/api/v1/auth/google/callback?state=eyJ.x&code=4/abc&scope=email'),
    '/api/v1/auth/google/callback?state=[redacted]&code=[redacted]&scope=email',
  );
  assert.equal(
    redactUrl('/api/v1/webhook?hub.mode=subscribe&hub.verify_token=s3cret&hub.challenge=123'),
    '/api/v1/webhook?hub.mode=subscribe&hub.verify_token=[redacted]&hub.challenge=[redacted]',
  );
  assert.equal(redactUrl('/invite/accept?token=t0k'), '/invite/accept?token=[redacted]');
  assert.equal(redactUrl('/auth/callback?code=deadbeef'), '/auth/callback?code=[redacted]');
  assert.equal(redactUrl('/x?api_key=k&page=2'), '/x?api_key=[redacted]&page=2');
});

test('the query can be dropped entirely', () => {
  assert.equal(redactUrl('/api/v1/contacts?q=Jane%20Doe&page=1', { query: false }), '/api/v1/contacts');
});

test('odd input does not throw', () => {
  assert.equal(redactUrl(undefined), '');
  assert.equal(redactUrl('/p?%E0%A4%A=1&flag'), '/p?%E0%A4%A=1&flag');
});
