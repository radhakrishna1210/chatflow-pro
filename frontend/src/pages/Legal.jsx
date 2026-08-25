import { useEffect } from 'react';
import { navigate } from '../App.jsx';
import LegalCenter from '../components/LegalCenter.jsx';
import { LEGAL_DOCS } from '../lib/legalContent.js';

// The public legal centre. Deliberately outside the dashboard shell and every
// auth guard: these URLs must resolve for a signed-out visitor, because Meta's
// WhatsApp Business onboarding and the payment gateway both require publicly
// reachable policy links. Signed-in users get the same documents inside the
// app, under Dashboard → Legal.
//
// The active document comes from the URL — /legal/privacy, not component
// state — so each policy is separately linkable, which is the entire point of
// publishing them. /legal alone opens the Terms.
export function docFromPath(path) {
  const slug = String(path || '').replace(/^\/legal\/?/, '').split(/[?#]/)[0];
  return LEGAL_DOCS[slug] ? slug : 'terms';
}

export default function Legal({ routePath }) {
  const active = docFromPath(routePath ?? window.location.pathname);
  const doc = LEGAL_DOCS[active];

  useEffect(() => {
    document.title = `${doc.title} — Spandan`;
    return () => { document.title = 'Spandan — WhatsApp Business Platform'; };
  }, [doc.title]);

  return (
    <div style={{ minHeight: '100vh', width: '100%', background: 'radial-gradient(1100px 560px at 12% -10%, rgba(53,232,242,0.05), transparent 60%), radial-gradient(900px 480px at 100% 0%, rgba(157,107,255,0.05), transparent 62%), var(--bg)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '16px clamp(18px,4vw,44px)', borderBottom: '1px solid var(--bd)', position: 'sticky', top: 0, zIndex: 20, background: 'rgba(10,11,14,0.82)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}>
        <a href="/" onClick={e => { e.preventDefault(); navigate('/'); }} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'inherit' }}>
          <span className="sp-pulse" style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 12px var(--accent)' }} />
          <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: '-.02em', color: 'var(--t1)' }}>Spandan</span>
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t3)', letterSpacing: '.12em' }}>LEGAL CENTER</span>
          <a href="/" onClick={e => { e.preventDefault(); navigate('/'); }} style={{ fontSize: 13.5, color: 'var(--t2)' }}>← Back to site</a>
        </div>
      </header>

      <LegalCenter active={active} onSelect={key => navigate(key === 'terms' ? '/legal' : `/legal/${key}`)} />
    </div>
  );
}
