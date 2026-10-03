import { Btn } from './Btn.jsx';
import { pageCount } from '../lib/paging.js';

// The Previous / Next pager the contacts table introduced, shared by every
// server-paged list (CF-048): "Showing 101–200 of 1,234 leads", and the
// buttons only when there is more than one page. `page` is 1-based.
export function ListPager({ page, pageSize, total, loading = false, onPage, noun = 'row', plural, compact = false, style }) {
  const pages = pageCount(total, pageSize);
  const many = plural || `${noun}s`;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const fmt = (n) => Number(n).toLocaleString('en-IN');
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: compact ? 8 : 12, flexWrap: 'wrap', ...style }}>
      <p style={{ fontSize: 11, color: 'var(--t3)', margin: 0 }}>
        {total === 0
          ? `No ${many}`
          : `Showing ${fmt(from)}–${fmt(to)} of ${fmt(total)} ${total === 1 ? noun : many}`}
      </p>
      {pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 6 : 8 }}>
          <Btn variant="outline" size={compact ? 'xs' : 'sm'} disabled={page <= 1 || loading} onClick={() => onPage(Math.max(1, page - 1))}>
            Previous
          </Btn>
          <span style={{ fontSize: compact ? 11 : 12, color: 'var(--t2)' }}>Page {page} of {pages}</span>
          <Btn variant="outline" size={compact ? 'xs' : 'sm'} disabled={page >= pages || loading} onClick={() => onPage(Math.min(pages, page + 1))}>
            Next
          </Btn>
        </div>
      )}
    </div>
  );
}

// "Load more" for a list read a page at a time whose endpoint does not report
// a total (invoices, support tickets, super-admin lists): shown while the last
// page came back full. `shown`/`total` add a count when one is known.
export function LoadMore({ hasMore, loading = false, onLoad, label = 'Load more', shown, total, style }) {
  if (!hasMore) return null;
  const left = Number.isFinite(total) && Number.isFinite(shown) && total > shown ? ` (${(total - shown).toLocaleString('en-IN')} more)` : '';
  return (
    <div style={{ padding: '12px', textAlign: 'center', ...style }}>
      <Btn variant="outline" size="sm" onClick={onLoad} disabled={loading}>
        {loading ? 'Loading…' : `${label}${left}`}
      </Btn>
    </div>
  );
}

export default ListPager;
