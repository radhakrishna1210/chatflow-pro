import { useState, useEffect } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';

const card = { background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', boxShadow:'var(--card-shadow)' };

const NOTIF_OPTS = [
  { id:'newConv',         label:'New Conversation',    default:true  },
  { id:'tplApproved',    label:'Template Approved',    default:true  },
  { id:'tplRejected',    label:'Template Rejected',    default:true  },
  { id:'campaignDone',   label:'Campaign Completed',   default:false },
  { id:'highOptout',     label:'High Opt-out Alert',   default:true  },
  { id:'rateLimitWarn',  label:'Rate Limit Warning',   default:true  },
];

const SectionCard = ({ icon, title, children }) => (
  <div style={{ ...card, overflow:'hidden', flexShrink:0 }}>
    <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', gap:10 }}>
      <I n={icon} s={16} c="var(--green)" />
      <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)' }}>{title}</span>
    </div>
    <div style={{ padding:'20px' }}>{children}</div>
  </div>
);

const Toggle = ({ on, onToggle }) => (
  <div onClick={onToggle} style={{ width:38, height:21, borderRadius:20, background: on ? 'var(--green)' : 'rgba(255,255,255,0.1)', cursor:'pointer', transition:'background .2s', position:'relative', border:`1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`, flexShrink:0 }}>
    <div style={{ position:'absolute', top:2, left: on ? 19 : 2, width:15, height:15, borderRadius:'50%', background:'white', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,0.4)' }} />
  </div>
);

const FInput = ({ value, onChange, placeholder, style:ex={} }) => (
  <input value={value} onChange={onChange} placeholder={placeholder}
    style={{ width:'100%', padding:'9px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none', boxSizing:'border-box', ...ex }}
    onFocus={e=>e.target.style.borderColor='var(--gbd)'}
    onBlur={e=>e.target.style.borderColor='var(--bd)'} />
);

const Avatar = ({ name='?', size=30 }) => {
  const init = name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  const colors = ['#1EBF5E','#0EA5E9','#A78BFA','#F59E0B'];
  const c = colors[init.charCodeAt(0) % colors.length];
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:`${c}18`, border:`1.5px solid ${c}44`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:size*.33+'px', fontWeight:700, color:c, flexShrink:0 }}>
      {init}
    </div>
  );
};

const statusBadge = s => {
  const cfg = { Paid:{ bg:'var(--gbg)', bd:'var(--gbd)', c:'var(--green)' }, Pending:{ bg:'rgba(245,158,11,.1)', bd:'rgba(245,158,11,.25)', c:'#fbbf24' }, Failed:{ bg:'rgba(239,68,68,.08)', bd:'rgba(239,68,68,.2)', c:'#f87171' } };
  const v = cfg[s] || cfg.Pending;
  return <span style={{ padding:'2px 8px', borderRadius:10, fontSize:11, fontWeight:600, background:v.bg, border:`1px solid ${v.bd}`, color:v.c }}>{s}</span>;
};

export default function SettingsView() {
  const [settings, setSettings] = useState({});
  const [members, setMembers]   = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [showToken, setShowToken]   = useState(false);
  const [notifs, setNotifs]    = useState(() => Object.fromEntries(NOTIF_OPTS.map(o=>[o.id,o.default])));
  const [inviteEmail, setInviteEmail] = useState('');
  const [showInvite, setShowInvite]   = useState(false);
  const [memberRoles, setMemberRoles] = useState({});
  const [usagePerc]  = useState(34);

  useEffect(() => {
    wFetch('/settings').then(r=>r.ok&&r.json()).then(d=>{ if(d) { setSettings(d); if(d.webhookUrl) setWebhookUrl(d.webhookUrl); if(d.notifyNewConversation!=null) setNotifs({newConv:d.notifyNewConversation,tplApproved:d.notifyTemplateApproved,tplRejected:d.notifyTemplateRejected,campaignDone:d.notifyCampaignCompleted,highOptout:d.notifyHighOptout,rateLimitWarn:d.notifyRateLimit}); }}).catch(()=>{});
    wFetch('/members').then(r=>r.ok&&r.json()).then(d=>{ if(Array.isArray(d)) setMembers(d); }).catch(()=>{});
    wFetch('/settings/invoices').then(r=>r.ok&&r.json()).then(d=>{ if(Array.isArray(d)) setInvoices(d); }).catch(()=>{});
  }, []);

  const saveWebhook = async () => {
    await wFetch('/settings', { method:'PATCH', body:JSON.stringify({ webhookUrl }) }).catch(()=>{});
  };

  const delMember = id => setMembers(p=>p.filter(m=>m.userId!==id));
  const setRole = (id, role) => setMemberRoles(p=>({...p,[id]:role}));

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ height:58, borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', padding:'0 28px', flexShrink:0, background:'var(--surf)' }}>
        <h1 style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:16, color:'var(--t1)', letterSpacing:'-.02em' }}>Settings</h1>
        <p style={{ fontSize:11.5, color:'var(--t2)', marginLeft:10 }}>Workspace configuration</p>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'24px 28px', display:'flex', flexDirection:'column', gap:16, maxWidth:860 }}>

        {/* ── Webhook ── */}
        <SectionCard icon="globe" title="Webhook">
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:12, fontWeight:600, color:'var(--t2)', display:'block', marginBottom:6 }}>Webhook URL</label>
            <FInput value={webhookUrl} onChange={e=>setWebhookUrl(e.target.value)} placeholder="https://your-server.com/webhook" />
          </div>
          {settings.webhookVerifyToken && (
            <div style={{ marginBottom:14 }}>
              <label style={{ fontSize:12, fontWeight:600, color:'var(--t2)', display:'block', marginBottom:6 }}>Verify Token</label>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <span style={{ fontSize:13, fontFamily:'monospace', color:'var(--t1)', background:'rgba(255,255,255,0.04)', padding:'7px 12px', borderRadius:7, border:'1px solid var(--bd)', flex:1 }}>
                  {showToken ? settings.webhookVerifyToken : '••••••••••••••••'}
                </span>
                <button onClick={()=>setShowToken(!showToken)} style={{ width:28, height:28, borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <I n={showToken?'eyeoff':'eye'} s={13} c="var(--t2)" />
                </button>
              </div>
            </div>
          )}
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={saveWebhook}>Save</Btn>
            <Btn variant="outline">Test</Btn>
          </div>
        </SectionCard>

        {/* ── Rate Limit ── */}
        <SectionCard icon="shield" title="Rate Limit Monitor">
          <div style={{ marginBottom:10 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
              <span style={{ fontSize:13, color:'var(--t1)', fontWeight:600 }}>Daily Usage</span>
              <span style={{ fontSize:13, color:'var(--t1)', fontWeight:700 }}>{(usagePerc/100 * 10000).toLocaleString()} / 10,000</span>
            </div>
            <div style={{ height:10, borderRadius:6, background:'rgba(255,255,255,0.06)', overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${usagePerc}%`, borderRadius:6, background: usagePerc > 80 ? '#f87171' : usagePerc > 60 ? '#fbbf24' : 'var(--green)', transition:'width .5s' }} />
            </div>
            <p style={{ fontSize:11, color:'var(--t3)', marginTop:6 }}>Connect your WhatsApp number to track live usage</p>
          </div>
        </SectionCard>

        {/* ── Team Members ── */}
        <SectionCard icon="users" title="Team Members">
          <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:14 }}>
            <Btn size="sm" style={{ background:'rgba(30,191,94,0.1)', color:'var(--green)', border:'1px solid var(--gbd)' }} onClick={()=>setShowInvite(!showInvite)}>
              <I n="plus" s={13} c="var(--green)" />
              Invite
            </Btn>
          </div>
          {showInvite && (
            <div style={{ display:'flex', gap:8, marginBottom:14, padding:14, borderRadius:10, background:'rgba(255,255,255,0.02)', border:'1px solid var(--bd)' }}>
              <FInput value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="colleague@company.com" style={{ flex:1 }} />
              <Btn size="sm">Send Invite</Btn>
            </div>
          )}
          {members.length === 0 ? (
            <p style={{ fontSize:13, color:'var(--t2)', textAlign:'center', padding:'16px 0' }}>No members yet.</p>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ borderBottom:'1px solid var(--bd)' }}>
                  {['Name','Email','Role',''].map(h => (
                    <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.07em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((m,i) => (
                  <tr key={m.userId} style={{ borderBottom: i < members.length-1 ? '1px solid var(--bd)' : 'none' }}>
                    <td style={{ padding:'10px 12px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <Avatar name={m.user.name} />
                        <span style={{ fontSize:13, fontWeight:600, color:'var(--t1)' }}>{m.user.name}</span>
                      </div>
                    </td>
                    <td style={{ padding:'10px 12px', fontSize:12, color:'var(--t2)' }}>{m.user.email}</td>
                    <td style={{ padding:'10px 12px' }}>
                      <select value={memberRoles[m.userId] || m.role} onChange={e=>setRole(m.userId,e.target.value)}
                        style={{ padding:'5px 8px', borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:12, fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none' }}>
                        <option>ADMIN</option><option>AGENT</option><option>VIEWER</option>
                      </select>
                    </td>
                    <td style={{ padding:'10px 12px' }}>
                      <button onClick={()=>delMember(m.userId)} style={{ width:28, height:28, borderRadius:6, background:'rgba(239,68,68,0.07)', border:'1px solid rgba(239,68,68,0.18)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                        <I n="trash" s={12} c="#f87171" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        {/* ── Billing ── */}
        <SectionCard icon="credit" title="Billing">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'14px 16px', borderRadius:10, background:'rgba(30,191,94,0.06)', border:'1px solid var(--gbd)', marginBottom:18 }}>
            <div>
              <p style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)', marginBottom:3 }}>Growth Plan</p>
              <p style={{ fontSize:12, color:'var(--t2)' }}>Manage your subscription</p>
            </div>
            <Btn style={{ boxShadow:'var(--glow)' }}>Upgrade</Btn>
          </div>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ borderBottom:'1px solid var(--bd)' }}>
                {['Invoice','Date','Amount','Status',''].map(h=>(
                  <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.07em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv,i) => (
                <tr key={inv.id} style={{ borderBottom: i < invoices.length-1 ? '1px solid var(--bd)' : 'none' }}>
                  <td style={{ padding:'10px 12px', fontSize:12, fontFamily:'monospace', color:'var(--t1)', fontWeight:700 }}>{inv.id}</td>
                  <td style={{ padding:'10px 12px', fontSize:12, color:'var(--t2)' }}>{new Date(inv.invoiceDate).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</td>
                  <td style={{ padding:'10px 12px', fontSize:13, fontWeight:700, color:'var(--t1)' }}>₹{inv.amount.toLocaleString()}</td>
                  <td style={{ padding:'10px 12px' }}>{statusBadge(inv.status)}</td>
                  <td style={{ padding:'10px 12px' }}>
                    <button style={{ width:28, height:28, borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t2)' }}>
                      <I n="download" s={12} c="var(--t2)" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>

        {/* ── Notifications ── */}
        <SectionCard icon="bell" title="Notifications">
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {NOTIF_OPTS.map(opt => (
              <div key={opt.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 14px', borderRadius:9, background:'rgba(255,255,255,0.02)', border:'1px solid var(--bd)' }}>
                <span style={{ fontSize:13, fontWeight:500, color:'var(--t1)' }}>{opt.label}</span>
                <Toggle on={notifs[opt.id]} onToggle={()=>setNotifs(p=>({...p,[opt.id]:!p[opt.id]}))} />
              </div>
            ))}
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', marginTop:16 }}>
            <Btn>Save Preferences</Btn>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
