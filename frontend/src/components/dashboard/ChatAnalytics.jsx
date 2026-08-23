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
import { wFetch } from '../../lib/api.js';
import MobileNavButton from '../MobileNavButton.jsx';

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
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap', rowGap: 10 }}>
      <div style={{ width: 34, height: 34, borderRadius: 8, background: `${color}16`, border: `1px solid ${color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <I n={icon} s={15} c={color} />
      </div>
    </div>
    <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 25, fontWeight: 800, color: 'var(--t1)', letterSpacing: '-.03em', lineHeight: 1.1 }}>
      {value}
    </div>
    <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 5 }}>{label}</div>
    {sub && <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>{sub}</div>}
  </div>
);

const SectionTitle = ({ title, sub }) => (
  <div style={{ marginBottom: 14 }}>
    <h3 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--t1)', marginBottom: 3 }}>{title}</h3>
    {sub && <p style={{ fontSize: 12, color: 'var(--t2)' }}>{sub}</p>}
  </div>
);

const Avatar = ({ name = '?', size = 28 }) => {
  const init = name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['#35e8f2', '#9d6bff', '#c4ff46', '#F59E0B', '#F472B6'];
  const c = colors[init.charCodeAt(0) % colors.length];
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: `${c}18`, border: `1.5px solid ${c}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.33 + 'px', fontWeight: 700, color: c, flexShrink: 0 }}>
      {init}
    </div>
  );
};

export default function ChatAnalytics({ workspaceId }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [insights, setInsights] = useState(null);

  // Fetch on mount and whenever the date window changes. Aborts the previous
  // in-flight request so toggling the filter doesn't race.
  //
  // Uses wFetch (not a raw fetch) so this always sends the *current* token
  // straight from localStorage and gets the app's automatic 401-refresh-and-
  // retry — a raw fetch with a token captured at render time would fail
  // silently and permanently if the access token had already expired by the
  // time this page first loads, which is exactly what caused analytics to
  // only start working after the user touched the date filter (by which
  // point some other wFetch-based widget on the page had already refreshed
  // the token).
  useEffect(() => {
    if (!workspaceId) return;

    const ctrl = new AbortController();
    setLoading(true);
    setError('');

    wFetch(`/analytics/chat?days=${days}`, { signal: ctrl.signal })
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
  }, [workspaceId, days]);

  // Topic clusters, sentiment and knowledge gaps. A separate request from the
  // counters above because it scans message bodies and is the slower of the
  // two — the page should not hold its numbers back waiting for it.
  useEffect(() => {
    const ctrl = new AbortController();
    setInsights(null);
    wFetch(`/analytics/insights?days=${days}`, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (body) setInsights(body); })
      .catch(() => { /* the rest of the page still works without it */ });
    return () => ctrl.abort();
  }, [workspaceId, days]);

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
  const topTopic = insights?.topics?.[0];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div className="dash-page-head" style={{ height: 58, borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 28px', flexShrink: 0, background: 'var(--surf)', gap: 12 }}>
        <MobileNavButton />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 800, fontSize: 16, color: 'var(--t1)', letterSpacing: '-.02em' }}>Chat Analysis</h1>
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
                  color: active ? '#08090c' : 'var(--t2)',
                  background: active ? 'var(--green)' : 'transparent',
                  fontFamily: "'Manrope',sans-serif",
                }}>
                {option}d
              </button>
            );
          })}
        </div>
      </div>

      <div className="dash-page" style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
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
              <StatCard icon="msg" color="#9d6bff" label="Messages received" value={fmt(messages.received)} sub="Inbound messages" />
              <StatCard icon="bot" color="#c4ff46" label="Sent by Bot / Automation" value={fmt(messages.bot)} sub="Outbound, senderUserId is null" />
              <StatCard icon="user" color="var(--green)" label="Sent Manually" value={fmt(messages.manual)} sub="Outbound, senderUserId set" />
              <StatCard icon="users" color="#c4ff46" label="Open conversations" value={fmt(conversations.open)} sub={`${fmt(conversations.pending)} pending · ${fmt(conversations.resolved)} resolved`} />
              <StatCard icon="bell" color="#fbbf24" label="Avg unread (open)" value={Number(conversations.averageUnreadOpen || 0).toFixed(1)} sub="Per open conversation" />
              <StatCard icon="checkc" color="#9d6bff" label="Campaign read rate" value={pct(campaigns.readRate)} sub={`${fmt(campaigns.read)} of ${fmt(campaigns.sent)} read`} />
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
                    <Bar dataKey="received" name="Received (inbound)" fill="#9d6bff" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Campaign counters + latency */}
            <div style={{ ...card, padding: 20 }}>
              <SectionTitle title="Campaigns" sub="Counter totals and average recipient event latency" />
              <div className="rgrid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginBottom: 14 }}>
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
              <div className="rgrid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--t2)' }}>Delivery rate <strong style={{ color: 'var(--t1)' }}>{pct(campaigns.deliveryRate)}</strong></div>
                <div style={{ fontSize: 12, color: 'var(--t2)' }}>Delivery latency <strong style={{ color: 'var(--t1)' }}>{minutes(campaigns.deliveryLatencyMs)}</strong></div>
                <div style={{ fontSize: 12, color: 'var(--t2)' }}>Read latency <strong style={{ color: 'var(--t1)' }}>{minutes(campaigns.readLatencyMs)}</strong></div>
              </div>
            </div>

            {/* Two-column: labels + top agents */}
            <div className="rgrid-2" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
              {/* Conversation labels */}
              <div style={{ ...card, padding: 20 }}>
                <SectionTitle title="Conversation Labels" sub="Current label distribution" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {labels.length === 0 && <p style={{ fontSize: 12, color: 'var(--t3)' }}>No labels yet.</p>}
                  {labels.map((row) => (
                    <div key={row.label}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4, flexWrap: 'wrap', rowGap: 10 }}>
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
                            <span style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(196,255,70,.1)', border: '1px solid rgba(196,255,70,.25)', color: '#d8ff8a', fontSize: 12, fontWeight: 700 }}>
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

            {/* ── What customers talk about ──
                Clustered against this workspace's own intent rules when it has
                any, so the categories are the ones it already told us matter. */}
            <div className="dash-split" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14 }}>
              <div style={{ ...card, padding: '20px 22px' }}>
                <SectionTitle
                  title="Topics customers raise"
                  sub={insights
                    ? `${fmt(insights.analysed)} inbound messages · clustered by ${insights.clusteredBy === 'intents' ? 'your intent rules' : 'the default taxonomy'}`
                    : 'Reading conversations…'}
                />
                {!insights && <p style={{ fontSize: 12.5, color: 'var(--t3)' }}>Loading…</p>}
                {insights && insights.topics.length === 0 && (
                  <p style={{ fontSize: 12.5, color: 'var(--t3)', lineHeight: 1.6 }}>
                    No inbound messages in this window yet.
                  </p>
                )}
                {insights && insights.topics.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                    {insights.topics.map((t) => (
                      <div key={t.name}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 5, flexWrap: 'wrap', rowGap: 10 }}>
                          <span style={{ fontSize: 12.5, color: 'var(--t1)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--t2)', flexShrink: 0 }}>
                            {fmt(t.count)} · {t.share}%
                          </span>
                        </div>
                        <div style={{ height: 6, borderRadius: 6, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                          <div style={{ width: `${t.width}%`, height: '100%', borderRadius: 6, background: 'linear-gradient(90deg, var(--cyan), rgba(157,107,255,0.85))' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {insights?.clusteredBy === 'default' && (
                  <p style={{ fontSize: 11, color: 'var(--t3)', marginTop: 12, lineHeight: 1.55 }}>
                    Add intents under Intent Matching and these clusters become your own categories instead of the defaults.
                  </p>
                )}
              </div>

              {/* ── Sentiment ── */}
              <div style={{ ...card, padding: '20px 22px' }}>
                <SectionTitle title="Sentiment mix" sub="Inbound messages, by tone" />
                {!insights && <p style={{ fontSize: 12.5, color: 'var(--t3)' }}>Loading…</p>}
                {insights && insights.sentiment.total === 0 && (
                  <p style={{ fontSize: 12.5, color: 'var(--t3)' }}>Nothing to read yet.</p>
                )}
                {insights && insights.sentiment.total > 0 && (
                  <>
                    <div style={{ display: 'flex', height: 10, borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
                      <div style={{ width: `${insights.sentiment.positive.pct}%`, background: 'var(--success)' }} />
                      <div style={{ width: `${insights.sentiment.neutral.pct}%`, background: 'rgba(255,255,255,0.16)' }} />
                      <div style={{ width: `${insights.sentiment.negative.pct}%`, background: '#f87171' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[
                        ['Positive', insights.sentiment.positive, 'var(--success)'],
                        ['Neutral', insights.sentiment.neutral, 'rgba(255,255,255,0.4)'],
                        ['Negative', insights.sentiment.negative, '#f87171'],
                      ].map(([label, value, colour]) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: colour, flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: 12.5, color: 'var(--t2)' }}>{label}</span>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--t1)' }}>{value.pct}%</span>
                        </div>
                      ))}
                    </div>
                    {insights.sentiment.insight && (
                      <div style={{ marginTop: 14, padding: '11px 13px', borderRadius: 9, background: 'var(--gbg)', border: '1px solid var(--gbd)' }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.14em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 6 }}>Where to look</div>
                        <p style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.6 }}>{insights.sentiment.insight}</p>
                      </div>
                    )}
                    <p style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 12, lineHeight: 1.55 }}>
                      Tone is read from wording, not meaning — treat it as a direction to look in, not a verdict.
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* ── Knowledge gaps ── */}
            <div style={{ ...card, padding: '20px 22px' }}>
              <SectionTitle
                title="Questions nothing could answer"
                sub="Messages that fell through routing, and customer questions that never got a reply"
              />
              {!insights && <p style={{ fontSize: 12.5, color: 'var(--t3)' }}>Loading…</p>}
              {insights && insights.gaps.length === 0 && (
                <p style={{ fontSize: 12.5, color: 'var(--t3)', lineHeight: 1.6 }}>
                  Nothing unanswered in this window. Every customer question either matched an intent or got a reply.
                </p>
              )}
              {insights && insights.gaps.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {insights.gaps.map((gap) => (
                    <div key={gap.question} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 9, background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.2)' }}>
                      <I n="alertt" s={15} c="#fbbf24" />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--t1)', lineHeight: 1.5 }}>{gap.question}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>{gap.count}×</span>
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('app:nav', { detail: 'ai-agent' }))}
                        style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--accent)', fontFamily: "'Manrope',sans-serif", whiteSpace: 'nowrap' }}>
                        Add to knowledge →
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
