import { useState, useEffect } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';

const card = { background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', boxShadow:'var(--card-shadow)' };

const barColor = r => r > 97 ? 'var(--green)' : r >= 93 ? '#fbbf24' : '#f87171';

const KpiCard = ({ icon, iconColor, label, value, suffix = '' }) => (
  <div style={{ ...card, padding:'20px' }}>
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 }}>
      <div style={{ width:36, height:36, borderRadius:9, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <I n={icon} s={16} c={iconColor} />
      </div>
    </div>
    <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:28, color:'var(--t1)', marginBottom:3, letterSpacing:'-.03em' }}>{value}{suffix}</div>
    <div style={{ fontSize:12, color:'var(--t2)' }}>{label}</div>
  </div>
);

const Avatar = ({ name='?', size=28 }) => {
  const init = name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  const colors = ['#1EBF5E','#0EA5E9','#A78BFA','#F59E0B','#F472B6'];
  const c = colors[init.charCodeAt(0) % colors.length];
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:`${c}18`, border:`1.5px solid ${c}44`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:size*.33+'px', fontWeight:700, color:c, flexShrink:0 }}>
      {init}
    </div>
  );
};

export default function AnalyticsView() {
  const [kpi, setKpi]             = useState(null);
  const [delivery, setDelivery]   = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [agents, setAgents]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (stored) {
      try { setCurrentUser(JSON.parse(stored)); } catch { setCurrentUser(null); }
    }
  }, []);

  const loadData = () => {
    Promise.all([
      wFetch('/analytics/overview').then(r=>r.ok&&r.json()).catch(()=>null),
      wFetch('/analytics/delivery').then(r=>r.ok&&r.json()).catch(()=>null),
      wFetch('/analytics/campaigns').then(r=>r.ok&&r.json()).catch(()=>null),
      wFetch('/analytics/agents').then(r=>r.ok&&r.json()).catch(()=>null),
    ]).then(([ov, del, camp, ag]) => {
      if (ov)  setKpi(ov);
      if (Array.isArray(del))  setDelivery(del);
      if (Array.isArray(camp)) setCampaigns(camp);
      if (Array.isArray(ag))   setAgents(ag);
      setLoading(false);
    });
  };

  useEffect(() => {
    loadData();
    
    const onDataUpdated = (e) => {
      if (e.detail?.campaigns || e.detail?.templates) {
        loadData();
      }
    };
    window.addEventListener('app:data-updated', onDataUpdated);
    return () => window.removeEventListener('app:data-updated', onDataUpdated);
  }, []);

  const currentAgent = currentUser ? agents.find(a => a.agentId === currentUser.id) : null;
  const maxBar = delivery.length ? Math.max(...delivery.map(d => d.sent)) : 1;
  const BAR_H  = 100;

  const today = () => new Date().toISOString().slice(0, 10);

  // Wrap in quotes and double any embedded quote — campaign and agent names
  // routinely contain commas, which would otherwise shift every later column.
  const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const downloadCsv = () => {
    const rows = [
      ['Section', 'Metric', 'Value'],
      ['Overview', 'Messages Sent', kpi?.messagesSent ?? 0],
      ['Overview', 'Delivery Rate (%)', kpi?.deliveryRate ?? 0],
      ['Overview', 'Opt-out Rate (%)', kpi?.optOutRate ?? 0],
      ['Overview', 'Total Contacts', kpi?.totalContacts ?? 0],
      [],
      ['7-Day Delivery', 'Day', 'Sent', 'Delivered', 'Delivery Rate (%)'],
      ...delivery.map(d => ['7-Day Delivery', d.date, d.sent, d.delivered, d.rate]),
      [],
      ['Campaign Performance', 'Campaign', 'Sent', 'Delivered', 'Read', 'Failed', 'Recipients'],
      ...campaigns.map(c => ['Campaign Performance', c.name, c.sent, c.delivered, c.read, c.failed, c.totalContacts]),
      [],
      ['Agent Performance', 'Agent', 'Chats Handled'],
      ...agents.map(a => ['Agent Performance', a.name, a.chatsHandled]),
    ];
    const csv = rows.map(r => r.map(csvCell).join(',')).join('\n');
    // BOM so Excel opens UTF-8 names (and the ₹ sign) correctly.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `analytics-${today()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Same approach the invoice download already uses (settings.service.js):
  // build a print-styled document and let the browser's Print → Save as PDF
  // produce the file, rather than pulling in a PDF library.
  const downloadPdf = () => {
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
    const win = window.open('', '_blank');
    if (!win) return; // popup blocked — nothing we can do from here
    win.document.write(`<!doctype html><html><head><meta charset="utf-8">
<title>ChatFlow Pro — Analytics ${esc(today())}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color:#111827; margin:0; padding:32px; }
  h1 { font-size:20px; margin:0 0 4px; letter-spacing:-.02em; }
  h2 { font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:#6b7280; margin:28px 0 8px; }
  .muted { color:#6b7280; font-size:13px; margin:0 0 8px; }
  .kpis { display:flex; gap:12px; flex-wrap:wrap; margin-top:16px; }
  .kpi { border:1px solid #e5e7eb; border-radius:10px; padding:12px 16px; min-width:130px; }
  .kpi span { display:block; font-size:11px; color:#6b7280; text-transform:uppercase; letter-spacing:.06em; }
  .kpi strong { font-size:22px; }
  table { width:100%; border-collapse:collapse; margin-top:4px; }
  th, td { padding:8px 10px; text-align:left; font-size:13px; border-bottom:1px solid #e5e7eb; }
  th { background:#f9fafb; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#6b7280; }
  td.n, th.n { text-align:right; }
  .foot { margin-top:28px; font-size:12px; color:#6b7280; }
  @media print { body { padding:0; } }
</style></head><body>
  <h1>ChatFlow Pro — Analytics</h1>
  <p class="muted">Generated ${esc(new Date().toLocaleString('en-IN'))}</p>
  <div class="kpis">
    <div class="kpi"><span>Messages Sent</span><strong>${esc((kpi?.messagesSent ?? 0).toLocaleString())}</strong></div>
    <div class="kpi"><span>Delivery Rate</span><strong>${esc(kpi?.deliveryRate ?? 0)}%</strong></div>
    <div class="kpi"><span>Opt-out Rate</span><strong>${esc(kpi?.optOutRate ?? 0)}%</strong></div>
    <div class="kpi"><span>Total Contacts</span><strong>${esc((kpi?.totalContacts ?? 0).toLocaleString())}</strong></div>
  </div>

  <h2>7-Day Message Delivery</h2>
  <table><thead><tr><th>Day</th><th class="n">Sent</th><th class="n">Delivered</th><th class="n">Rate</th></tr></thead><tbody>
    ${delivery.map(d => `<tr><td>${esc(d.date)}</td><td class="n">${esc(d.sent)}</td><td class="n">${esc(d.delivered)}</td><td class="n">${esc(d.rate)}%</td></tr>`).join('') || '<tr><td colspan="4">No sends in the last 7 days.</td></tr>'}
  </tbody></table>

  <h2>Campaign Performance</h2>
  <table><thead><tr><th>Campaign</th><th class="n">Sent</th><th class="n">Delivered</th><th class="n">Read</th><th class="n">Failed</th></tr></thead><tbody>
    ${campaigns.map(c => `<tr><td>${esc(c.name)}</td><td class="n">${esc(c.sent)}</td><td class="n">${esc(c.delivered)}</td><td class="n">${esc(c.read)}</td><td class="n">${esc(c.failed)}</td></tr>`).join('') || '<tr><td colspan="5">No campaigns yet.</td></tr>'}
  </tbody></table>

  <h2>Agent Performance</h2>
  <table><thead><tr><th>Agent</th><th class="n">Chats Handled</th></tr></thead><tbody>
    ${agents.map(a => `<tr><td>${esc(a.name)}</td><td class="n">${esc(a.chatsHandled)}</td></tr>`).join('') || '<tr><td colspan="2">No agent activity yet.</td></tr>'}
  </tbody></table>

  <p class="foot">Choose Print → Save as PDF to keep a copy.</p>
</body></html>`);
    win.document.close();
    win.focus();
    // Let the document lay out before the print dialog measures it.
    setTimeout(() => win.print(), 250);
  };

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ height:58, borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', padding:'0 28px', flexShrink:0, background:'var(--surf)' }}>
        <h1 style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:16, color:'var(--t1)', letterSpacing:'-.02em' }}>Analytics</h1>
        <p style={{ fontSize:11.5, color:'var(--t2)', marginLeft:10 }}>Performance insights &amp; metrics</p>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'24px 28px', display:'flex', flexDirection:'column', gap:18 }}>

        {loading && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'60px 0', color:'var(--t2)' }}>
            <div style={{ width:28, height:28, border:'2px solid var(--green)', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 1s linear infinite', marginRight:12 }} />
            Loading analytics…
          </div>
        )}

        {!loading && (
        <>
        {/* KPI grid */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
          {kpi ? <>
            <KpiCard icon="msg"   iconColor="var(--green)"  label="Messages Sent"  value={(kpi.messagesSent ?? 0).toLocaleString()} />
            <KpiCard icon="chart" iconColor="#38bdf8"       label="Delivery Rate"  value={kpi.deliveryRate ?? 0} suffix="%" />
            <KpiCard icon="ban"   iconColor="#f87171"       label="Opt-out Rate"   value={kpi.optOutRate   ?? 0} suffix="%" />
            <KpiCard icon="users" iconColor="#A78BFA"       label="Total Contacts" value={(kpi.totalContacts ?? 0).toLocaleString()} />
          </> : (
            <div style={{ gridColumn:'1/-1', textAlign:'center', padding:'20px', color:'var(--t2)', fontSize:13 }}>No overview data yet.</div>
          )}
        </div>

        {/* User analytics summary */}
        <div style={{ ...card, padding:'20px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
            <div>
              <h3 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)', marginBottom:4 }}>User Analytics</h3>
              <p style={{ fontSize:12, color:'var(--t2)' }}>Team activity and agent performance for the workspace.</p>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
            <div style={{ padding:'18px', borderRadius:'16px', background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)' }}>
              <div style={{ fontSize:11, color:'var(--t2)', marginBottom:6, textTransform:'uppercase', letterSpacing:'.08em' }}>Active users</div>
              <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:28, color:'var(--t1)' }}>{agents.length}</div>
            </div>
            <div style={{ padding:'18px', borderRadius:'16px', background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)' }}>
              <div style={{ fontSize:11, color:'var(--t2)', marginBottom:6, textTransform:'uppercase', letterSpacing:'.08em' }}>Chats handled</div>
              <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:28, color:'var(--t1)' }}>{agents.reduce((sum, agent) => sum + (agent.chatsHandled ?? 0), 0)}</div>
            </div>
            <div style={{ padding:'18px', borderRadius:'16px', background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)' }}>
              <div style={{ fontSize:11, color:'var(--t2)', marginBottom:6, textTransform:'uppercase', letterSpacing:'.08em' }}>Top performer</div>
              <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:18, color:'var(--t1)' }}>{agents.length ? agents.reduce((best, agent) => (agent.chatsHandled ?? 0) > (best.chatsHandled ?? 0) ? agent : best, agents[0]).name : 'No data'}</div>
            </div>
          </div>
        </div>

        {/* Current user analytics */}
        <div style={{ ...card, padding:'20px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
            <div>
              <h3 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)', marginBottom:4 }}>Your activity</h3>
              <p style={{ fontSize:12, color:'var(--t2)' }}>Personal metrics for your account.</p>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
            <div style={{ padding:'18px', borderRadius:'16px', background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)' }}>
              <div style={{ fontSize:11, color:'var(--t2)', marginBottom:6, textTransform:'uppercase', letterSpacing:'.08em' }}>Your chats</div>
              <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:28, color:'var(--t1)' }}>{currentAgent ? (currentAgent.chatsHandled ?? 0) : '0'}</div>
            </div>
            <div style={{ padding:'18px', borderRadius:'16px', background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)' }}>
              <div style={{ fontSize:11, color:'var(--t2)', marginBottom:6, textTransform:'uppercase', letterSpacing:'.08em' }}>Your rank</div>
              <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:18, color:'var(--t1)' }}>
                {currentAgent ? `${agents.filter(a => (a.chatsHandled ?? 0) > (currentAgent.chatsHandled ?? 0)).length + 1}/${agents.length}` : 'N/A'}
              </div>
            </div>
            <div style={{ padding:'18px', borderRadius:'16px', background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)' }}>
              <div style={{ fontSize:11, color:'var(--t2)', marginBottom:6, textTransform:'uppercase', letterSpacing:'.08em' }}>{currentUser ? `${currentUser.name}` : 'User'}</div>
              <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:18, color:'var(--t1)' }}>{currentAgent ? currentAgent.chatsHandled ?? 0 : 'No data'}</div>
            </div>
          </div>
        </div>

        {/* Bar chart */}
        <div style={{ ...card, padding:'22px 24px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:22 }}>
            <div>
              <h3 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)', marginBottom:3 }}>7-Day Message Delivery Rate</h3>
              <p style={{ fontSize:12, color:'var(--t2)' }}>Daily breakdown of delivery performance</p>
            </div>
            <Btn variant="outline" size="sm" onClick={downloadCsv}>
              <I n="download" s={13} c="var(--t2)" />
              CSV
            </Btn>
          </div>

          {delivery.every(d => d.sent === 0) && (
            <p style={{ textAlign:'center', padding:'30px 0', color:'var(--t3)', fontSize:12 }}>No campaign sends in the last 7 days yet.</p>
          )}
          {/* bars */}
          <div style={{ display:'flex', gap:8, alignItems:'flex-end', height:BAR_H+48 }}>
            {delivery.map(d => {
              const h = Math.max(8, (d.sent / maxBar) * BAR_H);
              const bc = barColor(d.rate);
              return (
                <div key={d.date} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                  <span style={{ fontSize:11, fontWeight:700, color:bc }}>{d.rate}%</span>
                  <div style={{ width:'100%', maxWidth:48 }}>
                    <div style={{ height:h, borderRadius:'6px 6px 0 0', background:bc, opacity:0.85, transition:'height .3s', position:'relative' }}>
                      <div style={{ position:'absolute', inset:0, borderRadius:'6px 6px 0 0', background:'linear-gradient(180deg,rgba(255,255,255,0.12) 0%,transparent 100%)' }} />
                    </div>
                  </div>
                  <span style={{ fontSize:11, color:'var(--t3)', fontWeight:500, textAlign:'center' }}>{d.date}</span>
                </div>
              );
            })}
          </div>

          {/* legend */}
          <div style={{ display:'flex', gap:20, marginTop:16, paddingTop:14, borderTop:'1px solid var(--bd)', flexWrap:'wrap' }}>
            {[['var(--green)','> 97% Excellent'],['#fbbf24','93–97% Warning'],['#f87171','< 93% Critical']].map(([c,l]) => (
              <div key={l} style={{ display:'flex', alignItems:'center', gap:6 }}>
                <div style={{ width:10, height:10, borderRadius:3, background:c, flexShrink:0 }} />
                <span style={{ fontSize:11, color:'var(--t2)' }}>{l}</span>
              </div>
            ))}
          </div>
        </div>

        {/* bottom two-column */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          {/* Campaign performance */}
          <div style={{ ...card, padding:'20px' }}>
            <h3 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:14, color:'var(--t1)', marginBottom:18 }}>Campaign Performance</h3>
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {campaigns.map(c => {
                const pct = c.totalContacts > 0 ? Math.round((c.delivered / c.totalContacts) * 100) : 0;
                return (
                  <div key={c.id}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
                      <span style={{ fontSize:13, fontWeight:600, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'60%' }}>{c.name}</span>
                      <span style={{ fontSize:12, color:'var(--t2)', flexShrink:0 }}>{pct}% delivered</span>
                    </div>
                    <div style={{ height:5, borderRadius:4, background:'rgba(255,255,255,0.06)', overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${pct}%`, borderRadius:4, background:'var(--green)', transition:'width .4s' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Agent performance */}
          <div style={{ ...card, overflow:'hidden' }}>
            <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--bd)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <h3 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:14, color:'var(--t1)' }}>Agent Performance</h3>
              <Btn variant="outline" size="sm" onClick={downloadPdf}>
                <I n="download" s={13} c="var(--t2)" />
                PDF
              </Btn>
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ borderBottom:'1px solid var(--bd)' }}>
                  <th style={{ padding:'9px 16px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.07em' }}>Agent</th>
                  <th style={{ padding:'9px 16px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.07em' }}>Chats Handled</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a, i) => (
                  <tr key={a.agentId} style={{ borderBottom: i < agents.length-1 ? '1px solid var(--bd)' : 'none' }}>
                    <td style={{ padding:'11px 16px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <Avatar name={a.name} />
                        <span style={{ fontSize:13, fontWeight:500, color:'var(--t1)' }}>{a.name}</span>
                      </div>
                    </td>
                    <td style={{ padding:'11px 16px' }}>
                      <span style={{ padding:'3px 10px', borderRadius:6, fontSize:12, fontWeight:700, background:'rgba(167,139,250,.1)', border:'1px solid rgba(167,139,250,.25)', color:'#c4b5fd' }}>{a.chatsHandled}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
