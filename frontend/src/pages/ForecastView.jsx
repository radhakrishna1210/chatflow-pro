import { useState, useEffect, useCallback } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { FInput, FLabel } from '../components/Form.jsx';
import { wFetch } from '../lib/api.js';
import { fmtMoney } from '../lib/format.js';
import { CustomFieldAdmin } from '../components/CustomFields.jsx';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const monthBounds = (d = new Date()) => ({
  from: new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10),
  to: new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10),
});

const ErrorBanner = ({ children, onDismiss }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 14px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)', color: '#f87171', fontSize: 12.5 }}>
    <span>{children}</span>
    {onDismiss && (
      <button onClick={onDismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
        <I n="x" s={14} c="#f87171" />
      </button>
    )}
  </div>
);

const CATEGORIES = [
  { key: 'commit', label: 'Commit', tone: '#22c55e', hint: 'Stages weighted 75% or higher' },
  { key: 'bestCase', label: 'Best case', tone: '#f59e0b', hint: 'Stages weighted 40–74%' },
  { key: 'pipeline', label: 'Pipeline', tone: '#3b82f6', hint: 'Everything else still open' },
];

const SummaryCard = ({ label, value, sub, tone, title }) => (
  <div style={{ ...card, padding: '14px 16px', flex: 1, minWidth: 160 }} title={title}>
    <div style={{ fontSize: 11, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 700, marginBottom: 6 }}>{label}</div>
    <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 21, color: tone || 'var(--t1)' }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>{sub}</div>}
  </div>
);

// Stage probability lives here rather than in a distant settings screen: it is
// the number that produces the forecast above it, so editing it in place makes
// the cause and effect visible.
const StageSettings = ({ stages, isAdmin, onSaved }) => {
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState('');
  const [err, setErr] = useState(null);

  const save = async (key) => {
    const patch = draft[key];
    if (!patch) return;
    setSaving(key);
    setErr(null);
    try {
      const res = await wFetch(`/pipeline-stages/${key}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Could not update this stage');
      }
      setDraft(prev => { const n = { ...prev }; delete n[key]; return n; });
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving('');
    }
  };

  return (
    <div style={{ ...card, padding: '16px 18px' }}>
      <div style={{ marginBottom: 4, fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--t1)' }}>
        Stage probability
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--t3)', marginBottom: 14 }}>
        {isAdmin
          ? 'The weighting each stage contributes to the forecast above. Won and lost are fixed at 100% and 0%.'
          : 'The weighting each stage contributes to the forecast above. Only an admin can change these.'}
      </div>

      {err && <div style={{ marginBottom: 12 }}><ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner></div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {stages.map(s => {
          const locked = s.key === 'CLOSED_WON' || s.key === 'CLOSED_LOST';
          const value = draft[s.key]?.probability ?? s.probability;
          const dirty = draft[s.key] !== undefined;
          return (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontSize: 12.5, color: 'var(--t2)' }}>{s.label}</span>
              <div style={{ flex: 2, height: 4, borderRadius: 2, background: 'var(--bd)', overflow: 'hidden' }}>
                <div style={{ width: `${value}%`, height: '100%', background: locked ? 'var(--t3)' : 'var(--green)' }} />
              </div>
              <input
                type="number" min={0} max={100} value={value}
                disabled={locked || !isAdmin}
                aria-label={`${s.label} probability`}
                onChange={e => setDraft(prev => ({ ...prev, [s.key]: { probability: Number(e.target.value) } }))}
                style={{ width: 62, background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 6, color: locked ? 'var(--t3)' : 'var(--t1)', fontSize: 12, padding: '5px 7px', outline: 'none' }}
              />
              <span style={{ fontSize: 11, color: 'var(--t3)', width: 12 }}>%</span>
              <div style={{ width: 58 }}>
                {dirty && !locked && isAdmin && (
                  <Btn size="sm" onClick={() => save(s.key)} disabled={saving === s.key}>
                    {saving === s.key ? '…' : 'Save'}
                  </Btn>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const ForecastView = ({ user }) => {
  const [range, setRange] = useState(monthBounds());
  const [data, setData] = useState(null);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const isAdmin = user?.role === 'ADMIN' || user?.superAdmin === true;

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    const qs = new URLSearchParams({ from: range.from, to: range.to });
    wFetch(`/forecast?${qs}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load the forecast'))))
      .then(setData)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [range.from, range.to]);

  const loadStages = useCallback(() => {
    wFetch('/pipeline-stages')
      .then(r => (r.ok ? r.json() : { data: [] }))
      .then(d => setStages(d.data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadStages(); }, [loadStages]);

  const shiftMonth = (delta) => {
    const base = new Date(range.from);
    setRange(monthBounds(new Date(base.getFullYear(), base.getMonth() + delta, 1)));
  };

  const totals = data?.totals;

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, color: 'var(--t1)' }}>Forecast</div>
          <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>
            Weighted by stage probability. Only deals with an expected close date in the period are counted.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <Btn size="sm" variant="ghost" onClick={() => shiftMonth(-1)} aria-label="Previous month">←</Btn>
          <div><FLabel>From</FLabel><FInput type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} /></div>
          <div><FLabel>To</FLabel><FInput type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} /></div>
          <Btn size="sm" variant="ghost" onClick={() => shiftMonth(1)} aria-label="Next month">→</Btn>
        </div>
      </div>

      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {err && <ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner>}
        {loading && <div style={{ fontSize: 12.5, color: 'var(--t3)' }}>Loading forecast…</div>}

        {totals && (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <SummaryCard
                label="Projected" value={fmtMoney(totals.projected)} tone="var(--green)"
                sub="Won so far plus weighted open deals"
                title="Closed-won value in this period, plus every open deal multiplied by its stage probability."
              />
              {CATEGORIES.map(c => (
                <SummaryCard
                  key={c.key} label={c.label} tone={c.tone}
                  value={fmtMoney(totals[c.key].weighted)}
                  sub={`${totals[c.key].count} deal${totals[c.key].count === 1 ? '' : 's'} · ${fmtMoney(totals[c.key].value)} unweighted`}
                  title={c.hint}
                />
              ))}
              <SummaryCard label="Closed won" value={fmtMoney(totals.closedWon.value)} sub={`${totals.closedWon.count} in period`} />
            </div>

            {data.excluded?.noCloseDate > 0 && (
              <div style={{ ...card, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, color: 'var(--t2)' }}>
                <I n="alertc" s={14} c="#f59e0b" />
                <span>
                  {data.excluded.noCloseDate} open deal{data.excluded.noCloseDate === 1 ? ' has' : 's have'} no expected close date
                  and {data.excluded.noCloseDate === 1 ? 'is' : 'are'} not counted in any period.
                </span>
              </div>
            )}

            <div style={{ ...card, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--bd)' }}>
                    {['Owner', 'Commit', 'Best case', 'Pipeline', 'Closed won', 'Projected'].map((h, i) => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: i === 0 ? 'left' : 'right', fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.08em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.byOwner.map(o => (
                    <tr key={o.ownerUserId ?? 'unassigned'} style={{ borderBottom: '1px solid var(--bd)' }}>
                      <td style={{ padding: '11px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Avatar name={o.ownerName} size={22} />
                          <span style={{ fontSize: 12.5, color: 'var(--t1)' }}>{o.ownerName}</span>
                        </div>
                      </td>
                      <td style={{ padding: '11px 16px', textAlign: 'right', fontSize: 12.5, color: 'var(--t2)' }}>{fmtMoney(o.commit.weighted)}</td>
                      <td style={{ padding: '11px 16px', textAlign: 'right', fontSize: 12.5, color: 'var(--t2)' }}>{fmtMoney(o.bestCase.weighted)}</td>
                      <td style={{ padding: '11px 16px', textAlign: 'right', fontSize: 12.5, color: 'var(--t2)' }}>{fmtMoney(o.pipeline.weighted)}</td>
                      <td style={{ padding: '11px 16px', textAlign: 'right', fontSize: 12.5, color: 'var(--t2)' }}>{fmtMoney(o.closedWon.value)}</td>
                      <td style={{ padding: '11px 16px', textAlign: 'right', fontSize: 12.5, fontWeight: 700, color: 'var(--t1)' }}>{fmtMoney(o.projected)}</td>
                    </tr>
                  ))}
                  {data.byOwner.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: '28px 16px', textAlign: 'center', fontSize: 12.5, color: 'var(--t3)' }}>
                      No deals close in this period.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {stages.length > 0 && <StageSettings stages={stages} isAdmin={isAdmin} onSaved={() => { loadStages(); load(); }} />}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
              <CustomFieldAdmin entity="lead" isAdmin={isAdmin} />
              <CustomFieldAdmin entity="deal" isAdmin={isAdmin} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ForecastView;
