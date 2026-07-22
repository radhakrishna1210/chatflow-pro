import { useState, useEffect, useRef } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch, adminFetch } from '../lib/api.js';

const statusColor = s => ({
  AVAILABLE: { bg:'var(--gbg)',              bd:'var(--gbd)',              c:'var(--green)' },
  ASSIGNED:  { bg:'rgba(14,165,233,.1)',     bd:'rgba(14,165,233,.25)',    c:'#38bdf8' },
  BANNED:    { bg:'rgba(239,68,68,.08)',     bd:'rgba(239,68,68,.2)',      c:'#f87171' },
}[s] || { bg:'rgba(255,255,255,.04)', bd:'var(--bd)', c:'var(--t2)' });

const card = { background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', boxShadow:'var(--card-shadow)' };

const qualityColor = q => q === 'High' ? 'var(--green)' : q === 'Medium' ? '#fbbf24' : '#f87171';

const Label = ({ children, hint, required }) => (
  <div style={{ marginBottom:6 }}>
    <label style={{ fontSize:12, fontWeight:600, color:'var(--t2)', display:'block', marginBottom:2 }}>
      {children} {required && <span style={{ color:'#f87171' }}>*</span>}
    </label>
    {hint && <p style={{ fontSize:11, color:'var(--t3)' }}>{hint}</p>}
  </div>
);

const FInput = ({ type='text', value, onChange, placeholder, style:ex={} }) => (
  <input type={type} value={value} onChange={onChange} placeholder={placeholder}
    style={{ width:'100%', padding:'9px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none', boxSizing:'border-box', ...ex }}
    onFocus={e => e.target.style.borderColor='var(--gbd)'}
    onBlur={e => e.target.style.borderColor='var(--bd)'} />
);

const Modal = ({ title, onClose, children, footer }) => (
  <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)' }}>
    <div style={{ ...card, width:480, maxHeight:'80vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--bd)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
        <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:16, color:'var(--t1)' }}>{title}</span>
        <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--t2)', display:'flex' }}>
          <I n="x" s={18} c="var(--t2)" />
        </button>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'20px 24px' }}>{children}</div>
      {footer && <div style={{ padding:'14px 24px', borderTop:'1px solid var(--bd)', display:'flex', justifyContent:'flex-end', gap:8, flexShrink:0 }}>{footer}</div>}
    </div>
  </div>
);

const CheckItem = ({ text }) => (
  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
    <I n="checkc" s={14} c="var(--green)" />
    <span style={{ fontSize:13, color:'var(--t2)' }}>{text}</span>
  </div>
);

export default function NumberSetupView() {
  const [number, setNumber]           = useState(null);
  const [refreshing, setRefreshing]   = useState(false);
  const [pool, setPool]               = useState([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const [getOpen, setGetOpen]         = useState(false);
  const [connOpen, setConnOpen]       = useState(false);
  const [selPool, setSelPool]         = useState(null);
  const [gotNumber, setGotNumber]     = useState(null);
  const [gettingNum, setGettingNum]   = useState(false);
  const [getError, setGetError]       = useState(null);
  const [showTok, setShowTok]         = useState(false);
  const [form, setForm]               = useState({ phoneNumber:'', metaPhoneNumberId:'', wabaId:'', accessToken:'', displayName:'' });

  // Admin pool management state
  const isSuperAdmin = JSON.parse(localStorage.getItem('user') || '{}').superAdmin === true;
  const isAdmin = JSON.parse(localStorage.getItem('user') || '{}').role === 'ADMIN';
  const [adminPool, setAdminPool]         = useState(null);   // { summary, pool[] }
  const [adminPoolLoading, setAplLoading] = useState(false);
  const [adminPoolError, setAplError]     = useState(null);
  const [syncing, setSyncing]             = useState(false);
  const [syncResult, setSyncResult]       = useState(null);
  const [resetting, setResetting]         = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [assignOpen, setAssignOpen]       = useState(null); // poolEntry being assigned
  const [workspaces, setWorkspaces]       = useState([]);
  const [wsLoading, setWsLoading]         = useState(false);
  const [wsSearch, setWsSearch]           = useState('');
  const [assigning, setAssigning]         = useState(false);
  const [assignError, setAssignError]     = useState(null);

  const load = () =>
    wFetch('/whatsapp/numbers').then(r => r.ok && r.json()).then(d => { if (Array.isArray(d) && d[0]) setNumber(d[0]); }).catch(() => {});

  useEffect(() => {
    load();
    if (isSuperAdmin) loadAdminPool();
  }, []);

  const loadAdminPool = () => {
    setAplLoading(true); setAplError(null);
    adminFetch('/numbers/pool')
      .then(async r => {
        if (!r.ok) { const t = await r.text(); throw new Error(`${r.status}: ${t}`); }
        return r.json();
      })
      .then(d => { setAdminPool(d); })
      .catch(err => setAplError(err.message))
      .finally(() => setAplLoading(false));
  };

  const syncFromWaba = async () => {
    setSyncing(true); setSyncResult(null);
    adminFetch('/numbers/sync-from-waba', { method:'POST' })
      .then(r=>r.ok&&r.json()).then(d=>{ setSyncResult(d); loadAdminPool(); })
      .catch(()=>setSyncResult({ added:[], skipped:[], error:true }))
      .finally(()=>setSyncing(false));
  };

  const resetAllAssignments = async () => {
    if (!window.confirm('This will disconnect all numbers from every workspace and return them to the pool. Continue?')) return;
    setResetting(true);
    await adminFetch('/numbers/reset-all', { method:'POST' }).catch(()=>{});
    setNumber(null);
    loadAdminPool();
    setResetting(false);
  };

  const resetEntry = async id => {
    await adminFetch(`/numbers/pool/${id}/reset`, { method:'PATCH' }).catch(()=>{});
    loadAdminPool();
  };

  const banEntry = async id => {
    await adminFetch(`/numbers/pool/${id}/ban`, { method:'PATCH' }).catch(()=>{});
    loadAdminPool();
  };

  const disconnectNumber = async () => {
    if (!number?.id) return;
    if (!window.confirm(`Disconnect ${number.phoneNumber}? It will be returned to the pool.`)) return;
    setDisconnecting(true);
    try {
      const res = await wFetch(`/whatsapp/numbers/${number.id}`, { method:'DELETE' });
      if (!res.ok) { const t = await res.text(); throw new Error(t); }
      setNumber(null);
      if (isSuperAdmin) loadAdminPool();
    } catch (e) {
      alert(`Disconnect failed: ${e.message}`);
    } finally {
      setDisconnecting(false);
    }
  };

  const openAssignDialog = (entry) => {
    setAssignOpen(entry); setAssignError(null); setWsSearch('');
    setWsLoading(true);
    adminFetch('/workspaces')
      .then(r => r.ok && r.json()).then(d => { if (Array.isArray(d)) setWorkspaces(d); })
      .catch(() => {})
      .finally(() => setWsLoading(false));
  };

  const assignToWorkspace = async (workspaceId) => {
    if (!assignOpen) return;
    setAssigning(true); setAssignError(null);
    try {
      const res = await adminFetch('/numbers/assign', {
        method:'POST',
        body: JSON.stringify({ poolEntryId: assignOpen.id, workspaceId }),
      });
      const data = await res.json();
      if (!res.ok) { setAssignError(data.error || `Error ${res.status}`); return; }
      setAssignOpen(null);
      loadAdminPool();
    } catch (e) {
      setAssignError(e.message);
    } finally {
      setAssigning(false);
    }
  };

  const openGetDialog = () => {
    setGetOpen(true); setGotNumber(null); setSelPool(null);
    setPoolLoading(true);
    wFetch('/whatsapp/numbers/pool')
      .then(r=>r.ok&&r.json()).then(d=>{ if(Array.isArray(d)) setPool(d); })
      .catch(()=>{})
      .finally(()=>setPoolLoading(false));
  };

  const getNumber = async () => {
    if (!selPool) return;
    setGettingNum(true); setGetError(null);
    try {
      const res = await wFetch('/whatsapp/onboard', { method:'POST', body:JSON.stringify({ poolEntryId:selPool }) });
      const data = await res.json();
      if (!res.ok) { setGetError(data.error || `Error ${res.status}`); return; }
      const picked = pool.find(p => p.id === selPool);
      const assigned = { ...picked, ...data };
      setGotNumber(assigned);
      setNumber(assigned);
    } catch (e) {
      setGetError(e.message || 'Network error');
    } finally {
      setGettingNum(false);
    }
  };

  const [metaConnecting, setMetaConnecting] = useState(false);
  const esRef = useRef({ code: null, wabaId: null, phoneNumberId: null });
  const [metaMsg, setMetaMsg] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('connected') === 'true') return { ok: 'WhatsApp number connected via Meta successfully.' };
    const err = q.get('meta_error');
    if (err) {
      const map = {
        missing_code: 'Meta did not return an authorization code.',
        invalid_state: 'Connection session expired — please try again.',
        no_waba_found: 'No WhatsApp Business Account was found on the Meta account you authorized.',
        no_phone_numbers: 'Your WhatsApp Business Account has no phone numbers yet.',
        exchange_failed: 'Meta token exchange failed. Check the app credentials and redirect URI configuration.',
      };
      const detail = q.get('meta_detail');
      const base = map[err] || `Meta connection failed (${err}).`;
      return { error: detail ? `${base} Meta said: "${detail}"` : base };
    }
    return null;
  });

  // Loads the Meta JS SDK once and listens for the WA_EMBEDDED_SIGNUP postMessage
  // that carries the customer's waba_id + phone_number_id.
  const loadFacebookSdk = (appId) => new Promise((resolve) => {
    if (window.FB) return resolve(window.FB);
    window.fbAsyncInit = function () {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: 'v21.0' });
      resolve(window.FB);
    };
    if (!document.getElementById('facebook-jssdk')) {
      const js = document.createElement('script');
      js.id = 'facebook-jssdk';
      js.src = 'https://connect.facebook.net/en_US/sdk.js';
      js.onerror = () => resolve(null);
      document.body.appendChild(js);
    }
  });

  useEffect(() => {
    const onMessage = (event) => {
      if (!event.origin.endsWith('facebook.com')) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type === 'WA_EMBEDDED_SIGNUP' && data?.event === 'FINISH') {
          esRef.current.wabaId = data.data?.waba_id || esRef.current.wabaId;
          esRef.current.phoneNumberId = data.data?.phone_number_id || esRef.current.phoneNumberId;
        }
      } catch { /* not our message */ }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Preferred path: FB.login Embedded Signup (popup, no token copy). Falls back
  // to the server-side OAuth redirect flow if the SDK or config_id is missing.
  const connectWithMeta = async () => {
    setMetaConnecting(true);
    setMetaMsg(null);
    try {
      const token = localStorage.getItem('accessToken');
      const { workspaceId } = JSON.parse(localStorage.getItem('user') || '{}');

      // Fetch Embedded Signup config (appId + configId) from the backend.
      let cfg = null;
      try {
        const cfgRes = await wFetch('/whatsapp/embedded-signup/config');
        if (cfgRes.ok) cfg = await cfgRes.json();
      } catch { /* fall through to redirect */ }

      const FB = cfg?.appId && cfg?.configId ? await loadFacebookSdk(cfg.appId) : null;

      if (FB && cfg?.configId) {
        esRef.current = { code: null, wabaId: null, phoneNumberId: null };
        FB.login((response) => {
          const code = response?.authResponse?.code;
          if (!code) {
            setMetaMsg({ error: 'Meta sign-in was cancelled or returned no code.' });
            setMetaConnecting(false);
            return;
          }
          // Give the postMessage a beat to arrive with waba/phone ids.
          setTimeout(async () => {
            const { wabaId, phoneNumberId } = esRef.current;
            if (!wabaId || !phoneNumberId) {
              setMetaMsg({ error: 'Meta did not return your WABA details. Please try again.' });
              setMetaConnecting(false);
              return;
            }
            try {
              const res = await wFetch('/whatsapp/embedded-signup', {
                method: 'POST', body: JSON.stringify({ code, wabaId, phoneNumberId }),
              });
              const data = await res.json();
              if (!res.ok) { setMetaMsg({ error: data.error || 'Could not complete connection.' }); return; }
              setMetaMsg({ ok: `Connected ${data.phoneNumber || 'your number'} via Meta.` });
              await load();
            } catch (e) {
              setMetaMsg({ error: e.message });
            } finally {
              setMetaConnecting(false);
            }
          }, 1200);
        }, {
          config_id: cfg.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding' },
        });
        return; // FB.login callback drives the rest
      }

      // Fallback: server-side OAuth redirect flow.
      const res = await fetch(`/api/v1/auth/meta/start?workspaceId=${encodeURIComponent(workspaceId || '')}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { setMetaMsg({ error: data.error || `Could not start Meta connection (${res.status})` }); setMetaConnecting(false); return; }
      window.location.href = data.url;
    } catch (e) {
      setMetaMsg({ error: e.message });
      setMetaConnecting(false);
    }
  };

  const connectOwn = async () => {
    try {
      const res = await wFetch('/whatsapp/numbers/connect-own', { method: 'POST', body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) { setMetaMsg({ error: data.error || `Could not connect (${res.status})` }); return; }
      setMetaMsg({ ok: `Connected ${data.phoneNumber || 'your number'}.${data.appSubscribed ? '' : ' (Webhook subscription pending — check credentials.)'}` });
      setConnOpen(false);
      await load();
    } catch (e) {
      setMetaMsg({ error: e.message });
    }
  };

  const fmtQ = q => ({ color: qualityColor(q), bg:`${qualityColor(q)}18`, bd:`${qualityColor(q)}44` });

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ height:58, borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', padding:'0 28px', flexShrink:0, background:'var(--surf)' }}>
        <h1 style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:16, color:'var(--t1)', letterSpacing:'-.02em' }}>Number Setup</h1>
        <p style={{ fontSize:11.5, color:'var(--t2)', marginLeft:10 }}>Manage your WhatsApp Business numbers</p>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'24px 28px', display:'flex', flexDirection:'column', gap:16, maxWidth:860, margin:'0 auto', width:'100%', boxSizing:'border-box' }}>

        {/* Active number */}
        <div style={{ ...card, padding:'22px 24px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:18 }}>
            <div style={{ width:52, height:52, borderRadius:14, background:'var(--gbg)', border:'1px solid var(--gbd)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <I n={number ? 'checkc' : 'alertc'} s={24} c={number ? 'var(--green)' : '#fbbf24'} />
            </div>
            <div style={{ flex:1 }}>
              <p style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:22, color:'var(--t1)', letterSpacing:'-.03em', marginBottom:6 }}>{number?.phoneNumber || 'No number connected'}</p>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {number?.quality && (
                  <span style={{ padding:'2px 9px', borderRadius:12, fontSize:11, fontWeight:700, background:fmtQ(number.quality).bg, border:`1px solid ${fmtQ(number.quality).bd}`, color:fmtQ(number.quality).color }}>Quality: {number.quality}</span>
                )}
                {number?.status && (
                  <span style={{ padding:'2px 9px', borderRadius:12, fontSize:11, fontWeight:700, background:'var(--gbg)', border:'1px solid var(--gbd)', color:'var(--green)' }}>{number.status}</span>
                )}
                {number?.messagingLimit && (
                  <span style={{ padding:'2px 9px', borderRadius:12, fontSize:11, fontWeight:600, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t2)' }}>{number.messagingLimit}</span>
                )}
              </div>
              {number?.displayName && <p style={{ fontSize:11, color:'var(--t3)', marginTop:5 }}>{number.displayName}</p>}
            </div>
            {isAdmin && (
              <div style={{ display:'flex', gap:8, flexShrink:0 }}>
                <Btn variant="outline" onClick={async () => {
                  setRefreshing(true);
                  wFetch('/whatsapp/numbers/refresh', { method:'POST' })
                    .then(r=>r.ok&&r.json()).then(d=>{ if(Array.isArray(d)&&d[0]) setNumber(d[0]); })
                    .catch(()=>{}).finally(()=>setRefreshing(false));
                }}>
                  <I n="refresh" s={13} c="var(--t2)" />
                  {refreshing ? 'Refreshing…' : 'Refresh Status'}
                </Btn>
                {number && (
                  <button
                    onClick={disconnectNumber}
                    disabled={disconnecting}
                    style={{
                      padding:'8px 14px',
                      borderRadius:8,
                      fontSize:13,
                      fontWeight:600,
                      cursor: disconnecting ? 'not-allowed' : 'pointer',
                      background:'rgba(239,68,68,0.08)',
                      border:'1px solid rgba(239,68,68,0.25)',
                      color:'#f87171',
                      fontFamily:"'Plus Jakarta Sans',sans-serif",
                      display:'inline-flex',
                      alignItems:'center',
                      gap:6,
                      opacity: disconnecting ? 0.6 : 1,
                    }}
                    title="Disconnect this number and return it to the pool">
                    {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {metaMsg && (
          <div style={{ padding:'11px 15px', borderRadius:8,
            background: metaMsg.error ? 'rgba(239,68,68,.08)' : 'var(--gbg)',
            border: `1px solid ${metaMsg.error ? 'rgba(239,68,68,.25)' : 'var(--gbd)'}`,
            display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <p style={{ fontSize:12.5, color: metaMsg.error ? '#f87171' : 'var(--green)' }}>{metaMsg.error || metaMsg.ok}</p>
            <button onClick={() => setMetaMsg(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--t2)', fontSize:14 }}>×</button>
          </div>
        )}

        {!isAdmin && (
          <div style={{ ...card, padding:'14px 18px', display:'flex', gap:10, alignItems:'center' }}>
            <I n="alertt" s={16} c="var(--t3)" />
            <p style={{ fontSize:12.5, color:'var(--t2)' }}>Connecting, refreshing or disconnecting a WhatsApp number requires a workspace admin.</p>
          </div>
        )}

        {/* Connect via Meta */}
        {isAdmin && <div style={{ ...card, border:'2px solid var(--gbd)', padding:'22px 24px', position:'relative' }}>
          <span style={{ position:'absolute', top:-11, left:20, padding:'2px 10px', borderRadius:10, fontSize:11, fontWeight:700, background:'var(--green)', color:'#060913' }}>Recommended</span>
          <div style={{ display:'flex', alignItems:'flex-start', gap:18 }}>
            <div style={{ flex:1 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M8 12c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4"/><circle cx="12" cy="12" r="2"/></svg>
                <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)' }}>Connect via Meta</span>
              </div>
              <p style={{ fontSize:13, color:'var(--t2)', marginBottom:12, lineHeight:1.55 }}>The easiest way to connect your WhatsApp Business account — no tokens to copy.</p>
              <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
                <CheckItem text="No Phone Number ID or tokens to copy" />
                <CheckItem text="All numbers imported automatically" />
                <CheckItem text="Works with existing Meta Business accounts" />
              </div>
            </div>
            <Btn style={{ boxShadow:'var(--glow)', flexShrink:0 }} onClick={connectWithMeta} disabled={metaConnecting}>
              {metaConnecting ? 'Redirecting…' : 'Connect with Meta'}
            </Btn>
          </div>
        </div>}

        {/* Two-option grid */}
        {isAdmin && <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          {/* Get a Number */}
          <div style={{ ...card, padding:'20px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
              <I n="sparkl" s={18} c="#A78BFA" />
              <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:14, color:'var(--t1)' }}>Get a Number</span>
            </div>
            <p style={{ fontSize:13, color:'var(--t2)', marginBottom:12, lineHeight:1.55 }}>We'll assign you a ready-to-use WhatsApp Business number instantly.</p>
            <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:16 }}>
              <CheckItem text="Instant provisioning" />
              <CheckItem text="Pre-verified by Meta" />
              <CheckItem text="Includes basic setup" />
            </div>
            <Btn onClick={openGetDialog} style={{ width:'100%', justifyContent:'center' }}>
              {number ? 'Get Another Number' : 'Get My WhatsApp Number'}
            </Btn>
          </div>

          {/* Connect Own */}
          <div style={{ ...card, padding:'20px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
              <I n="plug" s={18} c="#38bdf8" />
              <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:14, color:'var(--t1)' }}>Connect Your Own</span>
            </div>
            <p style={{ fontSize:13, color:'var(--t2)', marginBottom:12, lineHeight:1.55 }}>Already have a WhatsApp Business number? Connect it using your Meta credentials.</p>
            <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:16 }}>
              <CheckItem text="Bring your existing number" />
              <CheckItem text="Full control over settings" />
              <CheckItem text="Direct WABA connection" />
            </div>
            <Btn variant="outline" onClick={() => setConnOpen(true)} style={{ width:'100%', justifyContent:'center' }}>Connect My Number</Btn>
          </div>
        </div>}

        {/* Quality warning */}
        <div style={{ ...card, borderLeft:'3px solid #fbbf24', padding:'16px 20px', background:'rgba(245,158,11,.04)' }}>
          <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
            <I n="alertt" s={18} c="#fbbf24" />
            <div>
              <p style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:14, color:'#fbbf24', marginBottom:5 }}>Keep your quality rating high</p>
              <p style={{ fontSize:12, color:'var(--t2)', lineHeight:1.6 }}>High opt-out rates and spam reports lower your quality rating, which can reduce your messaging limits or temporarily suspend your number. Always send relevant, opted-in messages.</p>
            </div>
          </div>
        </div>

        {/* Admin: Number Pool Management */}
        {isSuperAdmin && (
          <div style={{ ...card, padding:'22px 24px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
              <div>
                <p style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:15, color:'var(--t1)', marginBottom:3 }}>Number Pool</p>
                <p style={{ fontSize:12, color:'var(--t2)' }}>Platform-wide inventory of WhatsApp numbers available for assignment</p>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <Btn variant="outline" onClick={resetAllAssignments} disabled={resetting} style={{ flexShrink:0, borderColor:'rgba(239,68,68,.3)', color:'#f87171' }}>
                  <I n="x" s={13} c={resetting ? 'var(--t3)' : '#f87171'} />
                  {resetting ? 'Resetting…' : 'Reset All'}
                </Btn>
                <Btn onClick={syncFromWaba} disabled={syncing} style={{ flexShrink:0 }}>
                  <I n="refresh" s={13} c={syncing ? 'var(--t3)' : 'var(--green)'} />
                  {syncing ? 'Syncing…' : 'Sync from Meta WABA'}
                </Btn>
              </div>
            </div>

            {/* Sync result feedback */}
            {syncResult && (
              <div style={{ marginBottom:16, padding:'10px 14px', borderRadius:8, background: syncResult.error ? 'rgba(239,68,68,.08)' : 'var(--gbg)', border:`1px solid ${syncResult.error ? 'rgba(239,68,68,.2)' : 'var(--gbd)'}` }}>
                {syncResult.error ? (
                  <p style={{ fontSize:12, color:'#f87171' }}>Sync failed — check admin API or Meta credentials.</p>
                ) : (
                  <p style={{ fontSize:12, color:'var(--green)' }}>
                    Added {syncResult.added?.length ?? 0} number{(syncResult.added?.length ?? 0) !== 1 ? 's' : ''}.
                    {syncResult.skipped?.length > 0 && ` Skipped ${syncResult.skipped.length} already in pool.`}
                  </p>
                )}
              </div>
            )}

            {/* Summary stats */}
            {adminPool?.summary && (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:18 }}>
                {[
                  { label:'Total',     val: adminPool.summary.total,     c:'var(--t1)' },
                  { label:'Available', val: adminPool.summary.available,  c:'var(--green)' },
                  { label:'Assigned',  val: adminPool.summary.assigned,   c:'#38bdf8' },
                  { label:'Banned',    val: adminPool.summary.banned,     c:'#f87171' },
                ].map(s => (
                  <div key={s.label} style={{ background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', borderRadius:10, padding:'12px 14px', textAlign:'center' }}>
                    <p style={{ fontSize:22, fontWeight:800, fontFamily:"'Syne',sans-serif", color:s.c, marginBottom:3 }}>{s.val}</p>
                    <p style={{ fontSize:11, color:'var(--t2)' }}>{s.label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Pool table */}
            {adminPoolLoading ? (
              <div style={{ textAlign:'center', padding:'24px 0' }}>
                <div style={{ width:28, height:28, border:'2px solid var(--green)', borderTopColor:'transparent', borderRadius:'50%', margin:'0 auto 10px', animation:'spin 1s linear infinite' }} />
                <p style={{ fontSize:13, color:'var(--t2)' }}>Loading pool…</p>
              </div>
            ) : adminPoolError ? (
              <div style={{ padding:'14px 16px', borderRadius:8, background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.2)' }}>
                <p style={{ fontSize:12, color:'#f87171', marginBottom:6 }}>Failed to load pool</p>
                <p style={{ fontSize:11, color:'var(--t3)', fontFamily:'monospace', wordBreak:'break-all' }}>{adminPoolError}</p>
                <button onClick={loadAdminPool} style={{ marginTop:10, padding:'4px 12px', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer', background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.25)', color:'#f87171' }}>Retry</button>
              </div>
            ) : !adminPool ? null
            : adminPool.pool.length === 0 ? (
              <div style={{ textAlign:'center', padding:'32px 0' }}>
                <I n="smartphone" s={36} c="var(--t3)" />
                <p style={{ fontSize:13, color:'var(--t2)', marginTop:10 }}>Pool is empty — click "Sync from Meta WABA" to import numbers.</p>
              </div>
            ) : (
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ borderBottom:'1px solid var(--bd)' }}>
                      {['Phone Number','Display Name','Status','Assigned To','Actions'].map(h => (
                        <th key={h} style={{ padding:'8px 10px', textAlign:'left', color:'var(--t2)', fontWeight:600, whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {adminPool.pool.map(e => {
                      const sc = statusColor(e.status);
                      return (
                        <tr key={e.id} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding:'10px 10px', color:'var(--t1)', fontFamily:'monospace', whiteSpace:'nowrap' }}>{e.phoneNumber}</td>
                          <td style={{ padding:'10px 10px', color:'var(--t2)' }}>{e.displayName || '—'}</td>
                          <td style={{ padding:'10px 10px' }}>
                            <span style={{ padding:'2px 9px', borderRadius:12, fontSize:11, fontWeight:700, background:sc.bg, border:`1px solid ${sc.bd}`, color:sc.c }}>{e.status}</span>
                          </td>
                          <td style={{ padding:'10px 10px', color:'var(--t2)', fontSize:11 }}>{e.assignedToName || '—'}</td>
                          <td style={{ padding:'10px 10px' }}>
                            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                              {e.status === 'AVAILABLE' && (
                                <button onClick={() => openAssignDialog(e)}
                                  style={{ padding:'4px 10px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:'rgba(14,165,233,.1)', border:'1px solid rgba(14,165,233,.25)', color:'#38bdf8' }}>
                                  Assign
                                </button>
                              )}
                              {e.status !== 'AVAILABLE' && (
                                <button onClick={() => resetEntry(e.id)}
                                  style={{ padding:'4px 10px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:'rgba(16,185,129,.1)', border:'1px solid rgba(16,185,129,.25)', color:'var(--green)' }}>
                                  Reset
                                </button>
                              )}
                              {e.status !== 'BANNED' && (
                                <button onClick={() => banEntry(e.id)}
                                  style={{ padding:'4px 10px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.2)', color:'#f87171' }}>
                                  Ban
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Get Number Dialog */}
      {/* Admin: Assign pool entry to workspace */}
      {assignOpen && (
        <Modal
          title={`Assign ${assignOpen.phoneNumber}`}
          onClose={() => { setAssignOpen(null); setAssignError(null); }}
          footer={<Btn variant="ghost" onClick={() => { setAssignOpen(null); setAssignError(null); }}>Cancel</Btn>}>
          <p style={{ fontSize:13, color:'var(--t2)', marginBottom:14 }}>
            Pick the workspace to connect this number to. The number will be created in their workspace and marked ASSIGNED in the pool.
          </p>
          {assignError && (
            <div style={{ marginBottom:12, padding:'9px 12px', borderRadius:8, background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.25)', color:'#f87171', fontSize:12 }}>
              {assignError}
            </div>
          )}
          <FInput value={wsSearch} onChange={e => setWsSearch(e.target.value)} placeholder="Search by name, owner, or email…" />
          <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:6, maxHeight:340, overflowY:'auto' }}>
            {wsLoading ? (
              <p style={{ fontSize:12, color:'var(--t3)', padding:'14px 4px' }}>Loading workspaces…</p>
            ) : workspaces.length === 0 ? (
              <p style={{ fontSize:12, color:'var(--t3)', padding:'14px 4px' }}>No workspaces found.</p>
            ) : (
              workspaces
                .filter(w => {
                  if (!wsSearch.trim()) return true;
                  const q = wsSearch.toLowerCase();
                  return w.name.toLowerCase().includes(q)
                    || w.owner?.name?.toLowerCase().includes(q)
                    || w.owner?.email?.toLowerCase().includes(q);
                })
                .map(w => (
                  <div key={w.id} style={{ padding:'10px 12px', borderRadius:8, border:'1px solid var(--bd)', display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontSize:13, fontWeight:600, color:'var(--t1)', marginBottom:2 }}>{w.name}</p>
                      {w.owner && (
                        <p style={{ fontSize:11, color:'var(--t3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {w.owner.name} — {w.owner.email}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => assignToWorkspace(w.id)}
                      disabled={assigning}
                      style={{ padding:'5px 12px', borderRadius:6, fontSize:11, fontWeight:600, cursor: assigning ? 'not-allowed' : 'pointer', background:'rgba(14,165,233,.1)', border:'1px solid rgba(14,165,233,.25)', color:'#38bdf8', flexShrink:0, opacity: assigning ? 0.6 : 1 }}>
                      {assigning ? 'Assigning…' : 'Assign'}
                    </button>
                  </div>
                ))
            )}
          </div>
        </Modal>
      )}

      {getOpen && (
        <Modal title="Get a WhatsApp Number" onClose={() => { setGetOpen(false); setGetError(null); }} footer={
          <>
            <Btn variant="ghost" onClick={() => { setGetOpen(false); setGetError(null); }}>Cancel</Btn>
            {!gotNumber && (
              <Btn disabled={!selPool || gettingNum} onClick={getNumber} style={{ boxShadow:'var(--glow)' }}>
                {gettingNum
                  ? <><svg width="13" height="13" viewBox="0 0 14 14" style={{ animation:'spin 1s linear infinite', marginRight:6 }}><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="20" strokeDashoffset="5"/></svg>Assigning…</>
                  : 'Get This Number'}
              </Btn>
            )}
            {gotNumber && <Btn onClick={() => setGetOpen(false)} style={{ boxShadow:'var(--glow)' }}>Done</Btn>}
          </>
        }>
          {getError && (
            <div style={{ marginBottom:14, padding:'10px 14px', borderRadius:8, background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.2)', fontSize:12, color:'#f87171' }}>
              {getError}
            </div>
          )}
          {gotNumber ? (
            <div style={{ textAlign:'center', padding:'24px 0' }}>
              <div style={{ display:'flex', justifyContent:'center', marginBottom:16 }}>
                <I n="checkc" s={48} c="var(--green)" />
              </div>
              <p style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:20, color:'var(--green)', marginBottom:8 }}>{gotNumber.phoneNumber}</p>
              <p style={{ fontSize:13, color:'var(--t2)' }}>Your number is live and ready to use.</p>
            </div>
          ) : poolLoading ? (
            <div style={{ textAlign:'center', padding:'32px 0', color:'var(--t2)' }}>
              <div style={{ width:32, height:32, border:'2px solid var(--green)', borderTopColor:'transparent', borderRadius:'50%', margin:'0 auto 12px', animation:'spin 1s linear infinite' }} />
              Loading available numbers…
            </div>
          ) : pool.length === 0 ? (
            <div style={{ textAlign:'center', padding:'32px 0' }}>
              <I n="smartphone" s={40} c="var(--t3)" />
              <p style={{ fontSize:14, color:'var(--t2)', marginTop:12 }}>No numbers available right now.</p>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:300, overflowY:'auto' }}>
              {pool.map(p => {
                const sel = selPool === p.id;
                return (
                  <div key={p.id} onClick={() => setSelPool(p.id)}
                    style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', borderRadius:10, border:`1.5px solid ${sel ? 'var(--green)' : 'var(--bd)'}`, background: sel ? 'var(--gbg)' : 'rgba(255,255,255,0.02)', cursor:'pointer', transition:'all .15s' }}>
                    <I n="smartphone" s={18} c={sel ? 'var(--green)' : 'var(--t2)'} />
                    <div style={{ flex:1 }}>
                      <p style={{ fontSize:14, fontWeight:700, color: sel ? 'var(--green)' : 'var(--t1)', fontFamily:'monospace' }}>{p.phoneNumber}</p>
                      {p.displayName && <p style={{ fontSize:11, color:'var(--t2)' }}>{p.displayName}</p>}
                    </div>
                    {sel && <I n="checkc" s={16} c="var(--green)" />}
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}

      {/* Connect Own Dialog */}
      {connOpen && (
        <Modal title="Connect Your Number" onClose={() => setConnOpen(false)} footer={
          <>
            <Btn variant="ghost" onClick={() => setConnOpen(false)}>Cancel</Btn>
            <Btn onClick={connectOwn} style={{ boxShadow:'var(--glow)' }}>Connect Number</Btn>
          </>
        }>
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {[
              { key:'phoneNumber',      label:'Phone Number',       hint:'', required:true,  ph:'+91 98765 43210',    type:'text' },
              { key:'metaPhoneNumberId',label:'Phone Number ID',    hint:'From Meta dashboard → WhatsApp → Phone Numbers', required:true, ph:'921047971092757', type:'text' },
              { key:'wabaId',           label:'WABA ID',            hint:'From Meta Business → WhatsApp Business Accounts', required:true, ph:'1475318980618872', type:'text' },
              { key:'displayName',      label:'Display Name',       hint:'', required:false, ph:'My Business',         type:'text' },
            ].map(f => (
              <div key={f.key}>
                <Label hint={f.hint} required={f.required}>{f.label}</Label>
                <FInput value={form[f.key]} onChange={e => setForm(p=>({...p,[f.key]:e.target.value}))} placeholder={f.ph} />
              </div>
            ))}
            <div>
              <Label hint="From Meta → System Users or your WABA access token" required={true}>Access Token</Label>
              <div style={{ position:'relative' }}>
                <FInput type={showTok ? 'text' : 'password'} value={form.accessToken} onChange={e => setForm(p=>({...p,accessToken:e.target.value}))} placeholder="EAAxxxxx…" />
                <button onClick={() => setShowTok(!showTok)} style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--t2)', display:'flex' }}>
                  <I n={showTok ? 'eyeoff' : 'eye'} s={15} c="var(--t2)" />
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
