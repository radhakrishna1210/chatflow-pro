import { useState, useEffect, useCallback } from 'react';
import { I } from './Icons.jsx';
import { Btn } from './Btn.jsx';
import { wFetch, wDownload } from '../lib/api.js';

const card = { background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', boxShadow:'var(--card-shadow)' };

const FILTERS = [
  { id: 'active',    label: 'Blocked' },
  { id: 'unblocked', label: 'Unblocked' },
  { id: 'all',       label: 'All' },
];

const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

// Settings → Blocked Numbers. Every number that opted out of this workspace,
// with search, filtering, CSV export, and single or bulk unblock.
export default function BlockedNumbers({ isAdmin }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [keywords, setKeywords] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status, ...(query ? { search: query } : {}) });
      const res = await wFetch(`/blocked-numbers?${params}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load blocked numbers');
      const data = await res.json();
      setRows(Array.isArray(data.data) ? data.data : []);
      setTotal(data.total || 0);
      setActiveCount(data.activeCount || 0);
      setSelected(new Set());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [status, query]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    wFetch('/blocked-numbers/keywords')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.keywords) setKeywords(d.keywords); })
      .catch(() => {});
  }, []);

  // Debounced search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const flash = (message) => { setNotice(message); setTimeout(() => setNotice(null), 3000); };

  const toggleRow = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const blockedRows = rows.filter(r => r.active);
  const allSelected = blockedRows.length > 0 && blockedRows.every(r => selected.has(r.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(blockedRows.map(r => r.id)));

  const unblock = async (ids, label) => {
    if (busy || ids.length === 0) return;
    if (!window.confirm(`Unblock ${label}? They will start receiving campaign and automation messages again.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await wFetch('/blocked-numbers/unblock', { method: 'POST', body: JSON.stringify({ ids }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not unblock');
      flash(`Unblocked ${data.unblocked} number${data.unblocked === 1 ? '' : 's'}.`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ status, ...(query ? { search: query } : {}) });
      await wDownload(`/blocked-numbers/export?${params}`, 'blocked-numbers.csv');
    } catch (e) {
      setError(e.message || 'Could not export CSV');
    }
  };

  return (
    <div style={{ ...card, overflow:'hidden', flexShrink:0 }}>
      <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <I n="ban" s={16} c="#f87171" />
        <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)' }}>Blocked Numbers</span>
        <span style={{ padding:'2px 9px', borderRadius:10, fontSize:11, fontWeight:700, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', color:'#f87171' }}>
          {activeCount} blocked
        </span>
        <div style={{ flex:1 }} />
        <Btn variant="outline" size="sm" onClick={exportCsv}>
          <I n="download" s={12} c="var(--t2)" /> Export CSV
        </Btn>
      </div>

      <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--bd)' }}>
        <p style={{ fontSize:12, color:'var(--t2)', lineHeight:1.55, marginBottom:12 }}>
          A contact who replies with an opt-out keyword is added here automatically and is skipped by every
          campaign, automation, trigger and API send from then on.
          {keywords.length > 0 && (
            <> Recognised keywords: {keywords.map(k => (
              <code key={k} style={{ background:'rgba(255,255,255,0.05)', padding:'1px 5px', borderRadius:4, marginRight:4, fontSize:11 }}>{k}</code>
            ))}
            </>
          )}
        </p>

        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <div style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', flex:'1 1 220px', minWidth:0 }}>
            <I n="search" s={13} c="var(--t2)" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by number, keyword or reason…"
              aria-label="Search blocked numbers"
              style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--t1)', fontSize:13, fontFamily:"'Plus Jakarta Sans',sans-serif", minWidth:0 }} />
          </div>
          <div style={{ display:'flex', gap:6 }}>
            {FILTERS.map(f => (
              <button key={f.id} onClick={() => setStatus(f.id)}
                style={{ padding:'7px 13px', borderRadius:8, fontSize:12.5, fontWeight:600, cursor:'pointer',
                  background: status === f.id ? 'var(--gbg)' : 'rgba(255,255,255,0.02)',
                  border:`1px solid ${status === f.id ? 'var(--gbd)' : 'var(--bd)'}`,
                  color: status === f.id ? 'var(--green)' : 'var(--t2)' }}>
                {f.label}
              </button>
            ))}
          </div>
          {isAdmin && selected.size > 0 && (
            <Btn size="sm" variant="outline" disabled={busy}
              onClick={() => unblock([...selected], `${selected.size} number${selected.size === 1 ? '' : 's'}`)}
              style={{ borderColor:'var(--gbd)', color:'var(--green)' }}>
              {busy ? 'Unblocking…' : `Unblock ${selected.size} selected`}
            </Btn>
          )}
        </div>
      </div>

      {error && <p style={{ margin:0, padding:'10px 20px', fontSize:12, color:'#f87171', background:'rgba(239,68,68,0.06)' }}>{error}</p>}
      {notice && <p style={{ margin:0, padding:'10px 20px', fontSize:12, color:'var(--green)', background:'var(--gbg)' }}>{notice}</p>}

      {loading ? (
        <p style={{ padding:'28px', textAlign:'center', fontSize:13, color:'var(--t2)' }}>Loading blocked numbers…</p>
      ) : rows.length === 0 ? (
        <p style={{ padding:'28px', textAlign:'center', fontSize:13, color:'var(--t2)' }}>
          {query ? 'No blocked numbers match that search.' : 'No numbers have opted out yet.'}
        </p>
      ) : (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', minWidth:720 }}>
            <thead>
              <tr style={{ borderBottom:'1px solid var(--bd)' }}>
                {isAdmin && (
                  <th style={{ padding:'8px 12px', width:36 }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all blocked numbers"
                      disabled={blockedRows.length === 0} style={{ accentColor:'#1EBF5E', cursor:'pointer' }} />
                  </th>
                )}
                {['Phone Number','Blocked Date','Time','Keyword','Reason','Blocked By',''].map(h => (
                  <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.07em', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id} style={{ borderBottom: i < rows.length-1 ? '1px solid var(--bd)' : 'none', opacity: row.active ? 1 : 0.55 }}>
                  {isAdmin && (
                    <td style={{ padding:'10px 12px' }}>
                      {row.active && (
                        <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleRow(row.id)}
                          aria-label={`Select ${row.phoneNumber}`} style={{ accentColor:'#1EBF5E', cursor:'pointer' }} />
                      )}
                    </td>
                  )}
                  <td style={{ padding:'10px 12px', fontSize:12.5, fontWeight:600, color:'var(--t1)', fontFamily:'monospace', whiteSpace:'nowrap' }}>{row.phoneNumber}</td>
                  <td style={{ padding:'10px 12px', fontSize:12, color:'var(--t2)', whiteSpace:'nowrap' }}>{fmtDate(row.blockedAt)}</td>
                  <td style={{ padding:'10px 12px', fontSize:12, color:'var(--t2)', whiteSpace:'nowrap' }}>{fmtTime(row.blockedAt)}</td>
                  <td style={{ padding:'10px 12px' }}>
                    {row.keyword
                      ? <code style={{ fontSize:11, fontWeight:700, padding:'2px 7px', borderRadius:5, background:'rgba(255,255,255,0.05)', border:'1px solid var(--bd)', color:'var(--t1)' }}>{row.keyword}</code>
                      : <span style={{ fontSize:12, color:'var(--t3)' }}>—</span>}
                  </td>
                  <td style={{ padding:'10px 12px', fontSize:12, color:'var(--t2)' }}>{row.reason}</td>
                  <td style={{ padding:'10px 12px', fontSize:12, color:'var(--t2)' }}>{row.blockedBy}</td>
                  <td style={{ padding:'10px 12px', textAlign:'right', whiteSpace:'nowrap' }}>
                    {!row.active ? (
                      <span style={{ fontSize:11, fontWeight:600, color:'var(--t3)' }}>Unblocked</span>
                    ) : isAdmin ? (
                      <button onClick={() => unblock([row.id], row.phoneNumber)} disabled={busy}
                        style={{ padding:'4px 11px', borderRadius:6, background:'rgba(30,191,94,0.08)', border:'1px solid var(--gbd)', cursor: busy ? 'not-allowed' : 'pointer', fontSize:11.5, fontWeight:600, color:'var(--green)', opacity: busy ? 0.6 : 1 }}>
                        Unblock
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <p style={{ padding:'10px 20px', fontSize:11, color:'var(--t3)', borderTop:'1px solid var(--bd)' }}>
          Showing {rows.length} of {total}. {!isAdmin && 'Only workspace admins can unblock numbers.'}
        </p>
      )}
    </div>
  );
}
