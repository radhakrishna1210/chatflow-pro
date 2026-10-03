import test from 'node:test';
import assert from 'node:assert/strict';
import { listWindow, forEachChunk, findManyChunked } from './paging.js';

// CF-048: list endpoints take bounded, optional paging; exports and analytics
// scans walk the table in id-cursor chunks instead of one unbounded findMany.

test('listWindow applies the default, the ceiling and sane offsets', () => {
  assert.deepEqual(listWindow({}), { take: 500, skip: 0 });
  assert.deepEqual(listWindow({ limit: '50', offset: '100' }), { take: 50, skip: 100 });
  assert.deepEqual(listWindow({ limit: 999999 }), { take: 1000, skip: 0 });
  assert.deepEqual(listWindow({ limit: '-3', offset: '-1' }), { take: 1, skip: 0 });
  assert.deepEqual(listWindow({ limit: 'abc' }, { defaultLimit: 200, maxLimit: 300 }), { take: 200, skip: 0 });
});

// A findMany stand-in over an in-memory table that honours where-less
// orderBy [..., id], take, cursor and skip the way Prisma does.
function fakeDelegate(rows) {
  const calls = [];
  return {
    calls,
    async findMany(args) {
      calls.push(args);
      const dir = args.orderBy.at(-1).id;
      const sorted = [...rows].sort((a, b) => (dir === 'desc' ? b.id - a.id : a.id - b.id));
      let start = 0;
      if (args.cursor) start = sorted.findIndex((r) => r.id === args.cursor.id) + (args.skip ?? 0);
      return sorted.slice(start, start + args.take);
    },
  };
}

test('forEachChunk visits every row once, in bounded queries', async () => {
  const rows = Array.from({ length: 2503 }, (_, i) => ({ id: i + 1 }));
  const delegate = fakeDelegate(rows);
  const seen = [];
  await forEachChunk(delegate, { where: {} }, (chunk) => { seen.push(...chunk.map((r) => r.id)); }, { chunkSize: 1000 });
  assert.equal(seen.length, 2503);
  assert.equal(new Set(seen).size, 2503);
  assert.equal(delegate.calls.length, 3);
  assert.ok(delegate.calls.every((c) => c.take === 1000));
});

test('forEachChunk stops after an exact multiple with one empty probe', async () => {
  const delegate = fakeDelegate(Array.from({ length: 20 }, (_, i) => ({ id: i + 1 })));
  const all = await findManyChunked(delegate, {}, { chunkSize: 10 });
  assert.equal(all.length, 20);
  assert.equal(delegate.calls.length, 3);
});

test('the caller\'s order is kept and made total with the id', async () => {
  const delegate = fakeDelegate([{ id: 1 }, { id: 2 }]);
  await findManyChunked(delegate, { orderBy: { createdAt: 'desc' }, select: { name: true } });
  assert.deepEqual(delegate.calls[0].orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
  assert.deepEqual(delegate.calls[0].select, { name: true, id: true }, 'id is selected for the cursor');
});
