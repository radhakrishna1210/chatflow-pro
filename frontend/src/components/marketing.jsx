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

export const BRAND = 'Svann';

// Signed-out visitors who press "Get started" want an account, not a login
// form; signed-in ones want their dashboard. The CTAs used to send everyone to
// /dashboard, which bounced a new visitor to the login screen.
export const isSignedIn = () => {
  try { return Boolean(localStorage.getItem('accessToken')); } catch { return false; }
};
export const startPath = () => (isSignedIn() ? 'dashboard' : 'register');

// A thin gradient bar along the top edge that tracks how far down the page the
// reader is. Written straight to a transform from a rAF-throttled scroll
// handler, so scrolling never re-renders React.
export const ScrollProgress = () => {
  const bar = useRef(null);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      const p = max > 0 ? Math.min(1, el.scrollTop / max) : 0;
      if (bar.current) bar.current.style.transform = `scaleX(${p})`;
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div aria-hidden="true" style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 2, zIndex: 101, pointerEvents: 'none' }}>
      <div ref={bar} style={{ height: '100%', background: 'var(--grad-cta)', transform: 'scaleX(0)', transformOrigin: '0 50%' }} />
    </div>
  );
};

// An endless horizontal ribbon. The list is rendered twice and the track slides
// by exactly half its width, so the loop has no seam. Paused on hover and
// stopped entirely under reduced motion (see .marquee-track in MARKETING_CSS).
export const Marquee = ({ items, renderItem, speed = 38 }) => (
  <div className="marquee" style={{ overflow: 'hidden', maskImage: 'linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)', WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)' }}>
    <div className="marquee-track" style={{ display: 'flex', gap: 12, width: 'max-content', animationDuration: `${speed}s` }}>
      {[...items, ...items].map((item, i) => (
        <div key={i} aria-hidden={i >= items.length ? 'true' : undefined}>{renderItem(item)}</div>
      ))}
    </div>
  </div>
);

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
    <div className="aurora-a" style={{ position: 'absolute', top: '-10%', left: '-5%', width: 620, height: 620, background: 'radial-gradient(circle, rgba(var(--accent-rgb),0.16), transparent 62%)', filter: 'blur(40px)', pointerEvents: 'none', willChange: 'transform' }} />
    <div className="aurora-b" style={{ position: 'absolute', top: '18%', right: '-12%', width: 680, height: 680, background: 'radial-gradient(circle, rgba(14,165,233,0.13), transparent 62%)', filter: 'blur(48px)', pointerEvents: 'none', willChange: 'transform' }} />
  </>
);

export const BrandMark = ({ size = 32, radius = 9, glow = true }) => (
  <div style={{ width: size, height: size, borderRadius: radius, background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: glow ? '0 0 18px rgba(var(--accent-rgb),0.35)' : 'none' }}>
    <svg width={size * 0.44} height={size * 0.44} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1C4.13 1 1 4.13 1 8c0 1.29.35 2.5.96 3.54L1 15l3.46-.96A7 7 0 1 0 8 1z" fill="var(--on-accent)" />
      <path d="M5.5 7.5h5M5.5 10h3" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" />
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

  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu on Escape and whenever the layout grows back to the
  // desktop bar, so it can never be left open behind the inline links.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    const mq = window.matchMedia?.('(min-width: 1025px)');
    const onMq = (e) => { if (e.matches) setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    mq?.addEventListener?.('change', onMq);
    return () => { window.removeEventListener('keydown', onKey); mq?.removeEventListener?.('change', onMq); };
  }, [menuOpen]);

  // An anchor that points at another route has to navigate rather than jump to
  // a fragment that does not exist on the current page.
  const go = (e, href) => {
    setMenuOpen(false);
    if (!href.startsWith('#')) { e.preventDefault(); navigate(href); }
  };

  // The logo goes home. It used to call onNav('landing'), which the router
  // treats as "log out" — so clicking the logo on a product page signed you out.
  const home = () => { setMenuOpen(false); navigate('/'); };

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, height: 64,
      display: 'flex', alignItems: 'center',
      background: scrolled || menuOpen ? 'rgba(8,11,18,0.86)' : 'transparent',
      backdropFilter: scrolled || menuOpen ? 'blur(18px) saturate(150%)' : 'none',
      WebkitBackdropFilter: scrolled || menuOpen ? 'blur(18px) saturate(150%)' : 'none',
      borderBottom: `1px solid ${scrolled || menuOpen ? 'var(--bd)' : 'transparent'}`,
      transition: 'background .3s ease, border-color .3s ease',
    }}>
      <div style={{ maxWidth: 1240, width: '100%', margin: '0 auto', padding: '0 clamp(18px,4vw,32px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <button onClick={home} aria-label={`${BRAND} home`} style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}>
          <BrandMark />
          <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--t1)', letterSpacing: '-.02em' }}>{BRAND}</span>
        </button>

        <div className="nav-links" style={{ display: 'flex', gap: 30 }}>
          {links.map(([l, h]) => (
            <a key={l} href={h} onClick={(e) => go(e, h)} style={{ color: 'var(--t2)', fontSize: 14, fontWeight: 500, textDecoration: 'none', transition: 'color .15s' }}
              onMouseOver={e => e.target.style.color = 'var(--t1)'} onMouseOut={e => e.target.style.color = 'var(--t2)'}>{l}</a>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="nav-login"><Btn variant="ghost" size="sm" onClick={() => onNav(isSignedIn() ? 'dashboard' : 'login')}>{isSignedIn() ? 'Dashboard' : 'Log in'}</Btn></span>
          <Btn variant="primary" size="sm" onClick={() => onNav(startPath())}>Get started <I n="arrow" s={12} c="var(--on-accent)" /></Btn>
          <button
            className="nav-burger"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="marketing-mobile-menu"
            style={{ display: 'none', width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bd)', cursor: 'pointer' }}
          >
            {menuOpen ? <I n="x" s={16} c="var(--t1)" /> : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--t1)" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div id="marketing-mobile-menu" className="mobile-menu" style={{ position: 'absolute', top: 64, left: 0, right: 0, padding: '10px clamp(18px,4vw,32px) 20px', background: 'var(--bg)', boxShadow: '0 24px 40px rgba(0,0,0,0.5)', borderBottom: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {links.map(([l, h]) => (
            <a key={l} href={h} onClick={(e) => go(e, h)} style={{ padding: '13px 4px', fontSize: 16, fontWeight: 600, color: 'var(--t1)', borderBottom: '1px solid var(--bd)' }}>{l}</a>
          ))}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <Btn variant="ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { setMenuOpen(false); onNav(isSignedIn() ? 'dashboard' : 'login'); }}>{isSignedIn() ? 'Dashboard' : 'Log in'}</Btn>
            <Btn style={{ flex: 1, justifyContent: 'center' }} onClick={() => { setMenuOpen(false); onNav(startPath()); }}>Start free</Btn>
          </div>
        </div>
      )}
    </nav>
  );
};

// Footer column links are plain labels in siteContent.js, so the ones that are
// real destinations rather than sections of the landing page are mapped here.
// "Privacy" in particular pointed at #features, which meant the site's most
// load-bearing policy link scrolled you to the feature grid.
const FOOTER_LINK_HREFS = {
  'Features': '#features',
  'How it works': '#steps',
  'Pricing': '#pricing',
  'Campaign AI Agent': '/product/campaign-ai',
  'Workflows': '#automation',
  'E-commerce': '#usecases',
  'Education': '#usecases',
  'Clinics': '#usecases',
  'Real estate': '#usecases',
  'Agencies': '#usecases',
  'About': '#story',
  'Contact': '#faq',
  'Privacy': '/legal/privacy',
  'Legal Center': '/legal',
};

// A fragment only exists on the landing page. From /product/... or /legal the
// browser would jump nowhere, so go home first and scroll once it has rendered.
const followHref = (e, href) => {
  if (!href.startsWith('#')) { e.preventDefault(); navigate(href); return; }
  if (window.location.pathname !== '/') {
    e.preventDefault();
    navigate('/');
    setTimeout(() => document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth' }), 80);
  }
};

export const MarketingFooter = ({ onNav }) => (
  <footer style={{ borderTop: '1px solid var(--bd)', padding: '56px clamp(18px,4vw,32px) 30px', background: 'rgba(13,17,33,0.5)' }}>
    <div style={{ maxWidth: 1240, margin: '0 auto' }}>
      <div className="footer-grid" style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr 1fr 1fr', gap: 40, marginBottom: 44 }}>
        <div>
          <button onClick={() => navigate('/')} aria-label={`${BRAND} home`} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, cursor: 'pointer', marginBottom: 14, background: 'none', border: 'none', padding: 0 }}>
            <BrandMark size={28} radius={8} glow={false} />
            <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>{BRAND}</span>
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
                const href = FOOTER_LINK_HREFS[l] || '#features';
                return (
                  <li key={l}>
                    <a href={href}
                      onClick={e => followHref(e, href)}
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
    font-size: clamp(40px, 4.9vw, 70px);
    font-weight: 800;
    color: var(--t1);
    letter-spacing: -.052em;
    line-height: 1.02;
  }
  .marquee-track { animation: marquee linear infinite; }
  .marquee:hover .marquee-track { animation-play-state: paused; }
  @keyframes marquee { to { transform: translateX(calc(-50% - 6px)); } }
  .grad-text {
    background: linear-gradient(90deg, var(--lime), var(--cyan), var(--violet), var(--cyan), var(--lime));
    background-size: 300% 100%;
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; color: transparent;
    animation: gradShift 9s ease-in-out infinite;
  }
  @keyframes gradShift { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
  .float-toast { animation: toastIn .6s cubic-bezier(.2,.7,.3,1) both, floatY 6s ease-in-out .6s infinite; }
  @keyframes toastIn { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: none; } }
  .step-line { background: linear-gradient(90deg, var(--lime), var(--cyan)); transform-origin: 0 50%; transform: scaleX(0); transition: transform 1.2s cubic-bezier(.2,.7,.3,1) .2s; }
  .in .step-line { transform: scaleX(1); }
  .cmp-table td, .cmp-table th { padding: 14px 18px; text-align: left; border-top: 1px solid var(--bd); font-size: 13.5px; vertical-align: top; }
  .cmp-table th { font-family: var(--mono); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--t2); border-top: none; }
  @media (prefers-reduced-motion: reduce) {
    .marquee-track, .grad-text, .float-toast { animation: none !important; }
    .step-line { transform: scaleX(1); transition: none; }
  }
  @media (max-width: 1024px) {
    .nav-burger { display: inline-flex !important; }
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
    .hero-back-panel, .float-toast { display: none !important; }
    .nav-login { display: none !important; }
    .steps-grid { grid-template-columns: 1fr !important; }
    .step-connector { display: none !important; }
    .cmp-table td, .cmp-table th { padding: 11px 10px; font-size: 12.5px; }
    .cmp-table .cmp-theirs { display: none; }
    /* The deliberate line break is for the wide layout; on a phone it left
       a single word stranded on its own line. Let the sentence flow. */
    .hero-heading br { display: none; }
    .hero-heading > span::after { content: ' '; }
    .cmp-table .cmp-vs { display: block !important; }
    .proof-grid { grid-template-columns: 1fr 1fr !important; gap: 20px 0; }
    .proof-grid > * { border-left: none !important; }
    .bento, .case-grid, .plan-grid { grid-template-columns: 1fr !important; }
    .footer-grid { grid-template-columns: 1fr !important; gap: 30px !important; }
  }
`;
