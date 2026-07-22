import { useState, useEffect } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';

const card = { background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', boxShadow:'var(--card-shadow)' };

const EVENTS = [
  { id:'messages',   label:'Messages',   default:true  },
  { id:'reactions',  label:'Reactions',  default:true  },
  { id:'deliveries', label:'Deliveries', default:true  },
  { id:'reads',      label:'Reads',      default:false },
  { id:'referrals',  label:'Referrals',  default:false },
];

const CopyBtn = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).catch(()=>{});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} title="Copy" style={{ width:28, height:28, borderRadius:6, background: copied ? 'var(--gbg)' : 'rgba(255,255,255,0.04)', border:`1px solid ${copied ? 'var(--gbd)' : 'var(--bd)'}`, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color: copied ? 'var(--green)' : 'var(--t2)', transition:'all .15s' }}>
      <I n={copied ? 'check' : 'copy'} s={12} c={copied ? 'var(--green)' : 'var(--t2)'} />
    </button>
  );
};

const SecretInput = ({ prefix }) => {
  const display = `${prefix}${'•'.repeat(24)}`;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <span style={{ fontSize:13, fontFamily:'monospace', color:'var(--t1)', background:'rgba(255,255,255,0.04)', padding:'5px 10px', borderRadius:6, border:'1px solid var(--bd)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{display}</span>
    </div>
  );
};

export default function ApiKeysView() {
  const isAdmin = JSON.parse(localStorage.getItem('user') || '{}').role === 'ADMIN';
  const [keys, setKeys]         = useState([]);
  const [newKey, setNewKey]     = useState(null);
  const [newName, setNewName]   = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [events, setEvents]     = useState(() => Object.fromEntries(EVENTS.map(e=>[e.id,e.default])));
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookMsg, setWebhookMsg] = useState(null); // { ok } | { error }
  const [webhookTesting, setWebhookTesting] = useState(false);
  const [webhookTestMsg, setWebhookTestMsg] = useState(null); // { ok } | { error }
  const [testPhone, setTestPhone] = useState('');
  const [testTpl, setTestTpl]   = useState('');
  const [testBody, setTestBody] = useState('');
  const [testErrors, setTestErrors] = useState({});
  const [sending, setSending]   = useState(false);
  const [sent, setSent]         = useState(false);
  const [sendError, setSendError] = useState('');

  useEffect(() => {
    wFetch('/api-keys').then(r=>r.ok&&r.json()).then(d=>{if(Array.isArray(d))setKeys(d)}).catch(()=>{});
    wFetch('/settings').then(r=>r.ok&&r.json()).then(d=>{
      if (!d) return;
      if (d.webhookUrl) setWebhookUrl(d.webhookUrl);
      if (Array.isArray(d.webhookEvents)) {
        setEvents(Object.fromEntries(EVENTS.map(e => [e.id, d.webhookEvents.includes(e.id)])));
      }
    }).catch(()=>{});
  }, []);

  const generate = async () => {
    const res = await wFetch('/api-keys', { method:'POST', body:JSON.stringify({ name:newName||'New Key', environment:'live' }) }).catch(()=>null);
    if (res?.ok) {
      const k = await res.json();
      setKeys(p=>[...p,k]);
      if (k.rawKey) setNewKey(k);
    }
    setNewName('');
  };

  const rotate = async id => {
    await wFetch(`/api-keys/${id}/rotate`, { method:'POST' }).catch(()=>{});
    setKeys(p => p.map(k => k.id===id ? { ...k, lastUsedAt:null } : k));
  };

  const revoke = async id => {
    await wFetch(`/api-keys/${id}`, { method:'DELETE' }).catch(()=>{});
    setKeys(p => p.filter(k => k.id!==id));
  };

  const saveWebhook = async () => {
    const trimmed = webhookUrl.trim();
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      setWebhookMsg({ error: 'Enter a valid URL starting with http:// or https://' });
      return;
    }
    setWebhookSaving(true);
    setWebhookMsg(null);
    try {
      const res = await wFetch('/settings', {
        method: 'PATCH',
        body: JSON.stringify({ webhookUrl: trimmed, webhookEvents: Object.keys(events).filter(k => events[k]) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setWebhookMsg({ error: data.error || 'Could not save webhook configuration' }); return; }
      setWebhookMsg({ ok: 'Webhook configuration saved.' });
    } catch (e) {
      setWebhookMsg({ error: e.message || 'Could not save webhook configuration' });
    } finally {
      setWebhookSaving(false);
    }
  };

  const testWebhookCall = async () => {
    setWebhookTesting(true);
    setWebhookTestMsg(null);
    try {
      const res = await wFetch('/settings/webhook/test', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setWebhookTestMsg({ error: data.error || 'Webhook test failed' }); return; }
      setWebhookTestMsg({ ok: `Test payload delivered (status ${data.status}).` });
    } catch (e) {
      setWebhookTestMsg({ error: e.message || 'Webhook test failed' });
    } finally {
      setWebhookTesting(false);
    }
  };

  const validateTestFields = () => {
    const errs = {};
    if (!testPhone.trim()) errs.phone = 'Phone number is required';
    else if (!/^[+\d][\d\s-]{5,19}$/.test(testPhone.trim())) errs.phone = 'Enter a valid phone number';
    if (!testTpl.trim() && !testBody.trim()) {
      errs.message = 'Provide a Template ID or a Message';
    }
    return errs;
  };

  const sendTest = async () => {
    const errs = validateTestFields();
    setTestErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSending(true);
    setSendError('');
    try {
      const res = await wFetch('/api-keys/test-message', {
        method: 'POST',
        body: JSON.stringify({
          to: testPhone.trim(),
          templateId: testTpl.trim() || undefined,
          message: testBody.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to send test message');
      setSent(true);
      setTimeout(() => setSent(false), 2500);
    } catch (e) {
      setSendError(e.message || 'Failed to send test message');
    } finally {
      setSending(false);
    }
  };

  const envBadge = env => ({
    live: { bg:'var(--gbg)', bd:'var(--gbd)', c:'var(--green)' },
    test: { bg:'rgba(167,139,250,.1)', bd:'rgba(167,139,250,.25)', c:'#c4b5fd' },
  }[env] || {});

  const inp = (val,fn,ph,type='text') => (
    <input type={type} value={val} onChange={e=>fn(e.target.value)} placeholder={ph}
      style={{ width:'100%', padding:'9px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none', boxSizing:'border-box' }}
      onFocus={e=>e.target.style.borderColor='var(--gbd)'}
      onBlur={e=>e.target.style.borderColor='var(--bd)'} />
  );

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ height:58, borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', padding:'0 28px', flexShrink:0, background:'var(--surf)' }}>
        <h1 style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:16, color:'var(--t1)', letterSpacing:'-.02em' }}>API Keys</h1>
        <p style={{ fontSize:11.5, color:'var(--t2)', marginLeft:10 }}>Manage API access, webhooks &amp; testing</p>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'24px 28px', display:'flex', flexDirection:'column', gap:18, maxWidth:860, margin:'0 auto', width:'100%', boxSizing:'border-box' }}>

        {/* ── API Keys card ── */}
        <div style={{ ...card, overflow:'hidden' }}>
          <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', gap:10 }}>
            <I n="key" s={16} c="var(--green)" />
            <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)' }}>API Keys</span>
          </div>

          {keys.map((k, i) => {
            const badge = envBadge(k.environment);
            return (
              <div key={k.id} style={{ padding:'14px 20px', borderBottom: i < keys.length-1 ? '1px solid var(--bd)' : 'none' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:14, fontWeight:600, color:'var(--t1)' }}>{k.name}</span>
                    <span style={{ padding:'2px 8px', borderRadius:8, fontSize:10, fontWeight:700, background:badge.bg, border:`1px solid ${badge.bd}`, color:badge.c }}>{k.environment}</span>
                  </div>
                  {isAdmin && (
                    <div style={{ display:'flex', gap:6 }}>
                      <button onClick={()=>rotate(k.id)} title="Rotate" style={{ width:28, height:28, borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t2)' }}>
                        <I n="rotate" s={12} c="var(--t2)" />
                      </button>
                      <button onClick={()=>revoke(k.id)} title="Revoke" style={{ width:28, height:28, borderRadius:6, background:'rgba(239,68,68,0.07)', border:'1px solid rgba(239,68,68,0.2)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                        <I n="trash" s={12} c="#f87171" />
                      </button>
                    </div>
                  )}
                </div>
                <SecretInput prefix={k.keyPrefix} />
                {k.lastUsedAt && <p style={{ fontSize:11, color:'var(--t3)', marginTop:5 }}>Last used: {k.lastUsedAt}</p>}
              </div>
            );
          })}

          {isAdmin && (
            <div style={{ padding:'14px 20px', background:'rgba(255,255,255,0.015)', display:'flex', gap:8, alignItems:'center' }}>
              <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Key name (optional)"
                style={{ flex:1, padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none' }}
                onKeyDown={e=>e.key==='Enter'&&generate()} />
              <Btn size="sm" style={{ background:'rgba(30,191,94,0.1)', color:'var(--green)', border:'1px solid var(--gbd)' }} onClick={generate}>
                <I n="plus" s={13} c="var(--green)" />
                Generate New
              </Btn>
            </div>
          )}
        </div>

        {/* ── Webhook card ── */}
        <div style={{ ...card, padding:'20px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:18 }}>
            <I n="globe" s={16} c="var(--green)" />
            <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)' }}>Webhook Configuration</span>
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:12, fontWeight:600, color:'var(--t2)', display:'block', marginBottom:6 }}>Webhook URL</label>
            <input value={webhookUrl} onChange={e=>setWebhookUrl(e.target.value)} placeholder="https://your-server.com/webhook"
              style={{ width:'100%', padding:'9px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none', boxSizing:'border-box' }}
              onFocus={e=>e.target.style.borderColor='var(--gbd)'}
              onBlur={e=>e.target.style.borderColor='var(--bd)'} />
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={{ fontSize:12, fontWeight:600, color:'var(--t2)', display:'block', marginBottom:10 }}>Subscribe to Events</label>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {EVENTS.map(ev => {
                const on = events[ev.id];
                return (
                  <div key={ev.id} onClick={() => setEvents(p=>({...p,[ev.id]:!p[ev.id]}))}
                    style={{ display:'flex', alignItems:'center', gap:7, padding:'6px 12px', borderRadius:8, border:`1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`, background: on ? 'var(--gbg)' : 'rgba(255,255,255,0.02)', cursor:'pointer', transition:'all .15s' }}>
                    <div style={{ width:14, height:14, borderRadius:3, border:`1.5px solid ${on ? 'var(--green)' : 'var(--bd)'}`, background: on ? 'var(--green)' : 'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'all .15s' }}>
                      {on && <I n="check" s={8} c="#060913" w={3} />}
                    </div>
                    <span style={{ fontSize:13, fontWeight:500, color: on ? 'var(--green)' : 'var(--t2)' }}>{ev.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {webhookMsg && (
            <p style={{ fontSize:12, color: webhookMsg.error ? '#f87171' : 'var(--green)', margin:'0 0 10px' }}>
              {webhookMsg.error || webhookMsg.ok}
            </p>
          )}
          {webhookTestMsg && (
            <p style={{ fontSize:12, color: webhookTestMsg.error ? '#f87171' : 'var(--green)', margin:'0 0 10px' }}>
              {webhookTestMsg.error || webhookTestMsg.ok}
            </p>
          )}
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={saveWebhook} disabled={webhookSaving}>{webhookSaving ? 'Saving…' : 'Save'}</Btn>
            <Btn variant="outline" onClick={testWebhookCall} disabled={webhookTesting}>{webhookTesting ? 'Testing…' : 'Test Webhook'}</Btn>
          </div>
        </div>

        {/* ── Playground card ── */}
        <div style={{ ...card, padding:'20px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:18 }}>
            <I n="send" s={16} c="var(--green)" />
            <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)' }}>API Playground</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:4 }}>
            <div>
              <label style={{ fontSize:12, fontWeight:600, color:'var(--t2)', display:'block', marginBottom:6 }}>Phone Number</label>
              {inp(testPhone,setTestPhone,'+91 98765 43210')}
              {testErrors.phone && <p style={{ fontSize:11.5, color:'#f87171', margin:'6px 0 0' }}>{testErrors.phone}</p>}
            </div>
            <div>
              <label style={{ fontSize:12, fontWeight:600, color:'var(--t2)', display:'block', marginBottom:6 }}>Template ID</label>
              {inp(testTpl,setTestTpl,'welcome_message')}
            </div>
          </div>
          <div style={{ marginBottom:14, marginTop:8 }}>
            <label style={{ fontSize:12, fontWeight:600, color:'var(--t2)', display:'block', marginBottom:6 }}>Message Body</label>
            <textarea value={testBody} onChange={e=>setTestBody(e.target.value)} placeholder="Enter test message…"
              style={{ width:'100%', minHeight:80, padding:'9px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none', resize:'vertical', boxSizing:'border-box', lineHeight:1.55 }} />
            {testErrors.message && <p style={{ fontSize:11.5, color:'#f87171', margin:'6px 0 0' }}>{testErrors.message}</p>}
          </div>
          {sendError && <p style={{ fontSize:12, color:'#f87171', margin:'0 0 12px' }}>{sendError}</p>}
          <Btn onClick={sendTest} disabled={sending} style={{ width:'100%', justifyContent:'center', boxShadow:'var(--glow)' }}>
            {sending ? 'Sending…' : sent ? '✓ Sent!' : <>
              <I n="send" s={14} c="#060A10" />
              Send Test Message
            </>}
          </Btn>
        </div>
      </div>

      {newKey && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, backdropFilter:'blur(4px)' }}>
          <div style={{ background:'var(--surf)', padding:28, borderRadius:16, border:'1px solid var(--bd)', width:'100%', maxWidth:460, boxShadow:'0 24px 48px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:18, color:'var(--t1)', marginBottom:12 }}>Save your API key</h2>
            <p style={{ fontSize:13, color:'var(--t2)', marginBottom:20, lineHeight:1.5 }}>
              Please copy this API key now. For your security, <strong style={{ color:'#f87171' }}>it won't be shown again</strong>.
            </p>
            
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:24 }}>
              <span style={{ fontSize:13, fontFamily:'monospace', color:'var(--t1)', background:'rgba(255,255,255,0.04)', padding:'9px 12px', borderRadius:6, border:'1px solid var(--bd)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {newKey.rawKey}
              </span>
              <CopyBtn text={newKey.rawKey} />
            </div>

            <div style={{ display:'flex', justifyContent:'flex-end' }}>
              <Btn onClick={() => setNewKey(null)}>Done</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
