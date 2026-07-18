import { useState, useEffect } from 'react';
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

// Platform-wide super-admin dashboard: aggregate stats across ALL workspaces,
// workspace management (suspend/reinstate), and a support-ticket queue. Distinct
// from the per-workspace analytics regular users see.
export default function SuperAdminView() {
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [plans, setPlans] = useState([]);
  const [knownFeatures, setKnownFeatures] = useState([]);
  const [editingPlan, setEditingPlan] = useState(null); // 'new' | plan object | null
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

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ height: 58, borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 28px', flexShrink: 0, background: 'var(--surf)', gap: 16 }}>
        <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 16, color: 'var(--t1)' }}>Platform Admin</h1>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['overview', 'Overview'], ['workspaces', 'Workspaces'], ['plans', 'Plans'], ['tickets', 'Support']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                background: tab === id ? 'var(--gbg)' : 'transparent', border: `1px solid ${tab === id ? 'var(--gbd)' : 'transparent'}`,
                color: tab === id ? 'var(--green)' : 'var(--t2)' }}>
              {label}{id === 'tickets' && tickets.filter(t => t.status === 'OPEN').length > 0 ? ` (${tickets.filter(t => t.status === 'OPEN').length})` : ''}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <Btn variant="outline" size="sm" onClick={load}>Refresh</Btn>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
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

        {!loading && tab === 'workspaces' && (
          <div style={{ ...card, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bd)' }}>
                  {['Workspace', 'Owner', 'Members', 'Campaigns', 'Contacts', 'Numbers', 'Wallet', 'Status', ''].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
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
                      <Btn variant="outline" size="sm" onClick={() => toggleSuspend(w)}
                        style={w.suspended ? {} : { borderColor: 'rgba(239,68,68,.35)', color: '#f87171' }}>
                        {w.suspended ? 'Reinstate' : 'Suspend'}
                      </Btn>
                    </td>
                  </tr>
                ))}
                {workspaces.length === 0 && (
                  <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>No workspaces.</td></tr>
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

        {!loading && tab === 'tickets' && (
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

      {editingPlan && (
        <PlanEditor
          plan={editingPlan}
          knownFeatures={knownFeatures}
          onClose={() => setEditingPlan(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
