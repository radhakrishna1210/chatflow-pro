import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pageParams, pageCount, readList, hasMoreRows, appendUnique, fetchAllPages,
  isEarlier, mergeNewestPage, prependOlder, oldestMessageId,
} from './paging.js';

test('pageParams sets limit/offset for a 1-based page and keeps the filters', () => {
  const qs = pageParams(new URLSearchParams({ status: 'OPEN' }), 3, 100);
  assert.equal(qs.get('status'), 'OPEN');
  assert.equal(qs.get('limit'), '100');
  assert.equal(qs.get('offset'), '200');
  assert.equal(pageParams({}, 0, 50).get('offset'), '0');
});

test('pageCount is at least 1 and rounds up', () => {
  assert.equal(pageCount(0, 100), 1);
  assert.equal(pageCount(100, 100), 1);
  assert.equal(pageCount(101, 100), 2);
  assert.equal(pageCount(undefined, 100), 1);
});

test('readList reads both response shapes', () => {
  assert.deepEqual(readList({ data: [{ id: 1 }], total: 7 }), { items: [{ id: 1 }], total: 7 });
  assert.deepEqual(readList([{ id: 1 }]), { items: [{ id: 1 }], total: null });
  assert.deepEqual(readList(null), { items: [], total: null });
});

test('hasMoreRows uses the total when there is one, else a full last page', () => {
  assert.equal(hasMoreRows({ loaded: 100, total: 101, lastPageSize: 100, size: 100 }), true);
  assert.equal(hasMoreRows({ loaded: 101, total: 101, lastPageSize: 1, size: 100 }), false);
  assert.equal(hasMoreRows({ loaded: 50, total: null, lastPageSize: 50, size: 50 }), true);
  assert.equal(hasMoreRows({ loaded: 60, total: null, lastPageSize: 10, size: 50 }), false);
});

test('appendUnique skips rows already loaded', () => {
  assert.deepEqual(appendUnique([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]).map((r) => r.id), ['a', 'b', 'c']);
});

test('fetchAllPages walks every page of a bare-array endpoint', async () => {
  const all = Array.from({ length: 25 }, (_, i) => ({ id: i }));
  const asked = [];
  const fetchFn = async (url) => {
    asked.push(url);
    const qs = new URL(url, 'http://x').searchParams;
    const offset = Number(qs.get('offset'));
    const limit = Number(qs.get('limit'));
    return { ok: true, json: async () => all.slice(offset, offset + limit) };
  };
  const { rows, truncated } = await fetchAllPages(fetchFn, '/workspaces', { size: 10 });
  assert.equal(rows.length, 25);
  assert.equal(truncated, false);
  assert.deepEqual(asked, ['/workspaces?limit=10&offset=0', '/workspaces?limit=10&offset=10', '/workspaces?limit=10&offset=20']);
});

test('fetchAllPages stops at maxRows and says so', async () => {
  const fetchFn = async () => ({ ok: true, json: async () => Array.from({ length: 10 }, (_, i) => ({ id: i })) });
  const { rows, truncated } = await fetchAllPages(fetchFn, '/x', { size: 10, maxRows: 30 });
  assert.equal(rows.length, 30);
  assert.equal(truncated, true);
});

test('fetchAllPages stops on a {data,total} endpoint once the total is reached', async () => {
  let calls = 0;
  const fetchFn = async () => { calls += 1; return { ok: true, json: async () => ({ data: Array.from({ length: 10 }, (_, i) => ({ id: `${calls}-${i}` })), total: 20 }) }; };
  const { rows } = await fetchAllPages(fetchFn, '/products?search=a', { size: 10 });
  assert.equal(rows.length, 20);
  assert.equal(calls, 2);
});

test('fetchAllPages throws on an error response', async () => {
  await assert.rejects(fetchAllPages(async () => ({ ok: false, status: 500 }), '/x'), /500/);
});

const msg = (id, s) => ({ id, sentAt: new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString() });

test('isEarlier orders by sentAt, then id', () => {
  assert.equal(isEarlier(msg('b', 1), msg('a', 2)), true);
  assert.equal(isEarlier(msg('a', 2), msg('b', 2)), true);
  assert.equal(isEarlier(msg('b', 2), msg('a', 2)), false);
});

test('a refresh keeps older pages already loaded and replaces the newest page', () => {
  const loaded = [msg('m1', 1), msg('m2', 2), msg('m3', 3), msg('m4', 4)];
  const refreshed = [msg('m3', 3), { ...msg('m4', 4), status: 'READ' }, msg('m5', 5)];
  const { messages, keptOlder } = mergeNewestPage(loaded, refreshed);
  assert.deepEqual(messages.map((m) => m.id), ['m1', 'm2', 'm3', 'm4', 'm5']);
  assert.equal(messages[3].status, 'READ');
  assert.equal(keptOlder, true);
});

test('a refresh drops optimistic placeholders and reports nothing older on a first load', () => {
  const { messages, keptOlder } = mergeNewestPage([{ id: 'tmp', _pending: true, sentAt: new Date(0).toISOString() }], [msg('m1', 1)]);
  assert.deepEqual(messages.map((m) => m.id), ['m1']);
  assert.equal(keptOlder, false);
  assert.deepEqual(mergeNewestPage([msg('m1', 1)], []).messages, []);
});

test('an older page goes in front, without duplicates', () => {
  const out = prependOlder([msg('m3', 3), msg('m4', 4)], [msg('m1', 1), msg('m2', 2), msg('m3', 3)]);
  assert.deepEqual(out.map((m) => m.id), ['m1', 'm2', 'm3', 'm4']);
  assert.equal(oldestMessageId(out), 'm1');
  assert.equal(oldestMessageId([{ id: 't', _pending: true }]), null);
});
