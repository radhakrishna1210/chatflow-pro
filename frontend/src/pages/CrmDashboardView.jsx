import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { wFetch } from '../lib/api.js';
import { fmtMoney, fmtMoneyShort } from '../lib/format.js';
import NextBestActions from '../components/NextBestActions.jsx';

const STAGE_COLORS = {
  QUALIFICATION: '#3b82f6',
  NEEDS_ANALYSIS: '#6366f1',
  PROPOSAL: '#8b5cf6',
  NEGOTIATION: '#d946ef',
  CLOSED_WON: '#10b981',
  CLOSED_LOST: '#ef4444'
};

const STAGE_LABELS = {
  QUALIFICATION: 'Qualification',
  NEEDS_ANALYSIS: 'Needs analysis',
  PROPOSAL: 'Proposal',
  NEGOTIATION: 'Negotiation',
  CLOSED_WON: 'Closed won',
  CLOSED_LOST: 'Closed lost'
};

const PIE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899'];

export function CrmDashboardView({ user }) {
  const [filter, setFilter] = useState('everyone'); // 'me' | 'everyone'
  const [data, setData] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let url = '/crm-analytics';
    if (filter === 'me') url += `?userId=${user.id}`;

    Promise.all([
      wFetch(url).then(r => r.json()),
      wFetch(`/tasks?isOverdue=true${filter === 'me' ? `&assignedToUserId=${user.id}` : ''}`).then(r => r.json())
    ]).then(([statsData, tasksData]) => {
      setData(statsData);
      setTasks(tasksData.data || []);
      setLoading(false);
    }).catch(e => {
      console.error(e);
      setLoading(false);
    });
  }, [filter, user.id]);

  if (loading) {
    return (
      <div style={{ padding: 40, color: 'var(--t3)', fontSize: 14 }}>Loading CRM Dashboard...</div>
    );
  }

  const kpis = data?.kpis || {};
  const charts = data?.charts || {};

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto', fontFamily: 'Inter, sans-serif' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff', margin: '0 0 8px 0', letterSpacing: '-0.02em' }}>Welcome back</h1>
          <p style={{ color: 'var(--t2)', fontSize: 13, margin: 0 }}>What the team has closed, what is still in play, and what needs you today.</p>
          {/* The header already promises "what needs you today" — this is the
              part that actually answers it, so it sits above the metrics. */}
        </div>
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', padding: 4, borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)' }}>
          <button 
            onClick={() => setFilter('me')}
            style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: filter === 'me' ? 'rgba(255,255,255,0.1)' : 'transparent', color: filter === 'me' ? '#fff' : 'var(--t2)', border: '1px solid ' + (filter === 'me' ? 'rgba(255,255,255,0.1)' : 'transparent'), borderRadius: 4, cursor: 'pointer' }}
          >Me</button>
          <button 
            onClick={() => setFilter('everyone')}
            style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: filter === 'everyone' ? 'rgba(255,255,255,0.1)' : 'transparent', color: filter === 'everyone' ? '#fff' : 'var(--t2)', border: '1px solid ' + (filter === 'everyone' ? 'rgba(255,255,255,0.1)' : 'transparent'), borderRadius: 4, cursor: 'pointer' }}
          >Everyone</button>
        </div>
      </div>

      {/* Next best actions */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: '#fff', margin: '0 0 4px 0' }}>Do next</h3>
          <p style={{ fontSize: 11, color: 'var(--t3)', margin: 0 }}>
            Ranked by urgency, with the facts behind each one. Nothing here is predicted — every item
            cites what it read.
          </p>
        </div>
        <NextBestActions limit={6} />
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, marginBottom: 32, overflow: 'hidden' }}>
        <KpiCard title="Closed won this month" value={fmtMoney(kpis.closedWonMonthly ?? 0, { dash: fmtMoney(0) })} subtext="Total value this month" borderRight />
        <KpiCard title="Open pipeline" value={fmtMoney(kpis.openPipelineTotal ?? 0, { dash: fmtMoney(0) })} subtext="Total deals in progress" borderRight />
        <KpiCard title="Win rate (90d)" value={`${kpis.winRate90d || 0}%`} subtext="Based on closed deals" borderRight />
        <KpiCard title="Average deal (90d)" value={fmtMoney(kpis.averageDeal90d ?? 0, { dash: fmtMoney(0) })} subtext="Value of won deals" />
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 24, marginBottom: 32 }}>
        
        {/* Area Chart */}
        <div>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: '#fff', margin: '0 0 4px 0' }}>Closed won vs. new pipeline</h3>
            <p style={{ fontSize: 11, color: 'var(--t3)', margin: 0 }}>Last six months, by the month a deal closed or was created</p>
          </div>
          <div style={{ height: 260, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '24px 16px 16px 0', background: 'rgba(255,255,255,0.02)' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={charts.pipelineVsWon || []}>
                <defs>
                  <linearGradient id="colorPipeline" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="month" stroke="rgba(255,255,255,0.2)" fontSize={11} tickMargin={10} axisLine={false} tickLine={false} />
                <YAxis stroke="rgba(255,255,255,0.2)" fontSize={11} axisLine={false} tickLine={false} tickFormatter={v => fmtMoneyShort(v)} />
                <Tooltip 
                  contentStyle={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 12, color: '#fff' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Area type="monotone" dataKey="newPipeline" name="New pipeline" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorPipeline)" />
                <Area type="monotone" dataKey="closedWon" name="Closed won" stroke="#3b82f6" strokeWidth={2} fillOpacity={0} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Donut Chart */}
        <div>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: '#fff', margin: '0 0 4px 0' }}>Open pipeline by stage</h3>
            <p style={{ fontSize: 11, color: 'var(--t3)', margin: 0 }}>Where the value sits right now</p>
          </div>
          <div style={{ height: 260, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '24px 24px', background: 'rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column' }}>
            
            <div style={{ height: 120, marginBottom: 16, position: 'relative' }}>
               <ResponsiveContainer width="100%" height="100%">
                 <PieChart>
                   <Pie
                     data={charts.openPipelineByStage || []}
                     cx="50%"
                     cy="50%"
                     innerRadius={45}
                     outerRadius={60}
                     paddingAngle={2}
                     dataKey="value"
                     stroke="none"
                   >
                     {(charts.openPipelineByStage || []).map((entry, index) => (
                       <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                     ))}
                   </Pie>
                 </PieChart>
               </ResponsiveContainer>
               {/* Center Text */}
               <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{fmtMoneyShort(kpis.openPipelineTotal ?? 0)}</span>
                  <span style={{ fontSize: 10, color: 'var(--t3)' }}>open</span>
               </div>
            </div>

            {/* Legend Table */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {(charts.openPipelineByStage || []).map((entry, index) => (
                <div key={entry.stage} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 11 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: PIE_COLORS[index % PIE_COLORS.length] }} />
                    <span style={{ color: 'var(--t2)' }}>{STAGE_LABELS[entry.stage] || entry.stage}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <span style={{ color: 'var(--t3)' }}>{entry.count}</span>
                    <span style={{ color: '#fff', fontWeight: 600, width: 52, textAlign: 'right' }}>{fmtMoneyShort(entry.value)}</span>
                  </div>
                </div>
              ))}
            </div>

          </div>
        </div>

      </div>

      {/* Deals and Tasks Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32 }}>
        
        {/* Deals In Progress */}
        <div>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: '#fff', margin: '0 0 4px 0' }}>Deals in progress</h3>
              <p style={{ fontSize: 11, color: 'var(--t3)', margin: 0 }}>The largest open deals, and how long each has sat in its stage</p>
            </div>
            <button style={{ background: '#fff', color: '#000', border: 'none', padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 4, cursor: 'pointer' }}>Open deals</button>
          </div>
          
          <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, background: 'rgba(255,255,255,0.02)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th style={{ textAlign: 'left', padding: '12px 16px', color: 'var(--t3)', fontWeight: 400 }}>Deal</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', color: 'var(--t3)', fontWeight: 400 }}>Stage</th>
                  <th style={{ textAlign: 'right', padding: '12px 16px', color: 'var(--t3)', fontWeight: 400 }}>Value</th>
                </tr>
              </thead>
              <tbody>
                {(data?.dealsInProgress || []).map(deal => (
                  <tr key={deal.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff' }}>
                          {(deal.company || deal.title).charAt(0)}
                        </div>
                        <div>
                          <div style={{ color: '#fff', fontWeight: 500, marginBottom: 2 }}>{deal.company ? `${deal.company} — ` : ''}{deal.title}</div>
                          <div style={{ color: 'var(--t3)', fontSize: 10 }}>{deal.company || deal.title} • {deal.ageDays}d ago</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: STAGE_COLORS[deal.stage] || '#fff' }} />
                        <span style={{ color: 'var(--t2)' }}>{STAGE_LABELS[deal.stage] || deal.stage}</span>
                      </div>
                      <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, marginTop: 6 }}>
                        <div style={{ height: '100%', background: STAGE_COLORS[deal.stage] || '#fff', borderRadius: 2, width: getStageProgress(deal.stage) }} />
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: '#fff', fontWeight: 600 }}>
                      {fmtMoney(deal.value)}
                    </td>
                  </tr>
                ))}
                {(!data?.dealsInProgress || data.dealsInProgress.length === 0) && (
                  <tr>
                    <td colSpan={3} style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--t3)' }}>No open deals.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Overdue Tasks */}
        <div>
          <div style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: '#fff', margin: '0 0 4px 0' }}>Overdue tasks</h3>
            <p style={{ fontSize: 11, color: 'var(--t3)', margin: 0 }}>Every task you have logged is either done or still to come</p>
          </div>
          
          <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, background: 'rgba(255,255,255,0.02)', minHeight: 250, display: 'flex', flexDirection: 'column' }}>
            {tasks.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {tasks.map(task => (
                  <div key={task.id} style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 4 }}>{task.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--t3)' }}>{task.description || 'No description'}</div>
                    </div>
                    <div style={{ fontSize: 11, color: '#f87171', background: 'rgba(248,113,113,0.1)', padding: '4px 8px', borderRadius: 4 }}>
                      {new Date(task.dueDate).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--t3)', fontSize: 12 }}>
                Nothing overdue. Good.
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Recent Activity */}
      <div>
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: '#fff', margin: '0 0 4px 0' }}>Recent activity</h3>
            <p style={{ fontSize: 11, color: 'var(--t3)', margin: 0 }}>Every note, task and stage change across the workspace</p>
          </div>
          <button style={{ background: '#fff', color: '#000', border: 'none', padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 4, cursor: 'pointer' }}>All companies</button>
        </div>

        <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, background: 'rgba(255,255,255,0.02)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th style={{ textAlign: 'left', padding: '12px 16px', color: 'var(--t3)', fontWeight: 400 }}>Activity</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', color: 'var(--t3)', fontWeight: 400 }}>Company</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', color: 'var(--t3)', fontWeight: 400 }}>Deal</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', color: 'var(--t3)', fontWeight: 400 }}>Who</th>
                  <th style={{ textAlign: 'right', padding: '12px 16px', color: 'var(--t3)', fontWeight: 400 }}>When</th>
                </tr>
              </thead>
              <tbody>
                {(data?.recentActivity || []).map(act => (
                  <tr key={act.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ color: '#fff', fontWeight: 500 }}>{act.activity}</div>
                      {act.type === 'activity' && <div style={{ color: 'var(--t3)', marginTop: 4 }}>{act.details}</div>}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--t2)' }}>{act.company}</td>
                    <td style={{ padding: '12px 16px', color: 'var(--t2)' }}>{act.deal}</td>
                    <td style={{ padding: '12px 16px', color: 'var(--t2)' }}>{act.who}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--t3)' }}>
                      {formatTimeAgo(new Date(act.when))}
                    </td>
                  </tr>
                ))}
                {(!data?.recentActivity || data.recentActivity.length === 0) && (
                  <tr>
                    <td colSpan={5} style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--t3)' }}>No recent activity.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
      </div>

    </div>
  );
}

function KpiCard({ title, value, subtext, borderRight }) {
  return (
    <div style={{ padding: 24, borderRight: borderRight ? '1px solid rgba(255,255,255,0.1)' : 'none', display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ fontSize: 11, color: 'var(--t3)' }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--t3)' }}>{subtext}</div>
    </div>
  );
}

function getStageProgress(stage) {
  switch (stage) {
    case 'QUALIFICATION': return '20%';
    case 'NEEDS_ANALYSIS': return '40%';
    case 'PROPOSAL': return '60%';
    case 'NEGOTIATION': return '80%';
    case 'CLOSED_WON': return '100%';
    case 'CLOSED_LOST': return '100%';
    default: return '0%';
  }
}

function formatTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
