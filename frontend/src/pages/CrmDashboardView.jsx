import { useState, useEffect } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { wFetch } from '../lib/api.js';
import { fmtMoney, fmtMoneyShort } from '../lib/format.js';
import NextBestActions from '../components/NextBestActions.jsx';
import { I } from '../components/Icons.jsx';
import { CrmIntegrationHealthModal } from '../components/CrmIntegrationHealthModal.jsx';


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

const PIE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

export function CrmDashboardView({ user }) {
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'source_performance' | 'custom_reports'
  const [range, setRange] = useState('30d'); // '7d' | '30d' | '90d' | 'this_month' | 'all'
  const [filter, setFilter] = useState('everyone'); // 'me' | 'everyone'
  const [data, setData] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [urgentActionsTotal, setUrgentActionsTotal] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('actions'); // 'actions' | 'overdue'
  const [doNextExpanded, setDoNextExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showHealthModal, setShowHealthModal] = useState(false);

  // Custom Reports state
  const [reportTemplates, setReportTemplates] = useState([]);
  const [savedReports, setSavedReports] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [reportConfig, setReportConfig] = useState({
    entity: 'leads',
    metric: 'count',
    groupBy: 'owner',
    chartType: 'bar',
  });
  const [reportData, setReportData] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [saveReportName, setSaveReportName] = useState('');
  const [savingReport, setSavingReport] = useState(false);
  const [reportMsg, setReportMsg] = useState('');

  const loadData = () => {
    let url = `/crm-analytics?range=${range}`;
    if (filter === 'me') url += `&userId=${user.id}`;

    Promise.all([
      wFetch(url).then(r => r.json()),
      wFetch(`/tasks?isOverdue=true${filter === 'me' ? `&assignedToUserId=${user.id}` : ''}`).then(r => r.json()),
      wFetch('/insights/recommendations?limit=1').then(r => r.json()).catch(() => ({ total: 0 })),
      wFetch('/crm-analytics/reports/saved').then(r => r.json()).catch(() => ({ templates: [], saved: [] }))
    ]).then(([statsData, tasksData, recsData, repData]) => {
      setData(statsData);
      const overdueList = tasksData.data || [];
      setTasks(overdueList);
      const recsTotal = recsData?.total ?? 0;
      setUrgentActionsTotal(recsTotal);
      setReportTemplates(repData?.templates || []);
      setSavedReports(repData?.saved || []);
      setLoading(false);

      const totalBadge = recsTotal + overdueList.length;
      window.dispatchEvent(new CustomEvent('crm:badge-updated', { detail: totalBadge }));
    }).catch(e => {
      console.error(e);
      setLoading(false);
    });
  };

  useEffect(() => {
    loadData();
  }, [filter, range, user.id]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onEsc = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [drawerOpen]);

  // Run custom report query
  const runReport = async (cfg = reportConfig) => {
    setReportLoading(true);
    setReportMsg('');
    try {
      const res = await wFetch('/crm-analytics/reports/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...cfg, range }),
      });
      if (res.ok) {
        const d = await res.json();
        setReportData(d);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setReportLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'custom_reports' && !reportData) {
      runReport();
    }
  }, [activeTab]);

  const handleApplyTemplate = (tmpl) => {
    setSelectedTemplate(tmpl.id);
    const newCfg = {
      entity: tmpl.entity,
      metric: tmpl.metric,
      groupBy: tmpl.groupBy,
      chartType: tmpl.chartType,
      filters: tmpl.filters || {},
    };
    setReportConfig(newCfg);
    runReport(newCfg);
  };

  const handleSaveReport = async () => {
    if (!saveReportName.trim()) return;
    setSavingReport(true);
    try {
      const res = await wFetch('/crm-analytics/reports/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: saveReportName.trim(), config: reportConfig }),
      });
      if (res.ok) {
        setSaveReportName('');
        setReportMsg('Report saved successfully!');
        // Reload saved reports
        const repData = await wFetch('/crm-analytics/reports/saved').then(r => r.json());
        setSavedReports(repData?.saved || []);
        setTimeout(() => setReportMsg(''), 4000);
      }
    } catch (e) {
      setReportMsg('Failed to save report');
    } finally {
      setSavingReport(false);
    }
  };

  const handleDeleteSavedReport = async (id, e) => {
    e.stopPropagation();
    try {
      const res = await wFetch(`/crm-analytics/reports/saved/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSavedReports(prev => prev.filter(r => r.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 40, color: 'var(--t3)', fontSize: 14 }}>Loading CRM Management Dashboard...</div>
    );
  }

  const kpis = data?.kpis || {};
  const charts = data?.charts || {};
  const act = data?.activityPerformance || {};
  const sourcePerformance = data?.leadSourcePerformance || [];
  const urgentCount = urgentActionsTotal + tasks.length;

  return (
    <div style={{ padding: '28px 36px', maxWidth: 1240, margin: '0 auto', fontFamily: 'Inter, sans-serif' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff', margin: '0 0 6px 0', letterSpacing: '-0.02em' }}>
            CRM Management & Analytics
          </h1>
          <p style={{ color: 'var(--t2)', fontSize: 13, margin: 0 }}>
            Executive visibility across leads, deal conversion, sales engagement, and custom reports.
          </p>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Time Range Selector */}
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', padding: 3, borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)' }}>
            {[
              { id: '7d', label: '7D' },
              { id: '30d', label: '30D' },
              { id: '90d', label: '90D' },
              { id: 'this_month', label: 'Month' },
              { id: 'all', label: 'All' },
            ].map(r => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                style={{
                  padding: '5px 10px',
                  fontSize: 11.5,
                  fontWeight: 600,
                  background: range === r.id ? 'var(--accent, #35e8f2)' : 'transparent',
                  color: range === r.id ? '#060A10' : 'var(--t2)',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Integration Health Button */}
          <button
            onClick={() => setShowHealthModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '6px 12px',
              background: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              borderRadius: 6,
              color: '#4ade80',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              transition: 'all 0.15s ease',
            }}
            title="View CRM Ingestion & Integration Health"
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
            Integration Health
          </button>

          {/* Action Center Bell */}
          {urgentCount > 0 && (
            <button
              onClick={() => { setDrawerTab('actions'); setDrawerOpen(true); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '6px 12px',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 6,
                color: '#fca5a5',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
              title="Open Action Center"
            >
              <I n="bell" s={14} c="#f87171" />
              <span>Action Center</span>
              <span style={{
                background: '#ef4444',
                color: '#fff',
                fontSize: 10,
                fontWeight: 800,
                padding: '1px 6px',
                borderRadius: 9,
              }}>
                {urgentCount}
              </span>
            </button>
          )}

          {/* Scope Filter */}
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', padding: 3, borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)' }}>
            <button 
              onClick={() => setFilter('me')}
              style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, background: filter === 'me' ? 'rgba(255,255,255,0.12)' : 'transparent', color: filter === 'me' ? '#fff' : 'var(--t2)', border: 'none', borderRadius: 4, cursor: 'pointer' }}
            >Me</button>
            <button 
              onClick={() => setFilter('everyone')}
              style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, background: filter === 'everyone' ? 'rgba(255,255,255,0.12)' : 'transparent', color: filter === 'everyone' ? '#fff' : 'var(--t2)', border: 'none', borderRadius: 4, cursor: 'pointer' }}
            >Everyone</button>
          </div>
        </div>
      </div>

      {/* Primary Dashboard Navigation Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: 28, gap: 24 }}>
        <button
          onClick={() => setActiveTab('overview')}
          style={{
            padding: '10px 4px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'overview' ? '2px solid var(--accent, #35e8f2)' : '2px solid transparent',
            color: activeTab === 'overview' ? '#fff' : 'var(--t3)',
            fontSize: 13.5,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <I n="layout" s={15} c={activeTab === 'overview' ? 'var(--accent, #35e8f2)' : 'var(--t3)'} />
          <span>Management Overview</span>
        </button>

        <button
          onClick={() => setActiveTab('source_performance')}
          style={{
            padding: '10px 4px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'source_performance' ? '2px solid var(--accent, #35e8f2)' : '2px solid transparent',
            color: activeTab === 'source_performance' ? '#fff' : 'var(--t3)',
            fontSize: 13.5,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <I n="chart" s={15} c={activeTab === 'source_performance' ? 'var(--accent, #35e8f2)' : 'var(--t3)'} />
          <span>Lead Source Performance</span>
        </button>

        <button
          onClick={() => setActiveTab('custom_reports')}
          style={{
            padding: '10px 4px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'custom_reports' ? '2px solid var(--accent, #35e8f2)' : '2px solid transparent',
            color: activeTab === 'custom_reports' ? '#fff' : 'var(--t3)',
            fontSize: 13.5,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <I n="columns" s={15} c={activeTab === 'custom_reports' ? 'var(--accent, #35e8f2)' : 'var(--t3)'} />
          <span>Custom Reports & Chart Library</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: MANAGEMENT OVERVIEW                                                */}
      {/* ========================================================================= */}
      {activeTab === 'overview' && (
        <div>
          {/* Top 4 Pipeline KPIs (Gap Analysis Part 1, Page 2) */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 16,
            marginBottom: 24,
          }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--t3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>New Leads</span>
                <I n="target" s={15} c="#38bdf8" />
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#fff' }}>{kpis.newLeads ?? 0}</div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>Created in selected range</div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--t3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Qualified Leads</span>
                <I n="checkc" s={15} c="#34d399" />
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#34d399' }}>{kpis.qualifiedLeads ?? 0}</div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>Passed qualification threshold</div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--t3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Open Deals</span>
                <I n="briefcase" s={15} c="#a78bfa" />
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#fff' }}>{kpis.openDeals ?? 0}</div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>Active in sales pipeline</div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--t3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Won Deals</span>
                <I n="spark" s={15} c="#fbbf24" />
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#fbbf24' }}>{kpis.wonDeals ?? 0}</div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>Closed won deals</div>
            </div>
          </div>

          {/* Secondary Financial & Conversion Metrics */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 16,
            marginBottom: 28,
          }}>
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '14px 18px' }}>
              <div style={{ fontSize: 11, color: 'var(--t3)' }}>Pipeline Value</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 3 }}>
                {fmtMoney(kpis.openPipelineTotal ?? 0, { dash: fmtMoney(0) })}
              </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '14px 18px' }}>
              <div style={{ fontSize: 11, color: 'var(--t3)' }}>Closed Won Value</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#10b981', marginTop: 3 }}>
                {fmtMoney(kpis.closedWonMonthly ?? 0, { dash: fmtMoney(0) })}
              </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '14px 18px' }}>
              <div style={{ fontSize: 11, color: 'var(--t3)' }}>Lead → Deal Conversion</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#35e8f2', marginTop: 3 }}>
                {kpis.conversionRate ?? 0}%
              </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '14px 18px' }}>
              <div style={{ fontSize: 11, color: 'var(--t3)' }}>Win Rate (90d)</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 3 }}>
                {kpis.winRate90d ?? 0}%
              </div>
            </div>
          </div>

          {/* Activity / Call Performance Strip */}
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 8,
            padding: '16px 20px',
            marginBottom: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Team Touchpoints & Tasks:</span>
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ color: '#60a5fa', fontSize: 13 }}>📞</span>
                <span style={{ fontSize: 12.5, color: 'var(--t2)' }}><strong>{act.calls || 0}</strong> Calls Logged</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ color: '#f59e0b', fontSize: 13 }}>📝</span>
                <span style={{ fontSize: 12.5, color: 'var(--t2)' }}><strong>{act.notes || 0}</strong> Notes Added</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ color: '#a78bfa', fontSize: 13 }}>📅</span>
                <span style={{ fontSize: 12.5, color: 'var(--t2)' }}><strong>{act.meetings || 0}</strong> Meetings</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ color: '#f87171', fontSize: 13 }}>🔴</span>
                <span style={{ fontSize: 12.5, color: act.overdueTasks > 0 ? '#f87171' : 'var(--t2)' }}>
                  <strong>{act.overdueTasks || 0}</strong> Overdue Tasks
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ color: '#34d399', fontSize: 13 }}>✅</span>
                <span style={{ fontSize: 12.5, color: 'var(--t2)' }}><strong>{act.completedTasks || 0}</strong> Completed Tasks</span>
              </div>
            </div>
          </div>

          {/* Charts Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 24, marginBottom: 32 }}>
            {/* Area Chart: Closed Won vs New Pipeline */}
            <div>
              <div style={{ marginBottom: 14 }}>
                <h3 style={{ fontSize: 13.5, fontWeight: 600, color: '#fff', margin: '0 0 4px 0' }}>Closed won vs. new pipeline</h3>
                <p style={{ fontSize: 11, color: 'var(--t3)', margin: 0 }}>Monthly trend of new pipeline value vs closed won revenue</p>
              </div>
              <div style={{ height: 260, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '20px 16px 16px 0', background: 'rgba(255,255,255,0.02)' }}>
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

            {/* Donut Chart: Open pipeline by stage */}
            <div>
              <div style={{ marginBottom: 14 }}>
                <h3 style={{ fontSize: 13.5, fontWeight: 600, color: '#fff', margin: '0 0 4px 0' }}>Open pipeline by stage</h3>
                <p style={{ fontSize: 11, color: 'var(--t3)', margin: 0 }}>Distribution of active opportunities</p>
              </div>
              <div style={{ height: 260, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '20px', background: 'rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ height: 120, marginBottom: 14, position: 'relative' }}>
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
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{fmtMoneyShort(kpis.openPipelineTotal ?? 0)}</span>
                    <span style={{ fontSize: 10, color: 'var(--t3)' }}>open</span>
                  </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {(charts.openPipelineByStage || []).map((entry, index) => (
                    <div key={entry.stage} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 11 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: PIE_COLORS[index % PIE_COLORS.length] }} />
                        <span style={{ color: 'var(--t2)' }}>{STAGE_LABELS[entry.stage] || entry.stage}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 14 }}>
                        <span style={{ color: 'var(--t3)' }}>{entry.count}</span>
                        <span style={{ color: '#fff', fontWeight: 600 }}>{fmtMoneyShort(entry.value)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Deals In Progress & Recent Activity */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24, marginBottom: 32 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <h3 style={{ fontSize: 13.5, fontWeight: 600, color: '#fff', margin: 0 }}>Top deals in progress</h3>
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('app:nav', { detail: 'deals' }))}
                  style={{ background: 'none', border: 'none', color: 'var(--accent, #35e8f2)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
                >
                  View pipeline →
                </button>
              </div>
              <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, background: 'rgba(255,255,255,0.02)', overflow: 'hidden' }}>
                {(data?.dealsInProgress || []).length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--t3)', fontSize: 12.5 }}>No open deals in progress.</div>
                ) : (
                  (data?.dealsInProgress || []).map((d) => (
                    <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{d.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>{d.company} · {d.ageDays}d old</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{fmtMoney(d.value)}</div>
                        <span style={{ fontSize: 10, color: STAGE_COLORS[d.stage] || '#fff', fontWeight: 600 }}>{STAGE_LABELS[d.stage] || d.stage}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <h3 style={{ fontSize: 13.5, fontWeight: 600, color: '#fff', margin: 0 }}>Recent Activity</h3>
                <span style={{ fontSize: 11, color: 'var(--t3)' }}>Live feed</span>
              </div>
              <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, background: 'rgba(255,255,255,0.02)', padding: '12px 16px', maxHeight: 310, overflowY: 'auto' }}>
                {(data?.recentActivity || []).length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--t3)', fontSize: 12.5 }}>No recent activities logged.</div>
                ) : (
                  (data?.recentActivity || []).map((a) => (
                    <div key={a.id} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 11.5 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fff', fontWeight: 600 }}>
                        <span>{a.activity}</span>
                        <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 400 }}>{formatTimeAgo(new Date(a.when))}</span>
                      </div>
                      <div style={{ color: 'var(--t3)', marginTop: 2 }}>{a.details}</div>
                      <div style={{ fontSize: 10, color: 'var(--t2)', marginTop: 2 }}>By {a.who} {a.deal !== '-' && `· ${a.deal}`}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: LEAD SOURCE PERFORMANCE (Gap Analysis Part 1, Page 14)             */}
      {/* ========================================================================= */}
      {activeTab === 'source_performance' && (
        <div>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: '0 0 6px 0' }}>
              Lead Source to Revenue Funnel
            </h2>
            <p style={{ fontSize: 12.5, color: 'var(--t2)', margin: 0 }}>
              End-to-end attribution from customer acquisition source to qualified pipeline, won deals, and revenue.
            </p>
          </div>

          {/* Summary Table */}
          <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden', background: 'rgba(255,255,255,0.02)', marginBottom: 28 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'var(--t3)' }}>
                  <th style={{ padding: '12px 18px', fontWeight: 600 }}>Acquisition Source</th>
                  <th style={{ padding: '12px 18px', fontWeight: 600 }}>Total Leads</th>
                  <th style={{ padding: '12px 18px', fontWeight: 600 }}>Qualified Leads</th>
                  <th style={{ padding: '12px 18px', fontWeight: 600 }}>Deals Created</th>
                  <th style={{ padding: '12px 18px', fontWeight: 600 }}>Won Deals</th>
                  <th style={{ padding: '12px 18px', fontWeight: 600 }}>Won Revenue</th>
                  <th style={{ padding: '12px 18px', fontWeight: 600 }}>Conversion %</th>
                </tr>
              </thead>
              <tbody>
                {sourcePerformance.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 32, textAlign: 'center', color: 'var(--t3)' }}>
                      No lead source data available in this timeframe.
                    </td>
                  </tr>
                ) : (
                  sourcePerformance.map((row, i) => {
                    const conv = row.leads > 0 ? ((row.won / row.leads) * 100).toFixed(1) : 0;
                    return (
                      <tr key={row.source} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 1 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
                        <td style={{ padding: '12px 18px', fontWeight: 600, color: '#fff' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: PIE_COLORS[i % PIE_COLORS.length] }} />
                            {row.source}
                          </span>
                        </td>
                        <td style={{ padding: '12px 18px', color: 'var(--t1)' }}>{row.leads}</td>
                        <td style={{ padding: '12px 18px', color: '#34d399' }}>{row.qualified}</td>
                        <td style={{ padding: '12px 18px', color: 'var(--t1)' }}>{row.deals}</td>
                        <td style={{ padding: '12px 18px', color: '#fbbf24', fontWeight: 700 }}>{row.won}</td>
                        <td style={{ padding: '12px 18px', color: '#10b981', fontWeight: 700 }}>{fmtMoney(row.revenue)}</td>
                        <td style={{ padding: '12px 18px', color: '#35e8f2', fontWeight: 600 }}>{conv}%</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Bar Chart Visualization */}
          <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '20px', background: 'rgba(255,255,255,0.02)' }}>
            <h3 style={{ fontSize: 13.5, fontWeight: 600, color: '#fff', margin: '0 0 16px 0' }}>Leads Volume vs. Closed Won by Source</h3>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sourcePerformance} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="source" stroke="rgba(255,255,255,0.2)" fontSize={11} tickMargin={10} axisLine={false} tickLine={false} />
                  <YAxis stroke="rgba(255,255,255,0.2)" fontSize={11} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 12, color: '#fff' }} />
                  <Bar dataKey="leads" name="Total Leads" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="won" name="Won Deals" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: CUSTOM REPORTS & CHART LIBRARY (Gap Analysis Part 2, Page 26-27)   */}
      {/* ========================================================================= */}
      {activeTab === 'custom_reports' && (
        <div>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: '0 0 6px 0' }}>
              Custom Reports & Chart Library
            </h2>
            <p style={{ fontSize: 12.5, color: 'var(--t2)', margin: 0 }}>
              Select prebuilt analytics templates or configure dynamic CRM metric visualizations across leads, deals, and activities.
            </p>
          </div>

          {/* Prebuilt Templates Quick Cards */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 12, color: 'var(--t3)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 10 }}>
              Quick Templates
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
              {reportTemplates.map((tmpl) => (
                <div
                  key={tmpl.id}
                  onClick={() => handleApplyTemplate(tmpl)}
                  style={{
                    padding: '14px 16px',
                    background: selectedTemplate === tmpl.id ? 'rgba(53,232,242,0.08)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${selectedTemplate === tmpl.id ? 'var(--accent, #35e8f2)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: 8,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 4 }}>{tmpl.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.4 }}>{tmpl.description}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Report Configuration Bar */}
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            padding: '16px 20px',
            marginBottom: 24,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 14,
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600 }}>Entity</span>
              <select
                value={reportConfig.entity}
                onChange={(e) => {
                  const val = e.target.value;
                  const newCfg = {
                    ...reportConfig,
                    entity: val,
                    groupBy: val === 'deals' ? 'stage' : val === 'activities' ? 'type' : 'owner',
                  };
                  setReportConfig(newCfg);
                  runReport(newCfg);
                }}
                style={{ background: '#111', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', padding: '6px 12px', borderRadius: 6, fontSize: 12 }}
              >
                <option value="leads">Leads</option>
                <option value="deals">Deals</option>
                <option value="activities">Activities</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600 }}>Metric</span>
              <select
                value={reportConfig.metric}
                onChange={(e) => {
                  const newCfg = { ...reportConfig, metric: e.target.value };
                  setReportConfig(newCfg);
                  runReport(newCfg);
                }}
                style={{ background: '#111', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', padding: '6px 12px', borderRadius: 6, fontSize: 12 }}
              >
                <option value="count">Count (Volume)</option>
                {reportConfig.entity === 'deals' && <option value="sum_value">Total Value (₹)</option>}
                {reportConfig.entity === 'leads' && <option value="avg_score">Average Lead Score</option>}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600 }}>Group By</span>
              <select
                value={reportConfig.groupBy}
                onChange={(e) => {
                  const newCfg = { ...reportConfig, groupBy: e.target.value };
                  setReportConfig(newCfg);
                  runReport(newCfg);
                }}
                style={{ background: '#111', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', padding: '6px 12px', borderRadius: 6, fontSize: 12 }}
              >
                {reportConfig.entity === 'leads' && (
                  <>
                    <option value="owner">Sales Owner</option>
                    <option value="source">Source Channel</option>
                    <option value="category">Category (HOT/WARM/COLD)</option>
                    <option value="status">Lifecycle Status</option>
                  </>
                )}
                {reportConfig.entity === 'deals' && (
                  <>
                    <option value="stage">Pipeline Stage</option>
                    <option value="owner">Deal Owner</option>
                  </>
                )}
                {reportConfig.entity === 'activities' && (
                  <option value="type">Activity Type</option>
                )}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600 }}>Chart Type</span>
              <select
                value={reportConfig.chartType}
                onChange={(e) => setReportConfig({ ...reportConfig, chartType: e.target.value })}
                style={{ background: '#111', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', padding: '6px 12px', borderRadius: 6, fontSize: 12 }}
              >
                <option value="bar">Bar Chart</option>
                <option value="pie">Pie Chart</option>
                <option value="table">Data Table</option>
              </select>
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
              <input
                type="text"
                placeholder="Name this report..."
                value={saveReportName}
                onChange={(e) => setSaveReportName(e.target.value)}
                style={{ background: '#111', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', padding: '6px 12px', borderRadius: 6, fontSize: 12, width: 170 }}
              />
              <button
                onClick={handleSaveReport}
                disabled={savingReport || !saveReportName.trim()}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'var(--accent, #35e8f2)',
                  color: '#060A10',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: saveReportName.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                {savingReport ? 'Saving...' : 'Save Report'}
              </button>
            </div>
          </div>

          {reportMsg && (
            <div style={{ padding: '8px 14px', background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52, 211, 153, 0.3)', color: '#34d399', borderRadius: 6, fontSize: 12, marginBottom: 16 }}>
              {reportMsg}
            </div>
          )}

          {/* Chart Display Area */}
          <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '24px', background: 'rgba(255,255,255,0.02)', marginBottom: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#fff', margin: '0 0 4px 0' }}>
                  {reportConfig.entity.toUpperCase()} grouped by {reportConfig.groupBy.toUpperCase()}
                </h3>
                <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>
                  Total metric volume: <strong>{reportData?.total ?? 0}</strong>
                </span>
              </div>
            </div>

            {reportLoading ? (
              <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)' }}>
                Generating report...
              </div>
            ) : !reportData || reportData.rows.length === 0 ? (
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', fontSize: 13 }}>
                No records found matching current query configuration.
              </div>
            ) : reportConfig.chartType === 'pie' ? (
              <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={reportData.rows} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={85} label={({ label, value }) => `${label}: ${value}`}>
                      {reportData.rows.map((entry, idx) => (
                        <Cell key={`cell-${idx}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 12, color: '#fff' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : reportConfig.chartType === 'bar' ? (
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={reportData.rows} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="label" stroke="rgba(255,255,255,0.2)" fontSize={11} tickMargin={10} axisLine={false} tickLine={false} />
                    <YAxis stroke="rgba(255,255,255,0.2)" fontSize={11} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 12, color: '#fff' }} />
                    <Bar dataKey="value" name={reportConfig.metric} fill="var(--accent, #35e8f2)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'var(--t3)' }}>
                    <th style={{ padding: '10px 14px' }}>Segment / Group</th>
                    <th style={{ padding: '10px 14px' }}>Metric Value</th>
                    <th style={{ padding: '10px 14px' }}>Share %</th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.rows.map((r, i) => {
                    const share = reportData.total > 0 ? ((r.value / reportData.total) * 100).toFixed(1) : 0;
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '10px 14px', color: '#fff', fontWeight: 600 }}>{r.label}</td>
                        <td style={{ padding: '10px 14px', color: 'var(--accent, #35e8f2)', fontWeight: 700 }}>{r.value}</td>
                        <td style={{ padding: '10px 14px', color: 'var(--t2)' }}>{share}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Saved Reports Section */}
          {savedReports.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--t3)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 10 }}>
                Saved Reports
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                {savedReports.map((sr) => (
                  <div
                    key={sr.id}
                    onClick={() => {
                      if (sr.config) {
                        setReportConfig(sr.config);
                        runReport(sr.config);
                      }
                    }}
                    style={{
                      padding: '12px 16px',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 8,
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{sr.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>By {sr.author || 'Me'}</div>
                    </div>
                    <button
                      onClick={(e) => handleDeleteSavedReport(sr.id, e)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
                      title="Delete saved report"
                    >
                      <I n="trash" s={13} c="#f87171" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action Center Drawer */}
      {drawerOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={() => setDrawerOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }} />
          <div style={{ position: 'relative', width: 440, maxWidth: '100%', height: '100%', background: '#121212', borderLeft: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', zIndex: 1 }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Action Center</div>
                <div style={{ fontSize: 11, color: 'var(--t3)' }}>Urgent recommendations & overdue tasks</div>
              </div>
              <button onClick={() => setDrawerOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--t2)', cursor: 'pointer', padding: 6 }}>
                <I n="x" s={18} c="var(--t2)" />
              </button>
            </div>

            <div style={{ display: 'flex', padding: '0 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', gap: 20 }}>
              <button
                onClick={() => setDrawerTab('actions')}
                style={{
                  padding: '12px 4px',
                  background: 'none',
                  border: 'none',
                  borderBottom: drawerTab === 'actions' ? '2px solid var(--accent, #35e8f2)' : '2px solid transparent',
                  color: drawerTab === 'actions' ? '#fff' : 'var(--t3)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Do Next {urgentActionsTotal > 0 && `(${urgentActionsTotal})`}
              </button>
              <button
                onClick={() => setDrawerTab('overdue')}
                style={{
                  padding: '12px 4px',
                  background: 'none',
                  border: 'none',
                  borderBottom: drawerTab === 'overdue' ? '2px solid var(--accent, #35e8f2)' : '2px solid transparent',
                  color: drawerTab === 'overdue' ? '#fff' : 'var(--t3)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Overdue Tasks {tasks.length > 0 && `(${tasks.length})`}
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
              {drawerTab === 'actions' ? (
                <NextBestActions limit={25} onTotalChange={setUrgentActionsTotal} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {tasks.map((task) => (
                    <div key={task.id} style={{ padding: '12px 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{task.title}</div>
                      <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>Due {new Date(task.dueDate).toLocaleDateString()}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Integration Health Modal */}
      {showHealthModal && (
        <CrmIntegrationHealthModal onClose={() => setShowHealthModal(false)} />
      )}
    </div>
  );
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
