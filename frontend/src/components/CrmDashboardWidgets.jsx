import { useState, useEffect } from 'react';
import { wFetch } from '../lib/api.js';
import { I } from './Icons.jsx';
import { Btn } from './Btn.jsx';

export function CrmDashboardWidgets() {
  const [stats, setStats] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      wFetch('/crm-analytics').then(r => r.json()),
      wFetch('/tasks?isOverdue=true').then(r => r.json())
    ]).then(([statsData, tasksData]) => {
      setStats(statsData);
      setTasks(tasksData.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ padding: '24px', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>Loading CRM Analytics...</div>;
  }

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: '18px', color: '#fff', margin: 0 }}>CRM Pipeline</h3>
        <Btn outline size="sm" onClick={() => window.dispatchEvent(new CustomEvent('app:nav', { detail: 'deals' }))}>
          View Deals
        </Btn>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <StatCard title="Total Revenue (Won)" value={`₹${stats?.totalRevenue?.toLocaleString() || 0}`} icon="dollar-sign" color="var(--green)" />
        <StatCard title="Total Deals" value={stats?.totalDeals || 0} icon="briefcase" color="#0ea5e9" />
        <StatCard title="Win Rate" value={`${stats?.winRate || 0}%`} icon="target" color="#8b5cf6" />
        <StatCard title="Open Leads" value={stats?.openLeads || 0} icon="users" color="#f59e0b" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        {/* We can put a chart here eventually, but for now we'll put Top Salesperson and Overdue Tasks */}
        <div style={{ background: 'var(--gbg)', border: '1px solid var(--bd)', borderRadius: 12, padding: 20 }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', margin: '0 0 16px 0' }}>Top Salesperson</h4>
          {stats?.topSalesperson ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <I n="user" s={20} c="var(--t2)" />
              </div>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--t1)' }}>{stats.topSalesperson.name}</div>
                <div style={{ fontSize: 12, color: 'var(--t3)' }}>Leading in closed-won revenue</div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--t3)' }}>No won deals yet.</div>
          )}
        </div>

        <div style={{ background: 'var(--gbg)', border: '1px solid var(--bd)', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', margin: 0 }}>Overdue Tasks</h4>
            <Btn size="xs" outline onClick={() => window.dispatchEvent(new CustomEvent('app:nav', { detail: 'tasks' }))}>
              See All
            </Btn>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {tasks.length > 0 ? tasks.slice(0, 3).map(task => (
              <div key={task.id} style={{ display: 'flex', flexDirection: 'column', paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{task.title}</span>
                <span style={{ fontSize: 11, color: '#f87171', marginTop: 2 }}>{new Date(task.dueDate).toLocaleDateString()}</span>
              </div>
            )) : (
              <div style={{ fontSize: 13, color: 'var(--t3)' }}>No overdue tasks!</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, color }) {
  return (
    <div style={{ background: 'var(--gbg)', border: '1px solid var(--bd)', borderRadius: 12, padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{title}</span>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <I n={icon} s={16} c={color} />
        </div>
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: '#fff', fontFamily: "'Syne', sans-serif" }}>{value}</div>
    </div>
  );
}
