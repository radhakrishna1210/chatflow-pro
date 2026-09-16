import { useState, useEffect, useMemo } from 'react';
import { navigate } from '../App.jsx';
import { I } from '../components/Icons.jsx';
import MobileNavButton from '../components/MobileNavButton.jsx';
import { RcFooter } from '../components/resources/ResourceChrome.jsx';
import ResourceCard from '../components/resources/ResourceCard.jsx';
import InteractiveWorkflow from '../components/resources/InteractiveWorkflow.jsx';
import {
  lookup, getRelated, prevNext,
  CATEGORY_NAME, CATEGORY_ICON,
} from '../data/resources.js';
import '../styles/resources.css';

const TYPE_LABEL = {
  guide: 'Guide', workflow: 'Workflow', api: 'API', troubleshooting: 'Troubleshooting',
};

// Flagship guides that have a matching interactive journey.
const SLUG_TO_JOURNEY = {
  'launch-first-campaign': 'launch-first-campaign',
  'connect-whatsapp-number': 'connect-whatsapp',
  'create-approved-template': 'template-approval',
  'build-a-workflow': 'setup-automation',
  'deploy-ai-agent': 'deploy-ai-agent',
  'invite-team-members': 'invite-team-member',
  'recharge-your-wallet': 'recharge-wallet',
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

function helpfulKey(slug) { return `rc_helpful_${slug}`; }

function NotFound() {
  return (
    <div className="rc">
      <div className="rc-aurora" aria-hidden="true"><div className="a" /><div className="b" /><div className="c" /></div>
      
      <main className="rc-detail-wrap" style={{ paddingBottom: 60, textAlign: 'center' }}>
        <div style={{ padding: '60px 0' }}>
          <div style={{ marginBottom: 16 }}><I n="alertc" s={30} c="var(--t2)" /></div>
          <h1 style={{ fontSize: 28, marginBottom: 10 }}>Resource not found</h1>
          <p style={{ color: 'var(--t2)', fontSize: 15, marginBottom: 22 }}>
            That resource doesn’t exist or has moved.
          </p>
          <button className="rc-btn rc-btn-cta rc-btn-lg" onClick={() => navigate('/resources')}>
            Back to the Resource Center
          </button>
        </div>
      </main>
      <RcFooter />
    </div>
  );
}

export default function ResourceDetail({ slug }) {
  const resource = lookup(slug);
  const [helpful, setHelpful] = useState(null);
  const [activeSection, setActiveSection] = useState('overview');

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (!resource) { setMeta('Resource not found — Spandan', 'The requested resource could not be found.'); return; }
    setMeta(`${resource.title} — Spandan Resource Center`, resource.description || resource.intro || resource.title);
    try {
      const saved = localStorage.getItem(helpfulKey(slug));
      setHelpful(saved === 'yes' || saved === 'no' ? saved : null);
    } catch { setHelpful(null); }
  }, [slug]); // eslint-disable-line

  const related = useMemo(() => (resource ? getRelated(slug, 3) : []), [slug]); // eslint-disable-line
  const { prev, next } = useMemo(() => (resource ? prevNext(slug) : { prev: null, next: null }), [slug]); // eslint-disable-line

  const sections = useMemo(() => {
    if (!resource) return [];
    const s = [{ id: 'overview', label: 'Overview' }];
    if (resource.learn?.length) s.push({ id: 'what-youll-learn', label: 'What you’ll learn' });
    if (resource.steps?.length) s.push({ id: 'steps', label: 'Step by step' });
    if (resource.tips?.length) s.push({ id: 'tips', label: 'Tips & common issues' });
    if (SLUG_TO_JOURNEY[slug]) s.push({ id: 'walkthrough', label: 'Interactive walkthrough' });
    return s;
  }, [slug]); // eslint-disable-line

  // Scrollspy for the table of contents.
  useEffect(() => {
    if (!resource) return;
    const targets = sections.map((sec) => document.getElementById(sec.id)).filter(Boolean);
    if (!targets.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActiveSection(vis[0].target.id);
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, [slug, sections]); // eslint-disable-line

  if (!resource) return <NotFound />;

  const catName = CATEGORY_NAME[resource.category] || resource.category;
  const journeyId = SLUG_TO_JOURNEY[slug];

  const rate = (val) => {
    setHelpful(val);
    try { localStorage.setItem(helpfulKey(slug), val); } catch { /* private mode */ }
  };

  return (
    <div className="rc rc-detail">
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
          <button onClick={() => navigate(`/resources/category/${resource.category}`)}>{catName}</button>
          <span className="sep" aria-hidden="true">/</span>
          <span className="cur">{resource.title}</span>
        </nav>

        <header className="rc-detail-head">
          <div className="kicker">
            <span className="rc-badge type">{TYPE_LABEL[resource.type] || resource.type}</span>
            <span className="rc-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <I n={CATEGORY_ICON[resource.category] || 'file'} s={11} c="var(--t2)" /> {catName}
            </span>
            {resource.difficulty && <span className={`rc-badge lvl-${resource.difficulty}`}>{resource.difficulty}</span>}
          </div>
          <h1>{resource.title}</h1>
          <p className="lead">{resource.intro || resource.description}</p>
          <div className="rc-detail-meta">
            {resource.duration && <span><I n="play" s={13} c="var(--t3)" /> {resource.duration} read</span>}
            <span><I n="file" s={13} c="var(--t3)" /> {catName}</span>
            <span><I n="check" s={13} c="var(--t3)" /> Based on the live Spandan product flow</span>
          </div>
        </header>

        <div className="rc-detail-grid">
          <article className="rc-content">
            <h2 id="overview">Overview</h2>
            <p>{resource.intro || resource.description}</p>

            {resource.learn?.length > 0 && (
              <>
                <h2 id="what-youll-learn">What you’ll learn</h2>
                <ul>{resource.learn.map((l) => <li key={l}>{l}</li>)}</ul>
              </>
            )}

            {resource.steps?.length > 0 && (
              <>
                <h2 id="steps">Step by step</h2>
                {resource.steps.map((st, i) => (
                  <div className="rc-step" key={st.title}>
                    <span className="n">{i + 1}</span>
                    <div>
                      <h3>{st.title}</h3>
                      <p>{st.body}</p>
                    </div>
                  </div>
                ))}
              </>
            )}

            {resource.tips?.length > 0 && (
              <>
                <h2 id="tips">Tips &amp; common issues</h2>
                <div className="callout warn">
                  <span className="ico"><I n="alertt" s={16} c="var(--rc-amber, #F59E0B)" /></span>
                  <div>
                    <ul style={{ margin: 0 }}>{resource.tips.map((t) => <li key={t}>{t}</li>)}</ul>
                  </div>
                </div>
              </>
            )}

            {journeyId && (
              <>
                <h2 id="walkthrough">Interactive walkthrough</h2>
                <p>Click through this flow step by step — each step shows the module, prerequisites, expected result and common errors.</p>
                <div style={{ marginTop: 14 }}>
                  <InteractiveWorkflow initialId={journeyId} />
                </div>
              </>
            )}

            <div className="callout success" style={{ marginTop: 24 }}>
              <span className="ico"><I n="arrow" s={16} c="var(--green)" /></span>
              <div>
                <strong style={{ color: 'var(--t1)' }}>Explore the whole {catName} section.</strong>{' '}
                <button
                  onClick={() => navigate(`/resources/category/${resource.category}`)}
                  style={{ background: 'none', border: 'none', color: 'var(--green)', fontWeight: 700, cursor: 'pointer', fontSize: 13.5, padding: 0, fontFamily: 'inherit' }}
                >
                  What it is, what it’s for &amp; every guide →
                </button>
              </div>
            </div>

            <div className="rc-helpful">
              {helpful ? (
                <>
                  <p>Thanks for the feedback.</p>
                  <span className="thanks">
                    {helpful === 'yes' ? 'Glad this helped.' : 'We’ll use this to improve the guide.'}
                  </span>
                </>
              ) : (
                <>
                  <p>Was this helpful?</p>
                  <div className="actions">
                    <button onClick={() => rate('yes')}><I n="check" s={13} c="var(--t1)" /> Yes</button>
                    <button onClick={() => rate('no')}><I n="x" s={13} c="var(--t1)" /> No</button>
                  </div>
                </>
              )}
            </div>

            <div className="rc-prevnext">
              {prev ? (
                <button onClick={() => navigate(`/resources/${prev.slug}`)}>
                  <div className="lbl">← Previous</div>
                  <div className="ttl">{prev.title}</div>
                </button>
              ) : <span />}
              {next ? (
                <button className="next" onClick={() => navigate(`/resources/${next.slug}`)}>
                  <div className="lbl">Next →</div>
                  <div className="ttl">{next.title}</div>
                </button>
              ) : <span />}
            </div>

            <div style={{ marginTop: 18 }}>
              <button className="rc-btn rc-btn-ghost" onClick={() => navigate('/resources')}>
                <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><I n="arrow" s={12} c="var(--t1)" /></span> Back to the Resource Center
              </button>
            </div>
          </article>

          {sections.length > 1 && (
            <aside>
              <div className="rc-toc">
                <h4>On this page</h4>
                {sections.map((sec) => (
                  <a
                    key={sec.id}
                    href={`#${sec.id}`}
                    className={activeSection === sec.id ? 'active' : ''}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(sec.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                  >
                    {sec.label}
                  </a>
                ))}
              </div>
            </aside>
          )}
        </div>

        {related.length > 0 && (
          <section className="rc-related">
            <h2>Related resources</h2>
            <div className="rc-res-grid">
              {related.map((r) => <ResourceCard key={r.slug} resource={r} />)}
            </div>
          </section>
        )}
      </div>

      <RcFooter />
    </div>
  );
}
