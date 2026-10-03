import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDiskDriver } from './disk.js';
import { copyDiskToBucket, copyTemplateAssetsToBucket, messageContentTypeLookup } from './migrate.js';

// The one-off move from local disk / Postgres into the bucket must be safe to
// run twice and to resume after an interruption.

function memoryBucket() {
  const objects = new Map();
  const puts = [];
  return {
    objects,
    puts,
    head: async (key) => (objects.has(key) ? { size: objects.get(key).buf.length } : null),
    put: async (key, buf, { contentType } = {}) => { puts.push(key); objects.set(key, { buf: Buffer.from(buf), contentType }); },
  };
}

test('disk -> bucket: dry run copies nothing; apply copies once; re-run is a no-op', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cf-migrate-'));
  try {
    const disk = createDiskDriver({ root });
    await disk.put('workspaces/ws_1/messages/m_1', Buffer.from('voice'));
    await disk.put('workspaces/ws_1/messages/m_2', Buffer.from('photo!'));
    const bucket = memoryBucket();
    const types = { m_1: 'audio/ogg; codecs=opus' };
    const contentTypeFor = messageContentTypeLookup({
      message: { findUnique: async ({ where }) => (types[where.id] ? { mediaMimeType: types[where.id] } : null) },
    });

    const dry = await copyDiskToBucket({ source: disk, target: bucket, apply: false, contentTypeFor });
    assert.deepEqual(dry, { files: 2, present: 0, copied: 0, wouldCopy: 2, failed: 0 });
    assert.equal(bucket.objects.size, 0);

    const first = await copyDiskToBucket({ source: disk, target: bucket, apply: true, contentTypeFor });
    assert.equal(first.copied, 2);
    assert.equal(bucket.objects.get('workspaces/ws_1/messages/m_1').contentType, 'audio/ogg');
    assert.equal(bucket.objects.get('workspaces/ws_1/messages/m_2').contentType, 'application/octet-stream');

    const again = await copyDiskToBucket({ source: disk, target: bucket, apply: true, contentTypeFor });
    assert.deepEqual(again, { files: 2, present: 2, copied: 0, wouldCopy: 0, failed: 0 });
    assert.equal(bucket.puts.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('disk -> bucket: one failing object is reported and the rest still copy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cf-migrate-'));
  try {
    const disk = createDiskDriver({ root });
    await disk.put('a/1', Buffer.from('x'));
    await disk.put('a/2', Buffer.from('y'));
    const bucket = memoryBucket();
    const realPut = bucket.put;
    bucket.put = async (key, ...rest) => { if (key === 'a/1') throw new Error('denied'); return realPut(key, ...rest); };
    const logs = [];
    const stats = await copyDiskToBucket({ source: disk, target: bucket, apply: true, log: (l) => logs.push(l) });
    assert.equal(stats.failed, 1);
    assert.equal(stats.copied, 1);
    assert.match(logs[0], /a\/1: denied/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function fakeAssets(rows) {
  const updates = [];
  return {
    rows,
    updates,
    templateAsset: {
      findMany: async ({ where, take }) => rows
        .filter((r) => r.bytes !== null
          && (where.storageKey === null ? r.storageKey === null : true)
          && (where.id?.gt ? r.id > where.id.gt : true))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, take)
        .map((r) => ({ ...r })),
      updateMany: async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id && r.storageKey === where.storageKey && r.bytes !== null);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        updates.push({ id: row.id, ...data });
        return { count: 1 };
      },
    },
  };
}

test('template assets: bytes move to the bucket, the key is recorded, and a re-run does nothing', async () => {
  const prisma = fakeAssets([
    { id: 'a1', workspaceId: 'ws_1', mimeType: 'image/png', sizeBytes: 3, storageKey: null, bytes: Buffer.from('png') },
    { id: 'a2', workspaceId: 'ws_2', mimeType: 'image/jpeg', sizeBytes: 4, storageKey: null, bytes: Buffer.from('jpeg') },
    { id: 'a3', workspaceId: 'ws_2', mimeType: 'image/jpeg', sizeBytes: 4, storageKey: 'k', bytes: null },
  ]);
  const bucket = memoryBucket();

  const dry = await copyTemplateAssetsToBucket({ prisma, target: bucket, apply: false, batchSize: 1 });
  assert.equal(dry.wouldCopy, 2);
  assert.equal(prisma.updates.length, 0);

  const run = await copyTemplateAssetsToBucket({ prisma, target: bucket, apply: true, batchSize: 1 });
  assert.equal(run.copied, 2);
  assert.equal(prisma.rows[0].storageKey, 'workspaces/ws_1/template-assets/a1');
  assert.ok(prisma.rows[0].bytes, 'without --purge-db-bytes the database copy stays');
  assert.equal(bucket.objects.get('workspaces/ws_2/template-assets/a2').contentType, 'image/jpeg');

  const again = await copyTemplateAssetsToBucket({ prisma, target: bucket, apply: true, batchSize: 1 });
  assert.equal(again.rows, 0);
});

test('template assets: --purge-db-bytes clears the database copy once the bucket has it, including earlier copies', async () => {
  const prisma = fakeAssets([
    { id: 'a1', workspaceId: 'ws_1', mimeType: 'image/png', sizeBytes: 3, storageKey: 'workspaces/ws_1/template-assets/a1', bytes: Buffer.from('png') },
    { id: 'a2', workspaceId: 'ws_1', mimeType: 'image/png', sizeBytes: 3, storageKey: null, bytes: Buffer.from('gif') },
  ]);
  const bucket = memoryBucket();
  bucket.objects.set('workspaces/ws_1/template-assets/a1', { buf: Buffer.from('png') });

  const stats = await copyTemplateAssetsToBucket({ prisma, target: bucket, apply: true, purge: true, batchSize: 1 });
  assert.equal(stats.present, 1);
  assert.equal(stats.copied, 1);
  assert.equal(stats.purged, 2);
  assert.equal(prisma.rows[0].bytes, null);
  assert.equal(prisma.rows[1].bytes, null);
  assert.equal(prisma.rows[1].storageKey, 'workspaces/ws_1/template-assets/a2');
});
