import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('../config/env.js', { namedExports: { env: { NODE_ENV: 'production' } } });

const { errorHandler } = await import('./errorHandler.js');

function run(err) {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const origWarn = console.warn;
  const origError = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    errorHandler(err, { method: 'DELETE', url: '/x' }, res, () => {});
  } finally {
    console.warn = origWarn;
    console.error = origError;
  }
  return res;
}

test('a foreign-key refusal (P2003) is a 409 conflict, not a 500', () => {
  const err = Object.assign(new Error('Foreign key constraint failed on the field: `Campaign_templateId_fkey (index)`'), {
    code: 'P2003',
    meta: { field_name: 'Campaign_templateId_fkey (index)' },
  });
  const res = run(err);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'FOREIGN_KEY_CONFLICT');
  assert.doesNotMatch(res.body.error, /Campaign_templateId_fkey/);
});

test('unexpected errors never carry internal detail outside development', () => {
  const res = run(new Error('relation "Secret" does not exist'));
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.detail, undefined);
  assert.ok(res.body.reference);
});
