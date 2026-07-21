import { useState, useEffect, useRef } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { adminFetch } from '../lib/api.js';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 14 };

const inputStyle = {
  width: '100%', padding: '9px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 13,
  fontFamily: "'Plus Jakarta Sans',sans-serif", outline: 'none', boxSizing: 'border-box',
};

const Field = ({ label, hint, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
    <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--t2)' }}>{label}</span>
    {children}
    {hint && <span style={{ fontSize: 10.5, color: 'var(--t3)' }}>{hint}</span>}
  </label>
);

const TInput = (props) => (
  <input {...props} style={{ ...inputStyle, ...props.style }}
    onFocus={e => { e.target.style.borderColor = 'var(--gbd)'; }}
    onBlur={e => { e.target.style.borderColor = 'var(--bd)'; }} />
);

// Modal editor for a single plan — used for both "create" (plan === 'new')
// and "edit" (plan === the existing record). Limits left blank mean unlimited;
// messageQuota of -1 means unlimited messages.
function PlanEditor({ plan, knownFeatures, onClose, onSaved }) {
  const isNew = plan === 'new';
  const src = isNew ? {} : plan;
  const numOrBlank = (v) => (v === null || v === undefined ? '' : String(v));
  const [f, setF] = useState({
    key: src.key || '',
    name: src.name || '',
    priceMonthly: numOrBlank(src.priceMonthly ?? 0),
    currency: src.currency || 'USD',
    messageQuota: numOrBlank(src.messageQuota ?? 0),
    overageRatePerMsg: numOrBlank(src.overageRatePerMsg ?? 0),
    contactLimit: numOrBlank(src.contactLimit),
    memberLimit: numOrBlank(src.memberLimit),
    campaignLimit: numOrBlank(src.campaignLimit),
    apiKeyLimit: numOrBlank(src.apiKeyLimit),
    isActive: src.isActive ?? true,
  });
  // Union of known flags and any custom flags already on the plan.
  const [features, setFeatures] = useState(() => {
    const init = {};
    for (const flag of knownFeatures) init[flag] = !!src.features?.[flag];
    for (const [k, v] of Object.entries(src.features || {})) init[k] = !!v;
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const toLimit = (v) => (String(v).trim() === '' ? null : Number(v));

  const save = async () => {
    setSaving(true); setErr(null);
    const body = {
      name: f.name.trim(),
      priceMonthly: Number(f.priceMonthly || 0),
      currency: f.currency.trim().toUpperCase(),
      messageQuota: Number(f.messageQuota),
      overageRatePerMsg: Number(f.overageRatePerMsg || 0),
      contactLimit: toLimit(f.contactLimit),
      memberLimit: toLimit(f.memberLimit),
      campaignLimit: toLimit(f.campaignLimit),
      apiKeyLimit: toLimit(f.apiKeyLimit),
      features,
      isActive: !!f.isActive,
    };
    if (isNew) body.key = f.key.trim().toUpperCase();
    const res = await adminFetch(isNew ? '/platform/plans' : `/platform/plans/${plan.id}`, {
      method: isNew ? 'POST' : 'PATCH', body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); }
    else { const d = await res.json().catch(() => ({})); setErr(d.error || 'Failed to save plan'); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...card, width: 560, maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--bd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--t1)' }}>
            {isNew ? 'New plan' : `Edit ${src.name} plan`}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
            <I n="x" s={18} c="var(--t2)" />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {err && <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 12.5 }}>{err}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Plan key" hint={isNew ? 'Uppercase, e.g. STARTER — permanent' : 'Cannot be changed'}>
              <TInput value={f.key} disabled={!isNew} placeholder="STARTER"
                onChange={e => set('key', e.target.value.toUpperCase())}
                style={!isNew ? { opacity: 0.55, cursor: 'not-allowed' } : {}} />
            </Field>
            <Field label="Display name">
              <TInput value={f.name} placeholder="Starter" onChange={e => set('name', e.target.value)} />
            </Field>
          </div>

          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Pricing</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
              <Field label="Monthly price">
                <TInput type="number" min="0" step="0.01" value={f.priceMonthly} onChange={e => set('priceMonthly', e.target.value)} />
              </Field>
              <Field label="Currency">
                <TInput value={f.currency} onChange={e => set('currency', e.target.value.toUpperCase())} />
              </Field>
              <Field label="Overage / msg" hint="Charged past quota">
                <TInput type="number" min="0" step="0.0001" value={f.overageRatePerMsg} onChange={e => set('overageRatePerMsg', e.target.value)} />
              </Field>
            </div>
          </div>

          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Rate limits &amp; quotas</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Message quota / cycle" hint="-1 = unlimited">
                <TInput type="number" step="1" value={f.messageQuota} onChange={e => set('messageQuota', e.target.value)} />
              </Field>
              <Field label="Contact limit" hint="Blank = unlimited">
                <TInput type="number" min="0" step="1" value={f.contactLimit} placeholder="∞" onChange={e => set('contactLimit', e.target.value)} />
              </Field>
              <Field label="Member limit" hint="Blank = unlimited">
                <TInput type="number" min="0" step="1" value={f.memberLimit} placeholder="∞" onChange={e => set('memberLimit', e.target.value)} />
              </Field>
              <Field label="Campaign limit" hint="Blank = unlimited">
                <TInput type="number" min="0" step="1" value={f.campaignLimit} placeholder="∞" onChange={e => set('campaignLimit', e.target.value)} />
              </Field>
              <Field label="API key limit" hint="Blank = unlimited">
                <TInput type="number" min="0" step="1" value={f.apiKeyLimit} placeholder="∞" onChange={e => set('apiKeyLimit', e.target.value)} />
              </Field>
            </div>
          </div>

          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Features</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {Object.keys(features).map((flag) => (
                <label key={flag} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--t1)', cursor: 'pointer', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--bd)', background: features[flag] ? 'var(--gbg)' : 'transparent' }}>
                  <input type="checkbox" checked={features[flag]} onChange={e => setFeatures(p => ({ ...p, [flag]: e.target.checked }))} />
                  {flag}
                </label>
              ))}
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--t1)', cursor: 'pointer' }}>
            <input type="checkbox" checked={f.isActive} onChange={e => set('isActive', e.target.checked)} />
            Active (visible to customers at checkout)
          </label>
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--bd)', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <Btn variant="outline" size="sm" onClick={onClose}>Cancel</Btn>
          <Btn size="sm" onClick={save} disabled={saving || !f.name.trim() || (isNew && !f.key.trim())}>
            {saving ? 'Saving…' : isNew ? 'Create plan' : 'Save changes'}
          </Btn>
        </div>
      </div>
    </div>
  );
}

const selectStyle = { ...inputStyle, cursor: 'pointer', colorScheme: 'dark' };
// The dropdown *popup* list is rendered natively by the OS/browser and
// mostly ignores the <select>'s own CSS — Chromium does honor an explicit
// background/color set directly on each <option>, though, which is the only
// reliable way to keep the option list legible instead of falling back to
// light system text on a white popup.
const optionStyle = { background: '#0b1220', color: '#e8eaf0' };

const StatCard = ({ label, value, color = 'var(--t1)' }) => (
  <div style={{ ...card, padding: 16 }}>
    <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</span>
    <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 20, color, marginTop: 4 }}>{value}</div>
  </div>
);

const money = (v, currency = '₹') => `${currency}${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Revenue overview: MRR/ARR estimated from active subscriptions × plan price.
function RevenueTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminFetch('/platform/revenue').then(r => r.ok ? r.json() : null).then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--t2)', fontSize: 13 }}>Loading revenue…</div>;
  if (!data) return <div style={{ ...card, padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>Could not load revenue data.</div>;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12, marginBottom: 20 }}>
        <StatCard label="MRR" value={money(data.mrr)} color="var(--green)" />
        <StatCard label="ARR (est.)" value={money(data.arr)} color="#38bdf8" />
        <StatCard label="Active subscriptions" value={data.activeSubscriptions} color="#a78bfa" />
      </div>

      <div style={{ ...card, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--bd)' }}>
              {['Plan', 'Price / mo', 'Subscribers', 'MRR contribution'].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.byPlan.map(p => (
              <tr key={p.key} style={{ borderBottom: '1px solid var(--bd)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{p.name}</td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{p.currency} {Number(p.price).toLocaleString()}</td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{p.subscribers}</td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>{p.currency} {Number(p.mrr).toLocaleString()}</td>
              </tr>
            ))}
            {data.byPlan.length === 0 && (
              <tr><td colSpan={4} style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>No active subscriptions yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Transaction analysis: wallet ledger across every workspace, filterable by
// workspace/type/date range, with credit/debit totals and a reason breakdown.
function TransactionsTab({ workspaces }) {
  const [workspaceId, setWorkspaceId] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    const params = new URLSearchParams();
    if (workspaceId) params.set('workspaceId', workspaceId);
    if (type) params.set('type', type);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    adminFetch(`/platform/transactions?${params}`).then(r => r.ok ? r.json() : null)
      .then(d => { if (reqId.current === id) setData(d); })
      .finally(() => { if (reqId.current === id) setLoading(false); });
  }, [workspaceId, type, from, to]);

  const s = data?.summary;
  const rows = data?.transactions || [];

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Workspace">
          <select value={workspaceId} onChange={e => setWorkspaceId(e.target.value)} style={{ ...selectStyle, width: 200 }}>
            <option value="" style={optionStyle}>All workspaces</option>
            {workspaces.map(w => <option key={w.id} value={w.id} style={optionStyle}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select value={type} onChange={e => setType(e.target.value)} style={{ ...selectStyle, width: 130 }}>
            <option value="" style={optionStyle}>All</option>
            <option value="CREDIT" style={optionStyle}>Credit</option>
            <option value="DEBIT" style={optionStyle}>Debit</option>
          </select>
        </Field>
        <Field label="From"><TInput type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="To"><TInput type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--t2)', fontSize: 13 }}>Loading transactions…</div> : !s ? (
        <div style={{ ...card, padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>Could not load transaction data.</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 12, marginBottom: 20 }}>
            <StatCard label="Total credited" value={money(s.totalCredit)} color="var(--green)" />
            <StatCard label="Total debited" value={money(s.totalDebit)} color="#f87171" />
            <StatCard label="Net" value={money(s.net)} color={s.net >= 0 ? 'var(--green)' : '#f87171'} />
            <StatCard label="Credit txns" value={s.creditCount} color="#38bdf8" />
            <StatCard label="Debit txns" value={s.debitCount} color="#a78bfa" />
          </div>

          {s.byReason.length > 0 && (
            <div style={{ ...card, padding: '14px 18px', marginBottom: 20 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Breakdown by reason</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {s.byReason.map(r => (
                  <div key={`${r.reason}-${r.type}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--bd)', fontSize: 12.5 }}>
                    <span style={{ color: 'var(--t1)' }}>{r.reason} <span style={{ fontSize: 10, fontWeight: 700, color: r.type === 'CREDIT' ? 'var(--green)' : '#f87171' }}>{r.type}</span></span>
                    <span style={{ color: 'var(--t2)' }}>{money(r.amount)} · {r.count}×</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ ...card, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bd)' }}>
                  {['Date', 'Workspace', 'Type', 'Reason', 'Amount', 'Balance after', 'Reference'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(t => (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--bd)' }}>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{new Date(t.createdAt).toLocaleString('en-IN')}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12.5, fontWeight: 600, color: 'var(--t1)' }}>{t.workspaceName}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: t.type === 'CREDIT' ? 'var(--green)' : '#f87171' }}>{t.type}</span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{t.reason}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12.5, fontWeight: 600, color: t.type === 'CREDIT' ? 'var(--green)' : '#f87171' }}>{t.type === 'CREDIT' ? '+' : '−'}{money(t.amount)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{money(t.balanceAfter)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 11, color: 'var(--t3)' }}>{t.reference || '—'}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>No transactions found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// Campaign usage across every workspace, filterable by workspace/status.
function CampaignsTab({ workspaces }) {
  const [workspaceId, setWorkspaceId] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    const params = new URLSearchParams();
    if (workspaceId) params.set('workspaceId', workspaceId);
    if (status) params.set('status', status);
    adminFetch(`/platform/campaigns?${params}`).then(r => r.ok ? r.json() : null)
      .then(d => { if (reqId.current === id) setData(d); })
      .finally(() => { if (reqId.current === id) setLoading(false); });
  }, [workspaceId, status]);

  const t = data?.totals;
  const rows = data?.campaigns || [];

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Workspace">
          <select value={workspaceId} onChange={e => setWorkspaceId(e.target.value)} style={{ ...selectStyle, width: 200 }}>
            <option value="" style={optionStyle}>All workspaces</option>
            {workspaces.map(w => <option key={w.id} value={w.id} style={optionStyle}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...selectStyle, width: 160 }}>
            <option value="" style={optionStyle}>All statuses</option>
            {['DRAFT', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED'].map(s => <option key={s} value={s} style={optionStyle}>{s}</option>)}
          </select>
        </Field>
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--t2)', fontSize: 13 }}>Loading campaigns…</div> : !t ? (
        <div style={{ ...card, padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>Could not load campaign data.</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 12, marginBottom: 20 }}>
            <StatCard label="Campaigns" value={t.count.toLocaleString()} />
            <StatCard label="Recipients" value={t.totalContacts.toLocaleString()} />
            <StatCard label="Sent" value={t.sent.toLocaleString()} />
            <StatCard label="Delivered" value={t.delivered.toLocaleString()} color="var(--green)" />
            <StatCard label="Read" value={t.read.toLocaleString()} color="#38bdf8" />
            <StatCard label="Failed" value={t.failed.toLocaleString()} color={t.failed > 0 ? '#f87171' : 'var(--t1)'} />
          </div>

          <div style={{ ...card, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bd)' }}>
                  {['Campaign', 'Workspace', 'Status', 'Sent', 'Delivered', 'Read', 'Failed', 'Date'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--bd)' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{c.name}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{c.workspaceName}</td>
                    <td style={{ padding: '12px 16px', fontSize: 11.5, fontWeight: 600, color: 'var(--t2)' }}>{c.status}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{c.sent.toLocaleString()}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{c.delivered.toLocaleString()}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{c.read.toLocaleString()}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: c.failed > 0 ? '#f87171' : 'var(--t2)' }}>{c.failed.toLocaleString()}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{new Date(c.createdAt).toLocaleDateString('en-IN')}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>No campaigns found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// WhatsApp number pool: assign/reset/ban numbers and sync new ones from the
// Meta WABA — the API already existed, this is its first UI surface.
function NumbersTab({ workspaces }) {
  const [summary, setSummary] = useState(null);
  const [pool, setPool] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [assignFor, setAssignFor] = useState(null);
  const [assignTarget, setAssignTarget] = useState('');
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await adminFetch('/numbers/pool');
    const d = res.ok ? await res.json() : null;
    setSummary(d?.summary || null);
    setPool(Array.isArray(d?.pool) ? d.pool : []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const doAssign = async (entryId) => {
    if (!assignTarget) return;
    setBusyId(entryId);
    const res = await adminFetch('/numbers/assign', { method: 'POST', body: JSON.stringify({ poolEntryId: entryId, workspaceId: assignTarget }) });
    setBusyId(null);
    if (res.ok) { setAssignFor(null); setAssignTarget(''); load(); }
    else { const d = await res.json().catch(() => ({})); window.alert(d.error || 'Assign failed'); }
  };

  const doReset = async (id) => {
    if (!window.confirm("Reset this number's assignment?")) return;
    setBusyId(id);
    const res = await adminFetch(`/numbers/pool/${id}/reset`, { method: 'PATCH' });
    setBusyId(null);
    if (res.ok) load();
  };

  const doBan = async (id) => {
    if (!window.confirm('Ban this number? It will no longer be assignable.')) return;
    setBusyId(id);
    const res = await adminFetch(`/numbers/pool/${id}/ban`, { method: 'PATCH' });
    setBusyId(null);
    if (res.ok) load();
  };

  const doSync = async () => {
    setSyncing(true);
    const res = await adminFetch('/numbers/sync-from-waba', { method: 'POST' });
    setSyncing(false);
    if (res.ok) load();
    else { const d = await res.json().catch(() => ({})); window.alert(d.error || 'Sync failed'); }
  };

  const doResetAll = async () => {
    if (!window.confirm("Reset ALL number assignments across every workspace? This disconnects every workspace's WhatsApp number.")) return;
    const res = await adminFetch('/numbers/reset-all', { method: 'POST' });
    if (res.ok) load();
  };

  const statusColor = (st) => st === 'AVAILABLE' ? 'var(--green)' : st === 'BANNED' ? '#f87171' : '#38bdf8';
  const statusBg = (st) => st === 'AVAILABLE' ? 'var(--gbg)' : st === 'BANNED' ? 'rgba(239,68,68,.08)' : 'rgba(56,189,248,.1)';
  const statusBd = (st) => st === 'AVAILABLE' ? 'var(--gbd)' : st === 'BANNED' ? 'rgba(239,68,68,.25)' : 'rgba(56,189,248,.25)';

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--t2)', fontSize: 13 }}>Loading number pool…</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {summary && [['Total', summary.total], ['Available', summary.available], ['Assigned', summary.assigned], ['Banned', summary.banned]].map(([l, v]) => (
            <div key={l} style={{ ...card, padding: '10px 16px' }}>
              <div style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase' }}>{l}</div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18, color: 'var(--t1)' }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="outline" size="sm" onClick={doResetAll} style={{ borderColor: 'rgba(239,68,68,.35)', color: '#f87171' }}>Reset all assignments</Btn>
          <Btn size="sm" onClick={doSync} disabled={syncing}><I n="refresh" s={13} c="#060A10" /> {syncing ? 'Syncing…' : 'Sync from WABA'}</Btn>
        </div>
      </div>

      <div style={{ ...card, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--bd)' }}>
              {['Phone number', 'Display name', 'Status', 'Assigned to', 'Registered', ''].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pool.map(e => (
              <tr key={e.id} style={{ borderBottom: '1px solid var(--bd)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{e.phoneNumber}</td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{e.displayName || '—'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: statusBg(e.status), border: `1px solid ${statusBd(e.status)}`, color: statusColor(e.status) }}>{e.status}</span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{e.assignedToName || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{e.registeredAt ? new Date(e.registeredAt).toLocaleDateString('en-IN') : '—'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                    {e.status === 'AVAILABLE' && assignFor === e.id && (
                      <>
                        <select value={assignTarget} onChange={ev => setAssignTarget(ev.target.value)} style={{ ...selectStyle, width: 160, padding: '6px 8px' }}>
                          <option value="" style={optionStyle}>Select workspace…</option>
                          {workspaces.map(w => <option key={w.id} value={w.id} style={optionStyle}>{w.name}</option>)}
                        </select>
                        <Btn size="sm" onClick={() => doAssign(e.id)} disabled={busyId === e.id || !assignTarget}>Confirm</Btn>
                        <Btn variant="ghost" size="sm" onClick={() => { setAssignFor(null); setAssignTarget(''); }}>Cancel</Btn>
                      </>
                    )}
                    {e.status === 'AVAILABLE' && assignFor !== e.id && (
                      <Btn variant="outline" size="sm" onClick={() => { setAssignFor(e.id); setAssignTarget(''); }} disabled={busyId === e.id}>Assign</Btn>
                    )}
                    {e.status === 'ASSIGNED' && (
                      <Btn variant="outline" size="sm" onClick={() => doReset(e.id)} disabled={busyId === e.id}>Reset</Btn>
                    )}
                    {e.status !== 'BANNED' && (
                      <Btn variant="outline" size="sm" onClick={() => doBan(e.id)} disabled={busyId === e.id} style={{ borderColor: 'rgba(239,68,68,.35)', color: '#f87171' }}>Ban</Btn>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {pool.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>No numbers in the pool.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Per-workspace analytics segregation: the message funnel (sent/delivered/
// read/failed) broken out by workspace, sortable, so usage and delivery
// health can be compared across the whole platform at a glance.
function WorkspaceAnalyticsTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState('sent');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    adminFetch('/platform/workspaces/analytics').then(r => r.ok ? r.json() : []).then(d => setRows(Array.isArray(d) ? d : [])).finally(() => setLoading(false));
  }, []);

  const sortValue = (w, key) => {
    if (key === 'name') return w.name;
    if (key === 'members') return w.members;
    if (key === 'campaigns') return w.campaigns;
    if (key === 'contacts') return w.contacts;
    if (key === 'sent') return w.messages.sent;
    if (key === 'delivered') return w.messages.delivered;
    if (key === 'deliveryRate') return w.deliveryRate;
    return 0;
  };

  const sorted = [...rows].sort((a, b) => {
    const av = sortValue(a, sortKey), bv = sortValue(b, sortKey);
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const totals = rows.reduce((acc, w) => ({ sent: acc.sent + w.messages.sent, delivered: acc.delivered + w.messages.delivered }), { sent: 0, delivered: 0 });
  const avgDeliveryRate = totals.sent > 0 ? +((totals.delivered / totals.sent) * 100).toFixed(1) : 0;

  const Th = ({ label, k }) => (
    <th onClick={() => k && toggleSort(k)} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', cursor: k ? 'pointer' : 'default', userSelect: 'none' }}>
      {label}{k && sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--t2)', fontSize: 13 }}>Loading workspace analytics…</div>;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 12, marginBottom: 20 }}>
        <StatCard label="Workspaces" value={rows.length} />
        <StatCard label="Total sent" value={totals.sent.toLocaleString()} />
        <StatCard label="Total delivered" value={totals.delivered.toLocaleString()} color="var(--green)" />
        <StatCard label="Avg delivery rate" value={`${avgDeliveryRate}%`} color="#38bdf8" />
      </div>

      <div style={{ ...card, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--bd)' }}>
              <Th label="Workspace" k="name" />
              <Th label="Plan" />
              <Th label="Members" k="members" />
              <Th label="Campaigns" k="campaigns" />
              <Th label="Contacts" k="contacts" />
              <Th label="Sent" k="sent" />
              <Th label="Delivered" k="delivered" />
              <Th label="Delivery rate" k="deliveryRate" />
              <Th label="Read rate" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(w => (
              <tr key={w.id} style={{ borderBottom: '1px solid var(--bd)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{w.name}</td>
                <td style={{ padding: '12px 16px', fontSize: 11.5, color: 'var(--t2)' }}>{w.plan}</td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{w.members}</td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{w.campaigns}</td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{w.contacts.toLocaleString()}</td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{w.messages.sent.toLocaleString()}</td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{w.messages.delivered.toLocaleString()}</td>
                <td style={{ padding: '12px 16px' }}>
                  {w.messages.sent > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 60, height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.06)' }}><div style={{ height: '100%', width: `${Math.min(w.deliveryRate, 100)}%`, borderRadius: 4, background: 'var(--green)' }} /></div>
                      <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>{w.deliveryRate}%</span>
                    </div>
                  ) : <span style={{ fontSize: 12, color: 'var(--t3)' }}>—</span>}
                </td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{w.messages.delivered > 0 ? `${w.readRate}%` : '—'}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>No workspaces yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// User management: search every registered user and impersonate one to see
// the app exactly as they do. The platform admin account itself is exempt.
function UsersTab() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [impersonatingId, setImpersonatingId] = useState(null);
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); }, [debounced]);

  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    const params = new URLSearchParams();
    if (debounced) params.set('search', debounced);
    params.set('page', String(page));
    adminFetch(`/platform/users?${params}`).then(r => r.ok ? r.json() : null)
      .then(d => { if (reqId.current === id) setData(d); })
      .finally(() => { if (reqId.current === id) setLoading(false); });
  }, [debounced, page]);

  const impersonate = async (u) => {
    if (!window.confirm(`Impersonate ${u.name} (${u.email})? You'll see the app exactly as they do until you return to admin.`)) return;
    setImpersonatingId(u.id);
    try {
      const res = await adminFetch(`/platform/users/${u.id}/impersonate`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) { window.alert(body.error || 'Impersonation failed'); return; }

      // Stash the admin's own session so the in-app banner can restore it.
      const adminToken = localStorage.getItem('accessToken');
      const adminRefresh = localStorage.getItem('refreshToken');
      const adminUser = localStorage.getItem('user');
      if (adminToken && adminUser) {
        sessionStorage.setItem('impersonatorSession', JSON.stringify({ accessToken: adminToken, refreshToken: adminRefresh, user: adminUser }));
      }

      localStorage.setItem('accessToken', body.accessToken);
      localStorage.setItem('refreshToken', body.refreshToken);
      localStorage.setItem('user', JSON.stringify({
        id: body.user.id, name: body.user.name, email: body.user.email, role: body.user.role,
        superAdmin: body.user.superAdmin === true, workspaceId: body.workspace?.id ?? null, workspaceName: body.workspace?.name ?? null,
      }));
      window.location.href = '/dashboard';
    } finally {
      setImpersonatingId(null);
    }
  };

  const users = data?.users || [];
  const total = data?.total || 0;
  const limit = data?.limit || 25;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Field label="Search" hint="By name or email">
          <TInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users…" style={{ width: 280 }} />
        </Field>
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--t2)', fontSize: 13 }}>Loading users…</div> : (
        <>
          <div style={{ ...card, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bd)' }}>
                  {['User', 'Email', 'Auth', 'Workspaces', 'Joined', ''].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--bd)' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{u.name}</span>
                        {u.superAdmin && <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: 'var(--gbg)', border: '1px solid var(--gbd)', color: 'var(--green)', textTransform: 'uppercase' }}>Super Admin</span>}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{u.email}</td>
                    <td style={{ padding: '12px 16px', fontSize: 11.5, color: 'var(--t2)' }}>{u.authMethod}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {u.workspaces.length === 0 && <span style={{ fontSize: 11, color: 'var(--t3)' }}>—</span>}
                        {u.workspaces.map(w => (
                          <span key={w.id} style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t2)' }}>{w.name} · {w.role}</span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{new Date(u.createdAt).toLocaleDateString('en-IN')}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <Btn variant="outline" size="sm" onClick={() => impersonate(u)} disabled={u.superAdmin || impersonatingId === u.id}
                        title={u.superAdmin ? "Can't impersonate the platform admin" : ''}>
                        {impersonatingId === u.id ? 'Starting…' : 'Impersonate'}
                      </Btn>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>No users found.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 14 }}>
              <Btn variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</Btn>
              <span style={{ fontSize: 12, color: 'var(--t2)' }}>Page {page} of {totalPages} · {total} user{total === 1 ? '' : 's'}</span>
              <Btn variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</Btn>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Payments: real money collected — plan-subscription invoices + wallet
// recharges — filterable by workspace/date. Distinct from Transactions (the
// full wallet ledger, which also includes non-payment debits like usage).
function PaymentsTab({ workspaces }) {
  const [workspaceId, setWorkspaceId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    const params = new URLSearchParams();
    if (workspaceId) params.set('workspaceId', workspaceId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    adminFetch(`/platform/payments?${params}`).then(r => r.ok ? r.json() : null)
      .then(d => { if (reqId.current === id) setData(d); })
      .finally(() => { if (reqId.current === id) setLoading(false); });
  }, [workspaceId, from, to]);

  const s = data?.summary;
  const rows = data?.payments || [];

  const kindLabel = (k) => k === 'PLAN_SUBSCRIPTION' ? 'Plan subscription' : 'Wallet recharge';
  const kindColor = (k) => k === 'PLAN_SUBSCRIPTION' ? '#a78bfa' : 'var(--green)';

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Workspace">
          <select value={workspaceId} onChange={e => setWorkspaceId(e.target.value)} style={{ ...selectStyle, width: 200 }}>
            <option value="" style={optionStyle}>All workspaces</option>
            {workspaces.map(w => <option key={w.id} value={w.id} style={optionStyle}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="From"><TInput type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="To"><TInput type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--t2)', fontSize: 13 }}>Loading payments…</div> : !s ? (
        <div style={{ ...card, padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>Could not load payment data.</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 12, marginBottom: 20 }}>
            <StatCard label="Total collected" value={money(s.total)} color="var(--green)" />
            <StatCard label="Plan revenue" value={money(s.planRevenue)} color="#a78bfa" />
            <StatCard label="Wallet recharges" value={money(s.walletRevenue)} color="#38bdf8" />
            <StatCard label="Payments" value={s.count} />
          </div>

          {s.byWorkspace.length > 0 && (
            <div style={{ ...card, padding: '14px 18px', marginBottom: 20 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>By workspace</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {s.byWorkspace.map(w => (
                  <div key={w.workspaceId} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--bd)', fontSize: 12.5 }}>
                    <span style={{ color: 'var(--t1)' }}>{w.workspaceName}</span>
                    <span style={{ color: 'var(--t2)' }}>{money(w.total)} · {w.count} payment{w.count === 1 ? '' : 's'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ ...card, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bd)' }}>
                  {['Date', 'Workspace', 'Type', 'Description', 'Amount', 'Reference'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(p => (
                  <tr key={`${p.kind}-${p.id}`} style={{ borderBottom: '1px solid var(--bd)' }}>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{new Date(p.date).toLocaleString('en-IN')}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12.5, fontWeight: 600, color: 'var(--t1)' }}>{p.workspaceName}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: kindColor(p.kind) }}>{kindLabel(p.kind)}</span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{p.description}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12.5, fontWeight: 600, color: 'var(--green)' }}>{money(p.amount)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 11, color: 'var(--t3)' }}>{p.reference || '—'}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>No payments found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// "View" drill-in on a Workspaces row: that workspace's members, their role
// and auth method. Never surfaces password hashes or any secret material.
function WorkspaceMembersModal({ workspaceId, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    adminFetch(`/platform/workspaces/${workspaceId}/members`)
      .then(async (r) => { if (r.ok) setData(await r.json()); else setErr((await r.json().catch(() => ({}))).error || 'Failed to load members'); })
      .catch((e) => setErr(e.message));
  }, [workspaceId]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...card, width: 620, maxHeight: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--bd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--t1)' }}>{data?.workspace?.name || 'Workspace members'}</span>
            {data?.workspace && (
              <span style={{ marginLeft: 10, padding: '2px 9px', borderRadius: 20, fontSize: 10.5, fontWeight: 600,
                background: data.workspace.suspended ? 'rgba(239,68,68,.08)' : 'var(--gbg)',
                border: `1px solid ${data.workspace.suspended ? 'rgba(239,68,68,.25)' : 'var(--gbd)'}`,
                color: data.workspace.suspended ? '#f87171' : 'var(--green)' }}>
                {data.workspace.suspended ? 'Suspended' : 'Active'}
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
            <I n="x" s={18} c="var(--t2)" />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {err && <div style={{ margin: 18, padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 12.5 }}>{err}</div>}
          {!data && !err && <div style={{ textAlign: 'center', padding: 40, color: 'var(--t2)', fontSize: 13 }}>Loading members…</div>}
          {data && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bd)' }}>
                  {['Member', 'Email', 'Role', 'Auth method', 'Joined'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', position: 'sticky', top: 0, background: 'var(--surf)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.members.map(m => (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--bd)' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{m.name}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{m.email}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                        background: m.role === 'ADMIN' ? 'var(--gbg)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${m.role === 'ADMIN' ? 'var(--gbd)' : 'var(--bd)'}`,
                        color: m.role === 'ADMIN' ? 'var(--green)' : 'var(--t2)' }}>{m.role}</span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 11.5, color: 'var(--t2)' }}>{m.authMethod}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{new Date(m.joinedAt).toLocaleDateString('en-IN')}</td>
                  </tr>
                ))}
                {data.members.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>No members yet.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// Platform-wide super-admin dashboard: aggregate stats across ALL workspaces,
// workspace management (suspend/reinstate), and a support-ticket queue. Distinct
// from the per-workspace analytics regular users see. `tab` is controlled by
// the main sidebar (each section is its own top-level nav item there).
export default function SuperAdminView({ tab }) {
  const [stats, setStats] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [plans, setPlans] = useState([]);
  const [knownFeatures, setKnownFeatures] = useState([]);
  const [editingPlan, setEditingPlan] = useState(null); // 'new' | plan object | null
  const [viewingWorkspaceId, setViewingWorkspaceId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const [s, w, t, p] = await Promise.all([
        adminFetch('/platform/stats').then(r => r.ok ? r.json() : null),
        adminFetch('/platform/workspaces').then(r => r.ok ? r.json() : []),
        adminFetch('/platform/tickets').then(r => r.ok ? r.json() : []),
        adminFetch('/platform/plans').then(r => r.ok ? r.json() : null),
      ]);
      setStats(s?.totals || null);
      setWorkspaces(Array.isArray(w) ? w : []);
      setTickets(Array.isArray(t) ? t : []);
      setPlans(Array.isArray(p?.plans) ? p.plans : []);
      setKnownFeatures(Array.isArray(p?.knownFeatures) ? p.knownFeatures : []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleSuspend = async (ws) => {
    const suspend = !ws.suspended;
    let reason = null;
    if (suspend) {
      reason = window.prompt(`Reason for suspending "${ws.name}"?`, 'Policy violation');
      if (reason === null) return;
    } else if (!window.confirm(`Reinstate "${ws.name}"?`)) return;
    const res = await adminFetch(`/platform/workspaces/${ws.id}/suspend`, {
      method: 'PATCH', body: JSON.stringify({ suspended: suspend, reason }),
    });
    if (res.ok) load();
  };

  const updateTicket = async (ticket, status) => {
    const res = await adminFetch(`/platform/tickets/${ticket.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    if (res.ok) load();
  };

  const deletePlan = async (plan) => {
    if (!window.confirm(`Delete the "${plan.name}" plan? This cannot be undone.`)) return;
    const res = await adminFetch(`/platform/plans/${plan.id}`, { method: 'DELETE' });
    if (res.ok) load();
    else { const d = await res.json().catch(() => ({})); window.alert(d.error || 'Could not delete plan'); }
  };

  const fmtLimit = (v) => (v === null || v === undefined ? 'Unlimited' : Number(v).toLocaleString());
  const fmtQuota = (v) => (v === -1 ? 'Unlimited' : Number(v).toLocaleString());

  const statCards = stats ? [
    { label: 'Workspaces', value: stats.workspaces, icon: 'users', color: 'var(--green)' },
    { label: 'Users', value: stats.users, icon: 'user', color: '#38bdf8' },
    { label: 'Connected Numbers', value: stats.connectedNumbers, icon: 'phone', color: '#a78bfa' },
    { label: 'Campaigns', value: stats.campaigns, icon: 'send', color: '#f59e0b' },
    { label: 'Contacts', value: stats.contacts, icon: 'users', color: '#0ea5e9' },
    { label: 'Messages Sent', value: stats.messagesSent, icon: 'send', color: 'var(--green)' },
    { label: 'Delivered', value: stats.messagesDelivered, icon: 'check', color: '#22c55e' },
    { label: 'Suspended', value: stats.suspendedWorkspaces, icon: 'alertc', color: '#f87171' },
    { label: 'Open Tickets', value: stats.openTickets, icon: 'msg', color: '#fbbf24' },
  ] : [];

  const TAB_LABELS = {
    overview: 'Overview', analytics: 'Analytics', revenue: 'Revenue', transactions: 'Transactions',
    payments: 'Payments', campaigns: 'Campaigns', workspaces: 'Workspaces', users: 'Users',
    numbers: 'Numbers', plans: 'Plans', support: 'Support',
  };
  const openTicketCount = tickets.filter(t => t.status === 'OPEN').length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ height: 58, borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 28px', flexShrink: 0, background: 'var(--surf)', gap: 16 }}>
        <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 16, color: 'var(--t1)' }}>
          Platform Admin <span style={{ color: 'var(--t3)', fontWeight: 600 }}>· {TAB_LABELS[tab] || ''}</span>
          {tab === 'support' && openTicketCount > 0 && (
            <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: 'rgba(251,191,36,.1)', color: '#fbbf24', verticalAlign: 'middle' }}>{openTicketCount} open</span>
          )}
        </h1>
        <div style={{ marginLeft: 'auto' }}>
          <Btn variant="outline" size="sm" onClick={load}>Refresh</Btn>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
       <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        {err && <div style={{ padding: '12px 16px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 13, marginBottom: 16 }}>{err}</div>}
        {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--t2)', fontSize: 13 }}>Loading platform data…</div>}

        {!loading && tab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12 }}>
            {statCards.map((c) => (
              <div key={c.label} style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <I n={c.icon} s={14} c={c.color} />
                  <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>{c.label}</span>
                </div>
                <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 26, fontWeight: 800, color: 'var(--t1)' }}>{(c.value ?? 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}

        {!loading && tab === 'analytics' && <WorkspaceAnalyticsTab />}
        {!loading && tab === 'revenue' && <RevenueTab />}
        {!loading && tab === 'transactions' && <TransactionsTab workspaces={workspaces} />}
        {!loading && tab === 'payments' && <PaymentsTab workspaces={workspaces} />}
        {!loading && tab === 'campaigns' && <CampaignsTab workspaces={workspaces} />}
        {!loading && tab === 'users' && <UsersTab />}
        {!loading && tab === 'numbers' && <NumbersTab workspaces={workspaces} />}

        {!loading && tab === 'workspaces' && (
          <div style={{ ...card, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bd)' }}>
                  {['Workspace', 'Owner', 'Members', 'Campaigns', 'Contacts', 'Numbers', 'Wallet', 'Status', 'View', 'Action'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h === 'View' || h === 'Action' ? '' : h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workspaces.map((w) => (
                  <tr key={w.id} style={{ borderBottom: '1px solid var(--bd)' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{w.name}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{w.owner?.email || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{w.counts?.members ?? 0}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{w.counts?.campaigns ?? 0}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{w.counts?.contacts ?? 0}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{w.counts?.waNumbers ?? 0}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>₹{Number(w.walletBalance || 0).toFixed(2)}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                        background: w.suspended ? 'rgba(239,68,68,.08)' : 'var(--gbg)',
                        border: `1px solid ${w.suspended ? 'rgba(239,68,68,.25)' : 'var(--gbd)'}`,
                        color: w.suspended ? '#f87171' : 'var(--green)' }}>
                        {w.suspended ? 'Suspended' : 'Active'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <Btn variant="outline" size="sm" onClick={() => setViewingWorkspaceId(w.id)}>View</Btn>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <Btn variant="outline" size="sm" onClick={() => toggleSuspend(w)}
                        style={w.suspended ? {} : { borderColor: 'rgba(239,68,68,.35)', color: '#f87171' }}>
                        {w.suspended ? 'Reinstate' : 'Suspend'}
                      </Btn>
                    </td>
                  </tr>
                ))}
                {workspaces.length === 0 && (
                  <tr><td colSpan={10} style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>No workspaces.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {!loading && tab === 'plans' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h2 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 15, color: 'var(--t1)' }}>Subscription plans</h2>
                <p style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>Prices, message quotas, rate limits and feature flags for every plan.</p>
              </div>
              <Btn size="sm" onClick={() => setEditingPlan('new')}><I n="plus" s={14} c="#060A10" /> New plan</Btn>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
              {plans.map((p) => (
                <div key={p.id} style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, opacity: p.isActive ? 1 : 0.6 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 16, color: 'var(--t1)' }}>{p.name}</span>
                        {!p.isActive && <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', color: 'var(--t3)', textTransform: 'uppercase' }}>Inactive</span>}
                      </div>
                      <span style={{ fontSize: 10.5, color: 'var(--t3)', fontWeight: 600, letterSpacing: '.05em' }}>{p.key}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 20, color: 'var(--green)' }}>{p.currency} {Number(p.priceMonthly).toLocaleString()}</div>
                      <span style={{ fontSize: 10.5, color: 'var(--t3)' }}>per month</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--t2)', borderTop: '1px solid var(--bd)', paddingTop: 12 }}>
                    {[
                      ['Messages / cycle', fmtQuota(p.messageQuota)],
                      ['Overage / msg', `${p.currency} ${Number(p.overageRatePerMsg)}`],
                      ['Contacts', fmtLimit(p.contactLimit)],
                      ['Members', fmtLimit(p.memberLimit)],
                      ['Campaigns', fmtLimit(p.campaignLimit)],
                      ['API keys', fmtLimit(p.apiKeyLimit)],
                    ].map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--t3)' }}>{k}</span>
                        <span style={{ fontWeight: 600 }}>{v}</span>
                      </div>
                    ))}
                  </div>

                  {Object.keys(p.features || {}).filter(k => p.features[k]).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {Object.keys(p.features).filter(k => p.features[k]).map(flag => (
                        <span key={flag} style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 12, background: 'var(--gbg)', border: '1px solid var(--gbd)', color: 'var(--green)' }}>{flag}</span>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 'auto', paddingTop: 4 }}>
                    <span style={{ fontSize: 11, color: 'var(--t3)' }}>{p.subscriberCount ?? 0} subscriber{(p.subscriberCount ?? 0) === 1 ? '' : 's'}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Btn variant="outline" size="sm" onClick={() => setEditingPlan(p)}><I n="pencil" s={13} c="var(--t2)" /> Edit</Btn>
                      <Btn variant="outline" size="sm" onClick={() => deletePlan(p)} style={{ borderColor: 'rgba(239,68,68,.35)', color: '#f87171' }}><I n="trash" s={13} c="#f87171" /></Btn>
                    </div>
                  </div>
                </div>
              ))}
              {plans.length === 0 && (
                <div style={{ ...card, padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13, gridColumn: '1 / -1' }}>No plans yet. Create your first plan.</div>
              )}
            </div>
          </div>
        )}

        {!loading && tab === 'support' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tickets.length === 0 && <div style={{ ...card, padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>No support tickets.</div>}
            {tickets.map((t) => (
              <div key={t.id} style={{ ...card, padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>{t.subject}</p>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 12, background: 'rgba(255,255,255,0.05)', color: 'var(--t3)', textTransform: 'uppercase' }}>{t.category}</span>
                    </div>
                    <p style={{ fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.5, marginBottom: 6 }}>{t.message}</p>
                    <p style={{ fontSize: 11, color: 'var(--t3)' }}>{t.workspace?.name || '—'} · {new Date(t.createdAt).toLocaleString('en-IN')}</p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', flexShrink: 0 }}>
                    <span style={{ padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                      background: t.status === 'OPEN' ? 'rgba(251,191,36,.1)' : t.status === 'RESOLVED' || t.status === 'CLOSED' ? 'var(--gbg)' : 'rgba(56,189,248,.1)',
                      color: t.status === 'OPEN' ? '#fbbf24' : t.status === 'RESOLVED' || t.status === 'CLOSED' ? 'var(--green)' : '#38bdf8' }}>{t.status}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {t.status !== 'IN_PROGRESS' && t.status !== 'RESOLVED' && t.status !== 'CLOSED' && <Btn variant="ghost" size="sm" onClick={() => updateTicket(t, 'IN_PROGRESS')}>Start</Btn>}
                      {t.status !== 'RESOLVED' && t.status !== 'CLOSED' && <Btn variant="outline" size="sm" onClick={() => updateTicket(t, 'RESOLVED')}>Resolve</Btn>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
       </div>
      </div>

      {editingPlan && (
        <PlanEditor
          plan={editingPlan}
          knownFeatures={knownFeatures}
          onClose={() => setEditingPlan(null)}
          onSaved={load}
        />
      )}

      {viewingWorkspaceId && (
        <WorkspaceMembersModal
          workspaceId={viewingWorkspaceId}
          onClose={() => setViewingWorkspaceId(null)}
        />
      )}
    </div>
  );
}
