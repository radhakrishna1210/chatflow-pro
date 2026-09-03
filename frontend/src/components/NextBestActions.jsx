import { useState, useEffect, useCallback } from 'react';
import { I } from './Icons.jsx';
import { wFetch } from '../lib/api.js';

// Ranked "what to do next", from GET /insights/recommendations.
//
// The service is deterministic and cites the facts behind every item, so this
// component's job is to keep that visible. A recommendation whose evidence is
// hidden behind a click is one people learn to ignore — the evidence *is* the
// reason to trust it, so it renders inline, always.
//
// Nothing here is predictive and the wording avoids implying it is: these are
// observations with an obvious next step.

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)' };

// Urgency thresholds mirror URGENCY in nextBestAction.service.js. Bands rather
// than the raw number: "87" reads like a measurement, which it is not.
const band = (urgency) => (urgency >= 90 ? 'now' : urgency >= 60 ? 'soon' : 'when you can');

const BAND_STYLE = {
  now: { fg: '#f87171', bg: 'rgba(239,68,68,.1)', bd: 'rgba(239,68,68,.28)' },
  soon: { fg: '#fbbf24', bg: 'rgba(245,158,11,.1)', bd: 'rgba(245,158,11,.28)' },
  'when you can': { fg: 'var(--t3)', bg: 'rgba(255,255,255,.04)', bd: 'var(--bd)' },
};

// Which dashboard section each record type lives in.
const DESTINATION = { task: 'tasks', deal: 'deals', lead: 'leads', ticket: 'tickets', contact: 'contacts' };

const RECORD_ICON = { task: 'check-square', deal: 'briefcase', lead: 'target', ticket: 'alertc', contact: 'user' };

export default function NextBestActions({ limit = 8 }) {
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await wFetch(`/insights/recommendations?limit=${limit}`);
      if (!res.ok) throw new Error(`Could not load recommendations (${res.status}).`);
      const body = await res.json();
      setItems(body.data ?? []);
      setTotal(body.total ?? 0);
    } catch (e) {
      setError(e.message);
    }
  }, [limit]);

  useEffect(() => { load(); }, [load]);

  // Matches how the rest of the dashboard moves between sections.
  const go = (record) => {
    const section = DESTINATION[record?.type];
    if (section) window.dispatchEvent(new CustomEvent('app:nav', { detail: section }));
  };

  if (error) {
    return <div style={{ ...card, padding: '13px 16px', fontSize: 12.5, color: '#f87171' }}>{error}</div>;
  }

  if (items === null) {
    return <div style={{ ...card, padding: '18px 16px', fontSize: 12.5, color: 'var(--t3)' }}>Working out what needs you…</div>;
  }

  if (items.length === 0) {
    return (
      <div style={{ ...card, padding: '26px 20px', textAlign: 'center' }}>
        <p style={{ fontSize: 13.5, color: 'var(--t1)', marginBottom: 4 }}>Nothing is asking for you right now</p>
        <p style={{ fontSize: 12.5, color: 'var(--t3)', margin: 0 }}>
          No overdue tasks, no breaching tickets, and no deal drifting without a next step.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((r) => {
        const b = band(r.urgency);
        const s = BAND_STYLE[b];
        return (
          <div key={r.key} className="m-lift" style={{ ...card, padding: '13px 15px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span style={{ flexShrink: 0, marginTop: 2 }}>
              <I n={RECORD_ICON[r.record?.type] ?? 'spark'} s={14} c={s.fg} />
            </span>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap', marginBottom: 4 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--t1)' }}>{r.title}</span>
                <span style={{
                  fontSize: 10, textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 700,
                  color: s.fg, background: s.bg, border: `1px solid ${s.bd}`, borderRadius: 4, padding: '1px 6px',
                }}>
                  {b}
                </span>
              </div>

              <p style={{ fontSize: 12.5, color: 'var(--t2)', margin: '0 0 6px', lineHeight: 1.5 }}>{r.why}</p>

              {/* The evidence is the whole point — it is what makes the
                  recommendation checkable rather than something to take on faith. */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(r.evidence ?? []).map((e) => (
                  <span key={e} style={{
                    fontSize: 11, color: 'var(--t3)', background: 'rgba(255,255,255,.03)',
                    border: '1px solid var(--bd)', borderRadius: 4, padding: '2px 7px',
                  }}>
                    {e}
                  </span>
                ))}
              </div>
            </div>

            {DESTINATION[r.record?.type] && (
              <button onClick={() => go(r.record)}
                style={{
                  flexShrink: 0, background: 'none', border: '1px solid var(--bd)', borderRadius: 7,
                  padding: '6px 11px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: 'var(--t2)',
                }}>
                {r.action?.label ?? 'Open'}
              </button>
            )}
          </div>
        );
      })}

      {total > items.length && (
        <p style={{ fontSize: 11.5, color: 'var(--t3)', textAlign: 'center', marginTop: 2 }}>
          Showing the {items.length} most urgent of {total}.
        </p>
      )}
    </div>
  );
}
