import { useState, useCallback, useRef } from 'react';
import { readList, hasMoreRows, appendUnique } from './paging.js';

// A list read a page at a time with "Load more" (CF-048), for endpoints that
// page with ?limit=&offset= — including those that return a bare array with
// no total (invoices, support tickets, super-admin lists), where more rows
// are assumed while the last page came back full.
//
// `reload()` re-reads from the top as many rows as are already on screen
// (at least one page, at most `max`, the server's ceiling), so refreshing
// after an action does not throw away what "Load more" fetched.
// `fetchFn(url)` is wFetch/adminFetch; `path` is the endpoint without a
// query string, and `params` adds any filters. Call `reload()` to load.
export function useLoadMoreList(fetchFn, path, { size = 50, max = 1000, params } = {}) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const itemsRef = useRef([]);
  const tokenRef = useRef(0);
  const paramKey = params ? new URLSearchParams(params).toString() : '';

  const url = useCallback((limit, offset) => {
    const qs = new URLSearchParams(paramKey);
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));
    return `${path}?${qs}`;
  }, [path, paramKey]);

  const reload = useCallback(async ({ fromStart = false } = {}) => {
    const token = ++tokenRef.current;
    const loaded = fromStart ? 0 : itemsRef.current.length;
    const limit = Math.min(Math.max(loaded, size), max);
    try {
      const res = await fetchFn(url(limit, 0));
      if (!res.ok) throw new Error(`Could not load this list (${res.status}).`);
      const { items: rows, total: count } = readList(await res.json());
      if (token !== tokenRef.current) return;
      itemsRef.current = rows;
      setItems(rows);
      setTotal(count);
      setHasMore(hasMoreRows({ loaded: rows.length, total: count, lastPageSize: rows.length, size: limit }));
      setError(null);
    } catch (e) {
      if (token === tokenRef.current) setError(e.message || 'Could not load this list.');
    } finally {
      if (token === tokenRef.current) setLoading(false);
    }
  }, [fetchFn, url, size, max]);

  const loadMore = useCallback(async () => {
    const token = tokenRef.current;
    setLoadingMore(true);
    try {
      const res = await fetchFn(url(size, itemsRef.current.length));
      if (!res.ok) throw new Error(`Could not load more (${res.status}).`);
      const { items: rows, total: count } = readList(await res.json());
      if (token !== tokenRef.current) return; // a reload replaced the list meanwhile
      const next = appendUnique(itemsRef.current, rows);
      itemsRef.current = next;
      setItems(next);
      setHasMore(hasMoreRows({ loaded: next.length, total: count, lastPageSize: rows.length, size }));
      if (count !== null) setTotal(count);
      setError(null);
    } catch (e) {
      setError(e.message || 'Could not load more.');
    } finally {
      setLoadingMore(false);
    }
  }, [fetchFn, url, size]);

  return { items, total, hasMore, loading, loadingMore, error, reload, loadMore };
}

export default useLoadMoreList;
