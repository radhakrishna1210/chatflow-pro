import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { I } from '../Icons.jsx';

// Shared surface used across all dashboard cards.
const card = {
  background: 'var(--surf)',
  border: '1px solid var(--bd)',
  borderRadius: 'var(--rl)',
  boxShadow: 'var(--card-shadow)',
};

const dayOptions = [7, 30, 90];

const fmt = (value) => Number(value || 0).toLocaleString();
const pct = (value) => `${Number(value || 0).toFixed(1)}%`;

// Human-readable duration for a millisecond latency value.
const minutes = (ms) => {
  if (!ms) return '0m';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
};

const StatCard = ({ icon, color, label, value, sub }) => (
  <div style={{ ...card, padding: 18, minHeight: 116 }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
      <div style={{ width: 34, height: 34, borderRadius: 8, background: `${color}16`, border: `1px solid ${color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <I n={icon} s={15} c={color} />
      </div>
    </div>
    <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 25, fontWeight: 800, color: 'var(--t1)', letterSpacing: '-.03em', lineHeight: 1.1 }}>
      {value}
    </div>
    <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 5 }}>{label}</div>
    {sub && <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>{sub}</div>}
  </div>
);

const SectionTitle = ({ title, sub }) => (
  <div style={{ marginBottom: 14 }}>
    <h3 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--t1)', marginBottom: 3 }}>{title}</h3>
    {sub && <p style={{ fontSize: 12, color: 'var(--t2)' }}>{sub}</p>}
  </div>
);

const Avatar = ({ name = '?', size = 28 }) => {
  const init = name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['#1EBF5E', '#0EA5E9', '#A78BFA', '#F59E0B', '#F472B6'];
  const c = colors[init.charCodeAt(0) % colors.length];
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: `${c}18`, border: `1.5px solid ${c}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.33 + 'px', fontWeight: 700, color: c, flexShrink: 0 }}>
      {init}
    </div>
  );
};

export default function ChatAnalytics({ workspaceId, token }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Fetch on mount and whenever the date window changes. Aborts the previous
  // in-flight request so toggling the filter doesn't race.
  useEffect(() => {
    if (!workspaceId) return;

    const ctrl = new AbortController();
    setLoading(true);
    setError('');

    fetch(`/api/v1/workspaces/${workspaceId}/analytics/chat?days=${days}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Analytics request failed (${res.status})`);
        return body;
      })
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message || 'Unable to load chat analytics');
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });

    return () => ctrl.abort();
  }, [workspaceId, token, days]);

  const chartData = useMemo(() => {
    const rows = data?.dailyVolume || [];
    return rows.map((row) => ({
      ...row,
      label: new Date(`${row.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }));
  }, [data]);

  const messages = data?.messages || {};
  const conversations = data?.conversations || {};
  const campaigns = data?.campaigns || {};
  const contacts = data?.contacts || {};
  const labels = conversations.labels || [];
  const topAgents = data?.topAgents || [];

  const maxLabelCount = labels.length ? Math.max(...labels.map((l) => l.count)) : 1;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ height: 58, borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 28px', flexShrink: 0, background: 'var(--surf)', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 16, color: 'var(--t1)', letterSpacing: '-.02em' }}>Chat Analysis</h1>
          <p style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 1 }}>Chat performance, campaigns, contacts, and agent activity</p>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 9, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)' }}>
          {dayOptions.map((option) => {
            const active = days === option;
            return (
              <button
                key={option}
                onClick={() => setDays(option)}
                style={{
                  border: 'none',
                  borderRadius: 7,
                  padding: '7px 11px',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: active ? 700 : 500,
                  color: active ? '#060913' : 'var(--t2)',
                  background: active ? 'var(--green)' : 'transparent',
                  fontFamily: "'Plus Jakarta Sans',sans-serif",
                }}>
                {option}d
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '60px 0', color: 'var(--t2)', fontSize: 13 }}>
            <div style={{ width: 26, height: 26, border: '2px solid var(--green)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', marginRight: 12 }} />
            Loading chat analysis...
          </div>
        )}

        {!loading && error && (
          <div style={{ ...card, padding: 18, color: '#f87171', fontSize: 13 }}>{error}</div>
        )}

        {!loading && !error && data && (
          <>
            {/* Stat cards — bot and manual are surfaced as separate cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
              <StatCard icon="send" color="var(--green)" label="Messages sent (outbound)" value={fmt(messages.sent)} sub="From Message.direction" />
              <StatCard icon="msg" color="#38bdf8" label="Messages received" value={fmt(messages.received)} sub="Inbound messages" />
              <StatCard icon="bot" color="#A78BFA" label="Sent by Bot / Automation" value={fmt(messages.bot)} sub="Outbound, senderUserId is null" />
              <StatCard icon="user" color="var(--green)" label="Sent Manually" value={fmt(messages.manual)} sub="Outbound, senderUserId set" />
              <StatCard icon="users" color="#A78BFA" label="Open conversations" value={fmt(conversations.open)} sub={`${fmt(conversations.pending)} pending · ${fmt(conversations.resolved)} resolved`} />
              <StatCard icon="bell" color="#fbbf24" label="Avg unread (open)" value={Number(conversations.averageUnreadOpen || 0).toFixed(1)} sub="Per open conversation" />
              <StatCard icon="checkc" color="#0EA5E9" label="Campaign read rate" value={pct(campaigns.readRate)} sub={`${fmt(campaigns.read)} of ${fmt(campaigns.sent)} read`} />
              <StatCard icon="alertc" color="#f87171" label="Campaign failed rate" value={pct(campaigns.failedRate)} sub={`${fmt(campaigns.failed)} failed`} />
              <StatCard icon="ban" color="#F472B6" label="Opt-out rate" value={pct(contacts.optOutRate)} sub={`${fmt(contacts.optedOut)} of ${fmt(contacts.total)} contacts`} />
            </div>

            {/* Daily volume chart */}
            <div style={{ ...card, padding: 20 }}>
              <SectionTitle title="Daily Volume" sub={`Outbound and inbound messages over the last ${days} days`} />
              <div style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.07)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: 'var(--t3)', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={days > 30 ? 18 : 8} />
                    <YAxis tick={{ fill: 'var(--t3)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip
                      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                      contentStyle={{ background: '#080d18', border: '1px solid var(--bd)', borderRadius: 8, color: 'var(--t1)' }}
                      labelStyle={{ color: 'var(--t2)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, color: 'var(--t2)' }} />
                    <Bar dataKey="sent" name="Sent (outbound)" fill="var(--green)" radius={[5, 5, 0, 0]} />
                    <Bar dataKey="received" name="Received (inbound)" fill="#38bdf8" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Campaign counters + latency */}
            <div style={{ ...card, padding: 20 }}>
              <SectionTitle title="Campaigns" sub="Counter totals and average recipient event latency" />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginBottom: 14 }}>
                {[
                  ['Sent', campaigns.sent],
                  ['Delivered', campaigns.delivered],
                  ['Read', campaigns.read],
                  ['Failed', campaigns.failed],
                ].map(([label, value]) => (
                  <div key={label} style={{ padding: 12, borderRadius: 8, border: '1px solid var(--bd)', background: 'rgba(255,255,255,0.025)' }}>
                    <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--t1)' }}>{fmt(value)}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--t2)' }}>Delivery rate <strong style={{ color: 'var(--t1)' }}>{pct(campaigns.deliveryRate)}</strong></div>
                <div style={{ fontSize: 12, color: 'var(--t2)' }}>Delivery latency <strong style={{ color: 'var(--t1)' }}>{minutes(campaigns.deliveryLatencyMs)}</strong></div>
                <div style={{ fontSize: 12, color: 'var(--t2)' }}>Read latency <strong style={{ color: 'var(--t1)' }}>{minutes(campaigns.readLatencyMs)}</strong></div>
              </div>
            </div>

            {/* Two-column: labels + top agents */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
              {/* Conversation labels */}
              <div style={{ ...card, padding: 20 }}>
                <SectionTitle title="Conversation Labels" sub="Current label distribution" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {labels.length === 0 && <p style={{ fontSize: 12, color: 'var(--t3)' }}>No labels yet.</p>}
                  {labels.map((row) => (
                    <div key={row.label}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                        <span style={{ fontSize: 12, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)' }}>{fmt(row.count)}</span>
                      </div>
                      <div style={{ height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${(row.count / maxLabelCount) * 100}%`, borderRadius: 4, background: 'var(--green)', transition: 'width .4s' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top agents */}
              <div style={{ ...card, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)' }}>
                  <SectionTitle title="Top Agents" sub="Top 5 by manual outbound messages in this date range" />
                </div>
                {topAgents.length === 0 ? (
                  <div style={{ padding: 20, fontSize: 12, color: 'var(--t3)' }}>No manual outbound messages in this period.</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {topAgents.map((agent, index) => (
                        <tr key={agent.agentId} style={{ borderBottom: index < topAgents.length - 1 ? '1px solid var(--bd)' : 'none' }}>
                          <td style={{ padding: '13px 20px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                              <Avatar name={agent.name} />
                              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{agent.name}</span>
                            </div>
                          </td>
                          <td style={{ padding: '13px 20px', textAlign: 'right' }}>
                            <span style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(167,139,250,.1)', border: '1px solid rgba(167,139,250,.25)', color: '#c4b5fd', fontSize: 12, fontWeight: 700 }}>
                              {fmt(agent.messageCount)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
