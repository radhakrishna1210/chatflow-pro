import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { navigate } from '../App.jsx';
import { I } from '../components/Icons.jsx';
import MobileNavButton from '../components/MobileNavButton.jsx';
import { RcFooter } from '../components/resources/ResourceChrome.jsx';
import ResourceCard from '../components/resources/ResourceCard.jsx';
import InteractiveWorkflow from '../components/resources/InteractiveWorkflow.jsx';
import TroubleshootingExplorer from '../components/resources/TroubleshootingExplorer.jsx';
import ResourceDetail from './ResourceDetail.jsx';
import ResourceCategory from './ResourceCategory.jsx';
import {
  CATEGORIES, CATEGORY_NAME, TYPES, DIFFICULTIES, QUICK_TYPES,
  allResources, byCategory, categoryCount, featured, popular, search,
} from '../data/resources.js';
import '../styles/resources.css';

const PAGE_SIZE = 9;
const TYPE_LABEL = { guide: 'Guides', workflow: 'Workflows', api: 'API docs', troubleshooting: 'Troubleshooting' };

/* Pointer-tracked light on glass cards (ported from the example HTML). */
function trackGlass(e) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
}

/* Reveal-on-scroll — mirrors the app's IntersectionObserver pattern. */
function useReveal(depsKey) {
  useEffect(() => {
    const els = document.querySelectorAll('.rc-reveal:not(.in)');
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      }),
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [depsKey]);
}

function setMeta(title, description) {
  document.title = title;
  let tag = document.querySelector('meta[name="description"]');
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', 'description');
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', description);
}

function readParams() {
  const p = new URLSearchParams(window.location.search);
  const q = p.get('q') || '';
  // A search is global (see the results memo) — if the link carries a query,
  // the chip params alongside it are dead weight; ignore them so clearing the
  // search later starts from a clean, unfiltered library.
  if (q.trim()) return { q, category: 'all', type: 'all', level: 'all' };
  return {
    q: '',
    category: p.get('category') || 'all',
    type: p.get('type') || 'all',
    level: p.get('level') || 'all',
  };
}

export default function ResourceCenter({ slug }) {
  // Sub-routing is delegated here so /resources, /resources/category/:id and
  // /resources/:slug all share the same top-level route entry and chrome.
  if (slug) {
    const clean = slug.replace(/\/+$/, '');
    if (clean.startsWith('category/')) {
      return <ResourceCategory categoryId={decodeURIComponent(clean.slice('category/'.length))} />;
    }
    return <ResourceDetail slug={decodeURIComponent(clean)} />;
  }

  const init = readParams();
  const [q, setQ] = useState(init.q);
  const [category, setCategory] = useState(init.category);
  const [type, setType] = useState(init.type);
  const [level, setLevel] = useState(init.level);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const gridRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    setMeta(
      'Resource Center — Spandan',
      'Guides, tutorials, interactive product journeys and developer reference for every part of Spandan — from your first campaign to your first webhook.'
    );
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  // Keep the URL shareable without forcing an App re-render (replaceState).
  useEffect(() => {
    const p = new URLSearchParams();
    if (q.trim()) {
      // While searching, only `q` is meaningful — the chip filters are ignored
      // (see results memo), so don't leave them in a shareable/reloadable URL.
      p.set('q', q.trim());
    } else {
      if (category !== 'all') p.set('category', category);
      if (type !== 'all') p.set('type', type);
      if (level !== 'all') p.set('level', level);
    }
    const qs = p.toString();
    window.history.replaceState({}, '', `/resources${qs ? `?${qs}` : ''}`);
  }, [q, category, type, level]);

  const anyFilter = q.trim() || category !== 'all' || type !== 'all' || level !== 'all';

  const results = useMemo(() => {
    // A search is always global — the chip filters below only apply when the
    // box is empty. Composing them lets an invisible filter scrolled past up
    // top silently zero out a perfectly good search (e.g. type=api + "workflow").
    if (q.trim()) return search(q, allResources());
    let pool = allResources();
    if (category !== 'all') pool = pool.filter((r) => r.category === category);
    if (type !== 'all') pool = pool.filter((r) => r.type === type);
    if (level !== 'all') pool = pool.filter((r) => r.difficulty === level);
    return pool;
  }, [q, category, type, level]);

  useReveal(`${category}|${type}|${level}|${q}|${visible}`);
  useEffect(() => { setVisible(PAGE_SIZE); }, [q, category, type, level]);

  const scrollToGrid = useCallback(() => {
    requestAnimationFrame(() => {
      const el = gridRef.current;
      if (!el) return;
      // Find the nearest scrollable ancestor (Dashboard content area)
      let scrollParent = el.parentElement;
      while (scrollParent && scrollParent !== document.documentElement) {
        const { overflow, overflowY } = getComputedStyle(scrollParent);
        if (overflow === 'auto' || overflow === 'scroll' || overflowY === 'auto' || overflowY === 'scroll') break;
        scrollParent = scrollParent.parentElement;
      }
      if (scrollParent && scrollParent !== document.documentElement) {
        const containerRect = scrollParent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        scrollParent.scrollTo({ top: scrollParent.scrollTop + elRect.top - containerRect.top - 20, behavior: 'smooth' });
      } else {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }, []);

  const clearFilters = () => { setQ(''); setCategory('all'); setType('all'); setLevel('all'); };
  const scrollToEl = useCallback((el) => {
    if (!el) return;
    let scrollParent = el.parentElement;
    while (scrollParent && scrollParent !== document.documentElement) {
      const { overflow, overflowY } = getComputedStyle(scrollParent);
      if (overflow === 'auto' || overflow === 'scroll' || overflowY === 'auto' || overflowY === 'scroll') break;
      scrollParent = scrollParent.parentElement;
    }
    if (scrollParent && scrollParent !== document.documentElement) {
      const containerRect = scrollParent.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      scrollParent.scrollTo({ top: scrollParent.scrollTop + elRect.top - containerRect.top - 20, behavior: 'smooth' });
    } else {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const pickQuick = (qt) => {
    if (qt.anchor) {
      const target = document.getElementById(qt.anchor);
      if (target) scrollToEl(target);
      return;
    }
    // These are filter shortcuts, not search — clear any query so the filtered
    // Library view (and its chips) is what shows.
    setQ('');
    setType((cur) => (cur === qt.type ? 'all' : qt.type));
    scrollToGrid();
  };

  const shown = results.slice(0, visible);
  const feat = featured();
  const pop = popular();
  const devResources = byCategory('developers');

  return (
    <div className="rc">
      <div className="rc-topbar">
        <MobileNavButton />
        <h1>Resource Center</h1>
        <p>Guides, product journeys &amp; developer reference</p>
      </div>
      <div className="rc-aurora" aria-hidden="true"><div className="a" /><div className="b" /><div className="c" /></div>

      <main>
        {/* ── HERO ─────────────────────────────────────────────── */}
        <section className="rc-hero rc-wrap">
          <span className="rc-eyebrow"><span className="dot" /> Spandan Resource Center</span>
          <h1>Learn how to get the most out of <span>Spandan</span></h1>
          <p>Practical guides, interactive product journeys and developer resources for every part of your WhatsApp messaging workflow.</p>
          <form
            className="rc-search"
            role="search"
            onSubmit={(e) => { e.preventDefault(); scrollToGrid(); }}
          >
            <span className="rc-search-ico">
              <I n="search" s={18} c="var(--t1)" />
            </span>
            <label htmlFor="rc-search-input" className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              Search resources
            </label>
            <input
              id="rc-search-input"
              ref={searchRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder='Search resources — "campaign", "template rejected", "webhook", "wallet"…'
              autoComplete="off"
            />
            {q && (
              <button type="button" className="rc-search-clear" onClick={() => { setQ(''); searchRef.current?.focus(); }} aria-label="Clear search">
                <I n="x" s={13} c="var(--t1)" />
              </button>
            )}
          </form>

          {q.trim() && (
            <div className="rc-search-feedback" aria-live="polite">
              <span>
                {results.length === 0
                  ? <>No resources match <strong>“{q.trim()}”</strong></>
                  : <><strong>{results.length}</strong> {results.length === 1 ? 'resource' : 'resources'} match <strong>“{q.trim()}”</strong></>}
              </span>
              {results.length > 0 && (
                <button type="button" onClick={scrollToGrid}>
                  Jump to results <I n="arrow" s={12} c="var(--accent)" />
                </button>
              )}
            </div>
          )}

          <div className="rc-quick" style={{ marginTop: 22 }}>
            {QUICK_TYPES.map((qt) => (
              <button
                key={qt.label}
                className={!qt.anchor && type === qt.type ? 'active' : ''}
                onClick={() => pickQuick(qt)}
              >
                <I n={qt.icon} s={14} c={!qt.anchor && type === qt.type ? 'var(--green)' : 'var(--t2)'} />
                {qt.label}
              </button>
            ))}
          </div>
        </section>

        {/* ── KNOWLEDGE BASE / CATEGORY GRID ───────────────────── */}
        <section className="rc-section rc-wrap" id="topics" style={{ scrollMarginTop: 80 }}>
          <div className="rc-section-head rc-reveal">
            <span className="k">Explore Spandan</span>
            <h2>Browse the knowledge base by topic</h2>
            <p>Every topic has its own page — what it is, what you use it for, its key features and every guide in that area.</p>
          </div>
          <div className="rc-kb-grid">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                className="rc-kb-card rc-glass rc-reveal"
                onClick={() => navigate(`/resources/category/${c.id}`)}
                onMouseMove={trackGlass}
                aria-label={`${c.name} — open section`}
              >
                <span className="ico"><I n={c.icon} s={20} c="var(--green)" /></span>
                <h3>{c.name}</h3>
                <p>{c.blurb}</p>
                <span className="count">
                  {categoryCount(c.id)} resource{categoryCount(c.id) === 1 ? '' : 's'}
                  <I n="arrow" s={12} c="var(--green)" />
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* ── FEATURED ─────────────────────────────────────────── */}
        <section className="rc-section rc-wrap">
          <div className="rc-section-head rc-reveal">
            <span className="k">Start here</span>
            <h2>Featured resources</h2>
            <p>The guides new workspaces reach for first, following the real product flow.</p>
          </div>
          <div className="rc-res-grid">
            {feat.map((r) => <div key={r.slug} className="rc-reveal"><ResourceCard resource={r} onMouseTrack={trackGlass} /></div>)}
          </div>
        </section>

        {/* ── ALL GUIDES + FILTERS ─────────────────────────────── */}
        <section className="rc-section rc-wrap" id="library" ref={gridRef} style={{ scrollMarginTop: 80 }}>
          <div className="rc-section-head rc-reveal">
            <span className="k">Library</span>
            <h2>All resources</h2>
            <p>Filter by what you're working on right now. Filters and search update the results instantly and are shareable via the URL.</p>
          </div>

          {q.trim() ? (
            <div className="rc-search-mode rc-reveal">
              <span>
                <I n="search" s={14} c="var(--accent)" />
                Searching all resources for <strong>“{q.trim()}”</strong>
              </span>
              <button type="button" onClick={() => setQ('')}>
                Clear search to browse by filter
              </button>
            </div>
          ) : (
          <div className="rc-filters rc-reveal">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
              <div className="rc-filter-group">
                <span>Type</span>
                <div className="rc-chips">
                  <button className={`rc-chip${type === 'all' ? ' active' : ''}`} onClick={() => setType('all')}>All</button>
                  {TYPES.map((t) => (
                    <button key={t} className={`rc-chip${type === t ? ' active' : ''}`} onClick={() => setType(type === t ? 'all' : t)}>
                      {TYPE_LABEL[t] || t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rc-filter-group">
                <span>Difficulty</span>
                <div className="rc-chips">
                  <button className={`rc-chip${level === 'all' ? ' active' : ''}`} onClick={() => setLevel('all')}>All</button>
                  {DIFFICULTIES.map((d) => (
                    <button key={d} className={`rc-chip${level === d ? ' active' : ''}`} onClick={() => setLevel(level === d ? 'all' : d)}>{d}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="rc-filter-group">
              <span>Category</span>
              <div className="rc-chips">
                <button className={`rc-chip${category === 'all' ? ' active' : ''}`} onClick={() => setCategory('all')}>All</button>
                {CATEGORIES.map((c) => (
                  <button key={c.id} className={`rc-chip${category === c.id ? ' active' : ''}`} onClick={() => setCategory(category === c.id ? 'all' : c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
          )}

          <div className="rc-filter-meta rc-reveal" style={{ marginBottom: 18 }}>
            <span>{results.length} result{results.length === 1 ? '' : 's'}{q.trim() ? <> for “{q.trim()}”</> : null}</span>
            {!q.trim() && category !== 'all' && (
              <button className="rc-clear-btn" onClick={() => navigate(`/resources/category/${category}`)}>
                Open the {CATEGORY_NAME[category]} section →
              </button>
            )}
            {anyFilter && <button className="rc-clear-btn" onClick={clearFilters}>Clear {q.trim() ? 'search' : 'filters'}</button>}
          </div>

          {shown.length === 0 ? (
            <div className="rc-empty rc-reveal">
              <div style={{ marginBottom: 12 }}><I n="search" s={26} c="var(--t2)" /></div>
              <h3>{q.trim() ? <>No resources match “{q.trim()}”</> : 'No resources match those filters'}</h3>
              <p style={{ fontSize: 14, marginBottom: 16 }}>
                {q.trim() ? 'Try a different or broader search term.' : 'Try a broader search term or clear one of the filters.'}
              </p>
              <button className="rc-btn rc-btn-ghost" onClick={clearFilters}>Clear {q.trim() ? 'search' : 'all filters'}</button>
            </div>
          ) : (
            <>
              <div className="rc-res-grid">
                {shown.map((r) => (
                  <div key={r.slug} className="rc-reveal">
                    <ResourceCard resource={r} onMouseTrack={trackGlass} />
                  </div>
                ))}
              </div>
              {visible < results.length && (
                <div className="rc-more-wrap">
                  <button className="rc-btn rc-btn-ghost rc-btn-lg" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                    Load more ({results.length - visible} left)
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* ── INTERACTIVE JOURNEYS ─────────────────────────────── */}
        <section className="rc-section rc-wrap" id="journeys" style={{ scrollMarginTop: 80 }}>
          <div className="rc-section-head rc-reveal">
            <span className="k">Do it step by step</span>
            <h2>Interactive product journeys</h2>
            <p>Click through the real Spandan flow — every step shows the module, prerequisites, expected result and the errors people hit.</p>
          </div>
          <div className="rc-reveal">
            <InteractiveWorkflow />
          </div>
        </section>

        {/* ── DEVELOPER RESOURCES ──────────────────────────────── */}
        <section className="rc-section rc-wrap">
          <div className="rc-section-head rc-reveal">
            <span className="k">For developers</span>
            <h2>Developer resources</h2>
            <p>Spandan is API-first. Authenticate with a workspace API key, send messages programmatically and receive webhooks. Exact endpoint paths and payloads for your workspace live on the API Keys screen in-app.</p>
          </div>
          <div className="rc-res-grid">
            {devResources.map((r) => (
              <div key={r.slug} className="rc-reveal"><ResourceCard resource={r} onMouseTrack={trackGlass} /></div>
            ))}
          </div>
          <div className="rc-more-wrap">
            <button className="rc-btn rc-btn-ghost" onClick={() => navigate('/resources/category/developers')}>
              Open the APIs &amp; Webhooks section <I n="arrow" s={12} c="var(--t1)" />
            </button>
          </div>
        </section>

        {/* ── TROUBLESHOOTING EXPLORER ─────────────────────────── */}
        <section className="rc-section rc-wrap">
          <div className="rc-section-head rc-reveal">
            <span className="k">Stuck on something?</span>
            <h2>Troubleshooting</h2>
            <p>Tell us what you're trying to do and we'll show the checks and guides that resolve it fastest.</p>
          </div>
          <div className="rc-reveal"><TroubleshootingExplorer /></div>
        </section>

        {/* ── POPULAR ──────────────────────────────────────────── */}
        <section className="rc-section rc-wrap">
          <div className="rc-section-head rc-reveal">
            <span className="k">Most read</span>
            <h2>Popular resources</h2>
            <p>What Spandan teams open most often.</p>
          </div>
          <div className="rc-res-grid">
            {pop.map((r) => (
              <div key={r.slug} className="rc-reveal"><ResourceCard resource={r} onMouseTrack={trackGlass} /></div>
            ))}
          </div>
        </section>

        {/* ── CTA ──────────────────────────────────────────────── */}
        <section className="rc-section">
          <div className="rc-cta-band rc-reveal">
            <h2>Ready to put this into practice?</h2>
            <p>Jump back into Spandan, or follow the Getting Started journey end to end.</p>
            <div className="rc-cta-actions" style={{ marginTop: 24 }}>
              <button className="rc-btn rc-btn-cta rc-btn-lg" onClick={() => navigate('/dashboard')}>
                Open your dashboard <I n="arrow" s={14} c="#060A10" />
              </button>
              <button className="rc-btn rc-btn-ghost rc-btn-lg" onClick={() => navigate('/resources/getting-started-with-chatflow-pro')}>
                Read the Getting Started guide
              </button>
            </div>
          </div>
        </section>
      </main>

      <RcFooter />
    </div>
  );
}
