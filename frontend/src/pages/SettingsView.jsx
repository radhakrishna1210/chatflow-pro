import { useState, useEffect } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';
import QuickLinksGrid from '../components/QuickLinksGrid.jsx';

const card = { background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', boxShadow:'var(--card-shadow)' };

const NOTIF_OPTS = [
  { id:'newConv',         label:'New Conversation',    default:true,  field:'notifyNewConversation'   },
  { id:'tplApproved',    label:'Template Approved',    default:true,  field:'notifyTemplateApproved'  },
  { id:'tplRejected',    label:'Template Rejected',    default:true,  field:'notifyTemplateRejected'  },
  { id:'campaignDone',   label:'Campaign Completed',   default:false, field:'notifyCampaignCompleted' },
  { id:'highOptout',     label:'High Opt-out Alert',   default:true,  field:'notifyHighOptout'        },
  { id:'rateLimitWarn',  label:'Rate Limit Warning',   default:true,  field:'notifyRateLimit'         },
];

// Email notifications map directly to backend Workspace.emailNotify* columns.
const EMAIL_NOTIF_OPTS = [
  { id:'emailNotifyCampaignCompleted', label:'Campaign Completed', hint:'Summary email when a campaign finishes sending',   default:true },
  { id:'emailNotifyTemplateApproved',  label:'Template Approved',  hint:'When Meta approves one of your message templates',  default:true },
  { id:'emailNotifyTemplateRejected',  label:'Template Rejected',  hint:'When Meta rejects a template, with common reasons', default:true },
  { id:'emailNotifyMemberInvite',      label:'Member Invited',     hint:'Email a teammate when they are added to this workspace', default:true },
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

const Toggle = ({ on, onToggle, disabled=false }) => (
  <div onClick={disabled ? undefined : onToggle} style={{ width:38, height:21, borderRadius:20, background: on ? 'var(--green)' : 'rgba(255,255,255,0.1)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, transition:'background .2s', position:'relative', border:`1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`, flexShrink:0 }}>
    <div style={{ position:'absolute', top:2, left: on ? 19 : 2, width:15, height:15, borderRadius:'50%', background:'white', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,0.4)' }} />
  </div>
);

const FInput = ({ value, onChange, placeholder, disabled=false, style:ex={} }) => (
  <input value={value} onChange={onChange} placeholder={placeholder} disabled={disabled}
    style={{ width:'100%', padding:'9px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none', boxSizing:'border-box', opacity: disabled ? 0.6 : 1, cursor: disabled ? 'not-allowed' : 'text', ...ex }}
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
  const isAdmin = JSON.parse(localStorage.getItem('user') || '{}').role === 'ADMIN';
  const [settings, setSettings] = useState({});
  const [members, setMembers]   = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookError, setWebhookError] = useState(null);
  const [showToken, setShowToken]   = useState(false);
  const [notifs, setNotifs]    = useState(() => Object.fromEntries(NOTIF_OPTS.map(o=>[o.id,o.default])));
  const [emailNotifs, setEmailNotifs] = useState(() => Object.fromEntries(EMAIL_NOTIF_OPTS.map(o=>[o.id,o.default])));
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsSaved, setPrefsSaved]   = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole]   = useState('CLIENT');
  const [showInvite, setShowInvite]   = useState(false);
  const [inviteError, setInviteError] = useState(null);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [invitations, setInvitations] = useState([]);
  const [resendingId, setResendingId] = useState(null);
  const [resentId, setResentId] = useState(null);
  const [memberRoles, setMemberRoles] = useState({});
  const [usagePerc, setUsagePerc] = useState(0);

  useEffect(() => {
    wFetch('/settings').then(r=>r.ok&&r.json()).then(d=>{ if(d) { setSettings(d); if(d.webhookUrl) setWebhookUrl(d.webhookUrl); if(d.notifyNewConversation!=null) setNotifs({newConv:d.notifyNewConversation,tplApproved:d.notifyTemplateApproved,tplRejected:d.notifyTemplateRejected,campaignDone:d.notifyCampaignCompleted,highOptout:d.notifyHighOptout,rateLimitWarn:d.notifyRateLimit}); setEmailNotifs(Object.fromEntries(EMAIL_NOTIF_OPTS.map(o=>[o.id, d[o.id]!=null ? d[o.id] : o.default]))); }}).catch(()=>{});
    wFetch('/members').then(r=>r.ok&&r.json()).then(d=>{ if(Array.isArray(d)) setMembers(d); }).catch(()=>{});
    if (isAdmin) wFetch('/invitations').then(r=>r.ok&&r.json()).then(d=>{ if(Array.isArray(d)) setInvitations(d); }).catch(()=>{});
    wFetch('/settings/invoices').then(r=>r.ok&&r.json()).then(d=>{ if(Array.isArray(d)) setInvoices(d); }).catch(()=>{});
    wFetch('/analytics/chat?days=7').then(r=>r.ok&&r.json()).then(d=>{
      if (d && Array.isArray(d.dailyVolume)) {
        const todayIso = new Date().toISOString().split('T')[0];
        const todayData = d.dailyVolume.find(v => v.date === todayIso) || d.dailyVolume[d.dailyVolume.length - 1];
        const sentToday = todayData?.sent || 0;
        setUsagePerc(Math.min((sentToday / 10000) * 100, 100));
      }
    }).catch(()=>{});
  }, []);

  const saveWebhook = async () => {
    const trimmed = webhookUrl.trim();
    if (trimmed && !/^https?:\/\/.+/i.test(trimmed)) {
      setWebhookError('Enter a valid URL starting with http:// or https://');
      return;
    }
    setWebhookError(null);
    const r = await wFetch('/settings', { method:'PATCH', body:JSON.stringify({ webhookUrl: trimmed }) }).catch(()=>null);
    if (r && !r.ok) {
      const data = await r.json().catch(()=>({}));
      setWebhookError(data.error || 'Could not save webhook URL');
    }
  };

  const savePreferences = async () => {
    setSavingPrefs(true); setPrefsSaved(false);
    const body = {
      ...Object.fromEntries(NOTIF_OPTS.map(o => [o.field, !!notifs[o.id]])),
      ...Object.fromEntries(EMAIL_NOTIF_OPTS.map(o => [o.id, !!emailNotifs[o.id]])),
    };
    try {
      const r = await wFetch('/settings', { method:'PATCH', body:JSON.stringify(body) });
      if (r.ok) { setPrefsSaved(true); setTimeout(()=>setPrefsSaved(false), 2500); }
    } catch {} finally { setSavingPrefs(false); }
  };

  const delMember = async id => {
    const prev = members;
    setMembers(p=>p.filter(m=>m.userId!==id));
    const r = await wFetch(`/members/${id}`, { method:'DELETE' }).catch(()=>null);
    if (!r || !r.ok) setMembers(prev); // roll back on failure
  };

  const setRole = async (id, role) => {
    const prev = memberRoles[id];
    setMemberRoles(p=>({...p,[id]:role}));
    const r = await wFetch(`/members/${id}`, { method:'PATCH', body:JSON.stringify({ role }) }).catch(()=>null);
    if (!r || !r.ok) setMemberRoles(p=>({...p,[id]:prev})); // roll back on failure
  };

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteError(null); setSendingInvite(true);
    try {
      const r = await wFetch('/invitations', { method:'POST', body:JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }) });
      const data = await r.json();
      if (!r.ok) { setInviteError(data.error || 'Could not send invite'); return; }
      setInvitations(p => [data, ...p]);
      setInviteEmail(''); setInviteRole('CLIENT'); setShowInvite(false);
    } catch (e) {
      setInviteError(e.message);
    } finally {
      setSendingInvite(false);
    }
  };

  const revokeInvite = async id => {
    const prev = invitations;
    setInvitations(p=>p.filter(i=>i.id!==id));
    const r = await wFetch(`/invitations/${id}`, { method:'DELETE' }).catch(()=>null);
    if (!r || !r.ok) setInvitations(prev); // roll back on failure
  };

  const resendInvite = async id => {
    setResendingId(id);
    try {
      const r = await wFetch(`/invitations/${id}/resend`, { method:'POST' });
      const data = await r.json();
      if (!r.ok) return;
      setInvitations(p => p.map(i => i.id === id ? data : i));
      setResentId(id);
      setTimeout(() => setResentId(prev => prev === id ? null : prev), 2500);
    } catch {} finally {
      setResendingId(null);
    }
  };

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ height:58, borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', padding:'0 28px', flexShrink:0, background:'var(--surf)' }}>
        <h1 style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:16, color:'var(--t1)', letterSpacing:'-.02em' }}>Settings</h1>
        <p style={{ fontSize:11.5, color:'var(--t2)', marginLeft:10 }}>Workspace configuration</p>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'24px 28px', display:'flex', flexDirection:'column', gap:16, maxWidth:860, margin:'0 auto', width:'100%', boxSizing:'border-box' }}>

        {/* ── Quick Links ── */}
        <SectionCard icon="columns" title="Quick Links">
          <QuickLinksGrid currentPage="settings" />
        </SectionCard>

        {/* ── Webhook ── */}
        <SectionCard icon="globe" title="Webhook">
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:12, fontWeight:600, color:'var(--t2)', display:'block', marginBottom:6 }}>Webhook URL</label>
            <FInput value={webhookUrl} onChange={e=>{ setWebhookUrl(e.target.value); setWebhookError(null); }} placeholder="https://your-server.com/webhook" disabled={!isAdmin}
              style={webhookError ? { borderColor:'#f87171' } : {}} />
            {webhookError && <p style={{ fontSize:11.5, color:'#f87171', marginTop:6 }}>{webhookError}</p>}
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
          {isAdmin && (
            <div style={{ display:'flex', gap:8 }}>
              <Btn onClick={saveWebhook}>Save</Btn>
              <Btn variant="outline">Test</Btn>
            </div>
          )}
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
          {isAdmin && (
            <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:14 }}>
              <Btn size="sm" style={{ background:'rgba(30,191,94,0.1)', color:'var(--green)', border:'1px solid var(--gbd)' }} onClick={()=>setShowInvite(!showInvite)}>
                <I n="plus" s={13} c="var(--green)" />
                Invite
              </Btn>
            </div>
          )}
          {isAdmin && showInvite && (
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:14, padding:14, borderRadius:10, background:'rgba(255,255,255,0.02)', border:'1px solid var(--bd)' }}>
              <div style={{ display:'flex', gap:8 }}>
                <FInput value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="colleague@company.com" style={{ flex:1 }} />
                <select value={inviteRole} onChange={e=>setInviteRole(e.target.value)}
                  style={{ padding:'9px 10px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none', colorScheme:'dark' }}>
                  <option value="CLIENT" style={{ background:'#07090F' }}>Member</option>
                  <option value="ADMIN" style={{ background:'#07090F' }}>Admin</option>
                </select>
                <Btn size="sm" onClick={sendInvite} disabled={sendingInvite}>{sendingInvite ? 'Sending…' : 'Send Invite'}</Btn>
              </div>
              {inviteError && <p style={{ fontSize:12, color:'#f87171' }}>{inviteError}</p>}
            </div>
          )}
          {invitations.length > 0 && (
            <div style={{ marginBottom:14, borderRadius:10, border:'1px solid var(--bd)', overflow:'hidden' }}>
              <div style={{ padding:'8px 12px', background:'rgba(255,255,255,0.02)', borderBottom:'1px solid var(--bd)' }}>
                <span style={{ fontSize:11, fontWeight:700, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.07em' }}>Pending Invitations</span>
              </div>
              {invitations.map((inv,i) => (
                <div key={inv.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'9px 12px', borderBottom: i < invitations.length-1 ? '1px solid var(--bd)' : 'none' }}>
                  <div style={{ minWidth:0, flex:1 }}>
                    <span style={{ fontSize:12.5, fontWeight:600, color:'var(--t1)' }}>{inv.email}</span>
                    <span style={{ fontSize:11, color:'var(--t3)', marginLeft:8 }}>{inv.role === 'ADMIN' ? 'Admin' : 'Member'} · expires {new Date(inv.expiresAt).toLocaleDateString()}</span>
                  </div>
                  <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                    <button onClick={()=>resendInvite(inv.id)} disabled={resendingId===inv.id} style={{ padding:'4px 10px', borderRadius:6, background: resentId===inv.id ? 'var(--gbg)' : 'rgba(255,255,255,0.04)', border: `1px solid ${resentId===inv.id ? 'var(--gbd)' : 'var(--bd)'}`, cursor: resendingId===inv.id ? 'not-allowed' : 'pointer', fontSize:11.5, fontWeight:600, color: resentId===inv.id ? 'var(--green)' : 'var(--t2)', opacity: resendingId===inv.id ? 0.6 : 1 }}>
                      {resendingId===inv.id ? 'Sending…' : resentId===inv.id ? 'Sent ✓' : 'Resend'}
                    </button>
                    <button onClick={()=>revokeInvite(inv.id)} style={{ padding:'4px 10px', borderRadius:6, background:'rgba(239,68,68,0.07)', border:'1px solid rgba(239,68,68,0.18)', cursor:'pointer', fontSize:11.5, fontWeight:600, color:'#f87171' }}>
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
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
                      {isAdmin ? (
                        <select value={memberRoles[m.userId] || m.role} onChange={e=>setRole(m.userId,e.target.value)}
                          style={{ padding:'5px 8px', borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:12, fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none', colorScheme:'dark' }}>
                          <option style={{ background:'#07090F' }}>ADMIN</option><option style={{ background:'#07090F' }}>CLIENT</option>
                        </select>
                      ) : (
                        <span style={{ fontSize:12, color:'var(--t2)' }}>{m.role === 'ADMIN' ? 'Admin' : 'Member'}</span>
                      )}
                    </td>
                    <td style={{ padding:'10px 12px' }}>
                      {isAdmin && (
                        <button onClick={()=>delMember(m.userId)} style={{ width:28, height:28, borderRadius:6, background:'rgba(239,68,68,0.07)', border:'1px solid rgba(239,68,68,0.18)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                          <I n="trash" s={12} c="#f87171" />
                        </button>
                      )}
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
            {isAdmin && <Btn style={{ boxShadow:'var(--glow)' }}>Upgrade</Btn>}
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
        <SectionCard icon="bell" title="In-App Notifications">
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {NOTIF_OPTS.map(opt => (
              <div key={opt.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 14px', borderRadius:9, background:'rgba(255,255,255,0.02)', border:'1px solid var(--bd)' }}>
                <span style={{ fontSize:13, fontWeight:500, color:'var(--t1)' }}>{opt.label}</span>
                <Toggle on={notifs[opt.id]} disabled={!isAdmin} onToggle={()=>setNotifs(p=>({...p,[opt.id]:!p[opt.id]}))} />
              </div>
            ))}
          </div>
        </SectionCard>

        {/* ── Email Notifications ── */}
        <SectionCard icon="mail" title="Email Notifications">
          <p style={{ fontSize:12, color:'var(--t2)', marginBottom:16, marginTop:-4, lineHeight:1.5 }}>
            Send emails to all workspace members for these events. Member invites are emailed to the invited person.
          </p>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {EMAIL_NOTIF_OPTS.map(opt => (
              <div key={opt.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:14, padding:'12px 14px', borderRadius:9, background:'rgba(255,255,255,0.02)', border:'1px solid var(--bd)' }}>
                <div style={{ minWidth:0 }}>
                  <span style={{ fontSize:13, fontWeight:500, color:'var(--t1)', display:'block' }}>{opt.label}</span>
                  {opt.hint && <span style={{ fontSize:11, color:'var(--t3)' }}>{opt.hint}</span>}
                </div>
                <Toggle on={emailNotifs[opt.id]} disabled={!isAdmin} onToggle={()=>setEmailNotifs(p=>({...p,[opt.id]:!p[opt.id]}))} />
              </div>
            ))}
          </div>
          {isAdmin && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:12, marginTop:16 }}>
              {prefsSaved && <span style={{ fontSize:12, color:'var(--green)', fontWeight:600 }}>Saved ✓</span>}
              <Btn onClick={savePreferences} disabled={savingPrefs}>{savingPrefs ? 'Saving…' : 'Save Preferences'}</Btn>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
