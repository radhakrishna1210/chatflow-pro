import { useState, useEffect } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { navigate } from '../App.jsx';
import {
  MONO, Reveal, Eyebrow, SectionHead, Aurora, Glass,
  MarketingNav, MarketingFooter, MARKETING_CSS,
} from '../components/marketing.jsx';
import { CAMPAIGN_AI } from '../../../backend/src/data/siteContent.js';

// ─── Campaign AI product page ────────────────────────────────────────────────
//
// The one feature page under /product. It exists because "the AI answers about
// the campaign the customer actually received" is the claim the whole platform
// rests on, and the landing page can only give it a paragraph.
//
// It shares its chrome with the landing page (components/marketing.jsx) and its
// words with the website assistant (backend/src/data/siteContent.js), so a
// visitor who reads the page and a visitor who asks the assistant get the same
// answer. Nothing here states a price — same rule as the rest of the site.
//
// The hero demo is deliberately static markup rather than the landing page's
// scripted playback: this page is read, not watched, and a thread that animates
// while someone is trying to read the definition beside it competes with it.

const PAGE_CSS = `
  ${MARKETING_CSS}
  .ca-hero { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 56px; align-items: center; }
  .ca-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .ca-caps  { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .ca-cases { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .ca-limits{ display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
  .ca-row   { display: grid; grid-template-columns: 1.6fr 1fr 1fr; gap: 0; align-items: center; }
  @media (max-width: 1024px) {
    .ca-hero  { grid-template-columns: 1fr; gap: 44px; }
    .ca-steps { grid-template-columns: repeat(2, 1fr); }
    .ca-caps  { grid-template-columns: repeat(2, 1fr); }
    .ca-cases { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 720px) {
    .ca-steps, .ca-caps, .ca-cases, .ca-limits { grid-template-columns: 1fr; }
  }
`;

const SHELL = { maxWidth: 1120, margin: '0 auto', padding: '0 clamp(18px,4vw,32px)' };

// ─── hero ────────────────────────────────────────────────────────────────────

const Chip = ({ children }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: 'var(--t2)', padding: '7px 13px', borderRadius: 100, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)' }}>
    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
    {children}
  </span>
);

// The proof the whole page is about: a real campaign message, a real question,
// and an answer whose every fact is tagged with where it came from.
const GroundedDemo = () => {
  const d = CAMPAIGN_AI.demo;
  return (
    <Glass className="hero-visual" style={{ borderRadius: 'var(--rxl)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', background: 'var(--grad-wa)' }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#fff', fontSize: 13 }}>
          {d.brand.slice(0, 1)}
        </div>
        <div style={{ lineHeight: 1.25 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: '#fff' }}>{d.brand}</div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.82)' }}>{d.brandNote}</div>
        </div>
      </div>

      <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 12, background: 'rgba(6,9,16,0.55)' }}>
        {/* the campaign that was sent */}
        <div style={{ alignSelf: 'flex-start', maxWidth: '92%', borderRadius: '4px 14px 14px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bd)', padding: '11px 13px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.45, color: 'var(--t1)' }}>{d.campaign}</p>
          <div style={{ marginTop: 9, paddingTop: 8, borderTop: '1px solid var(--bd)', textAlign: 'center', color: 'var(--green)', fontWeight: 700, fontSize: 12.5 }}>{d.cta}</div>
        </div>

        {/* what the customer asked */}
        <div style={{ alignSelf: 'flex-end', maxWidth: '84%', borderRadius: '14px 4px 14px 14px', background: 'rgba(53,232,242,0.14)', border: '1px solid var(--gbd)', padding: '9px 12px' }}>
          <p style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--t1)' }}>{d.question}</p>
        </div>

        {/* the answer, with its receipts */}
        <div style={{ alignSelf: 'flex-start', maxWidth: '96%' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 7 }}>
            <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.1em', color: 'var(--lime)', fontWeight: 600 }}>✓ GROUNDED IN CAMPAIGN</span>
            {d.facts.map(([k, v]) => (
              <span key={k} style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.06em', padding: '2px 7px', borderRadius: 5, background: 'rgba(53,232,242,0.10)', border: '1px solid var(--gbd)', color: 'var(--t2)' }}>
                <span style={{ color: 'var(--green)', fontWeight: 700 }}>{k}</span> {v}
              </span>
            ))}
          </div>
          <div style={{ borderRadius: '4px 14px 14px 14px', background: 'rgba(53,232,242,0.06)', border: '1px solid var(--gbd)', padding: '11px 13px' }}>
            <p style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--t1)' }}>{d.answer}</p>
          </div>
        </div>
      </div>
    </Glass>
  );
};

const Hero = ({ onNav }) => (
  <section id="top" style={{ position: 'relative', overflow: 'hidden', paddingTop: 128, paddingBottom: 80 }}>
    <Aurora />
    <div style={{ ...SHELL, position: 'relative' }}>
      {/* Breadcrumb. Home is a route; the middle crumb is the section of the
          site this page belongs to and has no page of its own yet, so it is
          plain text rather than a link that goes nowhere. */}
      <Reveal>
        <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 26, fontSize: 12.5, color: 'var(--t3)' }}>
          <a href="/" onClick={(e) => { e.preventDefault(); onNav('landing'); }}
            style={{ color: 'var(--t2)', textDecoration: 'none' }}
            onMouseOver={e => e.target.style.color = 'var(--t1)'} onMouseOut={e => e.target.style.color = 'var(--t2)'}>Home</a>
          <span aria-hidden="true">/</span>
          <span>Product</span>
          <span aria-hidden="true">/</span>
          <span style={{ color: 'var(--t1)', fontWeight: 600 }}>Campaign AI</span>
        </nav>
      </Reveal>

      <div className="ca-hero">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, alignItems: 'flex-start', minWidth: 0 }}>
          <Reveal><Eyebrow>{CAMPAIGN_AI.eyebrow}</Eyebrow></Reveal>
          <Reveal delay={60}>
            <h1 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 'clamp(32px,4.2vw,54px)', fontWeight: 800, letterSpacing: '-.045em', lineHeight: 1.05, color: 'var(--t1)' }}>
              {CAMPAIGN_AI.headline}
            </h1>
          </Reveal>
          <Reveal delay={110}>
            <p style={{ fontSize: 16.5, lineHeight: 1.7, color: 'var(--t2)', maxWidth: 540 }}>{CAMPAIGN_AI.definition}</p>
          </Reveal>
          <Reveal delay={160}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Btn size="lg" onClick={() => onNav('register')}>Start free <I n="arrow" s={14} c="#08090c" /></Btn>
              <Btn size="lg" variant="ghost" onClick={() => document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
                See it answer in context
              </Btn>
            </div>
          </Reveal>
          <Reveal delay={210}>
            <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
              {CAMPAIGN_AI.chips.map(c => <Chip key={c}>{c}</Chip>)}
            </div>
          </Reveal>
        </div>

        <Reveal delay={140} id="demo" style={{ minWidth: 0, scrollMarginTop: 90 }}>
          <GroundedDemo />
        </Reveal>
      </div>
    </div>
  </section>
);

// ─── how it works ────────────────────────────────────────────────────────────
//
// Numbered because it genuinely is a sequence: context is attached before the
// send, and nothing downstream works if that step is skipped.

const HowItWorks = () => (
  <section style={{ padding: '30px 0 100px' }}>
    <div style={SHELL}>
      <SectionHead
        eyebrow="The mechanism"
        title="How Campaign AI works"
        sub="Four steps turn a one-way broadcast into a grounded, two-way conversation."
      />
      <div className="ca-steps">
        {CAMPAIGN_AI.steps.map((s, i) => (
          <Reveal key={s.num} delay={i * 70}>
            <Glass style={{ padding: 22, borderRadius: 'var(--rxl)', height: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 700, color: 'var(--green)', letterSpacing: '-.02em' }}>{s.num}</div>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--t1)', letterSpacing: '-.02em' }}>{s.title}</div>
              <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--t2)' }}>{s.body}</p>
            </Glass>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

// ─── capabilities ────────────────────────────────────────────────────────────

const Capabilities = () => (
  <section id="capabilities" style={{ padding: '0 0 100px', scrollMarginTop: 80 }}>
    <div style={SHELL}>
      <SectionHead eyebrow="Capabilities" title="What you can do with it" />
      <div className="ca-caps">
        {CAMPAIGN_AI.capabilities.map((c, i) => (
          <Reveal key={c.title} delay={(i % 3) * 70}>
            <Glass style={{ padding: 22, borderRadius: 'var(--rxl)', height: '100%', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--gbg)', border: '1px solid var(--gbd)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <I n={c.icon} s={17} c="var(--green)" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)', marginBottom: 6, letterSpacing: '-.02em' }}>{c.title}</div>
                <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--t2)' }}>{c.body}</p>
              </div>
            </Glass>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

// ─── use cases ───────────────────────────────────────────────────────────────

const UseCases = () => (
  <section style={{ padding: '0 0 100px' }}>
    <div style={SHELL}>
      <SectionHead eyebrow="Who it is for" title="Built for these teams" />
      <div className="ca-cases">
        {CAMPAIGN_AI.useCases.map((u, i) => (
          <Reveal key={u.title} delay={i * 70}>
            <Glass style={{ padding: 22, borderRadius: 'var(--rxl)', height: '100%', display: 'flex', flexDirection: 'column', gap: 11 }}>
              <span style={{ width: 30, height: 3, borderRadius: 3, background: u.color }} />
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 15.5, color: 'var(--t1)', letterSpacing: '-.02em' }}>{u.title}</div>
              <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--t2)' }}>{u.body}</p>
            </Glass>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

// ─── comparison ──────────────────────────────────────────────────────────────

const Comparison = () => {
  const { columns, rows } = CAMPAIGN_AI.compare;
  const cell = { padding: '15px 18px', fontSize: 13.5, minWidth: 0 };
  return (
    <section style={{ padding: '0 0 100px' }}>
      <div style={SHELL}>
        <SectionHead eyebrow="Side by side" title="How Campaign AI compares" />
        <Reveal>
          {/* Its own scroll container: a three-column table must not make the
              page scroll sideways on a phone. */}
          <div style={{ overflowX: 'auto' }}>
            <Glass lit={false} style={{ borderRadius: 'var(--rxl)', overflow: 'hidden', minWidth: 560 }}>
              <div className="ca-row" style={{ borderBottom: '1px solid var(--bd)', background: 'rgba(255,255,255,0.02)' }}>
                {columns.map((c, i) => (
                  <div key={c} style={{ ...cell, fontFamily: MONO, fontSize: 10, letterSpacing: '.13em', textTransform: 'uppercase', fontWeight: 600, color: i === 1 ? 'var(--green)' : 'var(--t3)' }}>{c}</div>
                ))}
              </div>
              {rows.map(([capability, ours, theirs], i) => (
                <div key={capability} className="ca-row" style={{ borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--bd)' }}>
                  <div style={{ ...cell, color: 'var(--t1)', fontWeight: 600 }}>{capability}</div>
                  <div style={{ ...cell, color: 'var(--t1)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <I n="checkc" s={14} c="var(--success)" />
                    {ours}
                  </div>
                  <div style={{ ...cell, color: 'var(--t3)' }}>{theirs}</div>
                </div>
              ))}
            </Glass>
          </div>
        </Reveal>
      </div>
    </section>
  );
};

// ─── limitations ─────────────────────────────────────────────────────────────
//
// Kept on the page rather than buried in docs. A feature page that only lists
// what a thing does is the reason people distrust feature pages.

const Limits = () => (
  <section style={{ padding: '0 0 100px' }}>
    <div style={SHELL}>
      <SectionHead
        eyebrow="Straight answers"
        title="Limitations & compliance"
        sub="What the platform can and cannot do, so there are no surprises after you have sent."
      />
      <div className="ca-limits">
        {CAMPAIGN_AI.limits.map((text, i) => (
          <Reveal key={text} delay={(i % 2) * 70}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '16px 18px', borderRadius: 'var(--rl)', background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.20)', height: '100%' }}>
              <I n="alertt" s={16} c="#fbbf24" />
              <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--t2)' }}>{text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

// ─── faq ─────────────────────────────────────────────────────────────────────

const Faq = () => {
  const [open, setOpen] = useState(0);
  return (
    <section style={{ padding: '0 0 100px' }}>
      <div style={{ ...SHELL, maxWidth: 820 }}>
        <SectionHead eyebrow="Questions" title="Frequently asked questions" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {CAMPAIGN_AI.faqs.map(([q, a], i) => {
            const isOpen = open === i;
            return (
              <Reveal key={q} delay={i * 45}>
                <Glass lit={false} style={{ borderRadius: 'var(--rl)', overflow: 'hidden' }}>
                  <button
                    onClick={() => setOpen(isOpen ? -1 : i)}
                    aria-expanded={isOpen}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '17px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: "'Manrope',sans-serif" }}
                  >
                    <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--t1)' }}>{q}</span>
                    <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1, flexShrink: 0, color: isOpen ? 'var(--green)' : 'var(--t2)', transform: `rotate(${isOpen ? 45 : 0}deg)`, transition: 'transform .2s ease, color .2s ease' }}>+</span>
                  </button>
                  {isOpen && (
                    <div style={{ padding: '0 20px 18px' }}>
                      <p style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--t2)' }}>{a}</p>
                    </div>
                  )}
                </Glass>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
};

// ─── related + cta ───────────────────────────────────────────────────────────

// Every related surface is a real destination inside the app, so the links go
// there rather than to a fragment. A signed-out visitor hits the login guard
// and lands back here after signing in, which is the correct behaviour for a
// marketing page linking product surfaces.
const RELATED_HREF = {
  'AI Agent': '/dashboard/ai-agent',
  'Shared Inbox': '/dashboard/inbox',
  'Automation': '/dashboard/automation',
  'Intent Matching': '/dashboard/intent-matching',
  'WhatsApp Campaigns': '/dashboard/campaigns',
  'Templates': '/dashboard/templates',
};

const Related = () => (
  <section style={{ padding: '0 0 90px' }}>
    <div style={SHELL}>
      <Reveal>
        <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 16 }}>Related</div>
      </Reveal>
      <Reveal delay={60}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {CAMPAIGN_AI.related.map(r => (
            <a key={r} href={RELATED_HREF[r] || '/'}
              onClick={e => { e.preventDefault(); navigate(RELATED_HREF[r] || '/'); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600, color: 'var(--t2)', textDecoration: 'none', padding: '10px 16px', borderRadius: 100, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)', transition: 'all .15s' }}
              onMouseOver={e => { e.currentTarget.style.color = 'var(--t1)'; e.currentTarget.style.borderColor = 'var(--gbd)'; }}
              onMouseOut={e => { e.currentTarget.style.color = 'var(--t2)'; e.currentTarget.style.borderColor = 'var(--bd)'; }}>
              {r} <I n="arrow" s={12} c="currentColor" />
            </a>
          ))}
        </div>
      </Reveal>
    </div>
  </section>
);

const CTA = ({ onNav }) => (
  <section style={{ padding: '20px 0 110px', position: 'relative' }}>
    <div style={SHELL}>
      <Reveal>
        <Glass style={{ borderRadius: 'var(--rxl)', padding: 'clamp(32px,5vw,64px)', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
          <Aurora />
          <div style={{ position: 'relative' }}>
            <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 'clamp(26px,3.4vw,44px)', fontWeight: 800, letterSpacing: '-.04em', lineHeight: 1.08, color: 'var(--t1)', marginBottom: 14 }}>
              {CAMPAIGN_AI.cta.headline}
            </h2>
            <p style={{ fontSize: 16, color: 'var(--t2)', lineHeight: 1.7, maxWidth: 460, margin: '0 auto 26px' }}>{CAMPAIGN_AI.cta.sub}</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Btn size="lg" onClick={() => onNav('register')}>Start free <I n="arrow" s={14} c="#08090c" /></Btn>
              <Btn size="lg" variant="ghost" onClick={() => navigate('/dashboard/api')}>Read the docs</Btn>
            </div>
          </div>
        </Glass>
      </Reveal>
    </div>
  </section>
);

// ─── page ────────────────────────────────────────────────────────────────────

export default function CampaignAI({ onNav }) {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Campaign AI — ChatFlow Pro';
    return () => { document.title = previous; };
  }, []);

  return (
    <div style={{ minHeight: '100vh', overflowX: 'clip' }}>
      <style>{PAGE_CSS}</style>
      <MarketingNav
        onNav={onNav}
        links={[['How it works', '#top'], ['Capabilities', '#capabilities'], ['Pricing', '/#pricing'], ['Home', '/']]}
      />
      <Hero onNav={onNav} />
      <HowItWorks />
      <Capabilities />
      <UseCases />
      <Comparison />
      <Limits />
      <Faq />
      <Related />
      <CTA onNav={onNav} />
      <MarketingFooter onNav={onNav} />
    </div>
  );
}
