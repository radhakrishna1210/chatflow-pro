import { useState } from 'react';
import { I } from './Icons.jsx';
import { faq, features, security, integrations, site } from '../content/marketing.js';

// AEO-oriented sections (§78): direct answers, question-shaped headings, a
// comparison-style feature list and factual integration labels.
//
// Every string comes from src/content/marketing.js, so keyword and copy edits
// never require touching this file — which is what §80 asks for.
//
// Answers render expanded by default. An accordion that hides its content
// behind a click is exactly the "requires user interaction" pattern §77 warns
// against, so the text is always in the DOM; the toggle only collapses it.

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)' };

const Section = ({ id, title, kicker, children }) => (
  <section id={id} style={{ padding: '64px 22px', maxWidth: 1040, margin: '0 auto' }}>
    {kicker && (
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 10 }}>
        {kicker}
      </div>
    )}
    <h2 style={{ fontSize: 30, color: 'var(--t1)', marginBottom: 26 }}>{title}</h2>
    {children}
  </section>
);

export const MarketingFeatures = () => (
  <Section id="how-it-works" kicker="How it works" title="What you get in one workspace">
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
      {features.map((f) => (
        <article key={f.id} id={f.id} className="m-lift" style={{ ...card, padding: '20px 22px' }}>
          <h3 style={{ fontSize: 17, color: 'var(--t1)', marginBottom: 10 }}>{f.title}</h3>
          {/* The standalone answer, written to make sense quoted on its own. */}
          <p style={{ fontSize: 13.5, color: 'var(--t2)', lineHeight: 1.65, marginBottom: 14 }}>{f.answer}</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
            {f.points.map((p) => (
              <li key={p} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--t3)' }}>
                <I n="check" s={13} c="var(--green)" />
                <span style={{ lineHeight: 1.5 }}>{p}</span>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  </Section>
);

export const MarketingIntegrations = () => (
  <Section id="integrations" kicker="Integrations" title="What it connects to today">
    <p style={{ fontSize: 13.5, color: 'var(--t2)', marginBottom: 20, maxWidth: 640, lineHeight: 1.6 }}>
      {/* §75: only real integrations, clearly labelled. A logo wall of things
          that do not work is the fastest way to lose a reader's trust. */}
      Everything listed here is live in the product today. Nothing is listed as
      available before it is.
    </p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
      {integrations.map((i) => (
        <div key={i.name} style={{ ...card, padding: '15px 17px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--t1)' }}>{i.name}</span>
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, color: 'var(--green)', border: '1px solid var(--gbd)', borderRadius: 4, padding: '1px 6px' }}>
              {i.status}
            </span>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--t3)', margin: 0, lineHeight: 1.55 }}>{i.detail}</p>
        </div>
      ))}
    </div>
  </Section>
);

export const MarketingSecurity = () => (
  <Section id="security" kicker="Security" title={security.title}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
      {security.points.map((p) => (
        <div key={p.title} style={{ ...card, padding: '16px 18px' }}>
          <div style={{ display: 'flex', gap: 9, alignItems: 'center', marginBottom: 7 }}>
            <I n="shield" s={15} c="var(--green)" />
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--t1)' }}>{p.title}</span>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--t3)', margin: 0, lineHeight: 1.6 }}>{p.detail}</p>
        </div>
      ))}
    </div>
  </Section>
);

export const MarketingFaq = () => {
  // Collapsed state is opt-in, so the default DOM contains every answer.
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggle = (q) => setCollapsed((prev) => {
    const next = new Set(prev);
    next.has(q) ? next.delete(q) : next.add(q);
    return next;
  });

  return (
    <Section id="faq" kicker="FAQ" title="Questions people actually ask">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 780 }}>
        {faq.map(({ q, a }) => {
          const open = !collapsed.has(q);
          return (
            <div key={q} style={{ ...card, padding: '16px 18px' }}>
              <h3 style={{ margin: 0 }}>
                <button
                  onClick={() => toggle(q)}
                  aria-expanded={open}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 12, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    textAlign: 'left', color: 'var(--t1)', fontSize: 14.5, fontWeight: 600,
                    fontFamily: 'inherit',
                  }}>
                  <span>{q}</span>
                  <span aria-hidden="true" style={{ color: 'var(--t3)', flexShrink: 0, transition: 'transform var(--dur-fast) var(--ease-standard)', transform: open ? 'rotate(45deg)' : 'none', fontSize: 18, lineHeight: 1 }}>
                    +
                  </span>
                </button>
              </h3>
              {open && (
                <p style={{ margin: '10px 0 0', fontSize: 13.5, color: 'var(--t2)', lineHeight: 1.7 }}>{a}</p>
              )}
            </div>
          );
        })}
      </div>

      <p style={{ marginTop: 26, fontSize: 12, color: 'var(--t3)' }}>
        {/* §79 asks for transparent update dates. */}
        Last reviewed {new Date(site.updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.
      </p>
    </Section>
  );
};

export default MarketingFaq;
