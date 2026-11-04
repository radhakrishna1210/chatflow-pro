import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import dns from 'node:dns/promises';
import { ipIsPublic, assertSafeUrl, safeFetch, safeLookup } from './siteCrawler.js';

// The crawler (website analysis) and the widget knowledge indexer fetch URLs a
// tenant typed. Every way of naming a private address must be refused.

test('private and special-purpose addresses are not public, in every textual form', () => {
  for (const ip of [
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '198.18.0.1',
    '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', 'ff02::1',
    // Node's URL parser turns [::ffff:127.0.0.1] into this hex form; the old
    // prefix check on "::ffff:a.b.c.d" let it through to localhost.
    '::ffff:7f00:1', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe', '::7f00:1',
    '64:ff9b::a9fe:a9fe', '2002:a00:1::', '2001:0:4136:e378::1',
  ]) assert.equal(ipIsPublic(ip), false, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) assert.equal(ipIsPublic(ip), true, ip);
});

test('assertSafeUrl refuses private literals, odd schemes and credentials', () => {
  for (const url of [
    'http://[::ffff:127.0.0.1]:6379/', 'http://[::ffff:7f00:1]/', 'http://127.1/', 'http://0x7f.1/', 'http://2130706433/',
    'http://169.254.169.254/latest/meta-data/', 'http://localhost./', 'http://svc.internal/', 'file:///etc/passwd',
    'gopher://example.com/', 'http://user:pw@example.com/',
  ]) assert.throws(() => assertSafeUrl(url), undefined, url);
  assert.equal(assertSafeUrl('https://example.com/a').hostname, 'example.com');
});

test('safeLookup refuses a name with any private answer, including mixed answers', async () => {
  const lookup = mock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]);
  try {
    const err = await new Promise((resolve) => safeLookup('rebind.example', { all: true }, (e) => resolve(e)));
    assert.match(String(err?.message), /private network/);
  } finally {
    lookup.mock.restore();
  }
});

test('a hostname resolving to loopback never gets a connection (DNS pinned at connect time)', async () => {
  let hits = 0;
  const server = http.createServer((req, res) => { hits += 1; res.end('secret'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  // First answer public, then loopback: a check-then-fetch implementation
  // validates the first and connects to the second.
  let n = 0;
  const lookup = mock.method(dns, 'lookup', async () => (n++ === 0
    ? [{ address: '93.184.216.34', family: 4 }]
    : [{ address: '127.0.0.1', family: 4 }]));
  try {
    await assert.rejects(safeFetch(`http://rebind.example:${port}/`), (err) => err.status === 400 || err.status === 502);
    assert.equal(hits, 0, 'the internal server was never reached');
  } finally {
    lookup.mock.restore();
    server.close();
  }
});

test('the connection itself resolves through the vetted lookup, on a fresh socket', async () => {
  const seen = [];
  const request = mock.method(http, 'request', (url, options) => {
    seen.push(options);
    const req = new EventEmitter();
    req.end = () => setImmediate(() => req.emit('error', new Error('stop')));
    req.destroy = () => {};
    return req;
  });
  try {
    await assert.rejects(safeFetch('http://example.com/'), (err) => err.status === 502);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].lookup, safeLookup, 'DNS answer checked is the address dialled');
    assert.equal(seen[0].agent, false, 'no pooled socket skips the check');
  } finally {
    request.mock.restore();
  }
});
