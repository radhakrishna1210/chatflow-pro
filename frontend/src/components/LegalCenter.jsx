import { useEffect, useMemo } from 'react';
import { LEGAL_DOCS, LEGAL_ORDER } from '../lib/legalContent.js';

// The legal centre's body — policy switcher, table of contents, and the
// document itself. Shared by both places these policies are reachable:
//
//   • the public page at /legal (src/pages/Legal.jsx), which a signed-out
//     visitor and Meta's WhatsApp onboarding both need, and
//   • the "Legal" section inside the dashboard, so a signed-in user finds
//     the policies where they'd look for them rather than having to sign out
//     and hunt through the marketing footer.
//
// Owning the chrome is left to each caller — the public page brings its own
// header, the dashboard section sits under DashHeader — so this renders only
// what is common and never assumes which shell it is in.
export default function LegalCenter({ active, onSelect, compact = false }) {
  const doc = LEGAL_DOCS[active] || LEGAL_DOCS.terms;

  // A policy is a long read; switching documents should start at the top of
  // the new one rather than wherever the previous one was scrolled to.
  useEffect(() => {
    const scroller = compact ? document.querySelector('[data-legal-scroll]') : window;
    scroller?.scrollTo?.({ top: 0, behavior: 'instant' });
  }, [active, compact]);

  const crossLinks = useMemo(
    () => LEGAL_ORDER.filter(k => k !== active).map(k => ({ key: k, title: LEGAL_DOCS[k].title })),
    [active],
  );

  return (
    <div className="legal-grid" style={{ maxWidth: 1120, margin: '0 auto', padding: compact ? 0 : 'clamp(24px,4vw,44px)', display: 'grid', gridTemplateColumns: '230px 1fr', gap: 'clamp(24px,4vw,48px)', alignItems: 'start' }}>
      <aside className="legal-aside" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.16em', color: 'var(--t3)', padding: '0 0 10px' }}>POLICIES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {LEGAL_ORDER.map(key => {
              const on = key === active;
              return (
                <button key={key} onClick={() => onSelect(key)}
                  style={{ textAlign: 'left', fontSize: 13.5, fontWeight: on ? 700 : 500, color: on ? 'var(--t1)' : 'var(--t2)', background: on ? 'rgba(53,232,242,0.10)' : 'transparent', border: 'none', borderLeft: `2px solid ${on ? 'var(--accent)' : 'transparent'}`, borderRadius: '0 8px 8px 0', padding: '9px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {LEGAL_DOCS[key].title}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ border: '1px solid var(--bd)', borderRadius: 12, background: 'var(--surf)', padding: '14px 15px' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '.1em', color: 'var(--t3)', marginBottom: 6 }}>ON THIS PAGE</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {doc.toc.map(t => <span key={t} style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.4 }}>{t}</span>)}
          </div>
        </div>

        <div style={{ fontSize: 11.5, color: 'var(--t3)', lineHeight: 1.6 }}>
          {/* Deliberately not an email address: the one that used to be here
              named a domain the project does not own, so anyone who wrote to it
              reached nobody. Support tickets are the channel that exists. */}
          Questions about these policies? Open a ticket from Help &amp; Support and we will answer there.
        </div>
      </aside>

      <main style={{ minWidth: 0 }}>
        <div style={{ border: '1px solid var(--bd)', borderRadius: compact ? 'var(--rxl)' : 20, background: 'linear-gradient(180deg, rgba(19,22,30,0.6), rgba(12,13,17,0.6))', padding: 'clamp(24px,3.5vw,44px)' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.12em', color: 'var(--accent)', marginBottom: 10 }}>{doc.eyebrow}</div>
          <h1 style={{ fontSize: compact ? 'clamp(24px,3vw,32px)' : 'clamp(28px,4vw,40px)', fontWeight: 700, letterSpacing: '-.03em', marginBottom: 10, color: 'var(--t1)' }}>{doc.title}</h1>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--t3)', paddingBottom: 22, marginBottom: 24, borderBottom: '1px solid var(--bd)' }}>
            <span>Effective: {doc.effective}</span>
            <span>Last updated: {doc.updated}</span>
            <span>Governing law: India</span>
          </div>

          {/* Static policy prose authored in this repo (src/lib/legalContent.js),
              never user- or API-supplied — so there is no untrusted HTML here. */}
          <div className="legal-body" dangerouslySetInnerHTML={{ __html: doc.html }} />

          <div style={{ marginTop: 36, paddingTop: 22, borderTop: '1px solid var(--bd)', display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12.5, color: 'var(--t3)' }}>© {new Date().getFullYear()} ChatFlow Pro · India</span>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {crossLinks.map(c => (
                <button key={c.key} onClick={() => onSelect(c.key)}
                  style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--accent)', background: 'rgba(53,232,242,0.08)', border: '1px solid rgba(53,232,242,0.24)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {c.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
