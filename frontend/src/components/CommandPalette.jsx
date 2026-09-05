import { useState, useEffect, useRef, useCallback } from 'react';
import { I } from './Icons.jsx';
import { wFetch } from '../lib/api.js';

// Navigation and create actions available without typing a search term. These
// are the destinations the palette can reach; anything else comes back from
// the search endpoint.
const ACTIONS = [
  { id: 'nav-home', label: 'Go to Home', icon: 'home', nav: 'home', keywords: 'dashboard overview' },
  { id: 'nav-crm', label: 'Go to CRM Overview', icon: 'chart', nav: 'crm-overview', keywords: 'pipeline metrics kpi' },
  { id: 'nav-leads', label: 'Go to Leads', icon: 'target', nav: 'leads', keywords: 'prospects' },
  { id: 'nav-deals', label: 'Go to Deals', icon: 'briefcase', nav: 'deals', keywords: 'pipeline opportunities kanban' },
  { id: 'nav-tasks', label: 'Go to Tasks', icon: 'check-square', nav: 'tasks', keywords: 'todo work queue' },
  { id: 'nav-forecast', label: 'Go to Forecast', icon: 'chart', nav: 'forecast', keywords: 'commit best case quota weighted pipeline' },
  { id: 'nav-products', label: 'Go to Products', icon: 'briefcase', nav: 'products', keywords: 'catalogue services sku price' },
  { id: 'nav-quotes', label: 'Go to Quotes', icon: 'note', nav: 'quotes', keywords: 'proposal estimate pricing' },
  { id: 'nav-sequences', label: 'Go to Sequences', icon: 'wflow', nav: 'sequences', keywords: 'cadence follow up drip outreach' },
  { id: 'nav-contacts', label: 'Go to Contacts', icon: 'users', nav: 'contacts', keywords: 'people' },
  { id: 'nav-inbox', label: 'Go to Inbox', icon: 'msg', nav: 'inbox', keywords: 'conversations chat messages' },
  { id: 'nav-campaigns', label: 'Go to Campaigns', icon: 'send', nav: 'campaigns', keywords: 'broadcast' },
  { id: 'nav-automation', label: 'Go to Automation', icon: 'zap', nav: 'automation', keywords: 'workflows agent rules' },
  { id: 'nav-analytics', label: 'Go to Analytics', icon: 'chart', nav: 'analytics', keywords: 'reports stats' },
  { id: 'nav-settings', label: 'Go to Settings', icon: 'cog', nav: 'settings', keywords: 'preferences workspace' },
];

const TYPE_META = {
  contact: { icon: 'users', label: 'Contact' },
  lead: { icon: 'target', label: 'Lead' },
  deal: { icon: 'briefcase', label: 'Deal' },
  task: { icon: 'check-square', label: 'Task' },
};

const rowBase = {
  display: 'flex', alignItems: 'center', gap: 11, width: '100%',
  padding: '9px 14px', border: 'none', background: 'none',
  cursor: 'pointer', textAlign: 'left', color: 'var(--t1)', fontSize: 13,
};

export const CommandPalette = () => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const term = q.trim();

  const filteredActions = term
    ? ACTIONS.filter(a => `${a.label} ${a.keywords}`.toLowerCase().includes(term.toLowerCase()))
    : ACTIONS;

  const items = [
    ...filteredActions.map(a => ({ kind: 'action', ...a })),
    ...results.map(r => ({ kind: 'result', ...r })),
  ];

  // Ctrl/Cmd+K toggles from anywhere; Escape always closes.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setActive(0);
      // Focus after paint so the input exists.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQ('');
      setResults([]);
    }
  }, [open]);

  // Debounced so typing does not fire a query per keystroke.
  useEffect(() => {
    if (!open || term.length < 2) { setResults([]); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      wFetch(`/search?q=${encodeURIComponent(term)}`)
        .then(r => (r.ok ? r.json() : { results: [] }))
        .then(d => { if (!cancelled) setResults(d.results ?? []); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 180);
    return () => { cancelled = true; clearTimeout(t); };
  }, [term, open]);

  useEffect(() => { setActive(0); }, [term]);

  const run = useCallback((item) => {
    if (!item) return;
    const destination = item.kind === 'action' ? item.nav : item.href;
    if (destination) window.dispatchEvent(new CustomEvent('app:nav', { detail: destination }));
    setOpen(false);
  }, []);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(items[active]); }
  };

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{ position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(560px, 92vw)', background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: '0 24px 64px rgba(0,0,0,.5)', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 15px', borderBottom: '1px solid var(--bd)' }}>
          <I n="search" s={15} c="var(--t3)" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search leads, deals, contacts, tasks — or jump to a page"
            aria-label="Search or run a command"
            aria-controls="command-palette-list"
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--t1)', fontSize: 14 }}
          />
          <kbd style={{ fontSize: 10, color: 'var(--t3)', border: '1px solid var(--bd)', borderRadius: 4, padding: '2px 5px' }}>Esc</kbd>
        </div>

        <div id="command-palette-list" ref={listRef} role="listbox" aria-label="Results" style={{ maxHeight: '46vh', overflowY: 'auto', padding: '6px 0' }}>
          {loading && (
            <div style={{ padding: '10px 15px', fontSize: 12, color: 'var(--t3)' }}>Searching…</div>
          )}

          {items.length === 0 && !loading && (
            <div style={{ padding: '18px 15px', fontSize: 12.5, color: 'var(--t3)', textAlign: 'center' }}>
              {term.length < 2 ? 'Type at least two characters to search.' : `Nothing matches “${term}”.`}
            </div>
          )}

          {items.map((item, i) => {
            const meta = item.kind === 'result' ? TYPE_META[item.type] : null;
            return (
              <button
                key={`${item.kind}-${item.id}`}
                role="option"
                aria-selected={i === active}
                data-active={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(item)}
                style={{ ...rowBase, background: i === active ? 'rgba(255,255,255,.05)' : 'none' }}
              >
                <I n={meta ? meta.icon : item.icon} s={14} c={i === active ? 'var(--green)' : 'var(--t3)'} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.kind === 'action' ? item.label : item.title}
                  {item.kind === 'result' && item.subtitle && (
                    <span style={{ color: 'var(--t3)', fontSize: 11.5, marginLeft: 8 }}>{item.subtitle}</span>
                  )}
                </span>
                {meta && (
                  <span style={{ fontSize: 10, color: 'var(--t3)', border: '1px solid var(--bd)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>
                    {meta.label}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 14, padding: '8px 15px', borderTop: '1px solid var(--bd)', fontSize: 10.5, color: 'var(--t3)' }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
