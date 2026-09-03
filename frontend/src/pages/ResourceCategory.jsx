import { useEffect, useMemo } from 'react';
import { navigate } from '../App.jsx';
import { I } from '../components/Icons.jsx';
import MobileNavButton from '../components/MobileNavButton.jsx';
import { RcFooter } from '../components/resources/ResourceChrome.jsx';
import ResourceCard from '../components/resources/ResourceCard.jsx';
import InteractiveWorkflow from '../components/resources/InteractiveWorkflow.jsx';
import TroubleshootingExplorer from '../components/resources/TroubleshootingExplorer.jsx';
import {
  getCategory, byCategory, difficultyRange, featuredInCategory, relatedCategories,
  JOURNEYS,
} from '../data/resources.js';
import '../styles/resources.css';

// A category id → the interactive journey most relevant to it (if any).
const CATEGORY_JOURNEY = {
  'getting-started': 'launch-first-campaign',
  'whatsapp-numbers': 'connect-whatsapp',
  templates: 'template-approval',
  campaigns: 'launch-first-campaign',
  automation: 'setup-automation',
  'ai-agent': 'deploy-ai-agent',
  team: 'invite-team-member',
  billing: 'recharge-wallet',
};

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

function trackGlass(e) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
}

function NotFound() {
  return (
    <div className="rc">
      <div className="rc-aurora" aria-hidden="true"><div className="a" /><div className="b" /><div className="c" /></div>
      
      <main className="rc-detail-wrap" style={{ paddingBottom: 60, textAlign: 'center' }}>
        <div style={{ padding: '60px 0' }}>
          <div style={{ marginBottom: 16 }}><I n="alertc" s={30} c="var(--t2)" /></div>
          <h1 style={{ fontSize: 28, marginBottom: 10 }}>Section not found</h1>
          <p style={{ color: 'var(--t2)', fontSize: 15, marginBottom: 22 }}>That topic doesn’t exist or has moved.</p>
          <button className="rc-btn rc-btn-cta rc-btn-lg" onClick={() => navigate('/resources')}>
            Back to the Resource Center
          </button>
        </div>
      </main>
      <RcFooter />
    </div>
  );
}

export default function ResourceCategory({ categoryId }) {
  const category = getCategory(categoryId);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (!category) { setMeta('Section not found — Spandan', 'The requested section could not be found.'); return; }
    setMeta(
      `${category.name} — Spandan Resource Center`,
      `${category.overview} Guides, features and how-to for ${category.name} in Spandan.`
    );
  }, [categoryId]); // eslint-disable-line

  const resources = useMemo(() => (category ? byCategory(categoryId) : []), [categoryId]); // eslint-disable-line
  const feat = category ? featuredInCategory(categoryId) : null;
  const rest = feat ? resources.filter((r) => r.slug !== feat.slug) : resources;
  const related = category ? relatedCategories(categoryId, 4) : [];
  const range = category ? difficultyRange(categoryId) : null;
  const journeyId = category ? CATEGORY_JOURNEY[categoryId] : null;
  const journey = journeyId ? JOURNEYS.find((j) => j.id === journeyId) : null;
  const isTroubleshooting = categoryId === 'troubleshooting';

  if (!category) return <NotFound />;

  return (
    <div className="rc rc-cat">
      <div className="rc-topbar">
        <MobileNavButton />
        <h1>Resource Center</h1>
        <p>Guides, product journeys &amp; developer reference</p>
      </div>
      <div className="rc-aurora" aria-hidden="true"><div className="a" /><div className="b" /><div className="c" /></div>

      <div className="rc-detail-wrap">
        <nav className="rc-breadcrumb" aria-label="Breadcrumb">
          <button onClick={() => navigate('/resources')}>Resource Center</button>
          <span className="sep" aria-hidden="true">/</span>
          <span className="cur">{category.name}</span>
        </nav>

        {/* ── Category hero ─────────────────────────────────────── */}
        <header className="rc-cat-hero">
          <span className="rc-cat-hero-ico"><I n={category.icon} s={26} c="var(--green)" /></span>
          <div>
            <h1>{category.name}</h1>
            <p>{category.overview}</p>
            <div className="rc-cat-meta">
              <span><I n="file" s={13} c="var(--t3)" /> {resources.length} guide{resources.length === 1 ? '' : 's'}</span>
              {range && <span><I n="chart" s={13} c="var(--t3)" /> {range}</span>}
              <span><I n="check" s={13} c="var(--t3)" /> Reflects the live Spandan product</span>
            </div>
          </div>
        </header>
      </div>

      <main>
        {/* ── What you use it for ──────────────────────────────── */}
        {category.useFor?.length > 0 && (
          <section className="rc-section rc-wrap">
            <div className="rc-section-head" style={{ marginBottom: 26, textAlign: 'left', maxWidth: 720 }}>
              <span className="k">What it’s for</span>
              <h2>When you’ll use {category.name}</h2>
            </div>
            <div className="rc-cat-uses">
              {category.useFor.map((u) => (
                <div className="rc-cat-use rc-glass" key={u} onMouseMove={trackGlass}>
                  <span className="tick"><I n="check" s={13} c="var(--green)" w={2.6} /></span>
                  <span>{u}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Key features ─────────────────────────────────────── */}
        {category.features?.length > 0 && (
          <section className="rc-section rc-wrap">
            <div className="rc-section-head" style={{ marginBottom: 26, textAlign: 'left', maxWidth: 720 }}>
              <span className="k">Key features</span>
              <h2>What {category.name} gives you</h2>
            </div>
            <div className="rc-cat-features">
              {category.features.map((f, i) => (
                <div className="rc-cat-feature rc-glass" key={f.title} onMouseMove={trackGlass}>
                  <span className="num">{String(i + 1).padStart(2, '0')}</span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Guides in this section ───────────────────────────── */}
        <section className="rc-section rc-wrap">
          <div className="rc-section-head" style={{ marginBottom: 26, textAlign: 'left', maxWidth: 720 }}>
            <span className="k">Guides</span>
            <h2>{resources.length} {resources.length === 1 ? 'resource' : 'resources'} in {category.name}</h2>
          </div>

          {resources.length === 0 ? (
            <div className="rc-empty">
              <h3>No guides here yet</h3>
              <p style={{ fontSize: 14, marginBottom: 16 }}>This section is being written. Browse the rest of the library in the meantime.</p>
              <button className="rc-btn rc-btn-ghost" onClick={() => navigate('/resources')}>Back to the Resource Center</button>
            </div>
          ) : (
              <div className="rc-res-grid">
                {resources.map((r) => (
                  <div className="rc-reveal" key={r.slug}>
                    <ResourceCard resource={r} onMouseTrack={trackGlass} />
                  </div>
                ))}
              </div>
          )}
        </section>

        {/* ── Section-specific interactive block ───────────────── */}
        {isTroubleshooting ? (
          <section className="rc-section rc-wrap">
            <div className="rc-section-head" style={{ marginBottom: 26, textAlign: 'left', maxWidth: 720 }}>
              <span className="k">Interactive</span>
              <h2>Find the fix</h2>
              <p>Pick what you’re trying to do and get the checks and guides that resolve it fastest.</p>
            </div>
            <TroubleshootingExplorer />
          </section>
        ) : journey ? (
          <section className="rc-section rc-wrap">
            <div className="rc-section-head" style={{ marginBottom: 26, textAlign: 'left', maxWidth: 720 }}>
              <span className="k">Do it step by step</span>
              <h2>{journey.title}</h2>
              <p>Click through the flow — each step shows the module, prerequisites, expected result and common errors.</p>
            </div>
            <InteractiveWorkflow initialId={journey.id} />
          </section>
        ) : null}

        {/* ── Related sections ─────────────────────────────────── */}
        {related.length > 0 && (
          <section className="rc-section rc-wrap">
            <div className="rc-section-head" style={{ marginBottom: 26, textAlign: 'left', maxWidth: 720 }}>
              <span className="k">Keep exploring</span>
              <h2>Related sections</h2>
            </div>
            <div className="rc-kb-grid">
              {related.map((c) => (
                <button
                  key={c.id}
                  className="rc-kb-card rc-glass"
                  onClick={() => navigate(`/resources/category/${c.id}`)}
                  onMouseMove={trackGlass}
                  aria-label={`${c.name} — open section`}
                >
                  <span className="ico"><I n={c.icon} s={20} c="var(--green)" /></span>
                  <h3>{c.name}</h3>
                  <p>{c.blurb}</p>
                  <span className="count">Open section <I n="arrow" s={12} c="var(--green)" /></span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── CTA ──────────────────────────────────────────────── */}
        <section className="rc-section">
          <div className="rc-cta-band">
            <h2>Put {category.name} into practice</h2>
            <p>Open the module in Spandan, or keep exploring the library.</p>
            <div className="rc-cta-actions" style={{ marginTop: 22 }}>
              <button className="rc-btn rc-btn-cta rc-btn-lg" onClick={() => navigate('/dashboard')}>
                Open your dashboard <I n="arrow" s={14} c="#060A10" />
              </button>
              <button className="rc-btn rc-btn-ghost rc-btn-lg" onClick={() => navigate('/resources')}>
                Back to the Resource Center
              </button>
            </div>
          </div>
        </section>
      </main>

      <RcFooter />
    </div>
  );
}
