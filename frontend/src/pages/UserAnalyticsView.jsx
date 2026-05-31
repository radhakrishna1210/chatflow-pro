import { useState, useEffect } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';

const card = { background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', boxShadow:'var(--card-shadow)'};

const StatCard = ({ title, value, subtitle, color='var(--green)' }) => (
  <div style={{ ...card, padding:'20px' }}>
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
      <span style={{ fontSize:11, fontWeight:700, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.08em' }}>{title}</span>
      <I n="users" s={18} c={color} />
    </div>
    <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:28, color:'var(--t1)' }}>{value}</div>
    {subtitle && <p style={{ marginTop:8, fontSize:12, color:'var(--t2)' }}>{subtitle}</p>}
  </div>
);

export default function UserAnalyticsView() {
  const [currentUser, setCurrentUser] = useState(null);
  const [agents, setAgents] = useState([]);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (stored) {
      try { setCurrentUser(JSON.parse(stored)); } catch { setCurrentUser(null); }
    }

    Promise.all([
      wFetch('/analytics/overview').then(r => r.ok && r.json()).catch(() => null),
      wFetch('/analytics/agents').then(r => r.ok && r.json()).catch(() => []),
    ]).then(([ov, ag]) => {
      if (ov) setOverview(ov);
      if (Array.isArray(ag)) setAgents(ag);
      setLoading(false);
    });
  }, []);

  const currentAgent = currentUser ? agents.find(agent => agent.agentId === currentUser.id) : null;
  const totalChats = agents.reduce((sum, agent) => sum + (agent.chatsHandled ?? 0), 0);
  const rank = currentAgent
    ? agents.filter(agent => (agent.chatsHandled ?? 0) > (currentAgent.chatsHandled ?? 0)).length + 1
    : null;
  const topAgent = agents.reduce((best, agent) => (agent.chatsHandled ?? 0) > (best.chatsHandled ?? 0) ? agent : best, agents[0] || { name: 'N/A', chatsHandled: 0 });

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ height:58, borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', padding:'0 28px', background:'var(--surf)' }}>
        <div>
          <h1 style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:16, color:'var(--t1)', letterSpacing:'-.02em' }}>User Analytics</h1>
          <p style={{ fontSize:11.5, color:'var(--t2)', marginTop:2 }}>Personalized usage and performance metrics for your account.</p>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'24px 28px', display:'flex', flexDirection:'column', gap:18 }}>
        {loading && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'60px 0', color:'var(--t2)' }}>
            <div style={{ width:28, height:28, border:'2px solid var(--green)', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 1s linear infinite', marginRight:12 }} />
            Loading your analytics…
          </div>
        )}

        {!loading && (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
              <StatCard title="Your chats" value={currentAgent ? (currentAgent.chatsHandled ?? 0).toLocaleString() : '0'} subtitle="Messages you handled" />
              <StatCard title="Your rank" value={rank ? `${rank}/${agents.length}` : 'N/A'} subtitle="Position among agents" color="#38bdf8" />
              <StatCard title="Total agents" value={agents.length.toLocaleString()} subtitle="Active users in workspace" color="#A78BFA" />
              <StatCard title="Workspace chats" value={totalChats.toLocaleString()} subtitle="Total agent-handled chats" color="#f59e0b" />
            </div>

            <div style={{ ...card, padding:'22px' }}>
              <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)', marginBottom:10 }}>Current user performance</h2>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                <div style={{ padding:'18px', borderRadius:'16px', background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)' }}>
                  <div style={{ fontSize:12, color:'var(--t2)', marginBottom:8 }}>Name</div>
                  <div style={{ fontSize:18, fontWeight:700, color:'var(--t1)' }}>{currentUser?.name ?? 'Unknown user'}</div>
                </div>
                <div style={{ padding:'18px', borderRadius:'16px', background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)' }}>
                  <div style={{ fontSize:12, color:'var(--t2)', marginBottom:8 }}>Email</div>
                  <div style={{ fontSize:18, fontWeight:700, color:'var(--t1)' }}>{currentUser?.email ?? 'No email'}</div>
                </div>
                <div style={{ padding:'18px', borderRadius:'16px', background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)' }}>
                  <div style={{ fontSize:12, color:'var(--t2)', marginBottom:8 }}>Chats handled</div>
                  <div style={{ fontSize:18, fontWeight:700, color:'var(--t1)' }}>{currentAgent ? (currentAgent.chatsHandled ?? 0) : '0'}</div>
                </div>
                <div style={{ padding:'18px', borderRadius:'16px', background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)' }}>
                  <div style={{ fontSize:12, color:'var(--t2)', marginBottom:8 }}>Your rank</div>
                  <div style={{ fontSize:18, fontWeight:700, color:'var(--t1)' }}>{rank ? `${rank}/${agents.length}` : 'N/A'}</div>
                </div>
              </div>
            </div>

            <div style={{ ...card, padding:'22px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
                <div>
                  <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)' }}>Top performer</h2>
                  <p style={{ fontSize:12, color:'var(--t2)', marginTop:4 }}>Best performing agent this workspace.</p>
                </div>
                <Btn variant="outline" size="sm">Refresh</Btn>
              </div>
              <div style={{ display:'flex', gap:12, alignItems:'center' }}>
                <div style={{ width:50, height:50, borderRadius:'50%', background:'rgba(255,255,255,0.05)', border:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, color:'var(--green)' }}>
                  {topAgent.name?.slice(0,2).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize:16, fontWeight:700, color:'var(--t1)' }}>{topAgent.name || 'No data'}</div>
                  <div style={{ fontSize:12, color:'var(--t2)', marginTop:4 }}>{(topAgent.chatsHandled ?? 0).toLocaleString()} chats handled</div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
