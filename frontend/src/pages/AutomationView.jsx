import { useState, useEffect } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';

const card = { background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', boxShadow:'var(--card-shadow)' };

const INTEGRATIONS = [
  { id:'shopify',   name:'Shopify',        connected:true  },
  { id:'woo',       name:'WooCommerce',    connected:false },
  { id:'zapier',    name:'Zapier',         connected:true  },
  { id:'sheets',    name:'Google Sheets',  connected:true  },
  { id:'hubspot',   name:'HubSpot',        connected:false },
  { id:'razorpay',  name:'Razorpay',       connected:false },
];

const Toggle = ({ on, onToggle }) => (
  <div onClick={onToggle} style={{ width:36, height:20, borderRadius:20, background: on ? 'var(--green)' : 'rgba(255,255,255,0.1)', cursor:'pointer', transition:'background .2s', position:'relative', border:`1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`, flexShrink:0 }}>
    <div style={{ position:'absolute', top:2, left: on ? 17 : 2, width:14, height:14, borderRadius:'50%', background:'white', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,0.4)' }} />
  </div>
);

export default function AutomationView() {
  const [triggers, setTriggers] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [kw, setKw]             = useState('');
  const [resp, setResp]         = useState('');

  useEffect(() => {
    wFetch('/automation/triggers')
      .then(r => r.ok && r.json())
      .then(d => { if (Array.isArray(d)) setTriggers(d); })
      .catch(() => {});
  }, []);

  const openCreate = () => { setKw(''); setResp(''); setEditing(null); setCreating(true); };
  const openEdit   = t  => { setKw(t.keyword); setResp(t.responseTemplate); setEditing(t); setCreating(true); };
  const cancel     = () => { setCreating(false); setEditing(null); };

  const save = async () => {
    if (!kw.trim()) return;
    if (editing) {
      const updated = { ...editing, keyword:kw.toUpperCase(), responseTemplate:resp };
      await wFetch(`/automation/triggers/${editing.id}`, { method:'PATCH', body:JSON.stringify(updated) }).catch(()=>{});
      setTriggers(p => p.map(t => t.id === editing.id ? updated : t));
    } else {
      const neo = { id:`t${Date.now()}`, keyword:kw.toUpperCase(), responseTemplate:resp, isActive:true };
      await wFetch('/automation/triggers', { method:'POST', body:JSON.stringify({ keyword:neo.keyword, responseTemplate:resp, isActive:true }) }).catch(()=>{});
      setTriggers(p => [...p, neo]);
    }
    cancel();
  };

  const del = async id => {
    await wFetch(`/automation/triggers/${id}`, { method:'DELETE' }).catch(()=>{});
    setTriggers(p => p.filter(t => t.id !== id));
  };

  const toggleActive = async t => {
    const updated = { ...t, isActive:!t.isActive };
    await wFetch(`/automation/triggers/${t.id}`, { method:'PATCH', body:JSON.stringify({ isActive:updated.isActive }) }).catch(()=>{});
    setTriggers(p => p.map(x => x.id === t.id ? updated : x));
  };

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ height:58, borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', padding:'0 28px', flexShrink:0, background:'var(--surf)' }}>
        <h1 style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:16, color:'var(--t1)', letterSpacing:'-.02em' }}>Automation</h1>
        <p style={{ fontSize:11.5, color:'var(--t2)', marginLeft:10 }}>Configure triggers, flows &amp; integrations</p>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'24px 28px', display:'flex', flexDirection:'column', gap:18 }}>

        {/* ── Card 1: Visual Flow Builder ── */}
        <div style={{ ...card, border:'2px dashed var(--bd)', padding:'40px 28px', display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center', gap:14 }}>
          <div style={{ width:52, height:52, borderRadius:14, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="wflow" s={24} c="var(--t2)" />
          </div>
          <div>
            <p style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:17, color:'var(--t1)', marginBottom:6 }}>Visual Flow Builder</p>
            <p style={{ fontSize:13, color:'var(--t2)', marginBottom:4 }}>Design complex automation flows visually</p>
            <p style={{ fontSize:12, color:'var(--t3)' }}>Drag and drop triggers, conditions, and actions</p>
          </div>
          <Btn style={{ boxShadow:'var(--glow)' }}>
            <I n="plus" s={14} c="#060A10" />
            Create New Flow
          </Btn>
          <span style={{ fontSize:11, color:'var(--t3)', padding:'3px 10px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)' }}>Coming Soon</span>
        </div>

        {/* ── Card 2: Keyword Triggers ── */}
        <div style={{ ...card, overflow:'hidden' }}>
          <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <I n="zap" s={16} c="var(--green)" />
              <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)' }}>Keyword Triggers</span>
              <span style={{ fontSize:11, padding:'2px 8px', borderRadius:6, background:'var(--gbg)', border:'1px solid var(--gbd)', color:'var(--green)', fontWeight:600 }}>{triggers.length} active</span>
            </div>
            <Btn size="sm" style={{ background:'rgba(30,191,94,0.1)', color:'var(--green)', border:'1px solid var(--gbd)' }} onClick={openCreate}>
              <I n="plus" s={13} c="var(--green)" />
              Add Trigger
            </Btn>
          </div>

          {creating && (
            <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--bd)', background:'rgba(255,255,255,0.02)', display:'flex', flexDirection:'column', gap:12 }}>
              <p style={{ fontSize:12, fontWeight:700, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.07em' }}>{editing ? 'Edit Trigger' : 'New Trigger'}</p>
              <input value={kw} onChange={e => setKw(e.target.value.toUpperCase())} placeholder="STOP"
                style={{ padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--green)', fontSize:13, fontFamily:'monospace', outline:'none', letterSpacing:'.05em', width:'200px' }} />
              <textarea value={resp} onChange={e => setResp(e.target.value)} placeholder="Auto-reply message…"
                style={{ width:'100%', minHeight:60, padding:'9px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none', resize:'vertical', boxSizing:'border-box', lineHeight:1.55 }} />
              <div style={{ display:'flex', gap:8 }}>
                <Btn onClick={save} style={{ boxShadow:'var(--glow)' }}>Save Trigger</Btn>
                <Btn variant="ghost" onClick={cancel}>Cancel</Btn>
              </div>
            </div>
          )}

          <div>
            {triggers.length === 0 && (
              <div style={{ padding:'32px', textAlign:'center', color:'var(--t2)', fontSize:13 }}>No triggers yet. Add one above.</div>
            )}
            {triggers.map((t, i) => (
              <div key={t.id} style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 20px', borderBottom: i < triggers.length-1 ? '1px solid var(--bd)' : 'none', opacity: t.isActive ? 1 : 0.55, transition:'opacity .2s' }}>
                <span style={{ padding:'3px 10px', borderRadius:6, fontSize:12, fontWeight:700, fontFamily:'monospace', background:'rgba(30,191,94,0.08)', border:'1px solid var(--gbd)', color:'var(--green)', letterSpacing:'.05em', flexShrink:0 }}>{t.keyword}</span>
                <p style={{ flex:1, fontSize:13, color:'var(--t2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.responseTemplate}</p>
                <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                  <Toggle on={t.isActive} onToggle={() => toggleActive(t)} />
                  <button onClick={() => openEdit(t)} style={{ width:28, height:28, borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t2)' }}>
                    <I n="pencil" s={12} c="var(--t2)" />
                  </button>
                  <button onClick={() => del(t.id)} style={{ width:28, height:28, borderRadius:6, background:'rgba(239,68,68,0.07)', border:'1px solid rgba(239,68,68,0.2)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#f87171' }}>
                    <I n="trash" s={12} c="#f87171" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Card 3: Integrations ── */}
        <div style={{ ...card, padding:'20px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:18 }}>
            <I n="zap" s={16} c="var(--green)" />
            <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)' }}>Integrations</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
            {INTEGRATIONS.map(intg => (
              <div key={intg.id} style={{ padding:'14px 16px', borderRadius:10, border:'1px solid var(--bd)', background:'rgba(255,255,255,0.02)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <I n={intg.connected ? 'checkc' : 'x'} s={16} c={intg.connected ? 'var(--green)' : 'var(--t3)'} />
                  <span style={{ fontSize:13, fontWeight:600, color: intg.connected ? 'var(--t1)' : 'var(--t2)' }}>{intg.name}</span>
                </div>
                <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, fontWeight:600, background: intg.connected ? 'var(--gbg)' : 'rgba(255,255,255,0.04)', border:`1px solid ${intg.connected ? 'var(--gbd)' : 'var(--bd)'}`, color: intg.connected ? 'var(--green)' : 'var(--t2)', whiteSpace:'nowrap' }}>
                  {intg.connected ? 'Connected' : 'Connect'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
