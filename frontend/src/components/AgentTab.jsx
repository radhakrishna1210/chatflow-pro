import { useState, useEffect, useCallback } from 'react';
import { I } from './Icons.jsx';
import { Btn } from './Btn.jsx';
import { wFetch } from '../lib/api.js';

// What the autonomous agent has done to one record.
//
// The agent writes to records without asking, so this view is not a nicety —
// it is the only place the change becomes visible to the person who owns the
// record. It shows three things, and the middle one is the point:
//
//   what it did          — passes, with the evidence that justified each
//   what it held back    — claims that did not clear the bar, and why
//   what it plans next   — queued work, with the reason it booked it
//
// "What did it consider and reject" is the question reps actually ask, which is
// why withheld facts are kept and rendered rather than discarded.

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)' };

const fmtWhen = (d) => {
  const then = new Date(d);
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return then.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const fmtWhen2 = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const Empty = ({ children }) => (
  <p style={{ fontSize: 12.5, color: 'var(--t3)', margin: 0, lineHeight: 1.55 }}>{children}</p>
);

const Section = ({ icon, title, count, children }) => (
  <div style={{ ...card, padding: '14px 16px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
      <I n={icon} s={13} c="var(--t2)" />
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t2)' }}>{title}</span>
      {count !== undefined && <span style={{ fontSize: 11, color: 'var(--t3)' }}>{count}</span>}
    </div>
    {children}
  </div>
);

const Suggestion = ({ fact, onSettled }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const settle = async (accepted) => {
    setBusy(true);
    setError(null);
    try {
      const res = await wFetch(`/agent/facts/${fact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || b.message || `Could not settle that (${res.status}).`);
      }
      await onSettled();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const settled = !!fact.settledAt;

  return (
    <div style={{
      padding: '11px 13px', borderRadius: 8,
      border: `1px solid ${settled ? 'var(--bd)' : 'rgba(245,158,11,.25)'}`,
      background: settled ? 'transparent' : 'rgba(245,158,11,.05)',
      opacity: settled ? .6 : 1,
    }}>
      <div style={{ fontSize: 12.5, color: 'var(--t1)', marginBottom: 4 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t3)' }}>{fact.field}</span>{' '}
        <strong style={{ fontWeight: 600 }}>{fact.value}</strong>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--t3)', margin: '0 0 8px', lineHeight: 1.5 }}>{fact.rationale}</p>

      {error && <p style={{ fontSize: 11.5, color: '#f87171', margin: '0 0 6px' }}>{error}</p>}

      {settled ? (
        <span style={{ fontSize: 11.5, color: fact.accepted ? 'var(--green)' : 'var(--t3)' }}>
          {fact.accepted ? 'Accepted' : 'Rejected'} · {fmtWhen(fact.settledAt)}
        </span>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn size="sm" onClick={() => settle(true)} disabled={busy}>Accept</Btn>
          <Btn size="sm" variant="ghost" onClick={() => settle(false)} disabled={busy}>Reject</Btn>
        </div>
      )}
    </div>
  );
};

export default function AgentTab({ targetType, targetId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await wFetch(`/agent/history/${targetType}/${targetId}`);
      if (!res.ok) throw new Error(`Could not load the agent history (${res.status}).`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [targetType, targetId]);

  useEffect(() => { setData(null); load(); }, [load]);

  if (error) return <div style={{ ...card, padding: '13px 16px', fontSize: 12.5, color: '#f87171' }}>{error}</div>;
  if (!data) return <div style={{ ...card, padding: '16px', fontSize: 12.5, color: 'var(--t3)' }}>Loading…</div>;

  const applied = (data.facts ?? []).filter((f) => f.applied);
  const withheld = (data.facts ?? []).filter((f) => !f.applied);

  const nothingAtAll = (data.runs ?? []).length === 0 && (data.pending ?? []).length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {nothingAtAll && (
        <Section icon="bot" title="Agent">
          <Empty>
            The agent has not looked at this record yet. It works a queue on its own schedule and
            picks up records that have gone quiet or are still unworked.
          </Empty>
        </Section>
      )}

      {withheld.length > 0 && (
        <Section icon="alertt" title="Waiting on you" count={withheld.filter((f) => !f.settledAt).length}>
          <p style={{ fontSize: 11.5, color: 'var(--t3)', margin: '0 0 10px', lineHeight: 1.5 }}>
            The agent thought these were true but the evidence did not clear the bar, so it did not
            apply them.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {withheld.map((f) => <Suggestion key={f.id} fact={f} onSettled={load} />)}
          </div>
        </Section>
      )}

      {applied.length > 0 && (
        <Section icon="check" title="Changes it made" count={applied.length}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {applied.map((f) => (
              <div key={f.id}>
                <div style={{ fontSize: 12.5, color: 'var(--t1)' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t3)' }}>{f.field}</span>{' '}
                  <strong style={{ fontWeight: 600 }}>{f.value}</strong>
                  <span style={{ fontSize: 11, color: 'var(--t3)' }}> · {fmtWhen(f.createdAt)}</span>
                </div>
                <p style={{ fontSize: 11.5, color: 'var(--t3)', margin: '2px 0 0', lineHeight: 1.5 }}>{f.rationale}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {(data.runs ?? []).length > 0 && (
        <Section icon="chart" title="Every pass" count={data.runs.length}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {data.runs.map((r) => (
              <div key={r.id} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                <span style={{
                  flexShrink: 0, marginTop: 5, width: 6, height: 6, borderRadius: 3,
                  background: r.applied > 0 ? 'var(--green)' : r.withheld > 0 ? '#fbbf24' : 'var(--t3)',
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.5 }}>{r.summary}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 1 }}>{fmtWhen2(r.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {(data.pending ?? []).length > 0 && (
        <Section icon="clock" title="Booked next" count={data.pending.length}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.pending.map((p) => (
              <div key={p.id} style={{ fontSize: 12, color: 'var(--t2)' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t3)' }}>{p.kind}</span>
                {p.reason && <span style={{ color: 'var(--t3)' }}> — {p.reason}</span>}
                <div style={{ fontSize: 10.5, color: 'var(--t3)' }}>
                  {new Date(p.runAfter) > new Date() ? `due ${fmtWhen2(p.runAfter)}` : 'due now'}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
