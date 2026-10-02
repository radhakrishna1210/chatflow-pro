import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  ipIsPublic, assertSafeUrl, createSafeLookup, safeRequest, UnsafeUrlError,
} from './safeUrl.js';

test('private, loopback, link-local and metadata IPv4 ranges are not public', () => {
  for (const ip of [
    '0.0.0.0', '10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '100.64.0.1', '198.18.0.1', '192.0.0.1', '224.0.0.1', '255.255.255.255',
  ]) assert.equal(ipIsPublic(ip), false, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '157.240.1.1']) assert.equal(ipIsPublic(ip), true, ip);
});

test('IPv6 loopback, ULA, link-local and every IPv4-in-IPv6 form are judged correctly', () => {
  for (const ip of [
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '2001:db8::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '[::ffff:169.254.169.254]',
    '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '::127.0.0.1', '::ffff:0:10.0.0.1', 'not-an-ip',
  ]) assert.equal(ipIsPublic(ip), false, ip);
  for (const ip of ['2606:4700:4700::1111', '::ffff:8.8.8.8', '2a03:2880:f12f:83:face:b00c::25de']) {
    assert.equal(ipIsPublic(ip), true, ip);
  }
});

test('assertSafeUrl rejects bad schemes, internal names and private literals', () => {
  for (const raw of [
    'file:///etc/passwd', 'gopher://x', 'ftp://example.com', 'not a url',
    'http://localhost:6379/', 'http://foo.localhost/', 'http://metadata.google.internal/',
    'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f.1/', 'http://[::1]/',
    'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/latest/meta-data/', 'http://printer.local/',
  ]) assert.throws(() => assertSafeUrl(raw), UnsafeUrlError, raw);
  assert.equal(assertSafeUrl('https://example.com/hook').hostname, 'example.com');
  assert.throws(() => assertSafeUrl('http://example.com', { protocols: ['https:'] }), UnsafeUrlError);
});

const fakeResolver = (answers) => (host, opts, cb) => cb(null, answers[host] ?? []);

test('safeLookup refuses a name if any address it resolves to is private', async () => {
  const lookup = createSafeLookup(fakeResolver({
    'rebind.test': [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }],
    'meta.test': [{ address: '169.254.169.254', family: 4 }],
    'ok.test': [{ address: '93.184.216.34', family: 4 }],
    'v6.test': [{ address: 'fd00::1', family: 6 }],
  }));
  const run = (host, opts) => new Promise((resolve) => lookup(host, opts, (err, addr, fam) => resolve({ err, addr, fam })));

  assert.equal((await run('rebind.test', {})).err.code, 'EUNSAFEADDR');
  assert.equal((await run('meta.test', {})).err.code, 'EUNSAFEADDR');
  assert.equal((await run('v6.test', {})).err.code, 'EUNSAFEADDR');
  assert.equal((await run('nothing.test', {})).err.code, 'EUNSAFEADDR');

  const ok = await run('ok.test', {});
  assert.equal(ok.err, null);
  assert.equal(ok.addr, '93.184.216.34');
  assert.equal(ok.fam, 4);

  const all = await run('ok.test', { all: true });
  assert.deepEqual(all.addr, [{ address: '93.184.216.34', family: 4 }]);
});

test('safeRequest never connects to a loopback server, by literal or by name', async () => {
  let hits = 0;
  const server = http.createServer((req, res) => { hits += 1; res.end('secret'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    await assert.rejects(safeRequest(`http://127.0.0.1:${port}/`), UnsafeUrlError);
    await assert.rejects(safeRequest(`http://localhost:${port}/`), UnsafeUrlError);
    assert.equal(hits, 0);
  } finally {
    server.close();
  }
});
