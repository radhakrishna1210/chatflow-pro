import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

// Redirect handling and body capping, with the HTTP client faked so no socket
// is opened. The connect-time address check is covered in safeUrl.test.js.

let responses;
const requested = [];
mock.module('axios', {
  defaultExport: {
    request: async (config) => {
      requested.push(config);
      const next = responses.shift();
      if (typeof next === 'function') return next(config);
      return next;
    },
  },
});

const { safeRequest, UnsafeUrlError } = await import('./safeUrl.js');

test('a redirect to a private address is refused before it is requested', async () => {
  requested.length = 0;
  responses = [{ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' }, data: Buffer.alloc(0) }];
  await assert.rejects(safeRequest('https://example.com/', { maxRedirects: 3 }), UnsafeUrlError);
  assert.equal(requested.length, 1);
});

test('with no redirect allowance the 3xx is returned, not followed', async () => {
  requested.length = 0;
  responses = [{ status: 301, headers: { location: 'https://example.org/' }, data: Buffer.alloc(0) }];
  const res = await safeRequest('https://example.com/hook', { method: 'POST', data: '{}' });
  assert.equal(res.status, 301);
  assert.equal(requested.length, 1);
  assert.equal(requested[0].maxRedirects, 0);
  assert.equal(requested[0].proxy, false);
});

test('redirects are followed up to the limit, each one re-vetted', async () => {
  requested.length = 0;
  responses = [
    { status: 302, headers: { location: '/a' }, data: Buffer.alloc(0) },
    { status: 302, headers: { location: 'https://example.org/b' }, data: Buffer.alloc(0) },
    { status: 200, headers: { 'content-type': 'text/html' }, data: Buffer.from('ok') },
  ];
  const res = await safeRequest('https://example.com/', { maxRedirects: 2 });
  assert.equal(res.status, 200);
  assert.equal(res.url, 'https://example.org/b');
  assert.deepEqual(requested.map((r) => r.url), ['https://example.com/', 'https://example.com/a', 'https://example.org/b']);
});

test('truncate cuts an oversized body at maxBytes instead of failing', async () => {
  responses = [{ status: 200, headers: {}, data: Readable.from([Buffer.alloc(6, 'a'), Buffer.alloc(6, 'b')]) }];
  const res = await safeRequest('https://example.com/', { truncate: true, maxBytes: 8 });
  assert.equal(res.data.toString(), 'aaaaaabb');
});

test('a connect-time refusal surfaces as UnsafeUrlError', async () => {
  responses = [() => { const e = new Error('blocked'); e.code = 'EUNSAFEADDR'; throw e; }];
  await assert.rejects(safeRequest('https://rebind.example/'), UnsafeUrlError);
});
