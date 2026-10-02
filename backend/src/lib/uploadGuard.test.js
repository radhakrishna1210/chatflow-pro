import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { promises as fsp, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

mock.module('../middleware/rateLimit.js', { namedExports: { rateLimit: () => (req, res, next) => next() } });
const { verifyFileContents } = await import('./uploadGuard.js');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function tempFile(bytes) {
  const p = path.join(os.tmpdir(), `uploadguard-test-${process.pid}-${Math.random().toString(16).slice(2)}`);
  await fsp.writeFile(p, bytes);
  return p;
}

function fakeRes() {
  const res = new EventEmitter();
  res.destroyed = false;
  res.writableFinished = false;
  return res;
}

const run = (req, res) => new Promise((resolve) => { verifyFileContents(req, res, (err) => resolve(err ?? null)); });

test('a disk upload is checked from its first bytes, then loaded for the handler and removed afterwards', async () => {
  const filePath = await tempFile(PNG);
  const req = { file: { path: filePath, size: PNG.length, mimetype: 'image/png', originalname: 'a.png' } };
  const res = fakeRes();
  assert.equal(await run(req, res), null);
  assert.deepEqual(req.file.buffer, PNG);
  res.emit('close');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(existsSync(filePath), false);
});

test('a disk upload whose bytes do not match its type is refused and still cleaned up', async () => {
  const filePath = await tempFile(Buffer.from('#!/bin/sh\necho hi\n'));
  const req = { file: { path: filePath, size: 18, mimetype: 'image/png', originalname: 'x.png' } };
  const res = fakeRes();
  const err = await run(req, res);
  assert.equal(err.code, 'FILE_CONTENT_MISMATCH');
  assert.equal(req.file.buffer, undefined);
  res.emit('close');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(existsSync(filePath), false);
});

test('memory uploads behave as before', async () => {
  assert.equal(await run({ file: { buffer: PNG, mimetype: 'image/png' } }, fakeRes()), null);
  assert.equal((await run({ file: { buffer: Buffer.alloc(0), mimetype: 'image/png' } }, fakeRes())).status, 400);
  assert.equal((await run({ file: { buffer: Buffer.from('a,b\n1,2'), mimetype: 'text/csv' } }, fakeRes())), null);
});

test('only a few large files are held in memory at once; the rest wait their turn', async () => {
  const responses = [];
  const pending = [];
  for (let i = 0; i < 6; i += 1) {
    const filePath = await tempFile(PNG);
    const res = fakeRes();
    responses.push(res);
    const req = { file: { path: filePath, size: PNG.length, mimetype: 'image/png' } };
    pending.push(run(req, res).then(() => i));
  }
  const settled = new Set();
  pending.forEach((p) => p.then((i) => settled.add(i)));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(settled.size, 4);
  responses[0].emit('close');
  responses[1].emit('close');
  await Promise.all(pending);
  assert.equal(settled.size, 6);
  for (const res of responses.slice(2)) res.emit('close');
});
