import { useState, useEffect } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { adminFetch } from '../lib/api.js';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 14 };

// Platform-wide super-admin dashboard: aggregate stats across ALL workspaces,
// workspace management (suspend/reinstate), and a support-ticket queue. Distinct
// from the per-workspace analytics regular users see.
export default function SuperAdminView() {
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const [s, w, t] = await Promise.all([
        adminFetch('/platform/stats').then(r => r.ok ? r.json() : null),
        adminFetch('/platform/workspaces').then(r => r.ok ? r.json() : []),
        adminFetch('/platform/tickets').then(r => r.ok ? r.json() : []),
      ]);
      setStats(s?.totals || null);
      setWorkspaces(Array.isArray(w) ? w : []);
      setTickets(Array.isArray(t) ? t : []);
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
          {[['overview', 'Overview'], ['workspaces', 'Workspaces'], ['tickets', 'Support']].map(([id, label]) => (
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
    </div>
  );
}
