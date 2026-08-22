import { useState, useEffect, useRef } from 'react';
import { I } from './Icons.jsx';
import { Btn } from './Btn.jsx';
import { navigate } from '../App.jsx';
import { FOOTER_COLS, FOOTER_BLURB, FOOTER_LEGAL } from '../../../backend/src/data/siteContent.js';

// ─── Shared marketing chrome ─────────────────────────────────────────────────
//
// The signed-out surfaces — the landing page and the product pages under
// /product — are one site and have to look like it. These pieces used to live
// inside Landing.jsx, which was fine while there was one page; a second page
// would have meant a second nav that drifts from the first the moment either
// is touched. They moved here whole, so both pages share one header, one
// footer, one reveal observer and one set of breakpoints.
//
// Everything is presentation. The words come from
// backend/src/data/siteContent.js, which the website assistant also indexes —
// see the comment at the top of that file.

export const MONO = 'var(--mono)';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

// One observer shared by every <Reveal> on the page, created on first use.
// Elements are unobserved once they fire — a reveal that replays on every
// scroll past is a distraction, not an entrance.
//
// Each Reveal registers itself rather than the page sweeping for
// [data-reveal] on mount: sections that appear later (the cost calculator
// waits for its rates) would never be picked up by a one-time sweep, and an
// element left at opacity 0 still occupies its space — an invisible section
// with a page-height hole where it should be.
let revealObserver = null;
function observeReveal(el) {
  if (typeof IntersectionObserver === 'undefined') { el.classList.add('in'); return () => {}; }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        revealObserver.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
  }
  revealObserver.observe(el);
  return () => revealObserver.unobserve(el);
}

// True once the element has been seen. Drives the hero conversation so it
// plays when it is actually on screen rather than while the page is loading.
export function useInView(ref, { once = true } = {}) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) { setSeen(true); return undefined; }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setSeen(true);
        if (once) io.disconnect();
      } else if (!once) setSeen(false);
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, once]);
  return seen;
}

// Pointer position as CSS vars, so .glass-lit can put a highlight where the
// cursor is. Cheap enough to attach per card: two custom properties, no state.
export const trackLight = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
};

export const Glass = ({ as: Tag = 'div', className = '', lit = true, style, children, ...rest }) => (
  <Tag
    className={`glass${lit ? ' glass-lit glass-lift' : ''}${className ? ` ${className}` : ''}`}
    onMouseMove={lit ? trackLight : undefined}
    style={style}
    {...rest}
  >
    {children}
  </Tag>
);

export const Reveal = ({ delay = 0, style, children, ...rest }) => {
  const ref = useRef(null);
  useEffect(() => (ref.current ? observeReveal(ref.current) : undefined), []);
  return (
    <div ref={ref} data-reveal className="reveal" style={{ transitionDelay: `${delay}ms`, ...style }} {...rest}>
      {children}
    </div>
  );
};

// Section label. The double tick is the platform's own vocabulary for
// "delivered" — the one bit of ornament, and it means something.
export const Eyebrow = ({ children }) => (
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--green)' }}>
    <svg width="15" height="10" viewBox="0 0 18 12" fill="none" aria-hidden="true">
      <path d="M1 6l4 4L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 6l4 4L17 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    {children}
  </div>
);

export const SectionHead = ({ eyebrow, title, sub, align = 'center' }) => (
  <div style={{ textAlign: align, marginBottom: 56, maxWidth: align === 'center' ? 620 : 'none', marginLeft: align === 'center' ? 'auto' : 0, marginRight: align === 'center' ? 'auto' : 0 }}>
    <Reveal><Eyebrow>{eyebrow}</Eyebrow></Reveal>
    <Reveal delay={60}>
      <h2 style={{ fontSize: 'clamp(28px,3.6vw,48px)', fontWeight: 800, letterSpacing: '-.035em', margin: '16px 0 14px' }}>{title}</h2>
    </Reveal>
    {sub && (
      <Reveal delay={120}>
        <p style={{ fontSize: 16, color: 'var(--t2)', lineHeight: 1.7, maxWidth: 520, margin: align === 'center' ? '0 auto' : 0 }}>{sub}</p>
      </Reveal>
    )}
  </div>
);

export const Aurora = () => (
  <>
    <div className="aurora-a" style={{ position: 'absolute', top: '-10%', left: '-5%', width: 620, height: 620, background: 'radial-gradient(circle, rgba(53,232,242,0.16), transparent 62%)', filter: 'blur(40px)', pointerEvents: 'none', willChange: 'transform' }} />
    <div className="aurora-b" style={{ position: 'absolute', top: '18%', right: '-12%', width: 680, height: 680, background: 'radial-gradient(circle, rgba(14,165,233,0.13), transparent 62%)', filter: 'blur(48px)', pointerEvents: 'none', willChange: 'transform' }} />
  </>
);

export const BrandMark = ({ size = 32, radius = 9, glow = true }) => (
  <div style={{ width: size, height: size, borderRadius: radius, background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: glow ? '0 0 18px rgba(53,232,242,0.35)' : 'none' }}>
    <svg width={size * 0.44} height={size * 0.44} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1C4.13 1 1 4.13 1 8c0 1.29.35 2.5.96 3.54L1 15l3.46-.96A7 7 0 1 0 8 1z" fill="#08090c" />
      <path d="M5.5 7.5h5M5.5 10h3" stroke="#35e8f2" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  </div>
);

// The site header. `links` lets a product page point at its own sections while
// keeping the same bar; the landing page passes its in-page anchors.
export const MarketingNav = ({ onNav, links = [['Product', '#story'], ['Live demo', '#playground'], ['Platform', '#platform'], ['Pricing', '#pricing']] }) => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // An anchor that points at another route has to navigate rather than jump to
  // a fragment that does not exist on the current page.
  const go = (e, href) => {
    if (!href.startsWith('#')) { e.preventDefault(); navigate(href); }
  };

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, height: 64,
      display: 'flex', alignItems: 'center',
      background: scrolled ? 'rgba(8,11,18,0.72)' : 'transparent',
      backdropFilter: scrolled ? 'blur(18px) saturate(150%)' : 'none',
      WebkitBackdropFilter: scrolled ? 'blur(18px) saturate(150%)' : 'none',
      borderBottom: `1px solid ${scrolled ? 'var(--bd)' : 'transparent'}`,
      transition: 'background .3s ease, border-color .3s ease',
    }}>
      <div style={{ maxWidth: 1240, width: '100%', margin: '0 auto', padding: '0 clamp(18px,4vw,32px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <button onClick={() => onNav('landing')} style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}>
          <BrandMark />
          <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--t1)', letterSpacing: '-.02em' }}>ChatFlow Pro</span>
        </button>

        <div className="nav-links" style={{ display: 'flex', gap: 30 }}>
          {links.map(([l, h]) => (
            <a key={l} href={h} onClick={(e) => go(e, h)} style={{ color: 'var(--t2)', fontSize: 14, fontWeight: 500, textDecoration: 'none', transition: 'color .15s' }}
              onMouseOver={e => e.target.style.color = 'var(--t1)'} onMouseOut={e => e.target.style.color = 'var(--t2)'}>{l}</a>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Btn variant="ghost" size="sm" onClick={() => onNav('login')}>Log in</Btn>
          <Btn variant="primary" size="sm" onClick={() => onNav('dashboard')}>Get started <I n="arrow" s={12} c="#08090c" /></Btn>
        </div>
      </div>
    </nav>
  );
};

// Footer column links are plain labels in siteContent.js, so the ones that are
// real destinations rather than sections of the landing page are mapped here.
// "Privacy" in particular pointed at #features, which meant the site's most
// load-bearing policy link scrolled you to the feature grid.
const FOOTER_LINK_HREFS = {
  'Campaign AI Agent': '/product/campaign-ai',
  'Privacy': '/legal/privacy',
  'Legal Center': '/legal',
};

export const MarketingFooter = ({ onNav }) => (
  <footer style={{ borderTop: '1px solid var(--bd)', padding: '56px clamp(18px,4vw,32px) 30px', background: 'rgba(13,17,33,0.5)' }}>
    <div style={{ maxWidth: 1240, margin: '0 auto' }}>
      <div className="footer-grid" style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr 1fr 1fr', gap: 40, marginBottom: 44 }}>
        <div>
          <button onClick={() => onNav('landing')} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, cursor: 'pointer', marginBottom: 14, background: 'none', border: 'none', padding: 0 }}>
            <BrandMark size={28} radius={8} glow={false} />
            <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>ChatFlow Pro</span>
          </button>
          <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.65, maxWidth: 240 }}>
            {FOOTER_BLURB}
          </p>
        </div>
        {FOOTER_COLS.map(col => (
          <div key={col.title}>
            <h4 style={{ fontFamily: MONO, fontWeight: 600, fontSize: 11, color: 'var(--t1)', marginBottom: 15, textTransform: 'uppercase', letterSpacing: '.14em' }}>{col.title}</h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {col.links.map(l => {
                // Anything in FOOTER_LINK_HREFS is a real route; everything
                // else still scrolls to Features on the landing page.
                const href = FOOTER_LINK_HREFS[l] || '#features';
                return (
                  <li key={l}>
                    <a href={href}
                      onClick={e => { if (!href.startsWith('#')) { e.preventDefault(); navigate(href); } }}
                      style={{ fontSize: 13, color: 'var(--t2)', textDecoration: 'none', transition: 'color .15s' }}
                      onMouseOver={e => e.target.style.color = 'var(--t1)'} onMouseOut={e => e.target.style.color = 'var(--t2)'}>{l}</a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 22, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <p style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--t3)' }}>{FOOTER_LEGAL}</p>
        <div style={{ display: 'flex', gap: 18 }}>
          {/* These pointed at #features, so every policy link on the site was a
              dead anchor. They now resolve to the legal centre. */}
          {[['Terms', '/legal'], ['Privacy', '/legal/privacy'], ['Refunds', '/legal/refund'], ['Cookies', '/legal/cookies']].map(([l, href]) => (
            <a key={l} href={href} onClick={e => { e.preventDefault(); navigate(href); }} style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--t3)', textDecoration: 'none' }}>{l}</a>
          ))}
        </div>
      </div>
    </div>
  </footer>
);

// Breakpoints every marketing surface shares. Page-specific rules stay on the
// page; anything that touches the nav, the footer or a generic card grid lives
// here so one page cannot quietly disagree with the other about when the
// layout folds.
export const MARKETING_CSS = `
  .hero-heading {
    font-family: 'Space Grotesk', sans-serif;
    font-size: clamp(42px, 5.4vw, 76px);
    font-weight: 800;
    color: var(--t1);
    letter-spacing: -.052em;
    line-height: 1.02;
  }
  @media (max-width: 1024px) {
    .calc { grid-template-columns: 1fr !important; gap: 26px !important; }
    .hero-grid { flex-direction: column; align-items: flex-start !important; gap: 56px !important; }
    .hero-visual { width: 100%; }
    .bento { grid-template-columns: repeat(2, 1fr) !important; }
    .bento > * { grid-column: span 1 !important; }
    .case-grid, .plan-grid { grid-template-columns: repeat(2, 1fr) !important; }
    .footer-grid { grid-template-columns: 1fr 1fr !important; }
    .nav-links { display: none !important; }
  }
  @media (max-width: 720px) {
    .hero-back-panel { display: none !important; }
    .proof-grid { grid-template-columns: 1fr 1fr !important; gap: 20px 0; }
    .proof-grid > * { border-left: none !important; }
    .bento, .case-grid, .plan-grid { grid-template-columns: 1fr !important; }
    .footer-grid { grid-template-columns: 1fr !important; gap: 30px !important; }
  }
`;
