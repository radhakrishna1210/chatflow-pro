import { useState, useEffect, useRef, useCallback } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { navigate } from '../App.jsx';
import {
  MONO, prefersReducedMotion, useInView, Glass, Reveal, Eyebrow, SectionHead, Aurora,
  MarketingNav, MarketingFooter, MARKETING_CSS,
} from '../components/marketing.jsx';
import {
  HERO, PROOF, AI_PROMPT_EXAMPLES, FEATURES, USE_CASES, PLAN_CARDS,
  FAQ_ITEMS, REACTOR, PLAYGROUND, AUTOMATION_LAB, PLATFORM_MAP,
  // Aliased: `CTA` is already the name of the closing section's component.
  CTA as CTA_COPY,
} from '../../../backend/src/data/siteContent.js';
import { MarketingFaq, MarketingFeatures, MarketingIntegrations, MarketingSecurity } from '../components/MarketingFaq.jsx';

// ─── Landing page ────────────────────────────────────────────────────────────
//
// The page's job is to explain, in one screen, what this product does that a
// reseller's WhatsApp dashboard does not: a campaign message that answers
// questions about itself. So the hero is not a screenshot of the app — it is
// the message a customer receives, the button they tap, and the conversation
// that follows. Everything else on the page stays quiet around it.
//
// The words themselves come from backend/src/data/siteContent.js — a plain
// data module with no React in it — because the website assistant indexes that
// same file. Copy edited here would be invisible to the assistant, which would
// then answer "what features do you have?" from a stale second copy. Vite
// inlines the import at build time, so nothing about this reaches runtime.
//
// Surfaces are frosted (.glass in index.css) over a slowly drifting aurora, so
// depth comes from layering rather than from borders. All motion is opt-out:
// the reduced-motion block in index.css stops the drift and the reveals, and
// the scripted conversation below jumps straight to its final state.


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
        background: mine ? 'rgba(53,232,242,0.14)' : 'rgba(255,255,255,0.05)',
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
        {[['Sent', '12,421', 'var(--t1)'], ['Delivered', '12,180', 'var(--green)'], ['Chats opened', '1,308', '#9d6bff']].map(([l, v, c]) => (
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
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1C4.13 1 1 4.13 1 8c0 1.29.35 2.5.96 3.54L1 15l3.46-.96A7 7 0 1 0 8 1z" fill="#08090c" /></svg>
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
            borderRadius: 11, fontFamily: "'Manrope',sans-serif", fontSize: 12.5, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            color: pressed ? 'var(--green)' : '#53bdeb',
            background: pressed ? 'rgba(53,232,242,0.12)' : 'rgba(255,255,255,0.05)',
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
            style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '6px 14px 6px 6px', borderRadius: 999, background: 'var(--gbg)', border: '1px solid var(--gbd)', cursor: 'pointer', fontFamily: "'Manrope',sans-serif" }}
          >
            <span style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--green)', color: '#08090c', fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '.1em' }}>NEW</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>{HERO.badge}</span>
            <I n="arrow" s={12} c="var(--green)" />
          </button>
        </Reveal>

        <Reveal delay={80}>
          {/* Last line carries the green tail; the break between lines is the
              intended one, not whatever the width happens to produce. */}
          <h1 className="hero-heading">
            {HERO.headlineLines.map((line, i, all) => {
              const last = i === all.length - 1;
              const tinted = last && line.endsWith(HERO.highlight);
              return (
                <span key={line}>
                  {tinted ? line.slice(0, -HERO.highlight.length) : line}
                  {tinted && <span style={{ color: 'var(--green)' }}>{HERO.highlight}</span>}
                  {!last && <br />}
                </span>
              );
            })}
          </h1>
        </Reveal>

        <Reveal delay={150}>
          <p style={{ fontSize: 18, color: 'var(--t2)', maxWidth: 520, lineHeight: 1.7, fontWeight: 500 }}>
            {HERO.sub}
          </p>
        </Reveal>

        <Reveal delay={210}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <Btn size="lg" onClick={() => onNav('dashboard')} style={{ boxShadow: 'var(--glow)' }}>Start for free <I n="arrow" s={14} c="#08090c" /></Btn>
            <Btn variant="ghost" size="lg" onClick={() => { document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' }); }}>See how it works</Btn>
          </div>
        </Reveal>

        <Reveal delay={260}>
          <p style={{ fontFamily: MONO, fontSize: 12, color: 'var(--t3)', letterSpacing: '.02em' }}>
            {HERO.note}
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
// (PROOF is imported — see the note at the top of the file.)

const ProofStrip = () => (
  <section style={{ padding: '0 32px 90px' }}>
    <div style={{ maxWidth: 1240, margin: '0 auto' }}>
      <Reveal>
        <Glass lit={false} className="proof-grid" style={{ padding: '26px 8px', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', borderRadius: 'var(--rxl)' }}>
          {PROOF.map(([value, label], i) => (
            <div key={label} style={{ padding: '0 24px', borderLeft: i === 0 ? 'none' : '1px solid var(--bd)' }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 800, fontSize: 22, color: 'var(--t1)', letterSpacing: '-.03em', marginBottom: 6 }}>{value}</div>
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
        <h3 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 18, color: 'var(--t1)', marginBottom: 8 }}>Sign in to build this</h3>
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
              style={{ width: '100%', height: 132, background: 'transparent', border: 'none', padding: '22px 24px', color: 'var(--t1)', fontSize: 15.5, lineHeight: 1.6, resize: 'none', outline: 'none', fontFamily: "'Manrope',sans-serif" }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 18px', background: 'rgba(255,255,255,0.02)', borderTop: '1px solid var(--bd)' }}>
              <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--t3)', letterSpacing: '.06em' }}>ENTER TO SEND</span>
              <Btn size="sm" onClick={send} disabled={!prompt.trim()}>Build it <I n="arrow" s={12} c="#08090c" /></Btn>
            </div>
          </Glass>
        </Reveal>
        <Reveal delay={130}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16, justifyContent: 'center' }}>
            {AI_PROMPT_EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => setPrompt(ex)}
                style={{ padding: '7px 13px', borderRadius: 999, background: 'rgba(255,255,255,0.035)', border: '1px solid var(--bd)', color: 'var(--t2)', fontSize: 12.5, cursor: 'pointer', fontFamily: "'Manrope',sans-serif", transition: 'all .18s' }}
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
                <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 800, fontSize: 34, color: 'var(--t1)', letterSpacing: '-.04em' }}>
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
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 800, fontSize: 'clamp(44px,5vw,68px)', color: 'var(--green)', letterSpacing: '-.05em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
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

const FaqRow = ({ q, a, open, onToggle, index }) => (
  <Reveal delay={index * 50}>
    <Glass lit={false} style={{ borderRadius: 'var(--rl)', overflow: 'hidden' }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 16, padding: '18px 22px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: "'Manrope',sans-serif" }}
      >
        <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: 'var(--t1)', letterSpacing: '-.01em' }}>{q}</span>
        <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform .3s cubic-bezier(.2,.7,.3,1)', transform: open ? 'rotate(45deg)' : 'none' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={open ? 'var(--green)' : 'var(--t2)'} strokeWidth="2.4" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </span>
      </button>
      {/* Grid-rows trick: animates to the answer's real height without
          measuring it or hardcoding a max-height that clips longer copy. */}
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows .32s cubic-bezier(.2,.7,.3,1)' }}>
        <div style={{ overflow: 'hidden' }}>
          <p style={{ padding: '0 22px 20px', fontSize: 13.5, color: 'var(--t2)', lineHeight: 1.7, maxWidth: 760 }}>{a}</p>
        </div>
      </div>
    </Glass>
  </Reveal>
);

const Faq = () => {
  const [open, setOpen] = useState(0);
  return (
    <section style={{ padding: '20px 0 100px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 32px' }}>
        <SectionHead eyebrow="Before you ask" title={<>The questions that<br />come up <span style={{ color: 'var(--green)' }}>every time</span></>} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {FAQ_ITEMS.map(([q, a], i) => (
            <FaqRow key={q} q={q} a={a} index={i} open={open === i} onToggle={() => setOpen(open === i ? -1 : i)} />
          ))}
        </div>
      </div>
    </section>
  );
};


// ─── features ────────────────────────────────────────────────────────────────

const AgentChainVisual = () => (
  <div className="rgrid-3" style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
    {[
      ['1 · Attach', 'Pick a deployed agent and a CTA label while you build the campaign.', 'var(--green)'],
      ['2 · Tap', 'The button carries the recipient’s id, so the agent opens on the right message.', '#9d6bff'],
      ['3 · Answer', 'Questions are answered from that message — and nothing else is invented.', '#c4ff46'],
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
    {[['Trigger', 'Customer sends a message', 'var(--green)'], ['Wait', '2 hours', '#F59E0B'], ['Send', 'Follow-up template', '#9d6bff']].map(([t, d, c], i) => (
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

// The three inline diagrams, keyed by the `visual` name a FEATURES entry
// carries. A card without one just renders its prose.
const FEATURE_VISUALS = {
  agentChain: AgentChainVisual,
  ledger: LedgerVisual,
  flow: FlowVisual,
};

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
      {/* Reveal delays stagger each grid row rather than the whole list, so a
          card animates in with its neighbours. The rows are 6 columns wide and
          every card spans 2 or 4, so the running span tells us where a row
          starts without hardcoding the grouping. */}
      <div className="bento" style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 12 }}>
        {(() => {
          let cursor = 0;
          return FEATURES.map((f) => {
            const delay = (cursor % 6) * 30;
            cursor += f.span;
            const Visual = FEATURE_VISUALS[f.visual];
            return (
              <FCard key={f.title} span={f.span} icon={f.icon} color={f.color}
                title={f.title} desc={f.desc} delay={delay}
                visual={Visual ? <Visual /> : undefined} />
            );
          });
        })()}
      </div>
    </div>
  </section>
);

// ─── use cases ───────────────────────────────────────────────────────────────

const UseCases = () => (
  <section id="usecases" style={{ padding: '100px 0', borderTop: '1px solid var(--bd)', borderBottom: '1px solid var(--bd)', background: 'rgba(13,17,33,0.6)' }}>
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 32px' }}>
      <SectionHead eyebrow="Who runs it" title={<>Built for <span style={{ color: 'var(--green)' }}>every industry</span></>}
        sub="Same platform, different conversations. These are the ones it gets used for most." />
      <div className="case-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
        {USE_CASES.map((c, i) => (
          <Reveal key={c.title} delay={(i % 3) * 70}>
            <Glass style={{ padding: 22, height: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap', rowGap: 10 }}>
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

const Pricing = ({ onNav }) => (
  <section id="pricing" style={{ padding: '110px 0', position: 'relative', overflow: 'hidden' }}>
    <div className="aurora-a" style={{ position: 'absolute', bottom: '-20%', left: '30%', width: 560, height: 560, background: 'radial-gradient(circle, rgba(53,232,242,0.10), transparent 62%)', filter: 'blur(50px)', pointerEvents: 'none' }} />
    <div style={{ position: 'relative', maxWidth: 1240, margin: '0 auto', padding: '0 32px' }}>
      <SectionHead eyebrow="Pricing" title={<>Plans that cost what they say.<br /><span style={{ color: 'var(--green)' }}>Messages cost what Meta charges.</span></>}
        sub="No per-agent seats. On a paid plan the per-message rate you are billed is the one Meta bills us — the wallet ledger shows every deduction and every refund." />
      {/* Cards stretch to the tallest plan and the CTA is pinned to the
          bottom of each, so the three buttons land on one line. Sized to
          content they sat at three different heights, and the popular card's
          button hung below the panel it belongs to. */}
      <div className="plan-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, maxWidth: 1000, margin: '0 auto' }}>
        {PLAN_CARDS.map((p, i) => (
          <Reveal key={p.name} delay={i * 80} style={{ height: '100%' }}>
            <Glass lit={!p.popular} style={{
              padding: 30, borderRadius: 'var(--rxl)', position: 'relative',
              height: '100%', display: 'flex', flexDirection: 'column',
              ...(p.popular ? {
                // Tint layered *over* the glass, not instead of it. On its own
                // the gradient faded to near-nothing by the bottom of the
                // card, so the panel looked like it stopped above the button.
                background: 'linear-gradient(158deg, rgba(53,232,242,0.10), rgba(14,165,233,0.05)), var(--glass)',
                borderColor: 'var(--gbd)',
                boxShadow: 'var(--glow), var(--glass-sh)',
              } : {}),
            }}>
              {p.popular && (
                <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', padding: '4px 13px', borderRadius: 999, background: 'var(--green)', fontFamily: MONO, fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', color: '#08090c', textTransform: 'uppercase', whiteSpace: 'nowrap', boxShadow: '0 4px 18px rgba(53,232,242,0.35)' }}>Most popular</div>
              )}
              <h3 style={{ fontWeight: 700, fontSize: 18, color: 'var(--t1)', marginBottom: 6, letterSpacing: '-.02em' }}>{p.name}</h3>
              <p style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 20, lineHeight: 1.55 }}>{p.desc}</p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: p.note ? 6 : 24 }}>
                <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 800, fontSize: 40, color: 'var(--t1)', letterSpacing: '-.045em' }}>{p.price}</span>
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
                {p.name === 'Enterprise' ? 'Talk to sales' : `Choose ${p.name}`} <I n="arrow" s={13} c={p.popular ? '#08090c' : 'var(--t2)'} />
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
          <div className="aurora-b" style={{ position: 'absolute', top: '-60%', left: '50%', width: 700, height: 700, marginLeft: -350, background: 'radial-gradient(circle, rgba(53,232,242,0.12), transparent 60%)', filter: 'blur(40px)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative' }}>
            <Eyebrow>Start today</Eyebrow>
            <h2 style={{ fontSize: 'clamp(28px,3.8vw,50px)', fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.08, margin: '18px 0 16px' }}>
              {CTA_COPY.headlineLines.map((line, i, all) => (
                <span key={line}>{line}{i < all.length - 1 && <br />}</span>
              ))}
            </h2>
            <p style={{ fontSize: 16.5, color: 'var(--t2)', lineHeight: 1.7, maxWidth: 480, margin: '0 auto 32px' }}>
              {CTA_COPY.sub}
            </p>
            <Btn size="lg" onClick={() => onNav('dashboard')} style={{ boxShadow: 'var(--glow)' }}>
              Start for free <I n="arrow" s={14} c="#08090c" />
            </Btn>
            <p style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--t3)', marginTop: 16, letterSpacing: '.04em' }}>NO CARD · FREE PLAN INCLUDES 100 MESSAGES</p>
          </div>
        </Glass>
      </Reveal>
    </div>
  </section>
);


// ─── page ────────────────────────────────────────────────────────────────────

// ─── The conversation reactor ────────────────────────────────────────────────
//
// Six chapters of one message's life, each lighting its stage in the pipeline
// beside them. It is a stepper rather than an animation on a timer: the reader
// controls the pace, which is the difference between explaining something and
// performing at someone.

const Reactor = () => {
  const [chapter, setChapter] = useState(0);
  const current = REACTOR.chapters[chapter];

  return (
    <section id="story" style={{ padding: '20px 0 100px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 clamp(18px,4vw,32px)' }}>
        <SectionHead eyebrow={REACTOR.eyebrow} title={REACTOR.title} sub={REACTOR.sub} />

        <Reveal>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 34 }}>
            {REACTOR.chapters.map((c, i) => {
              const on = i === chapter;
              return (
                <button key={c.num} onClick={() => setChapter(i)} aria-pressed={on}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 15px', borderRadius: 100, cursor: 'pointer',
                           fontFamily: "'Manrope',sans-serif", fontSize: 12.5, fontWeight: 600, transition: 'all .2s',
                           background: on ? 'rgba(157,107,255,0.14)' : 'rgba(255,255,255,0.03)',
                           border: `1px solid ${on ? 'var(--violet)' : 'var(--bd)'}`,
                           color: on ? 'var(--t1)' : 'var(--t2)' }}>
                  <span style={{ fontFamily: MONO, fontSize: 10.5, color: on ? 'var(--violet)' : 'var(--t3)' }}>{c.num}</span>
                  {c.kicker}
                </button>
              );
            })}
          </div>
        </Reveal>

        <div className="reactor-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, alignItems: 'center' }}>
          <Reveal>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: MONO, fontSize: 44, fontWeight: 700, color: 'rgba(157,107,255,0.35)', lineHeight: 1, letterSpacing: '-.03em' }}>{current.num}</div>
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.18em', color: 'var(--violet)', margin: '12px 0 10px' }}>{current.kicker}</div>
              <h3 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 'clamp(22px,2.6vw,32px)', fontWeight: 800, letterSpacing: '-.035em', color: 'var(--t1)', marginBottom: 12 }}>
                {current.title}
              </h3>
              <p style={{ fontSize: 15.5, color: 'var(--t2)', lineHeight: 1.7, maxWidth: 440 }}>{current.body}</p>
            </div>
          </Reveal>

          <Reveal delay={80}>
            <Glass style={{ borderRadius: 'var(--rxl)', padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {REACTOR.pipeline.map((stage, i) => {
                const active = i === chapter;
                const done = i < chapter;
                return (
                  <div key={stage.key} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '11px 13px', borderRadius: 12, transition: 'all .3s',
                    background: active ? 'rgba(196,255,70,0.06)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${active ? 'rgba(196,255,70,0.4)' : 'var(--bd)'}` }}>
                    <span style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                   fontFamily: MONO, fontSize: 11, fontWeight: 700, transition: 'all .3s',
                                   background: active ? 'rgba(196,255,70,0.16)' : done ? 'rgba(53,232,242,0.1)' : 'rgba(255,255,255,0.04)',
                                   color: active ? 'var(--lime)' : done ? 'var(--cyan)' : 'var(--t3)',
                                   border: `1px solid ${active ? 'rgba(196,255,70,0.5)' : done ? 'var(--gbd)' : 'var(--bd)'}` }}>
                      {stage.key}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: active ? 'var(--t1)' : done ? 'var(--t2)' : 'var(--t3)' }}>{stage.label}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--t3)' }}>{stage.sub}</div>
                    </div>
                    {active && <span className="sp-pulse" style={{ marginLeft: 'auto', width: 7, height: 7, borderRadius: '50%', background: 'var(--lime)', flexShrink: 0 }} />}
                  </div>
                );
              })}
            </Glass>
          </Reveal>
        </div>
      </div>
    </section>
  );
};

// ─── Campaign playground ─────────────────────────────────────────────────────
//
// The claim the whole product rests on, made falsifiable: edit the campaign,
// ask a question, and watch the answer change with it. The replies are built
// from whatever the visitor typed — which is the point. Nothing is scripted, so
// there is nothing to catch out.

const playgroundReply = (key, pg) => {
  const { title, product, discount, expiry, cta } = pg;
  const verb = (cta || 'buy').toLowerCase();
  switch (key) {
    case 'end':    return `Your “${title}” runs ${expiry}, so there is still time to claim ${discount} off the ${product}.`;
    case 'size':   return `I can check ${product} stock live — send me your size and I will confirm it before you ${verb}.`;
    case 'coupon': return `The ${discount} from “${title}” is already the best price on the ${product}, so there is no extra coupon to stack on top.`;
    case 'new':    return `Yes — “${title}” covers the ${product} and this season's new arrivals, all at ${discount} off.`;
    default:       return `That is part of the “${title}” offer — ${discount} off the ${product}.`;
  }
};

const PlaygroundField = ({ label, value, onChange }) => (
  <label style={{ display: 'block', minWidth: 0 }}>
    <span style={{ display: 'block', fontFamily: MONO, fontSize: 9.5, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 6 }}>{label}</span>
    <input value={value} onChange={e => onChange(e.target.value)}
      style={{ width: '100%', padding: '10px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 13.5, fontFamily: "'Manrope',sans-serif", outline: 'none', boxSizing: 'border-box' }}
      onFocus={e => e.target.style.borderColor = 'var(--gbd)'}
      onBlur={e => e.target.style.borderColor = 'var(--bd)'} />
  </label>
);

const Playground = () => {
  const [pg, setPg] = useState(PLAYGROUND.seed);
  const [asked, setAsked] = useState(null);
  const set = (k) => (v) => setPg(p => ({ ...p, [k]: v }));

  const facts = [
    ['OFFER', pg.title], ['DEAL', pg.discount], ['ITEM', pg.product], ['ENDS', pg.expiry],
  ];

  return (
    <section id="playground" style={{ padding: '20px 0 100px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 clamp(18px,4vw,32px)' }}>
        <SectionHead eyebrow={PLAYGROUND.eyebrow} title={PLAYGROUND.title} sub={PLAYGROUND.sub} />

        <div className="playground-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
          <Reveal>
            <Glass style={{ borderRadius: 'var(--rxl)', padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--t3)' }}>Campaign fields</div>
              <PlaygroundField label="Offer name" value={pg.title} onChange={set('title')} />
              <PlaygroundField label="Product" value={pg.product} onChange={set('product')} />
              <div className="rgrid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <PlaygroundField label="Discount" value={pg.discount} onChange={set('discount')} />
                <PlaygroundField label="CTA" value={pg.cta} onChange={set('cta')} />
              </div>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 9 }}>Customer asks →</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {PLAYGROUND.questions.map(q => {
                    const on = asked?.key === q.key;
                    return (
                      <button key={q.key} onClick={() => setAsked(q)}
                        style={{ fontSize: 12.5, fontWeight: 600, padding: '8px 13px', borderRadius: 100, cursor: 'pointer', fontFamily: "'Manrope',sans-serif", transition: 'all .2s',
                                 background: on ? 'rgba(53,232,242,0.12)' : 'rgba(255,255,255,0.03)',
                                 border: `1px solid ${on ? 'var(--green)' : 'var(--bd)'}`,
                                 color: on ? '#8fecf3' : 'var(--t2)' }}>
                        {q.q}
                      </button>
                    );
                  })}
                </div>
              </div>
            </Glass>
          </Reveal>

          <Reveal delay={80}>
            <Glass style={{ borderRadius: 'var(--rxl)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 15px', background: 'var(--grad-wa)' }}>
                <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#fff', fontSize: 12 }}>B</span>
                <div style={{ lineHeight: 1.25 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: '#fff' }}>Your Brand</div>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.85)' }}>online · Spandan AI active</div>
                </div>
              </div>

              <div style={{ padding: '18px 15px', display: 'flex', flexDirection: 'column', gap: 12, background: 'rgba(6,9,16,0.55)', minHeight: 300 }}>
                <div style={{ alignSelf: 'flex-start', maxWidth: '92%', borderRadius: '4px 14px 14px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bd)', padding: '11px 13px' }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)', lineHeight: 1.4 }}>🔔 {pg.title} is live!</p>
                  <p style={{ fontSize: 12.5, color: 'var(--t2)', marginTop: 5, lineHeight: 1.5 }}>
                    {pg.discount} OFF on {pg.product} — tap to shop or ask me anything.
                  </p>
                  <div style={{ marginTop: 9, paddingTop: 8, borderTop: '1px solid var(--bd)', textAlign: 'center', color: 'var(--green)', fontWeight: 700, fontSize: 12.5 }}>{pg.cta}</div>
                </div>

                {asked && (
                  <>
                    <div style={{ alignSelf: 'flex-end', maxWidth: '82%', borderRadius: '14px 4px 14px 14px', background: 'rgba(53,232,242,0.14)', border: '1px solid var(--gbd)', padding: '9px 12px' }}>
                      <p style={{ fontSize: 12.5, color: 'var(--t1)', lineHeight: 1.5 }}>{asked.q}</p>
                    </div>
                    <div style={{ alignSelf: 'flex-start', maxWidth: '96%', minWidth: 0 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                        <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.1em', color: 'var(--lime)', fontWeight: 600 }}>✓ VERIFIED FROM YOUR CAMPAIGN</span>
                        {facts.map(([k, v]) => (
                          <span key={k} style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.06em', padding: '2px 7px', borderRadius: 5, background: 'rgba(53,232,242,0.1)', border: '1px solid var(--gbd)', color: 'var(--t2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span style={{ color: 'var(--green)', fontWeight: 700 }}>{k}</span> {v}
                          </span>
                        ))}
                      </div>
                      <div style={{ borderRadius: '4px 14px 14px 14px', background: 'rgba(53,232,242,0.06)', border: '1px solid var(--gbd)', padding: '11px 13px' }}>
                        <p style={{ fontSize: 12.5, color: 'var(--t1)', lineHeight: 1.55 }}>{playgroundReply(asked.key, pg)}</p>
                      </div>
                    </div>
                  </>
                )}

                {!asked && (
                  <p style={{ marginTop: 'auto', textAlign: 'center', fontSize: 12, color: 'var(--t3)' }}>
                    ↑ pick a question to see the answer built from these fields
                  </p>
                )}
              </div>
            </Glass>
          </Reveal>
        </div>
      </div>
    </section>
  );
};

// ─── Automation lab ──────────────────────────────────────────────────────────

const AutomationLab = () => {
  const [active, setActive] = useState(-1);
  const timer = useRef(null);

  const run = () => {
    clearInterval(timer.current);
    if (prefersReducedMotion()) { setActive(AUTOMATION_LAB.nodes.length - 1); return; }
    setActive(0);
    let i = 0;
    timer.current = setInterval(() => {
      i += 1;
      if (i >= AUTOMATION_LAB.nodes.length) { clearInterval(timer.current); return; }
      setActive(i);
    }, 620);
  };

  const reset = () => { clearInterval(timer.current); setActive(-1); };
  useEffect(() => () => clearInterval(timer.current), []);

  const running = active >= 0 && active < AUTOMATION_LAB.nodes.length - 1;

  return (
    <section style={{ padding: '20px 0 100px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 clamp(18px,4vw,32px)' }}>
        <SectionHead eyebrow={AUTOMATION_LAB.eyebrow} title={AUTOMATION_LAB.title} sub={AUTOMATION_LAB.sub} />

        <Reveal>
          <Glass style={{ borderRadius: 'var(--rxl)', padding: 'clamp(18px,3vw,28px)' }}>
            <div className="lab-flow" style={{ display: 'flex', alignItems: 'stretch', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
              {AUTOMATION_LAB.nodes.map((node, i) => {
                const lit = active >= i;
                return (
                  <div key={node.label} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 170px', minWidth: 0 }}>
                    <div style={{ flex: 1, minWidth: 0, padding: '13px 14px', borderRadius: 13, transition: 'all .3s',
                      background: lit ? 'rgba(53,232,242,0.07)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${lit ? 'var(--gbd)' : 'var(--bd)'}`,
                      boxShadow: lit ? '0 0 22px rgba(53,232,242,0.16)' : 'none' }}>
                      <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.12em', color: lit ? 'var(--green)' : 'var(--t3)', marginBottom: 6 }}>{node.kind}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--t1)' }}>{node.label}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 2 }}>{node.sub}</div>
                    </div>
                    {i < AUTOMATION_LAB.nodes.length - 1 && (
                      <span aria-hidden="true" style={{ color: active > i ? 'var(--green)' : 'var(--t3)', fontSize: 15, flexShrink: 0, transition: 'color .3s' }}>→</span>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Btn size="sm" onClick={run} disabled={running}>▶ {running ? 'Running…' : 'Run the flow'}</Btn>
              <Btn size="sm" variant="ghost" onClick={reset}>Reset</Btn>
              <span style={{ fontSize: 12.5, color: 'var(--t2)' }}>
                {active < 0 ? 'Idle' : AUTOMATION_LAB.trace[Math.min(active, AUTOMATION_LAB.trace.length - 1)]}
              </span>
            </div>
          </Glass>
        </Reveal>
      </div>
    </section>
  );
};

// ─── Platform map ────────────────────────────────────────────────────────────

const PlatformMap = () => (
  <section id="platform" style={{ padding: '20px 0 100px' }}>
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 clamp(18px,4vw,32px)' }}>
      <SectionHead eyebrow={PLATFORM_MAP.eyebrow} title={PLATFORM_MAP.title} sub={PLATFORM_MAP.sub} />
      <div className="case-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {PLATFORM_MAP.groups.map((group, i) => (
          <Reveal key={group.name} delay={(i % 3) * 70}>
            <Glass style={{ borderRadius: 'var(--rxl)', padding: 20, height: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: group.color, boxShadow: `0 0 10px ${group.color}` }} />
                <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.18em', color: 'var(--t2)' }}>{group.name}</span>
              </div>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 9 }}>
                {group.items.map(item => (
                  <li key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--t2)' }}>
                    <I n="check" s={11} c={group.color} w={2.5} />
                    {item}
                  </li>
                ))}
              </ul>
            </Glass>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

// Every rule this page needs is shared with the other marketing surfaces —
// see components/marketing.jsx. Page-specific rules would be appended here.
const PAGE_CSS = `
  ${MARKETING_CSS}
  @media (max-width: 900px) {
    .reactor-grid, .playground-grid { grid-template-columns: 1fr !important; gap: 26px !important; }
  }
`;

export default function Landing({ onNav }) {
  return (
    <div style={{ minHeight: '100vh', overflowX: 'clip' }}>
      <style>{PAGE_CSS}</style>
      <MarketingNav onNav={onNav} />
      <Hero onNav={onNav} />
      <ProofStrip />
      <AIPromptSection onNav={onNav} />
      <Reactor />
      <Playground />
      <Features />
<AutomationLab />
{/* <Features/> above covers the messaging half. This covers the CRM half —
          leads, pipeline, forecasting, gamification — which the SoftwareApplication
          featureList in index.html claims, so it has to be on the page (§81).
          Each card leads with a standalone answer an engine can quote (§78). */}
      <MarketingFeatures />
      <UseCases />
      <PlatformMap />
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
      <MarketingFooter onNav={onNav} />
    </div>
  );
}
