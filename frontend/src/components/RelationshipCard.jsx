import { useState, useEffect } from 'react';
import { I } from './Icons.jsx';
import { wFetch } from '../lib/api.js';

// Relationship strength for one contact, from GET /insights/relationship/:id.
//
// The service deliberately returns a *band* with named reasons and a stated
// confidence, rather than a number, because the spec warns against pretending
// relationship health is scientifically precise. This component has to hold
// that line: the confidence is shown next to the band, not tucked away, and a
// low-confidence verdict is visibly hedged rather than styled to look
// authoritative. A band built on two messages should not look like a finding.

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)' };

const BAND = {
  STRONG:   { label: 'Strong',   fg: 'var(--green)', bg: 'var(--gbg)', bd: 'var(--gbd)' },
  MODERATE: { label: 'Moderate', fg: '#38bdf8', bg: 'rgba(14,165,233,.12)', bd: 'rgba(14,165,233,.32)' },
  WEAK:     { label: 'Weak',     fg: '#fbbf24', bg: 'rgba(245,158,11,.12)', bd: 'rgba(245,158,11,.32)' },
  AT_RISK:  { label: 'At risk',  fg: '#f87171', bg: 'rgba(239,68,68,.12)', bd: 'rgba(239,68,68,.32)' },
};

const TONE = { good: 'var(--green)', ok: 'var(--t2)', bad: '#f87171' };

// Phrased as what the reader should do with the verdict, not as a statistic.
const CONFIDENCE_NOTE = {
  low: 'Based on very little contact so far — treat this as a first impression, not a finding.',
  moderate: 'Based on a limited history. Directionally useful rather than precise.',
  certain: null,
};

export default function RelationshipCard({ contactId, contactName }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    wFetch(`/insights/relationship/${contactId}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) throw new Error(`Could not load relationship strength (${res.status}).`);
        setData(await res.json());
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [contactId]);

  if (error) return <div style={{ ...card, padding: '12px 15px', fontSize: 12.5, color: '#f87171' }}>{error}</div>;
  if (!data) return <div style={{ ...card, padding: '14px 15px', fontSize: 12.5, color: 'var(--t3)' }}>Reading the history…</div>;

  const b = BAND[data.band] ?? BAND.WEAK;
  const note = CONFIDENCE_NOTE[data.confidence];

  return (
    <div style={{ ...card, padding: '15px 17px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 11, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t2)' }}>
          Relationship{contactName ? ` with ${contactName}` : ''}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span style={{
            fontSize: 11.5, fontWeight: 700, color: b.fg, background: b.bg,
            border: `1px solid ${b.bd}`, borderRadius: 5, padding: '2px 9px',
          }}>
            {b.label}
          </span>
          {/* Sits beside the band on purpose. Reading the verdict without the
              confidence is what turns a hedge into a claim. */}
          <span style={{ fontSize: 11, color: 'var(--t3)' }}>{data.confidence} confidence</span>
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {(data.factors ?? []).map((f) => (
          <div key={f.label} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ flexShrink: 0, marginTop: 2 }}>
              <I n={f.tone === 'bad' ? 'alertt' : f.tone === 'good' ? 'check' : 'note'} s={12} c={TONE[f.tone] ?? 'var(--t2)'} />
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--t1)', fontWeight: 600 }}>{f.label}.</strong> {f.detail}
            </span>
          </div>
        ))}
      </div>

      {note && (
        <p style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 11, paddingTop: 10, borderTop: '1px solid var(--bd)', lineHeight: 1.5 }}>
          {note}
        </p>
      )}
    </div>
  );
}
