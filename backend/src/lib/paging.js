// Bounded reads for request-facing queries (CF-048).
//
// Two shapes, for two kinds of caller:
//
//   listWindow  — a list endpoint. Optional `limit`/`offset` with a default
//                 and a ceiling, so a tenant that has grown to tens of
//                 thousands of rows gets a page rather than all of them. The
//                 default is set high enough that a normal workspace still
//                 sees everything it saw before, so response shapes and the
//                 UI are unchanged.
//   forEachChunk — an export, analytics scan or batch job that genuinely needs
//                 every row. It walks the table in id-cursor chunks and hands
//                 each chunk to the caller, so no single query (or Prisma
//                 result) holds the whole set and the caller can fold rows
//                 into a summary as it goes.

export const DEFAULT_CHUNK_SIZE = 1000;

/**
 * @returns {{ take: number, skip: number }}
 */
export function listWindow({ limit, offset } = {}, { defaultLimit = 500, maxLimit = 1000 } = {}) {
  const take = Math.min(Math.max(Number.parseInt(limit, 10) || defaultLimit, 1), maxLimit);
  const skip = Math.max(Number.parseInt(offset, 10) || 0, 0);
  return { take, skip };
}

// The caller's order, made total with the id so the cursor never skips or
// repeats a row that ties on the other keys.
function withIdTieBreak(orderBy) {
  const list = orderBy ? (Array.isArray(orderBy) ? orderBy : [orderBy]) : [];
  if (list.some((o) => o && Object.prototype.hasOwnProperty.call(o, 'id'))) return list;
  const last = list.length ? Object.values(list[list.length - 1])[0] : 'asc';
  return [...list, { id: last === 'desc' ? 'desc' : 'asc' }];
}

/**
 * Walk `delegate.findMany(args)` in chunks of `chunkSize`, calling
 * `onChunk(rows)` for each. `args` may carry where/select/include/orderBy;
 * `select`, when given, gains `id` (needed for the cursor).
 */
export async function forEachChunk(delegate, args, onChunk, { chunkSize = DEFAULT_CHUNK_SIZE } = {}) {
  const base = { ...args, orderBy: withIdTieBreak(args?.orderBy) };
  if (base.select && !base.select.id) base.select = { ...base.select, id: true };
  let cursor = null;
  for (;;) {
    const rows = await delegate.findMany({
      ...base,
      take: chunkSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length) await onChunk(rows);
    if (rows.length < chunkSize) return;
    cursor = rows[rows.length - 1].id;
  }
}

/** Every row, fetched in chunks. For callers that need the whole list. */
export async function findManyChunked(delegate, args, opts) {
  const all = [];
  await forEachChunk(delegate, args, (rows) => { all.push(...rows); }, opts);
  return all;
}
