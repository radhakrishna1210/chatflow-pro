import { useState, useEffect, useRef, useCallback } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { MarketingFaq, MarketingFeatures, MarketingIntegrations, MarketingSecurity } from '../components/MarketingFaq.jsx';

// ─── Landing page ────────────────────────────────────────────────────────────
//
// The page's job is to explain, in one screen, what this product does that a
// reseller's WhatsApp dashboard does not: a campaign message that answers
// questions about itself. So the hero is not a screenshot of the app — it is
// the message a customer receives, the button they tap, and the conversation
// that follows. Everything else on the page stays quiet around it.
//
// Surfaces are frosted (.glass in index.css) over a slowly drifting aurora, so
// depth comes from layering rather than from borders. All motion is opt-out:
// the reduced-motion block in index.css stops the drift and the reveals, and
// the scripted conversation below jumps straight to its final state.

const MONO = 'var(--mono)';

// ─── motion helpers ──────────────────────────────────────────────────────────

const prefersReducedMotion = () =>
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
function useInView(ref, { once = true } = {}) {
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

// ─── shared pieces ───────────────────────────────────────────────────────────

// Pointer position as CSS vars, so .glass-lit can put a highlight where the
// cursor is. Cheap enough to attach per card: two custom properties, no state.
const trackLight = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
};

const Glass = ({ as: Tag = 'div', className = '', lit = true, style, children, ...rest }) => (
  <Tag
    className={`glass${lit ? ' glass-lit glass-lift' : ''}${className ? ` ${className}` : ''}`}
    onMouseMove={lit ? trackLight : undefined}
    style={style}
    {...rest}
  >
    {children}
  </Tag>
);

const Reveal = ({ delay = 0, style, children, ...rest }) => {
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
const Eyebrow = ({ children }) => (
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--green)' }}>
    <svg width="15" height="10" viewBox="0 0 18 12" fill="none" aria-hidden="true">
      <path d="M1 6l4 4L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 6l4 4L17 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    {children}
  </div>
);

const SectionHead = ({ eyebrow, title, sub, align = 'center' }) => (
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

const Aurora = () => (
  <>
    <div className="aurora-a" style={{ position: 'absolute', top: '-10%', left: '-5%', width: 620, height: 620, background: 'radial-gradient(circle, rgba(30,191,94,0.16), transparent 62%)', filter: 'blur(40px)', pointerEvents: 'none', willChange: 'transform' }} />
    <div className="aurora-b" style={{ position: 'absolute', top: '18%', right: '-12%', width: 680, height: 680, background: 'radial-gradient(circle, rgba(14,165,233,0.13), transparent 62%)', filter: 'blur(48px)', pointerEvents: 'none', willChange: 'transform' }} />
  </>
);

// ─── the signature: a campaign message that answers for itself ───────────────

const SCRIPT = [
  { role: 'user',  text: 'Price?' },
  { role: 'agent', text: 'The Premium Plan is ₹999/month.' },
  { role: 'user',  text: 'Till when?' },
  { role: 'agent', text: 'The 50% offer runs until 15 August.' },
];

const Bubble = ({ role, text, mono }) => {
  const mine = role === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '84%', padding: '8px 11px',
        borderRadius: mine ? '13px 13px 3px 13px' : '13px 13px 13px 3px',
        background: mine ? 'rgba(30,191,94,0.14)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${mine ? 'var(--gbd)' : 'var(--bd)'}`,
      }}>
        {!mine && <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.12em', color: 'var(--green)', marginBottom: 3, textTransform: 'uppercase' }}>Riya · campaign agent</div>}
        <p style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--t1)', fontFamily: mono ? MONO : undefined }}>{text}</p>
      </div>
    </div>
  );
};

const Typing = () => (
  <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
    <div className="dot-typing" style={{ display: 'flex', gap: 4, padding: '10px 12px', borderRadius: '13px 13px 13px 3px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bd)' }}>
      {[0, 1, 2].map((i) => <span key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--t2)' }} />)}
    </div>
  </div>
);

// The campaign message, its CTA, and what happens when the CTA is tapped.
// Plays itself once on view; tapping the button replays it, because the whole
// point is that the button is the thing you press.
const CampaignTap = () => {
  const ref = useRef(null);
  const seen = useInView(ref);
  const timers = useRef([]);
  const [step, setStep] = useState(0);       // how many script lines are shown
  const [pressed, setPressed] = useState(false);
  const [typing, setTyping] = useState(false);

  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const play = useCallback(() => {
    clear();
    if (prefersReducedMotion()) { setPressed(true); setStep(SCRIPT.length); return; }
    setStep(0); setTyping(false);
    setPressed(true);
    let t = 620;
    SCRIPT.forEach((line, i) => {
      if (line.role === 'agent') {
        timers.current.push(setTimeout(() => setTyping(true), t));
        t += 780;
      }
      timers.current.push(setTimeout(() => { setTyping(false); setStep(i + 1); }, t));
      t += line.role === 'agent' ? 900 : 700;
    });
  }, []);

  useEffect(() => { if (seen) play(); return clear; }, [seen, play]);

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', maxWidth: 420 }}>
      {/* Delivery panel, frosted and set back — the campaign this message
          belongs to, seen through the glass behind the phone. */}
      <Glass lit={false} className="hero-back-panel" style={{ position: 'absolute', top: -28, right: -96, width: 250, padding: '14px 16px', opacity: 0.75 }}>
        <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--t2)', marginBottom: 10 }}>Summer Sale · live</div>
        {[['Sent', '12,421', 'var(--t1)'], ['Delivered', '12,180', 'var(--green)'], ['Chats opened', '1,308', '#0EA5E9']].map(([l, v, c]) => (
          <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0' }}>
            <span style={{ fontSize: 11, color: 'var(--t2)' }}>{l}</span>
            <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: c }}>{v}</span>
          </div>
        ))}
        <div style={{ marginTop: 10, height: 3, borderRadius: 3, background: 'rgba(255,255,255,0.07)' }}>
          <div style={{ height: '100%', width: '98.3%', borderRadius: 3, background: 'var(--green)' }} />
        </div>
      </Glass>

      <Glass lit={false} style={{ position: 'relative', padding: 16, borderRadius: 'var(--rxl)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1C4.13 1 1 4.13 1 8c0 1.29.35 2.5.96 3.54L1 15l3.46-.96A7 7 0 1 0 8 1z" fill="#060913" /></svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--t1)' }}>Aarti Textiles</div>
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--t2)' }}>business account</div>
          </div>
        </div>

        {/* The template as it lands on the customer's phone. */}
        <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bd)', borderRadius: '13px 13px 13px 3px', padding: '11px 13px' }}>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--t1)' }}>
            <strong>Summer Sale 🎉</strong><br />
            Premium Plan at ₹999/month.<br />
            Get 50% OFF until 15 August.<br />
            <span style={{ color: 'var(--t2)' }}>Unlimited messages · AI automation · Analytics · Priority support</span>
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginTop: 6 }}>
            <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--t2)' }}>10:24</span>
            <svg width="14" height="9" viewBox="0 0 18 12" fill="none" aria-hidden="true">
              <path d="M1 6l4 4L13 1" stroke="#53bdeb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M6 6l4 4L17 1" stroke="#53bdeb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        {/* The CTA. Pressing it is the product. */}
        <button
          onClick={play}
          aria-label="Replay: customer taps Ask Anything"
          style={{
            width: '100%', marginTop: 3, padding: '10px', cursor: 'pointer',
            borderRadius: 11, fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 12.5, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            color: pressed ? 'var(--green)' : '#53bdeb',
            background: pressed ? 'rgba(30,191,94,0.12)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${pressed ? 'var(--gbd)' : 'var(--bd)'}`,
            transform: pressed ? 'scale(0.985)' : 'none',
            transition: 'all .25s cubic-bezier(.2,.7,.3,1)',
          }}
        >
          <I n="msg" s={13} c={pressed ? 'var(--green)' : '#53bdeb'} />
          Ask Anything
        </button>

        {step > 0 && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', gap: 7 }}>
            {SCRIPT.slice(0, step).map((line, i) => <Bubble key={i} {...line} />)}
            {typing && <Typing />}
          </div>
        )}
      </Glass>
    </div>
  );
};

// ─── nav ─────────────────────────────────────────────────────────────────────

const Navbar = ({ onNav }) => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 24);
    fn();
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

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
      <div style={{ maxWidth: 1240, width: '100%', margin: '0 auto', padding: '0 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <button onClick={() => onNav('landing')} style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 18px rgba(30,191,94,0.35)' }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1C4.13 1 1 4.13 1 8c0 1.29.35 2.5.96 3.54L1 15l3.46-.96A7 7 0 1 0 8 1z" fill="#060913" /><path d="M5.5 7.5h5M5.5 10h3" stroke="#1EBF5E" strokeWidth="1.2" strokeLinecap="round" /></svg>
          </div>
          <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--t1)', letterSpacing: '-.02em' }}>ChatFlow<span style={{ color: 'var(--green)' }}>Pro</span></span>
        </button>

        <div className="nav-links" style={{ display: 'flex', gap: 30 }}>
          {[['Features', '#features'], ['Use Cases', '#usecases'], ['Pricing', '#pricing']].map(([l, h]) => (
            <a key={l} href={h} style={{ color: 'var(--t2)', fontSize: 14, fontWeight: 500, textDecoration: 'none', transition: 'color .15s' }}
              onMouseOver={e => e.target.style.color = 'var(--t1)'} onMouseOut={e => e.target.style.color = 'var(--t2)'}>{l}</a>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Btn variant="ghost" size="sm" onClick={() => onNav('login')}>Log in</Btn>
          <Btn variant="primary" size="sm" onClick={() => onNav('dashboard')}>Get started <I n="arrow" s={12} c="#060A10" /></Btn>
        </div>
      </div>
    </nav>
  );
};

// ─── hero ────────────────────────────────────────────────────────────────────

const Hero = ({ onNav }) => (
  <section style={{ position: 'relative', overflow: 'hidden', paddingTop: 150, paddingBottom: 90 }}>
    <Aurora />
    <div className="hero-grid" style={{ position: 'relative', maxWidth: 1240, margin: '0 auto', padding: '0 32px', display: 'flex', alignItems: 'center', gap: 64 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'flex-start' }}>
        <Reveal>
          {/* The newest thing is the reason to read on, so it gets the badge.
              The partner credential moves to the proof strip below. */}
          <button
            onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '6px 14px 6px 6px', borderRadius: 999, background: 'var(--gbg)', border: '1px solid var(--gbd)', cursor: 'pointer', fontFamily: "'Plus Jakarta Sans',sans-serif" }}
          >
            <span style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--green)', color: '#060913', fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '.1em' }}>NEW</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>Campaign AI Agent</span>
            <I n="arrow" s={12} c="var(--green)" />
          </button>
        </Reveal>

        <Reveal delay={80}>
          <h1 className="hero-heading">
            Your campaign can<br />answer <span style={{ color: 'var(--green)' }}>for itself.</span>
          </h1>
        </Reveal>

        <Reveal delay={150}>
          <p style={{ fontSize: 18, color: 'var(--t2)', maxWidth: 520, lineHeight: 1.7, fontWeight: 500 }}>
            Send WhatsApp campaigns, then let an AI agent handle the questions they start — priced, dated
            and worded from the exact message each customer received. No markup on Meta's rates.
          </p>
        </Reveal>

        <Reveal delay={210}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <Btn size="lg" onClick={() => onNav('dashboard')} style={{ boxShadow: 'var(--glow)' }}>Start for free <I n="arrow" s={14} c="#060A10" /></Btn>
            <Btn variant="ghost" size="lg" onClick={() => { document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' }); }}>See how it works</Btn>
          </div>
        </Reveal>

        <Reveal delay={260}>
          <p style={{ fontFamily: MONO, fontSize: 12, color: 'var(--t3)', letterSpacing: '.02em' }}>
            Free plan · no card · connect a number in minutes
          </p>
        </Reveal>
      </div>

      <div className="hero-visual" style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}>
        <Reveal delay={200} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
          <CampaignTap />
        </Reveal>
      </div>
    </div>
  </section>
);

// ─── proof strip ─────────────────────────────────────────────────────────────
// Capability claims, not invented traffic numbers: each line is something the
// product actually does, and each is demonstrated further down the page.

const PROOF = [
  ['At cost', 'Meta’s per-message rate, passed through'],
  ['Refunded', 'Every message that never went out'],
  ['Never guessed', 'A price or date the campaign didn’t state'],
  ['Meta partner', 'Official WhatsApp Business API access'],
];

const ProofStrip = () => (
  <section style={{ padding: '0 32px 90px' }}>
    <div style={{ maxWidth: 1240, margin: '0 auto' }}>
      <Reveal>
        <Glass lit={false} className="proof-grid" style={{ padding: '26px 8px', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', borderRadius: 'var(--rxl)' }}>
          {PROOF.map(([value, label], i) => (
            <div key={label} style={{ padding: '0 24px', borderLeft: i === 0 ? 'none' : '1px solid var(--bd)' }}>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 22, color: 'var(--t1)', letterSpacing: '-.03em', marginBottom: 6 }}>{value}</div>
              <div style={{ fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.5 }}>{label}</div>
            </div>
          ))}
        </Glass>
      </Reveal>
    </div>
  </section>
);

// ─── AI prompt ───────────────────────────────────────────────────────────────

const LoginRequiredModal = ({ isOpen, onClose, onNav }) => {
  if (!isOpen) return null;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(3,5,12,0.72)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)', padding: 20 }}>
      <Glass lit={false} onClick={(e) => e.stopPropagation()} style={{ width: 400, maxWidth: '100%', padding: 26, display: 'flex', flexDirection: 'column', alignItems: 'center', borderRadius: 'var(--rxl)' }}>
        <div style={{ width: 46, height: 46, borderRadius: 13, background: 'var(--gbg)', border: '1px solid var(--gbd)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <I n="lock" s={20} c="var(--green)" />
        </div>
        <h3 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 18, color: 'var(--t1)', marginBottom: 8 }}>Sign in to build this</h3>
        <p style={{ fontSize: 14, color: 'var(--t2)', textAlign: 'center', marginBottom: 22, lineHeight: 1.6 }}>
          The assistant builds templates, campaigns and flows inside your workspace, so it needs an account to build them in.
        </p>
        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
          <Btn variant="ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>Cancel</Btn>
          <Btn style={{ flex: 1, justifyContent: 'center' }} onClick={() => onNav('login')}>Log in</Btn>
        </div>
      </Glass>
    </div>
  );
};

const EXAMPLES = [
  'Create a template for an abandoned cart',
  'Build a Diwali sale campaign for my VIP list',
  'Set up an agent that answers offer questions',
  'Draft a welcome flow for new contacts',
];

const AIPromptSection = ({ onNav }) => {
  const [prompt, setPrompt] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [focused, setFocused] = useState(false);

  const send = () => {
    if (!prompt.trim()) return;
    if (!localStorage.getItem('accessToken')) setShowLoginModal(true);
    else onNav('dashboard');
  };

  return (
    <section style={{ padding: '0 32px 100px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <LoginRequiredModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} onNav={onNav} />
      <div style={{ width: '100%', maxWidth: 720 }}>
        <Reveal>
          <div style={{ textAlign: 'center', marginBottom: 22 }}>
            <Eyebrow>Describe it, don’t build it</Eyebrow>
          </div>
        </Reveal>
        <Reveal delay={70}>
          <Glass lit={false} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 'var(--rxl)', borderColor: focused ? 'var(--gbd)' : 'var(--glass-bd)', boxShadow: focused ? 'var(--glow), var(--glass-sh)' : 'var(--glass-sh)', transition: 'border-color .25s, box-shadow .25s' }}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Describe the campaign or flow you want…"
              aria-label="Describe the campaign or flow you want"
              style={{ width: '100%', height: 132, background: 'transparent', border: 'none', padding: '22px 24px', color: 'var(--t1)', fontSize: 15.5, lineHeight: 1.6, resize: 'none', outline: 'none', fontFamily: "'Plus Jakarta Sans',sans-serif" }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 18px', background: 'rgba(255,255,255,0.02)', borderTop: '1px solid var(--bd)' }}>
              <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--t3)', letterSpacing: '.06em' }}>ENTER TO SEND</span>
              <Btn size="sm" onClick={send} disabled={!prompt.trim()}>Build it <I n="arrow" s={12} c="#060A10" /></Btn>
            </div>
          </Glass>
        </Reveal>
        <Reveal delay={130}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16, justifyContent: 'center' }}>
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => setPrompt(ex)}
                style={{ padding: '7px 13px', borderRadius: 999, background: 'rgba(255,255,255,0.035)', border: '1px solid var(--bd)', color: 'var(--t2)', fontSize: 12.5, cursor: 'pointer', fontFamily: "'Plus Jakarta Sans',sans-serif", transition: 'all .18s' }}
                onMouseOver={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = 'var(--t1)'; }}
                onMouseOut={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.035)'; e.currentTarget.style.color = 'var(--t2)'; }}>
                {ex}
              </button>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
};

// ─── what a send costs ───────────────────────────────────────────────────────
//
// The one number a prospect actually wants before signing up. Rates come from
// the server's published rate card (GET /api/v1/pricing), which is the same
// table campaigns are billed against — a figure typed in here by hand is how
// someone gets quoted a price the billing code will not honour. If the rates
// can't be fetched, the section removes itself rather than guess.

const CATEGORY_COPY = [
  ['MARKETING', 'Marketing', 'Offers, launches, re-engagement'],
  ['UTILITY', 'Utility', 'Order updates, reminders, receipts'],
  ['AUTHENTICATION', 'Authentication', 'One-time passcodes'],
];

const SIZES = [500, 2000, 10000, 25000];

// Eases to a new value so a changed total reads as movement, not a jump cut.
function useCountUp(target, ms = 420) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (prefersReducedMotion()) { setValue(target); from.current = target; return undefined; }
    const start = performance.now();
    const origin = from.current;
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(origin + (target - origin) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

const rupees = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

const CostCalculator = () => {
  const [rates, setRates] = useState(null);
  const [failed, setFailed] = useState(false);
  const [category, setCategory] = useState('MARKETING');
  const [count, setCount] = useState(2000);

  useEffect(() => {
    let alive = true;
    fetch('/api/v1/pricing')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('unavailable'))))
      .then((d) => { if (alive && d?.rates) setRates(d.rates); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  const rate = rates?.[category];
  const total = useCountUp(rate ? count * rate : 0);

  if (failed || !rates) return null;

  return (
    <section style={{ padding: '20px 0 100px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 32px' }}>
        <SectionHead
          eyebrow="Run the numbers"
          title={<>What your next send<br /><span style={{ color: 'var(--green)' }}>actually costs</span></>}
          sub="These are the live rates your campaigns are billed at — not an estimate, and not a marked-up resale price."
        />
        <Reveal>
          <Glass lit={false} className="calc" style={{ padding: 30, borderRadius: 'var(--rxl)', display: 'grid', gridTemplateColumns: '1.15fr .85fr', gap: 34, alignItems: 'center' }}>
            <div>
              <label htmlFor="calc-size" style={{ display: 'block', fontFamily: MONO, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--t2)', marginBottom: 12 }}>
                Recipients
              </label>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
                <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 34, color: 'var(--t1)', letterSpacing: '-.04em' }}>
                  {count.toLocaleString('en-IN')}
                </span>
                <span style={{ fontSize: 13, color: 'var(--t2)' }}>contacts</span>
              </div>
              <input
                id="calc-size" type="range" min="100" max="50000" step="100"
                value={count} onChange={(e) => setCount(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--green)' }}
              />
              <div style={{ display: 'flex', gap: 7, marginTop: 14, flexWrap: 'wrap' }}>
                {SIZES.map((n) => (
                  <button key={n} onClick={() => setCount(n)}
                    style={{ padding: '5px 11px', borderRadius: 999, cursor: 'pointer', fontFamily: MONO, fontSize: 11.5,
                      background: count === n ? 'var(--gbg)' : 'rgba(255,255,255,0.035)',
                      border: `1px solid ${count === n ? 'var(--gbd)' : 'var(--bd)'}`,
                      color: count === n ? 'var(--green)' : 'var(--t2)', transition: 'all .18s' }}>
                    {n.toLocaleString('en-IN')}
                  </button>
                ))}
              </div>

              <div style={{ marginTop: 26 }}>
                <span style={{ display: 'block', fontFamily: MONO, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--t2)', marginBottom: 12 }}>
                  Message type
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {CATEGORY_COPY.map(([key, label, hint]) => {
                    const on = category === key;
                    return (
                      <button key={key} onClick={() => setCategory(key)}
                        aria-pressed={on}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                          background: on ? 'var(--gbg)' : 'rgba(255,255,255,0.025)',
                          border: `1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`, transition: 'all .18s' }}>
                        <span style={{ width: 13, height: 13, borderRadius: '50%', flexShrink: 0, border: `1.5px solid ${on ? 'var(--green)' : 'var(--bdm)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {on && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} />}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: on ? 'var(--t1)' : 'var(--t2)' }}>{label}</span>
                          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--t3)', marginTop: 1 }}>{hint}</span>
                        </span>
                        <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: on ? 'var(--green)' : 'var(--t2)' }}>
                          ₹{rates[key].toFixed(2)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--t2)', marginBottom: 10 }}>
                One campaign
              </div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 'clamp(44px,5vw,68px)', color: 'var(--green)', letterSpacing: '-.05em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {rupees(total)}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 12, color: 'var(--t2)', marginTop: 10 }}>
                {count.toLocaleString('en-IN')} × ₹{rate.toFixed(2)}
              </div>
              <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', gap: 9, textAlign: 'left' }}>
                {[
                  'Reserved from your wallet at launch',
                  'Opted-out numbers skipped, never charged',
                  'Anything undelivered comes back to you',
                ].map((line) => (
                  <div key={line} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.5 }}>
                    <span style={{ flexShrink: 0, marginTop: 2 }}><I n="check" s={13} c="var(--green)" w={2.4} /></span>{line}
                  </div>
                ))}
              </div>
            </div>
          </Glass>
        </Reveal>
      </div>
    </section>
  );
};

// ─── questions people ask before signing up ──────────────────────────────────


// ─── features ────────────────────────────────────────────────────────────────

const AgentChainVisual = () => (
  <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
    {[
      ['1 · Attach', 'Pick a deployed agent and a CTA label while you build the campaign.', 'var(--green)'],
      ['2 · Tap', 'The button carries the recipient’s id, so the agent opens on the right message.', '#0EA5E9'],
      ['3 · Answer', 'Questions are answered from that message — and nothing else is invented.', '#A78BFA'],
    ].map(([step, copy, c]) => (
      <div key={step} style={{ padding: '11px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.025)', border: '1px solid var(--bd)' }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.08em', color: c, marginBottom: 6, textTransform: 'uppercase' }}>{step}</div>
        <p style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.55 }}>{copy}</p>
      </div>
    ))}
  </div>
);

const LedgerVisual = () => (
  <div style={{ marginTop: 18, borderRadius: 10, border: '1px solid var(--bd)', background: 'rgba(255,255,255,0.02)', overflow: 'hidden' }}>
    {[
      ['Reserved at launch', '−₹2,116.00', 'var(--t1)'],
      ['2 numbers opted out', 'skipped', 'var(--t2)'],
      ['Refunded on completion', '+₹4.36', 'var(--green)'],
    ].map(([label, value, c], i) => (
      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 13px', borderTop: i ? '1px solid var(--bd)' : 'none' }}>
        <span style={{ fontSize: 12, color: 'var(--t2)' }}>{label}</span>
        <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: c }}>{value}</span>
      </div>
    ))}
  </div>
);

const FlowVisual = () => (
  <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
    {[['Trigger', 'Customer sends a message', 'var(--green)'], ['Wait', '2 hours', '#F59E0B'], ['Send', 'Follow-up template', '#0EA5E9']].map(([t, d, c], i) => (
      <div key={t}>
        <div style={{ padding: '9px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.025)', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: c, flexShrink: 0 }} />
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: c, textTransform: 'uppercase', letterSpacing: '.08em', width: 52, flexShrink: 0 }}>{t}</span>
          <span style={{ fontSize: 11.5, color: 'var(--t2)' }}>{d}</span>
        </div>
        {i < 2 && <div style={{ width: 1, height: 7, background: 'var(--bdm)', marginLeft: 15 }} />}
      </div>
    ))}
  </div>
);

const FCard = ({ span = 2, icon, color = 'var(--green)', title, desc, visual, delay = 0 }) => (
  <Reveal delay={delay} style={{ gridColumn: `span ${span}` }}>
    <Glass style={{ padding: 26, height: '100%' }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 15, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09)' }}>
        <I n={icon} s={17} c={color} />
      </div>
      <h3 style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--t1)', marginBottom: 7, letterSpacing: '-.015em' }}>{title}</h3>
      <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.65 }}>{desc}</p>
      {visual}
    </Glass>
  </Reveal>
);

const Features = () => (
  <section id="features" style={{ padding: '20px 0 100px', position: 'relative' }}>
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 32px' }}>
      <SectionHead
        eyebrow="What's inside"
        title={<>Everything the campaign needs<br />after <span style={{ color: 'var(--green)' }}>you press send</span></>}
        sub="Sending is the easy part. These are the pieces that decide whether the conversation it starts goes anywhere."
      />
      <div className="bento" style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 12 }}>
        <FCard span={4} icon="bot" title="Campaign AI Agent" delay={0}
          desc="Attach your agent to a campaign and it answers questions about that campaign — the price, the discount, the deadline, the fine print — from the exact message that customer received. Edit the campaign later and their answers stay true to what was sent."
          visual={<AgentChainVisual />} />
        <FCard span={2} icon="spark" color="#0EA5E9" title="Replies that route themselves" delay={60}
          desc="A deployed agent answers free-form questions when no rule matches, and intent matching sends “my parcel hasn’t come” to your shipping trigger without an exact keyword." />

        <FCard span={2} icon="wflow" color="#F59E0B" title="Workflows that actually run" delay={0}
          desc="Triggers, conditions, delays and multi-step sends — with a run history, so “did it fire?” is answerable."
          visual={<FlowVisual />} />
        <FCard span={4} icon="credit" title="Billing you can audit" delay={60}
          desc="Campaigns reserve at launch and settle on completion. Opted-out and unsendable numbers are skipped, retries are never charged twice, and everything that never went out comes back to your wallet."
          visual={<LedgerVisual />} />

        <FCard span={2} icon="note" color="#A78BFA" title="Forms over chat" delay={0}
          desc="Collect answers one question per message, with validation, and a completed submission at the end." />
        <FCard span={2} icon="phone" color="#0EA5E9" title="Voice AI reception" delay={60}
          desc="Inbound calls answered, transcribed and turned into a lead, with a handoff when the caller needs a person." />
        <FCard span={2} icon="insta" color="#F59E0B" title="Instagram quickflows" delay={120}
          desc="DMs, comments and story replies automated on the same keyword model as WhatsApp." />

        <FCard span={2} icon="file" title="Template studio" delay={0}
          desc="Write copy with AI, generate the header image, add buttons, submit to Meta, and watch approval status land by webhook." />
        <FCard span={2} icon="chart" color="#A78BFA" title="Delivery and revenue" delay={60}
          desc="Sent, delivered, read and failed per campaign, tied back to spend — plus retries and SMS or email fallback." />
        <FCard span={2} icon="key" color="#0EA5E9" title="API, webhooks, integrations" delay={120}
          desc="Scoped API keys, outbound webhooks and OAuth connections for the tools your team already runs." />
      </div>
    </div>
  </section>
);

// ─── use cases ───────────────────────────────────────────────────────────────

const CASES = [
  { icon: 'send',  color: '#1EBF5E', title: 'E-commerce',    metric: 'Cart recovery', desc: 'Abandoned-cart nudges, order updates and catalogue sends — with the agent fielding “is it in stock?”.' },
  { icon: 'users', color: '#0EA5E9', title: 'Education',      metric: 'Admissions',    desc: 'Enrolment reminders, fee notices and a form that collects student details over chat.' },
  { icon: 'phone', color: '#A78BFA', title: 'Clinics',        metric: 'Appointments',  desc: 'Booking confirmations, reminders and reports, with inbound calls answered when the desk is busy.' },
  { icon: 'building', color: '#F59E0B', title: 'Real estate', metric: 'Site visits',   desc: 'Property drops to a smart list, then an agent that answers price and location questions per listing.' },
  { icon: 'globe', color: '#1EBF5E', title: 'Agencies',       metric: 'Multi-client',  desc: 'A workspace per client, separate numbers and wallets, and one place to report from.' },
  { icon: 'zap',   color: '#0EA5E9', title: 'Travel',         metric: 'Itineraries',   desc: 'Booking confirmations and itinerary sends, with after-hours questions handled automatically.' },
];

const UseCases = () => (
  <section id="usecases" style={{ padding: '100px 0', borderTop: '1px solid var(--bd)', borderBottom: '1px solid var(--bd)', background: 'rgba(13,17,33,0.6)' }}>
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 32px' }}>
      <SectionHead eyebrow="Who runs it" title={<>Built for <span style={{ color: 'var(--green)' }}>every industry</span></>}
        sub="Same platform, different conversations. These are the ones it gets used for most." />
      <div className="case-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
        {CASES.map((c, i) => (
          <Reveal key={c.title} delay={(i % 3) * 70}>
            <Glass style={{ padding: 22, height: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <I n={c.icon} s={16} c={c.color} />
                </div>
                <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '.06em', color: 'var(--t2)', padding: '4px 9px', borderRadius: 999, background: 'rgba(255,255,255,0.035)', border: '1px solid var(--bd)', textTransform: 'uppercase' }}>{c.metric}</span>
              </div>
              <h3 style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--t1)', marginBottom: 6 }}>{c.title}</h3>
              <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.6 }}>{c.desc}</p>
            </Glass>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

// ─── pricing ─────────────────────────────────────────────────────────────────

const PLANS = [
  // Prices must match the Plan catalog seeded in backend/src/server.js —
  // advertising a price the checkout cannot sell is worse than no price.
  { name: 'Basic', price: '₹1,500', per: '/mo', note: 'or ₹3,500 per quarter', desc: 'For a small team running its first campaigns.', popular: false,
    features: ['1 WhatsApp number', 'Up to 10 team members', '10,000 messages per cycle', 'Campaigns, templates, team inbox', 'Workflows and auto-replies', 'Email support'] },
  { name: 'Growth', price: '₹2,500', per: '/mo', note: 'or ₹7,500 per quarter', desc: 'For teams whose WhatsApp runs itself.', popular: true,
    features: ['Unlimited numbers and members', 'Unlimited messages', 'Campaign AI Agent', 'AI intent matching and smart replies', 'Retries with SMS and email fallback', 'Voice AI and Instagram flows', 'Revenue and delivery analytics', 'Priority support'] },
  { name: 'Enterprise', price: 'Custom', per: '', desc: 'For volume, review requirements and bespoke work.', popular: false,
    features: ['Everything in Growth', 'Custom message volume', 'Dedicated account manager', 'SSO and audit logs', 'Custom integrations', 'SLA'] },
];

const Pricing = ({ onNav }) => (
  <section id="pricing" style={{ padding: '110px 0', position: 'relative', overflow: 'hidden' }}>
    <div className="aurora-a" style={{ position: 'absolute', bottom: '-20%', left: '30%', width: 560, height: 560, background: 'radial-gradient(circle, rgba(30,191,94,0.10), transparent 62%)', filter: 'blur(50px)', pointerEvents: 'none' }} />
    <div style={{ position: 'relative', maxWidth: 1240, margin: '0 auto', padding: '0 32px' }}>
      <SectionHead eyebrow="Pricing" title={<>Plans that cost what they say.<br /><span style={{ color: 'var(--green)' }}>Messages cost what Meta charges.</span></>}
        sub="No per-agent seats. On a paid plan the per-message rate you are billed is the one Meta bills us — the wallet ledger shows every deduction and every refund." />
      {/* Cards stretch to the tallest plan and the CTA is pinned to the
          bottom of each, so the three buttons land on one line. Sized to
          content they sat at three different heights, and the popular card's
          button hung below the panel it belongs to. */}
      <div className="plan-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, maxWidth: 1000, margin: '0 auto' }}>
        {PLANS.map((p, i) => (
          <Reveal key={p.name} delay={i * 80} style={{ height: '100%' }}>
            <Glass lit={!p.popular} style={{
              padding: 30, borderRadius: 'var(--rxl)', position: 'relative',
              height: '100%', display: 'flex', flexDirection: 'column',
              ...(p.popular ? {
                // Tint layered *over* the glass, not instead of it. On its own
                // the gradient faded to near-nothing by the bottom of the
                // card, so the panel looked like it stopped above the button.
                background: 'linear-gradient(158deg, rgba(30,191,94,0.10), rgba(14,165,233,0.05)), var(--glass)',
                borderColor: 'var(--gbd)',
                boxShadow: 'var(--glow), var(--glass-sh)',
              } : {}),
            }}>
              {p.popular && (
                <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', padding: '4px 13px', borderRadius: 999, background: 'var(--green)', fontFamily: MONO, fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', color: '#060913', textTransform: 'uppercase', whiteSpace: 'nowrap', boxShadow: '0 4px 18px rgba(30,191,94,0.35)' }}>Most popular</div>
              )}
              <h3 style={{ fontWeight: 700, fontSize: 18, color: 'var(--t1)', marginBottom: 6, letterSpacing: '-.02em' }}>{p.name}</h3>
              <p style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 20, lineHeight: 1.55 }}>{p.desc}</p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: p.note ? 6 : 24 }}>
                <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 40, color: 'var(--t1)', letterSpacing: '-.045em' }}>{p.price}</span>
                <span style={{ fontSize: 13, color: 'var(--t2)' }}>{p.per}</span>
              </div>
              {p.note && <p style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--t2)', marginBottom: 24, letterSpacing: '.02em' }}>{p.note}</p>}
              {/* Grows to fill the card so the button below it stays put. */}
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 26, flex: 1 }}>
                {p.features.map(f => (
                  <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, color: 'var(--t2)', lineHeight: 1.5 }}>
                    <span style={{ flexShrink: 0, marginTop: 2 }}><I n="check" s={13} c="var(--green)" w={2.4} /></span>{f}
                  </li>
                ))}
              </ul>
              {/* No extra glow on the popular plan's button: the card is
                  already glowing, and two overlapping halos made the button
                  look detached from the card it sits in. */}
              {/* Names the plan, because "Start free" on a ₹2,500/mo
                  subscription promises something this button cannot do — the
                  free plan is its own tier, called out under the grid. */}
              <Btn variant={p.popular ? 'primary' : 'ghost'} style={{ width: '100%', justifyContent: 'center' }} onClick={() => onNav('dashboard')}>
                {p.name === 'Enterprise' ? 'Talk to sales' : `Choose ${p.name}`} <I n="arrow" s={13} c={p.popular ? '#060A10' : 'var(--t2)'} />
              </Btn>
            </Glass>
          </Reveal>
        ))}
      </div>

      {/* The free tier is real (100 messages a cycle) and is what the "Start
          for free" buttons elsewhere on the page lead to. Saying so here stops
          the paid cards from having to carry that promise. */}
      <Reveal delay={240}>
        <p style={{ textAlign: 'center', marginTop: 26, fontSize: 13.5, color: 'var(--t2)' }}>
          Not ready to pay? The Free plan includes 100 messages a cycle, one workspace and no card —{' '}
          <button onClick={() => onNav('dashboard')} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--green)', fontWeight: 600, cursor: 'pointer' }}>
            start there
          </button>.
        </p>
      </Reveal>
    </div>
  </section>
);

// ─── closing ─────────────────────────────────────────────────────────────────

const CTA = ({ onNav }) => (
  <section style={{ padding: '30px 32px 110px', position: 'relative' }}>
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <Reveal>
        <Glass lit={false} style={{ padding: '64px 40px', borderRadius: 'var(--rxl)', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
          <div className="aurora-b" style={{ position: 'absolute', top: '-60%', left: '50%', width: 700, height: 700, marginLeft: -350, background: 'radial-gradient(circle, rgba(30,191,94,0.12), transparent 60%)', filter: 'blur(40px)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative' }}>
            <Eyebrow>Start today</Eyebrow>
            <h2 style={{ fontSize: 'clamp(28px,3.8vw,50px)', fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.08, margin: '18px 0 16px' }}>
              Send the campaign.<br />Let it handle the questions.
            </h2>
            <p style={{ fontSize: 16.5, color: 'var(--t2)', lineHeight: 1.7, maxWidth: 480, margin: '0 auto 32px' }}>
              Connect a number, import your contacts, and put an agent behind your next offer.
            </p>
            <Btn size="lg" onClick={() => onNav('dashboard')} style={{ boxShadow: 'var(--glow)' }}>
              Start for free <I n="arrow" s={14} c="#060A10" />
            </Btn>
            <p style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--t3)', marginTop: 16, letterSpacing: '.04em' }}>NO CARD · FREE PLAN INCLUDES 100 MESSAGES</p>
          </div>
        </Glass>
      </Reveal>
    </div>
  </section>
);

const FOOTER_COLS = [
  { title: 'Product', links: ['Features', 'Pricing', 'Campaign AI Agent', 'Workflows', 'API'] },
  { title: 'Solutions', links: ['E-commerce', 'Education', 'Clinics', 'Real estate', 'Agencies'] },
  { title: 'Company', links: ['About', 'Blog', 'Careers', 'Contact', 'Privacy'] },
];

const Footer = ({ onNav }) => (
  <footer style={{ borderTop: '1px solid var(--bd)', padding: '56px 32px 30px', background: 'rgba(13,17,33,0.5)' }}>
    <div style={{ maxWidth: 1240, margin: '0 auto' }}>
      <div className="footer-grid" style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr 1fr 1fr', gap: 40, marginBottom: 44 }}>
        <div>
          <button onClick={() => onNav('landing')} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, cursor: 'pointer', marginBottom: 14, background: 'none', border: 'none', padding: 0 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1C4.13 1 1 4.13 1 8c0 1.29.35 2.5.96 3.54L1 15l3.46-.96A7 7 0 1 0 8 1z" fill="#060913" /></svg>
            </div>
            <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>ChatFlow<span style={{ color: 'var(--green)' }}>Pro</span></span>
          </button>
          <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.65, maxWidth: 240 }}>
            WhatsApp Business API for teams that would rather their campaigns answered for themselves.
          </p>
        </div>
        {FOOTER_COLS.map(col => (
          <div key={col.title}>
            <h4 style={{ fontFamily: MONO, fontWeight: 600, fontSize: 11, color: 'var(--t1)', marginBottom: 15, textTransform: 'uppercase', letterSpacing: '.14em' }}>{col.title}</h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {col.links.map(l => (
                <li key={l}>
                  <a href="#features" style={{ fontSize: 13, color: 'var(--t2)', textDecoration: 'none', transition: 'color .15s' }}
                    onMouseOver={e => e.target.style.color = 'var(--t1)'} onMouseOut={e => e.target.style.color = 'var(--t2)'}>{l}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 22, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <p style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--t3)' }}>© 2026 ChatFlow Pro · Meta WhatsApp Business API partner</p>
        <div style={{ display: 'flex', gap: 18 }}>
          {['Terms', 'Privacy', 'Security'].map(l => <a key={l} href="#features" style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--t3)', textDecoration: 'none' }}>{l}</a>)}
        </div>
      </div>
    </div>
  </footer>
);

// ─── page ────────────────────────────────────────────────────────────────────

const PAGE_CSS = `
  .hero-heading {
    font-family: 'Syne', sans-serif;
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

export default function Landing({ onNav }) {
  return (
    <div style={{ minHeight: '100vh', overflowX: 'clip' }}>
      <style>{PAGE_CSS}</style>
      <Navbar onNav={onNav} />
      <Hero onNav={onNav} />
      <ProofStrip />
      <AIPromptSection onNav={onNav} />
      <Features />
      {/* <Features/> above covers the messaging half. This covers the CRM half —
          leads, pipeline, forecasting, gamification — which the SoftwareApplication
          featureList in index.html claims, so it has to be on the page (§81).
          Each card leads with a standalone answer an engine can quote (§78). */}
      <MarketingFeatures />
      <UseCases />
      <CostCalculator />
      <Pricing onNav={onNav} />
      {/* Sourced from src/content/marketing.js, which is also what the JSON-LD
          in index.html describes — §81 requires the structured data to match
          what is actually on the page. The previous FAQ kept all but one
          answer out of the DOM, which §77 warns against. */}
      <MarketingIntegrations />
      <MarketingSecurity />
      <MarketingFaq />
      <CTA onNav={onNav} />
      <Footer onNav={onNav} />
    </div>
  );
}
