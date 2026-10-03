// Paging for the bounded list endpoints (CF-048).
//
// The server caps leads, tickets, quotes, products, invoices, support tickets
// and the super-admin workspace lists (default 500 / 1000 rows), and an inbox
// thread at its newest 500 messages. A screen that fetched "the list" once
// and never asked for more silently showed a workspace above the cap only
// its first page. These helpers keep every caller asking for an explicit
// window and knowing whether more rows exist. No React in here, so the
// helpers run under `node --test`.

/** Rows per page for the CRM tables. Well under the server's ceiling. */
export const PAGE_SIZE = 100;

/** A copy of `params` with limit/offset set for 1-based `page` of `size`. */
export function pageParams(params, page = 1, size = PAGE_SIZE) {
  const qs = new URLSearchParams(params);
  qs.set('limit', String(size));
  qs.set('offset', String(Math.max(0, (Math.max(1, page) - 1) * size)));
  return qs;
}

export const pageCount = (total, size = PAGE_SIZE) => Math.max(1, Math.ceil((Number(total) || 0) / size));

/**
 * A list response as `{ items, total }`: `{ data, total }` bodies report the
 * full count; bare arrays (invoices, support tickets, admin lists) do not, so
 * `total` is null and the caller pages until a short page comes back.
 */
export function readList(body) {
  if (Array.isArray(body)) return { items: body, total: null };
  const items = Array.isArray(body?.data) ? body.data : [];
  return { items, total: Number.isFinite(body?.total) ? body.total : null };
}

/**
 * Whether rows remain after `loaded` of them: from `total` when the endpoint
 * reports one, otherwise from whether the last page came back full.
 */
export function hasMoreRows({ loaded, total, lastPageSize, size }) {
  if (total !== null && total !== undefined) return loaded < total;
  return lastPageSize >= size;
}

/** Appends `next` to `prev`, skipping rows already present (by id). */
export function appendUnique(prev, next) {
  const ids = new Set(prev.map((r) => r.id));
  return [...prev, ...next.filter((r) => !ids.has(r.id))];
}

/**
 * Every row of a list endpoint, for a caller that genuinely needs the whole
 * set (a filter dropdown). Walks limit/offset pages of `size` until a short
 * page, stopping at `maxRows` so a runaway platform cannot hang the screen;
 * `truncated` says when that happened.
 *
 * `fetchFn(path)` is wFetch/adminFetch (returns a Response).
 */
export async function fetchAllPages(fetchFn, path, { size = 1000, params, maxRows = 20000 } = {}) {
  const rows = [];
  for (let offset = 0; offset < maxRows; offset += size) {
    const qs = new URLSearchParams(params);
    qs.set('limit', String(size));
    qs.set('offset', String(offset));
    const res = await fetchFn(`${path}${path.includes('?') ? '&' : '?'}${qs}`);
    if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
    const { items, total } = readList(await res.json());
    rows.push(...items);
    if (!hasMoreRows({ loaded: rows.length, total, lastPageSize: items.length, size })) {
      return { rows, truncated: false };
    }
  }
  return { rows, truncated: true };
}

// ─── Inbox threads ──────────────────────────────────────────────────────────
// A thread is fetched newest-page-first; "Load earlier messages" prepends
// older pages (GET …/messages?before=<oldest id>). A refresh brings back only
// the newest page, so it must not throw away the older ones already loaded.

const sentAtMs = (m) => new Date(m.sentAt ?? m.createdAt ?? 0).getTime();

/** Whether message `a` sorts before `b` (sentAt, then id — the server's order). */
export function isEarlier(a, b) {
  const ta = sentAtMs(a);
  const tb = sentAtMs(b);
  return ta < tb || (ta === tb && String(a.id) < String(b.id));
}

/**
 * The thread after a refresh: older messages already loaded (those before the
 * refreshed page's first message) followed by the refreshed page. Optimistic
 * placeholders are dropped, as a refresh always did. `keptOlder` says whether
 * any older message survived, i.e. whether the caller's "has earlier" state
 * still describes the loaded history rather than this page.
 */
export function mergeNewestPage(prev = [], page = []) {
  if (!page.length) return { messages: page, keptOlder: false };
  const first = page[0];
  const ids = new Set(page.map((m) => m.id));
  const older = prev.filter((m) => !m._pending && !ids.has(m.id) && isEarlier(m, first));
  return { messages: [...older, ...page], keptOlder: older.length > 0 };
}

/** The thread with an older page put in front of it. */
export function prependOlder(prev = [], older = []) {
  const ids = new Set(prev.map((m) => m.id));
  return [...older.filter((m) => !ids.has(m.id)), ...prev];
}

/** The id to pass as `before` to load the page older than `messages`. */
export function oldestMessageId(messages = []) {
  const first = messages.find((m) => !m._pending);
  return first ? first.id : null;
}
