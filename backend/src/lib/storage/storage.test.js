import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDiskDriver } from './disk.js';
import { createS3Driver } from './s3.js';
import { storageConfigFrom, ephemeralDiskWarning, keys, DEFAULT_DISK_ROOT } from './index.js';
import { sha256Hex } from './sigv4.js';

// ── disk driver ──────────────────────────────────────────────────────────────

test('disk: put, head, get, getBuffer and delete round-trip under the root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cf-storage-'));
  try {
    const disk = createDiskDriver({ root });
    const key = 'workspaces/ws_1/messages/m_1';
    await disk.put(key, Buffer.from('hello'), { contentType: 'text/plain' });

    assert.deepEqual(await disk.head(key), { size: 5, contentType: null });
    assert.equal((await disk.getBuffer(key)).toString(), 'hello');
    assert.equal(await readFile(path.join(root, 'workspaces', 'ws_1', 'messages', 'm_1'), 'utf8'), 'hello');

    const obj = await disk.get(key);
    const chunks = [];
    for await (const c of obj.stream) chunks.push(c);
    assert.equal(Buffer.concat(chunks).toString(), 'hello');
    assert.equal(obj.size, 5);

    const listed = [];
    for await (const k of disk.list()) listed.push(k);
    assert.deepEqual(listed, [key]);

    await disk.delete(key);
    assert.equal(await disk.head(key), null);
    assert.equal(await disk.getBuffer(key), null);
    assert.equal(await disk.get(key), null);
    await disk.delete(key); // idempotent
    assert.equal(await disk.signedUrl(key), null, 'disk has no URL to hand out');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('disk: a key cannot escape the root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cf-storage-'));
  try {
    const disk = createDiskDriver({ root });
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'a//b', '', 'a\\..\\..\\x']) {
      await assert.rejects(() => disk.put(bad, Buffer.from('x')), /Invalid storage key/, bad);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── s3 driver (fetch stubbed) ────────────────────────────────────────────────

function fakeFetch(responder) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, ...init });
    return responder(url, init);
  };
  return { impl, calls };
}

const R2 = {
  driver: 's3',
  bucket: 'media',
  region: 'auto',
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  accessKeyId: 'AKID',
  secretAccessKey: 'SECRET',
  prefix: '',
};

test('s3: put sends a signed PUT with the body hash, path-style on a custom endpoint', async () => {
  const { impl, calls } = fakeFetch(() => new Response('', { status: 200 }));
  const s3 = createS3Driver(R2, { fetch: impl, now: () => new Date('2026-10-03T10:00:00Z') });
  const body = Buffer.from('voice-bytes');
  await s3.put('workspaces/ws_1/messages/m 1', body, { contentType: 'audio/ogg' });

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.method, 'PUT');
  assert.equal(call.url, 'https://acct.r2.cloudflarestorage.com/media/workspaces/ws_1/messages/m%201');
  assert.equal(call.headers['x-amz-content-sha256'], sha256Hex(body));
  assert.equal(call.headers['content-type'], 'audio/ogg');
  assert.equal(call.headers.host, undefined, 'fetch sets Host from the URL');
  assert.match(call.headers.Authorization,
    /^AWS4-HMAC-SHA256 Credential=AKID\/20261003\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
});

test('s3: Supabase-style endpoint path prefix is kept and signed; S3_PREFIX is applied', async () => {
  const { impl, calls } = fakeFetch(() => new Response(null, { status: 404 }));
  const s3 = createS3Driver({
    ...R2, endpoint: 'https://ref.supabase.co/storage/v1/s3/', region: 'ap-south-1', prefix: 'prod/',
  }, { fetch: impl });
  assert.equal(await s3.head('a/b'), null);
  assert.equal(calls[0].url, 'https://ref.supabase.co/storage/v1/s3/media/prod/a/b');
  assert.equal(calls[0].method, 'HEAD');
});

test('s3: AWS without an endpoint uses virtual-hosted addressing', async () => {
  const { impl, calls } = fakeFetch(() => new Response('abc', { status: 200, headers: { 'content-type': 'image/png', 'content-length': '3' } }));
  const s3 = createS3Driver({ ...R2, endpoint: null, region: 'ap-south-1' }, { fetch: impl });
  const buf = await s3.getBuffer('k.png');
  assert.equal(buf.toString(), 'abc');
  assert.equal(calls[0].url, 'https://media.s3.ap-south-1.amazonaws.com/k.png');

  const obj = await s3.get('k.png');
  const chunks = [];
  for await (const c of obj.stream) chunks.push(c);
  assert.equal(Buffer.concat(chunks).toString(), 'abc');
  assert.equal(obj.contentType, 'image/png');
});

test('s3: missing objects are null; refusals throw with the S3 error code', async () => {
  const { impl } = fakeFetch((url, init) => (init.method === 'GET'
    ? new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 })
    : new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 })));
  const s3 = createS3Driver(R2, { fetch: impl });
  assert.equal(await s3.get('nope'), null);
  assert.equal(await s3.getBuffer('nope'), null);
  await assert.rejects(() => s3.put('k', Buffer.from('x')), (err) => err.code === 'AccessDenied' && /HTTP 403/.test(err.message));
});

test('s3: an unreachable endpoint becomes a storage error, not a raw fetch failure', async () => {
  const s3 = createS3Driver(R2, { fetch: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(() => s3.getBuffer('k'), (err) => err.code === 'STORAGE_ERROR' && /unreachable/.test(err.message));
});

test('s3: delete tolerates a missing object', async () => {
  const { impl, calls } = fakeFetch(() => new Response(null, { status: 404 }));
  const s3 = createS3Driver(R2, { fetch: impl });
  await s3.delete('gone');
  assert.equal(calls[0].method, 'DELETE');
});

test('s3: signedUrl presigns a GET with response overrides and only host signed', async () => {
  const s3 = createS3Driver(R2, { fetch: async () => { throw new Error('no network for presign'); }, now: () => new Date('2026-10-03T10:00:00Z') });
  const url = new URL(await s3.signedUrl('workspaces/ws/messages/m1', { expiresIn: 300, contentType: 'audio/ogg', filename: 'note "1".ogg' }));
  assert.equal(url.origin + url.pathname, 'https://acct.r2.cloudflarestorage.com/media/workspaces/ws/messages/m1');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert.equal(url.searchParams.get('response-content-type'), 'audio/ogg');
  assert.equal(url.searchParams.get('response-content-disposition'), 'inline; filename="note _1_.ogg"');
  assert.match(url.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);
});

test('s3: keys that could address another object are refused', async () => {
  const s3 = createS3Driver(R2, { fetch: async () => new Response('') });
  await assert.rejects(() => s3.put('../x', Buffer.from('x')), /Invalid storage key/);
  await assert.rejects(() => s3.put('/x', Buffer.from('x')), /Invalid storage key/);
});

// ── configuration ────────────────────────────────────────────────────────────

test('config: disk is the default; S3_BUCKET selects s3; STORAGE_DRIVER pins', () => {
  assert.deepEqual(storageConfigFrom({}), { driver: 'disk', root: DEFAULT_DISK_ROOT });
  const s3 = storageConfigFrom({ S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's', S3_ENDPOINT: 'https://x', S3_PREFIX: '/env/' });
  assert.equal(s3.driver, 's3');
  assert.equal(s3.region, 'auto', 'a custom endpoint defaults to region auto (R2)');
  assert.equal(s3.prefix, 'env/');
  assert.equal(storageConfigFrom({ S3_BUCKET: 'b', STORAGE_DRIVER: 'disk' }).driver, 'disk');
  assert.throws(() => storageConfigFrom({ STORAGE_DRIVER: 's3', S3_BUCKET: 'b' }), /S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY are not set/);
  assert.throws(() => storageConfigFrom({ STORAGE_DRIVER: 'ftp' }), /must be "s3" or "disk"/);
});

test('boot warning: only for the disk driver in production on Render', () => {
  assert.match(ephemeralDiskWarning({ NODE_ENV: 'production', RENDER: 'true' }), /WIPED on every deploy/);
  assert.equal(ephemeralDiskWarning({ NODE_ENV: 'production' }), null, 'the VPS disk persists');
  assert.equal(ephemeralDiskWarning({ NODE_ENV: 'development', RENDER: 'true' }), null);
  assert.equal(ephemeralDiskWarning({
    NODE_ENV: 'production', RENDER: 'true', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's',
  }), null);
  assert.match(ephemeralDiskWarning({ NODE_ENV: 'production', STORAGE_DRIVER: 's3' }), /Misconfigured/);
});

test('keys are scoped by workspace and sanitised', () => {
  assert.equal(keys.messageMedia('ws_1', 'cm1'), 'workspaces/ws_1/messages/cm1');
  assert.equal(keys.templateAsset('ws/../x', 'id'), 'workspaces/ws_.._x/template-assets/id');
});
