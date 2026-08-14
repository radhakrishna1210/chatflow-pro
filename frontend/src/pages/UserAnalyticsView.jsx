import { useState, useEffect, useCallback } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';

// ─── User analytics ──────────────────────────────────────────────────────────
//
// This page is about the audience: how the contact list is growing, how much of
// it comes back, and which customers actually engage. It used to be about
// agents — a leaderboard of staff under a heading that promised customers —
// which meant the one page named for the audience never mentioned it.
//
// The agent view was not deleted. It moved to the bottom of this page as "Your
// team", because it is real information someone was using; it just was not what
// the page said it was.
//
// There is no revenue or lifetime-value column, and that is deliberate.
// Nothing in this product records what a contact spent — orders live in the
// customer's own store — so a currency figure here would be invented. The page
// measures engagement instead, and says what a revenue figure would need.

const card = { background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', boxShadow:'var(--card-shadow)' };

const StatCard = ({ title, value, subtitle, color = 'var(--green)', icon = 'users' }) => (
  <div style={{ ...card, padding:'18px 20px' }}>
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, gap:8 }}>
      <span style={{ fontFamily:'var(--mono)', fontSize:9.5, fontWeight:600, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.1em' }}>{title}</span>
      <I n={icon} s={16} c={color} />
    </div>
    <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:800, fontSize:27, color:'var(--t1)', letterSpacing:'-.02em' }}>{value}</div>
    {subtitle && <p style={{ marginTop:6, fontSize:11.5, color:'var(--t2)', lineHeight:1.5 }}>{subtitle}</p>}
  </div>
);

const SectionTitle = ({ title, sub, right }) => (
  <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:16, flexWrap:'wrap' }}>
    <div>
      <h3 style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)', letterSpacing:'-.01em' }}>{title}</h3>
      {sub && <p style={{ fontSize:12, color:'var(--t2)', marginTop:3 }}>{sub}</p>}
    </div>
    {right}
  </div>
);

const Avatar = ({ name = '?', size = 30 }) => {
  const init = String(name).split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';
  const colors = ['#35e8f2', '#9d6bff', '#c4ff46', '#F59E0B', '#F472B6'];
  const c = colors[init.charCodeAt(0) % colors.length];
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:`${c}18`, border:`1.5px solid ${c}44`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:size * 0.34, fontWeight:700, color:c, flexShrink:0 }}>
      {init}
    </div>
  );
};

// ─── growth ──────────────────────────────────────────────────────────────────

const GrowthChart = ({ growth }) => {
  const max = Math.max(1, ...growth.map(g => g.added));
  return (
    <div>
      <div style={{ display:'flex', alignItems:'flex-end', gap:6, height:150 }}>
        {growth.map((g) => (
          <div key={g.label} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:6, minWidth:0 }}>
            <span style={{ fontFamily:'var(--mono)', fontSize:9.5, color:'var(--t3)' }}>{g.added || ''}</span>
            <div title={`${g.added} added in the week of ${g.label}`}
              style={{ width:'100%', height:`${Math.max(2, (g.added / max) * 100)}%`, minHeight:2, borderRadius:'4px 4px 0 0', background:'linear-gradient(180deg, var(--cyan), rgba(53,232,242,0.25))' }} />
          </div>
        ))}
      </div>
      <div style={{ display:'flex', gap:6, marginTop:8 }}>
        {growth.map((g, i) => (
          <span key={g.label} style={{ flex:1, textAlign:'center', fontSize:9, color:'var(--t3)', minWidth:0, overflow:'hidden', whiteSpace:'nowrap' }}>
            {/* Every other label on a 12-week chart: all twelve overlap. */}
            {i % 2 === 0 ? g.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
};

// ─── cohorts ─────────────────────────────────────────────────────────────────

const CohortGrid = ({ cohorts, columns }) => (
  <div className="dash-scroll-x">
    <div style={{ minWidth: 60 + columns.length * 58 }}>
      <div style={{ display:'grid', gridTemplateColumns:`104px repeat(${columns.length}, 1fr)`, gap:4, marginBottom:6 }}>
        <span />
        {columns.map(c => (
          <span key={c} style={{ textAlign:'center', fontFamily:'var(--mono)', fontSize:9.5, color:'var(--t3)' }}>{c}</span>
        ))}
      </div>
      {cohorts.map(row => (
        <div key={row.label} style={{ display:'grid', gridTemplateColumns:`104px repeat(${columns.length}, 1fr)`, gap:4, marginBottom:4 }}>
          <span style={{ fontSize:11.5, color:'var(--t2)', display:'flex', alignItems:'center', gap:6, whiteSpace:'nowrap' }}>
            {row.label}
            <span style={{ fontFamily:'var(--mono)', fontSize:9.5, color:'var(--t3)' }}>· {row.size}</span>
          </span>
          {row.cells.map((cell, i) => (
            <span key={i} style={{
              textAlign:'center', padding:'7px 0', borderRadius:6, fontSize:11, fontWeight:600,
              fontVariantNumeric:'tabular-nums',
              // A future week is drawn as absence, not as zero — the difference
              // between "nobody came back" and "that week hasn't happened".
              background: cell == null ? 'rgba(255,255,255,0.02)' : `rgba(53,232,242,${0.08 + (cell / 100) * 0.55})`,
              color: cell == null ? 'var(--t3)' : cell > 45 ? '#06110f' : '#8fecf3',
              border: cell == null ? '1px dashed var(--bd)' : '1px solid transparent',
            }}>
              {cell == null ? '—' : `${cell}%`}
            </span>
          ))}
        </div>
      ))}
    </div>
  </div>
);

// ─── page ────────────────────────────────────────────────────────────────────

export default function UserAnalyticsView() {
  const [audience, setAudience] = useState(null);
  const [agents, setAgents] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [weeks, setWeeks] = useState(12);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (stored) {
      try { setCurrentUser(JSON.parse(stored)); } catch { setCurrentUser(null); }
    }
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      wFetch(`/analytics/audience?weeks=${weeks}`).then(r => (r.ok ? r.json() : null)).catch(() => null),
      wFetch('/analytics/agents').then(r => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([aud, ag]) => {
      if (aud) setAudience(aud);
      if (Array.isArray(ag)) setAgents(ag);
      setLoading(false);
    });
  }, [weeks]);

  useEffect(() => { load(); }, [load]);

  const currentAgent = currentUser ? agents.find(a => a.agentId === currentUser.id) : null;
  const rank = currentAgent
    ? agents.filter(a => (a.chatsHandled ?? 0) > (currentAgent.chatsHandled ?? 0)).length + 1
    : null;

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ minHeight:58, borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', padding:'10px 28px', gap:12, background:'var(--surf)', flexWrap:'wrap', flexShrink:0 }}>
        <div style={{ flex:1, minWidth:180 }}>
          <h1 style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:800, fontSize:16, color:'var(--t1)', letterSpacing:'-.02em' }}>User analytics</h1>
          <p style={{ fontSize:11.5, color:'var(--t2)', marginTop:2 }}>Audience growth, retention and engagement</p>
        </div>
        <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
          {[8, 12, 16, 26].map(w => {
            const on = weeks === w;
            return (
              <button key={w} onClick={() => setWeeks(w)}
                style={{ fontSize:12.5, fontWeight:600, padding:'7px 13px', borderRadius:8, cursor:'pointer', fontFamily:"'Manrope',sans-serif",
                         background: on ? 'var(--gbg)' : 'rgba(255,255,255,0.03)',
                         border:`1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`,
                         color: on ? 'var(--green)' : 'var(--t2)' }}>{w}w</button>
            );
          })}
          <Btn variant="outline" size="sm" onClick={load}>Refresh</Btn>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'24px 28px', display:'flex', flexDirection:'column', gap:18 }}>
        {loading && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'60px 0', color:'var(--t2)', fontSize:13 }}>
            <div style={{ width:24, height:24, border:'2px solid var(--green)', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 1s linear infinite', marginRight:12 }} />
            Loading audience analytics…
          </div>
        )}

        {!loading && audience && (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:12 }}>
              <StatCard title="Total contacts" value={audience.total.toLocaleString('en-IN')}
                subtitle={`${audience.addedThisMonth.toLocaleString('en-IN')} added in the last 30 days`} />
              <StatCard title="Opt-in rate" value={`${audience.optInRate}%`} color="#c4ff46" icon="checkc"
                subtitle={`${audience.optedIn.toLocaleString('en-IN')} reachable contacts`} />
              <StatCard title="30-day retention" value={audience.retention30 == null ? '—' : `${audience.retention30}%`} color="#9d6bff" icon="rotate"
                subtitle={audience.retention30 == null
                  ? 'Needs two months of history to compare'
                  : 'Conversations active this month vs last'} />
              <StatCard title="Active conversations" value={audience.activeLast30.toLocaleString('en-IN')} color="#f59e0b" icon="msg"
                subtitle="Threads with a message in the last 30 days" />
            </div>

            <div className="dash-split" style={{ display:'grid', gridTemplateColumns:'1.15fr 1fr', gap:14 }}>
              <div style={{ ...card, padding:'20px 22px' }}>
                <SectionTitle title="Contact growth" sub={`New contacts per week, last ${audience.weeks} weeks`} />
                <GrowthChart growth={audience.growth} />
              </div>

              <div style={{ ...card, padding:'20px 22px' }}>
                <SectionTitle title="Retention cohorts" sub="Share of each week's new contacts who wrote back in later weeks" />
                {audience.cohorts.length === 0
                  ? <p style={{ fontSize:12.5, color:'var(--t3)' }}>No contacts added in this window yet.</p>
                  : <CohortGrid cohorts={audience.cohorts} columns={audience.cohortColumns} />}
              </div>
            </div>

            <div style={{ ...card, padding:'20px 22px' }}>
              <SectionTitle
                title="Most engaged customers"
                sub="Ranked by conversations, AI chats and campaigns received"
              />
              {audience.top.length === 0 ? (
                <p style={{ fontSize:12.5, color:'var(--t3)' }}>No contacts yet.</p>
              ) : (
                <div className="dash-scroll-x">
                  <table style={{ width:'100%', borderCollapse:'collapse', minWidth:520 }}>
                    <thead>
                      <tr style={{ borderBottom:'1px solid var(--bd)' }}>
                        {['Customer', 'Conversations', 'AI chats', 'Campaigns', 'Since'].map((h, i) => (
                          <th key={h} style={{ padding:'0 12px 10px', textAlign: i === 0 ? 'left' : 'right', fontFamily:'var(--mono)', fontSize:9.5, fontWeight:600, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.08em', whiteSpace:'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {audience.top.map(c => (
                        <tr key={c.id} style={{ borderBottom:'1px solid var(--bd)' }}>
                          <td style={{ padding:'11px 12px' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
                              <Avatar name={c.name || c.phoneNumber} />
                              <div style={{ minWidth:0 }}>
                                <div style={{ fontSize:13, fontWeight:600, color:'var(--t1)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.name || c.phoneNumber}</div>
                                <div style={{ fontSize:11, color:'var(--t3)' }}>{c.phoneNumber}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding:'11px 12px', textAlign:'right', fontSize:13, color:'var(--t1)', fontVariantNumeric:'tabular-nums' }}>{c.conversations}</td>
                          <td style={{ padding:'11px 12px', textAlign:'right', fontSize:13, color:'var(--t2)', fontVariantNumeric:'tabular-nums' }}>{c.aiChats}</td>
                          <td style={{ padding:'11px 12px', textAlign:'right', fontSize:13, color:'var(--t2)', fontVariantNumeric:'tabular-nums' }}>{c.campaigns}</td>
                          <td style={{ padding:'11px 12px', textAlign:'right', fontSize:12, color:'var(--t3)', whiteSpace:'nowrap' }}>
                            {new Date(c.since).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'2-digit' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p style={{ fontSize:11, color:'var(--t3)', marginTop:12, lineHeight:1.6 }}>
                Lifetime value is not shown because nothing here records what a customer spent. Connect your store or payment
                provider under Integrations and conversion tracking can attribute revenue to the campaigns that produced it.
              </p>
            </div>

            {/* The old page, kept: it is real data and someone was reading it. */}
            <div style={{ ...card, padding:'20px 22px' }}>
              <SectionTitle title="Your team" sub="Chats handled by each member of this workspace" />
              {agents.length === 0 ? (
                <p style={{ fontSize:12.5, color:'var(--t3)' }}>No agent activity recorded yet.</p>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {agents.slice(0, 8).map(a => {
                    const isYou = currentUser && a.agentId === currentUser.id;
                    const max = Math.max(1, ...agents.map(x => x.chatsHandled ?? 0));
                    return (
                      <div key={a.agentId} style={{ display:'flex', alignItems:'center', gap:12 }}>
                        <Avatar name={a.name || '?'} size={28} />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:'flex', justifyContent:'space-between', gap:8, marginBottom:5 }}>
                            <span style={{ fontSize:12.5, color: isYou ? 'var(--t1)' : 'var(--t2)', fontWeight: isYou ? 700 : 500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                              {a.name}{isYou ? ' · you' : ''}
                            </span>
                            <span style={{ fontFamily:'var(--mono)', fontSize:11.5, color:'var(--t2)', flexShrink:0 }}>{(a.chatsHandled ?? 0).toLocaleString()}</span>
                          </div>
                          <div style={{ height:4, borderRadius:4, background:'rgba(255,255,255,0.07)', overflow:'hidden' }}>
                            <div style={{ width:`${((a.chatsHandled ?? 0) / max) * 100}%`, height:'100%', borderRadius:4, background: isYou ? 'var(--grad-cta)' : 'rgba(157,107,255,0.6)' }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {rank && (
                    <p style={{ fontSize:11.5, color:'var(--t3)', marginTop:4 }}>
                      You are {rank} of {agents.length} by chats handled.
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {!loading && !audience && (
          <div style={{ ...card, padding:30, textAlign:'center', color:'var(--t3)', fontSize:13 }}>
            Audience analytics could not be loaded. Try Refresh.
          </div>
        )}
      </div>
    </div>
  );
}
