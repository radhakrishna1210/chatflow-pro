import { useState, useEffect, useCallback } from 'react';
import { I } from './Icons.jsx';
import { wFetch } from '../lib/api.js';

// Named filter sets for a CRM list. `filters` is whatever object the host
// screen already uses for its query, so this component works for leads, deals
// or tasks without knowing what any individual filter means.
//
// Props:
//   entity   — 'leads' | 'deals' | 'tasks'
//   current  — the screen's live filter object
//   onApply  — called with a stored filter object when a view is selected
export const SavedViews = ({ entity, current, onApply }) => {
  const [views, setViews] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    wFetch(`/saved-views?entity=${encodeURIComponent(entity)}`)
      .then(r => (r.ok ? r.json() : { data: [] }))
      .then(d => setViews(d.data ?? []))
      .catch(() => {});
  }, [entity]);

  useEffect(() => { load(); }, [load]);

  const apply = (id) => {
    setActiveId(id);
    if (!id) return;
    const view = views.find(v => v.id === id);
    if (view) onApply(view.filters ?? {});
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await wFetch('/saved-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Empty values are dropped so a saved view stores the filters that were
        // actually set, not a wall of blank keys.
        body: JSON.stringify({
          entity,
          name: trimmed,
          isShared: shared,
          filters: Object.fromEntries(Object.entries(current || {}).filter(([, v]) => v !== '' && v != null)),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Could not save this view');
      }
      const saved = await res.json();
      setNaming(false);
      setName('');
      setShared(false);
      load();
      setActiveId(saved.id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!activeId) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await wFetch(`/saved-views/${activeId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Could not delete this view');
      }
      setActiveId('');
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const selectStyle = {
    background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 8,
    color: 'var(--t1)', fontSize: 12.5, padding: '7px 9px', outline: 'none', maxWidth: 190,
  };
  const iconBtn = {
    display: 'flex', alignItems: 'center', gap: 5, padding: '7px 10px',
    background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 8,
    color: 'var(--t2)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <select value={activeId} onChange={e => apply(e.target.value)} style={selectStyle} aria-label="Saved views">
        <option value="">Saved views…</option>
        {views.map(v => (
          <option key={v.id} value={v.id}>
            {v.name}{v.isShared ? ' (shared)' : ''}
          </option>
        ))}
      </select>

      {naming ? (
        <>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setNaming(false); }}
            placeholder="Name this view"
            aria-label="Name this view"
            style={{ ...selectStyle, maxWidth: 160 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--t3)', cursor: 'pointer' }}>
            <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} />
            Share with team
          </label>
          <button onClick={save} disabled={busy || !name.trim()} style={{ ...iconBtn, color: 'var(--green)' }}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => { setNaming(false); setErr(null); }} style={iconBtn}>Cancel</button>
        </>
      ) : (
        <>
          <button onClick={() => setNaming(true)} style={iconBtn} title="Save the current filters as a view">
            <I n="check" s={12} c="var(--t2)" /> Save view
          </button>
          {activeId && views.find(v => v.id === activeId) && (
            <button onClick={remove} disabled={busy} style={{ ...iconBtn, color: '#f87171' }} title="Delete the selected view">
              <I n="x" s={12} c="#f87171" />
            </button>
          )}
        </>
      )}

      {err && <span style={{ fontSize: 11.5, color: '#f87171' }}>{err}</span>}
    </div>
  );
};

export default SavedViews;
