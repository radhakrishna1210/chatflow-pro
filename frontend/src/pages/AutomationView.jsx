import { useState, useEffect } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';

const card = { background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', boxShadow:'var(--card-shadow)' };

const Toggle = ({ on, onToggle }) => (
  <div onClick={onToggle} style={{ width:36, height:20, borderRadius:20, background: on ? 'var(--green)' : 'rgba(255,255,255,0.1)', cursor:'pointer', transition:'background .2s', position:'relative', border:`1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`, flexShrink:0 }}>
    <div style={{ position:'absolute', top:2, left: on ? 17 : 2, width:14, height:14, borderRadius:'50%', background:'white', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,0.4)' }} />
  </div>
);

// ── SUB-TABS ──
const TABS = [
  { id: 'basic',     label: 'Basic Automations',        icon: 'play'  },
  { id: 'custom',    label: 'Custom Auto Reply',         icon: 'msg'   },
  { id: 'workflows', label: 'Workflows',                 icon: 'wflow' },
  { id: 'ai-intent', label: 'AI Intent Matching',        icon: 'spark' },
  { id: 'wa-agent',  label: 'WhatsApp AI Agent',         icon: 'bot'   },
  { id: 'ig-quick',  label: 'Instagram Quickflows',      icon: 'insta' },
  { id: 'voice-ai',  label: 'Voice AI - Inbound Calls',  icon: 'phone' },
  { id: 'wa-forms',  label: 'WhatsApp Forms',            icon: 'note'  },
  { id: 'interactive', label: 'Smart Lists',             icon: 'users' },
];

// ─────────────────────────────────────────────
// 1. BASIC AUTOMATIONS
// ─────────────────────────────────────────────
const BasicAutomationsTab = () => {
  const [ooo,     setOoo]     = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [delayed, setDelayed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    wFetch('/automation/basic')
      .then(r => r.ok && r.json())
      .then(d => {
        if (d) {
          setOoo(!!d.autoOooEnabled);
          setWelcome(!!d.autoWelcomeEnabled);
          setDelayed(!!d.autoDelayedEnabled);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const toggleSetting = async (setting, currentVal, setter) => {
    const newVal = !currentVal;
    setter(newVal);
    await wFetch('/automation/basic', {
      method: 'PATCH',
      body: JSON.stringify({ [setting]: newVal })
    }).catch(() => setter(currentVal));
  };

  if (loading) return <div style={{ color:'var(--t2)', fontSize:13, padding:20 }}>Loading...</div>;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'8px' }}>
        <div style={{ width:'36px', height:'36px', borderRadius:'8px', background:'rgba(30,191,94,0.1)', border:'1px solid var(--gbd)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <I n="play" s={18} c="var(--green)" />
        </div>
        <div>
          <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:'18px', color:'var(--t1)', marginBottom:'2px' }}>Basic Automations</h2>
          <p style={{ fontSize:'13px', color:'var(--t2)' }}>Set up Welcome, OOO &amp; Delayed autoreplies.</p>
        </div>
      </div>

      {[
        { title:'Out of Office Message', desc:'Set up your working hours and Out of Office Message. Auto Reply gets triggered for new users and users whose conversation is marked closed.', on:ooo,     set:() => toggleSetting('autoOooEnabled',     ooo,     setOoo)     },
        { title:'Welcome Message',        desc:'Configure Greeting message triggered when new customers reach out for the first time or existing customers reach out after 24 hours.',        on:welcome, set:() => toggleSetting('autoWelcomeEnabled', welcome, setWelcome) },
        { title:'Delayed Response Message',desc:'Configure Auto Replies when you are delayed in responding. Setup your delay time and the message to be triggered.',                          on:delayed, set:() => toggleSetting('autoDelayedEnabled', delayed, setDelayed) },
      ].map((b, i) => (
        <div key={i} style={{ ...card, padding:'0', display:'flex', flexDirection:'column' }}>
          <div style={{ padding:'16px 20px', display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div style={{ flex:1, paddingRight:'24px' }}>
              <h3 style={{ fontSize:'14px', fontWeight:600, color:'var(--t1)', marginBottom:'8px' }}>{b.title}</h3>
              <p style={{ fontSize:'12px', color:'var(--t2)', lineHeight:1.5 }}>{b.desc}</p>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <span style={{ fontSize:'12px', fontWeight:600, color: b.on ? 'var(--green)' : 'var(--t3)' }}>{b.on ? 'Enabled' : 'Disabled'}</span>
              <Toggle on={b.on} onToggle={b.set} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────
// 2. CUSTOM AUTO REPLY
// ─────────────────────────────────────────────
const CustomAutoReplyTab = () => {
  const [triggers, setTriggers] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editing,  setEditing]  = useState(null);
  const [kw,   setKw]   = useState('');
  const [resp, setResp] = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  useEffect(() => {
    wFetch('/automation/triggers')
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (Array.isArray(d)) setTriggers(d); })
      .catch(() => {});
  }, []);

  const openCreate = () => { setKw(''); setResp(''); setEditing(null); setError(''); setCreating(true); };
  const openEdit   = t  => { setKw(t.keyword); setResp(t.responseTemplate); setEditing(t); setError(''); setCreating(true); };
  const cancel     = () => { setCreating(false); setEditing(null); setError(''); };

  const save = async () => {
    if (!kw.trim()) { setError('Keyword is required'); return; }
    if (!resp.trim()) { setError('Response message is required'); return; }
    setError('');
    setSaving(true);
    try {
      if (editing) {
        const res = await wFetch(`/automation/triggers/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ keyword: kw.toUpperCase(), responseTemplate: resp })
        });
        if (!res.ok) throw new Error('Failed to update trigger');
        const updated = await res.json();
        setTriggers(p => p.map(t => t.id === editing.id ? updated : t));
      } else {
        const res = await wFetch('/automation/triggers', {
          method: 'POST',
          body: JSON.stringify({ keyword: kw.toUpperCase(), responseTemplate: resp, isActive: true })
        });
        if (!res.ok) throw new Error('Failed to create trigger');
        const data = await res.json();
        setTriggers(p => [data, ...p]);
      }
      cancel();
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const del = async id => {
    await wFetch(`/automation/triggers/${id}`, { method:'DELETE' }).catch(() => {});
    setTriggers(p => p.filter(t => t.id !== id));
  };

  const toggleActive = async t => {
    const updated = { ...t, isActive: !t.isActive };
    await wFetch(`/automation/triggers/${t.id}`, { method:'PATCH', body:JSON.stringify({ isActive:updated.isActive }) }).catch(() => {});
    setTriggers(p => p.map(x => x.id === t.id ? updated : x));
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'36px', height:'36px', borderRadius:'8px', background:'rgba(30,191,94,0.1)', border:'1px solid var(--gbd)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="msg" s={18} c="var(--green)" />
          </div>
          <div>
            <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:'18px', color:'var(--t1)', marginBottom:'2px' }}>Custom Auto Reply</h2>
            <p style={{ fontSize:'13px', color:'var(--t2)' }}>Keyword-based automatic replies for common questions</p>
          </div>
        </div>
        <Btn onClick={openCreate} style={{ boxShadow:'var(--glow)' }}><I n="plus" s={14} c="#060A10" /> Add Trigger</Btn>
      </div>

      {creating && (
        <div style={{ ...card, padding:'20px', display:'flex', flexDirection:'column', gap:'12px' }}>
          <p style={{ fontSize:13, fontWeight:700, color:'var(--t1)', fontFamily:"'Syne',sans-serif" }}>{editing ? 'Edit Trigger' : 'New Trigger'}</p>
          <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
            <label style={{ fontSize:'11px', fontWeight:600, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.05em' }}>Keyword</label>
            <input value={kw} onChange={e => setKw(e.target.value.toUpperCase())} placeholder="e.g. STOP"
              style={{ padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--green)', fontSize:13, fontFamily:'monospace', outline:'none', letterSpacing:'.05em', width:'200px' }} />
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
            <label style={{ fontSize:'11px', fontWeight:600, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.05em' }}>Auto-reply Message</label>
            <textarea value={resp} onChange={e => setResp(e.target.value)} placeholder="Auto-reply message…" rows={3}
              style={{ width:'100%', padding:'9px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none', resize:'vertical', boxSizing:'border-box' }} />
          </div>
          {error && <p style={{ fontSize:12, color:'#f87171', margin:0 }}>⚠️ {error}</p>}
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={save} disabled={saving} style={{ boxShadow:'var(--glow)' }}>{saving ? 'Saving…' : editing ? 'Update Trigger' : 'Save Trigger'}</Btn>
            <Btn variant="ghost" onClick={cancel}>Cancel</Btn>
          </div>
        </div>
      )}

      <div style={{ ...card, overflow:'hidden' }}>
        {triggers.length === 0 && (
          <div style={{ padding:'32px', textAlign:'center', color:'var(--t2)', fontSize:13 }}>No triggers yet. Add one above.</div>
        )}
        {triggers.map((t, i) => (
          <div key={t.id} style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 20px', borderBottom: i < triggers.length-1 ? '1px solid var(--bd)' : 'none', opacity: t.isActive ? 1 : 0.55, transition:'opacity .2s' }}>
            <span style={{ padding:'3px 10px', borderRadius:6, fontSize:12, fontWeight:700, fontFamily:'monospace', background:'rgba(30,191,94,0.08)', border:'1px solid var(--gbd)', color:'var(--green)', letterSpacing:'.05em', flexShrink:0 }}>{t.keyword}</span>
            <p style={{ flex:1, fontSize:13, color:'var(--t2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.responseTemplate}</p>
            <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
              <Toggle on={t.isActive} onToggle={() => toggleActive(t)} />
              <button onClick={() => openEdit(t)} style={{ width:28, height:28, borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <I n="pencil" s={12} c="var(--t2)" />
              </button>
              <button onClick={() => del(t.id)} style={{ width:28, height:28, borderRadius:6, background:'rgba(239,68,68,0.07)', border:'1px solid rgba(239,68,68,0.2)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <I n="trash" s={12} c="#f87171" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// 3. WORKFLOWS
// ─────────────────────────────────────────────
const WorkflowsTab = () => (
  <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
    <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
      <div style={{ width:'36px', height:'36px', borderRadius:'8px', background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <I n="wflow" s={18} c="#f59e0b" />
      </div>
      <div>
        <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:'18px', color:'var(--t1)', marginBottom:'2px' }}>Workflows</h2>
        <p style={{ fontSize:'13px', color:'var(--t2)' }}>Build multi-step automation flows with conditions and actions</p>
      </div>
    </div>
    <div style={{ ...card, padding:'40px 28px', display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center', gap:16 }}>
      <div style={{ width:64, height:64, borderRadius:16, background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <I n="wflow" s={32} c="#f59e0b" />
      </div>
      <div>
        <h3 style={{ fontSize:16, fontWeight:600, color:'var(--t1)', marginBottom:8 }}>Visual Flow Builder Coming Soon</h3>
        <p style={{ fontSize:13, color:'var(--t2)', maxWidth:360, margin:'0 auto' }}>Design powerful multi-step automation flows with drag-and-drop triggers, conditions, delays, and actions.</p>
      </div>
      <Btn variant="outline">Notify Me</Btn>
    </div>
  </div>
);

// ─────────────────────────────────────────────
// 4. AI INTENT MATCHING
// ─────────────────────────────────────────────
const AIIntentMatchingTab = () => {
  const [enabled, setEnabled] = useState(false);
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'36px', height:'36px', borderRadius:'8px', background:'rgba(167,139,250,0.1)', border:'1px solid rgba(167,139,250,0.3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="spark" s={18} c="#a78bfa" />
          </div>
          <div>
            <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:'18px', color:'var(--t1)', marginBottom:'2px' }}>AI Intent Matching</h2>
            <p style={{ fontSize:'13px', color:'var(--t2)' }}>Let AI intelligently route messages to the right automation</p>
          </div>
        </div>
        <Toggle on={enabled} onToggle={() => setEnabled(!enabled)} />
      </div>
      <div style={{ ...card, padding:'24px' }}>
        <p style={{ fontSize:13, color:'var(--t2)', lineHeight:1.6 }}>AI Intent Matching uses machine learning to understand what your customers are asking, and automatically routes messages to the best matching keyword trigger or workflow. Enable it above to activate this feature for your workspace.</p>
        <div style={{ marginTop:16, padding:'12px 16px', background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.3)', borderRadius:8, fontSize:12, color:'#fbbf24', display:'flex', alignItems:'center', gap:8 }}>
          <I n="alertc" s={14} />
          ₹0.2 per successful intent match will be deducted from wallet.
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// 5. WHATSAPP AI AGENT
// ─────────────────────────────────────────────
const WhatsAppAIAgentTab = () => {
  const [kbEnabled, setKbEnabled] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [deployed,  setDeployed]  = useState(false);

  const handleDeploy = () => {
    if (deploying || deployed) return;
    setDeploying(true);
    setTimeout(() => { setDeploying(false); setDeployed(true); setTimeout(() => setDeployed(false), 2000); }, 1500);
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'36px', height:'36px', borderRadius:'8px', background:'rgba(30,191,94,0.1)', border:'1px solid var(--gbd)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="bot" s={18} c="var(--green)" />
          </div>
          <div>
            <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:'18px', color:'var(--t1)', marginBottom:'2px' }}>WhatsApp AI Agent</h2>
            <p style={{ fontSize:'13px', color:'var(--t2)' }}>Configure your automated AI assistant</p>
          </div>
        </div>
        <Btn style={{ boxShadow: deploying || deployed ? 'none' : 'var(--glow)', background: deployed ? 'var(--gbg)' : 'var(--green)', color: deployed ? 'var(--green)' : '#07090F' }} onClick={handleDeploy}>
          {deploying ? <><svg width="14" height="14" viewBox="0 0 14 14" style={{ animation:'spin 1s linear infinite' }}><circle cx="7" cy="7" r="5" fill="none" stroke="#07090F" strokeWidth="2" strokeDasharray="20" strokeDashoffset="5" /></svg> Deploying...</> : deployed ? <><I n="check" s={14} c="var(--green)" w={2}/> Deployed!</> : <><I n="play" s={14} c="#060913"/> Deploy Agent</>}
        </Btn>
      </div>
      <div style={{ ...card, padding:'24px', display:'flex', flexDirection:'column', gap:'20px' }}>
        <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
          <label style={{ fontSize:'12px', fontWeight:600, color:'var(--t1)' }}>System Prompt</label>
          <textarea placeholder="You are a helpful customer support agent for ChatFlow Pro..." style={{ width:'100%', minHeight:'120px', padding:'12px 16px', borderRadius:'8px', background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:'13px', fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none', resize:'vertical' }} />
          <span style={{ fontSize:'11px', color:'var(--t3)' }}>Instruct the AI on how to behave and respond to customers.</span>
        </div>
        <div style={{ display:'flex', gap:'24px' }}>
          <div style={{ flex:1, display:'flex', flexDirection:'column', gap:'8px' }}>
            <label style={{ fontSize:'12px', fontWeight:600, color:'var(--t1)' }}>AI Model</label>
            <select style={{ width:'100%', padding:'10px 16px', borderRadius:'8px', background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:'13px', outline:'none' }}>
              <option value="gpt-4o" style={{ background:'#07090F' }}>GPT-4o (Recommended)</option>
              <option value="gpt-4-turbo" style={{ background:'#07090F' }}>GPT-4 Turbo</option>
              <option value="claude-3-5" style={{ background:'#07090F' }}>Claude 3.5 Sonnet</option>
            </select>
          </div>
          <div style={{ flex:1, display:'flex', flexDirection:'column', gap:'8px' }}>
            <label style={{ fontSize:'12px', fontWeight:600, color:'var(--t1)' }}>Creativity (Temperature)</label>
            <input type="range" min="0" max="1" step="0.1" defaultValue="0.7" style={{ width:'100%', marginTop:'8px' }} />
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', color:'var(--t3)' }}><span>Precise</span><span>Creative</span></div>
          </div>
        </div>
        <div style={{ borderTop:'1px solid var(--bd)', paddingTop:'20px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <h4 style={{ fontSize:'14px', fontWeight:600, color:'var(--t1)', marginBottom:'4px' }}>Knowledge Base Integration</h4>
            <p style={{ fontSize:'12px', color:'var(--t2)' }}>Allow AI to read your documents and answer questions accurately.</p>
          </div>
          <Toggle on={kbEnabled} onToggle={() => setKbEnabled(!kbEnabled)} />
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// 6. INSTAGRAM QUICKFLOWS
// ─────────────────────────────────────────────
const InstagramQuickflowsTab = () => {
  const handleConnect = () => {
    const clientId = '1483504773159594';
    const redirectUri = encodeURIComponent(`${window.location.origin}/api/v1/auth/instagram/callback`);
    const scopes = 'instagram_basic,instagram_manage_messages,instagram_manage_comments,pages_show_list';
    window.location.href = `https://api.instagram.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scopes}&response_type=code`;
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'36px', height:'36px', borderRadius:'8px', background:'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="insta" s={18} c="#fff" />
          </div>
          <div>
            <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:'18px', color:'var(--t1)', marginBottom:'2px' }}>Instagram Quickflows</h2>
            <p style={{ fontSize:'13px', color:'var(--t2)' }}>Automate your Instagram DMs &amp; Comments</p>
          </div>
        </div>
        <Btn style={{ boxShadow:'var(--glow)' }}><I n="plus" s={14} c="#060913"/> New IG Flow</Btn>
      </div>
      <div style={{ ...card, padding:'40px 20px', textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap:'16px' }}>
        <div style={{ width:'64px', height:'64px', borderRadius:'16px', background:'rgba(255,255,255,0.02)', border:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <I n="insta" s={32} c="var(--t3)" />
        </div>
        <div>
          <h3 style={{ fontSize:'16px', fontWeight:600, color:'var(--t1)', marginBottom:'8px' }}>No Instagram Flows Yet</h3>
          <p style={{ fontSize:'13px', color:'var(--t2)', maxWidth:'400px', margin:'0 auto' }}>Create automated replies for story mentions, comments on posts, or direct messages to boost your engagement.</p>
        </div>
        <Btn variant="outline" onClick={handleConnect}>Connect Instagram Account</Btn>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// 7. VOICE AI
// ─────────────────────────────────────────────
const VoiceAITab = () => {
  const [enabled, setEnabled] = useState(false);
  const [name,   setName]   = useState('MyCallGenie');
  const [prompt, setPrompt] = useState('Greet the caller and ask for their details.');
  const [phone,  setPhone]  = useState('');
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    wFetch('/automation/voice')
      .then(r => r.ok && r.json())
      .then(d => {
        if (d) {
          setEnabled(!!d.voiceAiEnabled);
          setName(d.voiceAiName || 'MyCallGenie');
          setPrompt(d.voiceAiPrompt || 'Greet the caller and ask for their details.');
          setPhone(d.voiceAiPhone || '');
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleToggle = async newVal => {
    setEnabled(newVal);
    await wFetch('/automation/voice', {
      method: 'PATCH',
      body: JSON.stringify({ voiceAiEnabled: newVal })
    }).catch(() => setEnabled(!newVal));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await wFetch('/automation/voice', {
        method: 'PATCH',
        body: JSON.stringify({ voiceAiName: name, voiceAiPrompt: prompt, voiceAiPhone: phone })
      });
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ color:'var(--t2)', fontSize:13, padding:20 }}>Loading...</div>;

  if (!enabled) {
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'36px', height:'36px', borderRadius:'8px', background:'rgba(30,191,94,0.1)', border:'1px solid var(--gbd)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="phone" s={18} c="var(--green)" />
          </div>
          <div>
            <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:'18px', color:'var(--t1)', marginBottom:'2px' }}>Voice AI - Inbound Calls</h2>
            <p style={{ fontSize:'13px', color:'var(--t2)' }}>Set up AI to answer inbound calls and capture leads.</p>
          </div>
        </div>
        <div style={{ ...card, padding:'40px', display:'flex', flexDirection:'column', alignItems:'center', gap:'32px' }}>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'40px', width:'100%', justifyContent:'center', alignItems:'center' }}>
            <div style={{ flex:1, minWidth:'280px', display:'flex', flexDirection:'column', gap:'16px' }}>
              <p style={{ fontSize:'20px', fontFamily:"'Syne',sans-serif", fontWeight:700, color:'var(--t1)', lineHeight:1.3 }}>
                Get an <span style={{ color:'var(--green)' }}>AI Receptionist</span> to handle your calls 24/7.
              </p>
              <ul style={{ display:'flex', flexDirection:'column', gap:'12px', padding:0, listStyle:'none' }}>
                {['AI answers calls 24x7','Leads auto-pushed to ChatFlow Pro','Works on your existing personal number','Built by your trusted team'].map((item, i) => (
                  <li key={i} style={{ display:'flex', alignItems:'center', gap:'12px', fontSize:'14px', color:'var(--t1)' }}>
                    <I n="check" s={16} c="var(--green)" /> {item}
                  </li>
                ))}
              </ul>
            </div>
            <div style={{ flex:1, minWidth:'300px' }}>
              <p style={{ fontSize:'14px', fontWeight:700, color:'var(--t1)', marginBottom:'16px', textAlign:'center' }}>How It Works</p>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:'rgba(255,255,255,0.02)', padding:'20px', borderRadius:'12px', border:'1px solid var(--bd)' }}>
                <div style={{ textAlign:'center' }}>
                  <div style={{ width:'40px', height:'40px', borderRadius:'50%', background:'rgba(255,255,255,0.05)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 8px' }}><I n="phone" s={18} c="var(--t2)" /></div>
                  <p style={{ fontSize:'11px', color:'var(--t2)', fontWeight:600 }}>Missed Call</p>
                </div>
                <I n="arrow" s={14} c="var(--t3)" />
                <div style={{ textAlign:'center' }}>
                  <div style={{ width:'40px', height:'40px', borderRadius:'50%', background:'#581c87', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 8px' }}><I n="spark" s={18} c="#e9d5ff" /></div>
                  <p style={{ fontSize:'11px', color:'var(--t2)', fontWeight:600 }}>AI Answers</p>
                </div>
                <I n="arrow" s={14} c="var(--t3)" />
                <div style={{ textAlign:'center' }}>
                  <div style={{ width:'40px', height:'40px', borderRadius:'50%', background:'var(--green)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 8px' }}><I n="users" s={18} c="#000" /></div>
                  <p style={{ fontSize:'11px', color:'var(--t2)', fontWeight:600 }}>Lead Captured</p>
                </div>
              </div>
            </div>
          </div>
          <Btn style={{ padding:'12px 32px', fontSize:'15px', boxShadow:'var(--glow)' }} onClick={() => handleToggle(true)}>Get Started Now →</Btn>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'36px', height:'36px', borderRadius:'8px', background:'rgba(30,191,94,0.1)', border:'1px solid var(--gbd)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="phone" s={18} c="var(--green)" />
          </div>
          <div>
            <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:'18px', color:'var(--t1)', marginBottom:'2px' }}>Voice AI - Receptionist Settings</h2>
            <p style={{ fontSize:'13px', color:'var(--t2)' }}>Configure how the Voice AI interacts with callers</p>
          </div>
        </div>
        <Btn variant="outline" onClick={() => handleToggle(false)} style={{ borderColor:'#f8717133', color:'#f87171' }}>Deactivate Agent</Btn>
      </div>
      <div style={{ ...card, padding:'24px', display:'flex', flexDirection:'column', gap:'20px' }}>
        <div style={{ display:'flex', gap:'24px', flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:'250px', display:'flex', flexDirection:'column', gap:'8px' }}>
            <label style={{ fontSize:'12px', fontWeight:600, color:'var(--t1)' }}>Agent Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. MyCallGenie"
              style={{ width:'100%', padding:'10px 16px', borderRadius:'8px', background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:'13px', outline:'none' }} />
          </div>
          <div style={{ flex:1, minWidth:'250px', display:'flex', flexDirection:'column', gap:'8px' }}>
            <label style={{ fontSize:'12px', fontWeight:600, color:'var(--t1)' }}>Call Forwarding Number</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. +1 (555) 019-2834"
              style={{ width:'100%', padding:'10px 16px', borderRadius:'8px', background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:'13px', outline:'none' }} />
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
          <label style={{ fontSize:'12px', fontWeight:600, color:'var(--t1)' }}>System Prompt / Agent Instructions</label>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Greet the caller and ask for their details..."
            style={{ width:'100%', minHeight:'120px', padding:'12px 16px', borderRadius:'8px', background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:'13px', fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none', resize:'vertical' }} />
          <span style={{ fontSize:'11px', color:'var(--t3)' }}>Provide guidance on what info the AI should gather from the caller.</span>
        </div>
        <div style={{ display:'flex', gap:8, marginTop:'4px' }}>
          <Btn onClick={handleSave} disabled={saving} style={{ boxShadow:'var(--glow)' }}>{saving ? 'Saving...' : 'Save Settings'}</Btn>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// 8. WHATSAPP FORMS
// ─────────────────────────────────────────────
const WhatsAppFormsTab = () => {
  const [forms,      setForms]      = useState([]);
  const [editing,    setEditing]    = useState(null);
  const [creating,   setCreating]   = useState(false);
  const [formName,   setFormName]   = useState('');
  const [formFields, setFormFields] = useState(1);
  const [formStatus, setFormStatus] = useState('Draft');
  const [error,  setError]  = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    wFetch('/whatsapp-forms')
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (Array.isArray(d)) setForms(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const openCreate = () => { setFormName(''); setFormFields(1); setFormStatus('Draft'); setEditing(null); setError(''); setCreating(true); };
  const openEdit   = form => { setFormName(form.name); setFormFields(form.fields); setFormStatus(form.status); setEditing(form); setError(''); setCreating(true); };
  const cancel     = () => { setCreating(false); setEditing(null); setError(''); };

  const save = async () => {
    if (!formName.trim()) { setError('Form name is required'); return; }
    setError('');
    try {
      if (editing) {
        const res = await wFetch(`/whatsapp-forms/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: formName, fields: formFields, status: formStatus })
        });
        if (!res.ok) throw new Error('Failed to update form');
        const updated = await res.json();
        setForms(prev => prev.map(f => f.id === editing.id ? updated : f));
      } else {
        const res = await wFetch('/whatsapp-forms', {
          method: 'POST',
          body: JSON.stringify({ name: formName, fields: formFields })
        });
        if (!res.ok) throw new Error('Failed to create form');
        const created = await res.json();
        setForms(prev => [created, ...prev]);
      }
      cancel();
    } catch (err) {
      setError(err.message || 'Something went wrong');
    }
  };

  const deleteForm = async id => {
    if (!window.confirm('Delete this form?')) return;
    try {
      const res = await wFetch(`/whatsapp-forms/${id}`, { method:'DELETE' });
      if (res.ok) setForms(prev => prev.filter(f => f.id !== id));
    } catch (err) { console.error(err); }
  };

  const toggleStatus = async id => {
    const form = forms.find(f => f.id === id);
    if (!form) return;
    const newStatus = form.status === 'Active' ? 'Draft' : 'Active';
    setForms(prev => prev.map(f => f.id === id ? { ...f, status: newStatus } : f));
    try {
      const res = await wFetch(`/whatsapp-forms/${id}`, { method:'PATCH', body: JSON.stringify({ status: newStatus }) });
      if (!res.ok) throw new Error();
    } catch { setForms(prev => prev.map(f => f.id === id ? form : f)); }
  };

  if (loading) return <div style={{ color:'var(--t2)', fontSize:13, padding:20 }}>Loading...</div>;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'36px', height:'36px', borderRadius:'8px', background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="note" s={18} c="var(--t2)" />
          </div>
          <div>
            <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:'18px', color:'var(--t1)', marginBottom:'2px' }}>WhatsApp Forms</h2>
            <p style={{ fontSize:'13px', color:'var(--t2)' }}>Collect structured data natively inside WhatsApp</p>
          </div>
        </div>
        <Btn style={{ boxShadow:'var(--glow)' }} onClick={openCreate}><I n="plus" s={14} c="#060913"/> Create Form</Btn>
      </div>

      {creating && (
        <div style={{ ...card, padding:'20px', display:'flex', flexDirection:'column', gap:'16px' }}>
          <p style={{ fontSize:13, fontWeight:700, color:'var(--t1)', fontFamily:"'Syne',sans-serif" }}>{editing ? 'Edit Form' : 'Create New Form'}</p>
          <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
            <label style={{ fontSize:'11px', fontWeight:600, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.05em' }}>Form Name <span style={{ color:'#f87171' }}>*</span></label>
            <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Customer Feedback Survey"
              style={{ padding:'10px 14px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:`1px solid ${error && !formName.trim() ? '#f87171' : 'var(--bd)'}`, color:'var(--t1)', fontSize:13, outline:'none', width:'100%', maxWidth:'400px', boxSizing:'border-box' }} />
          </div>
          <div style={{ display:'flex', gap:'16px' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
              <label style={{ fontSize:'11px', fontWeight:600, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.05em' }}>Number of Fields</label>
              <input type="number" min="1" value={formFields} onChange={e => setFormFields(parseInt(e.target.value) || 1)}
                style={{ padding:'10px 14px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, outline:'none', width:'120px' }} />
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
              <label style={{ fontSize:'11px', fontWeight:600, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.05em' }}>Status</label>
              <select value={formStatus} onChange={e => setFormStatus(e.target.value)}
                style={{ padding:'10px 14px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, outline:'none' }}>
                <option value="Draft" style={{ background:'#07090F' }}>Draft</option>
                <option value="Active" style={{ background:'#07090F' }}>Active</option>
              </select>
            </div>
          </div>
          {error && <p style={{ fontSize:12, color:'#f87171', margin:0 }}>⚠️ {error}</p>}
          <div style={{ display:'flex', gap:8, marginTop:'4px' }}>
            <Btn onClick={save} style={{ boxShadow:'var(--glow)' }}>{editing ? 'Update Form' : 'Create Form'}</Btn>
            <Btn variant="ghost" onClick={cancel}>Cancel</Btn>
          </div>
        </div>
      )}

      <div style={{ ...card, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', textAlign:'left' }}>
          <thead>
            <tr style={{ borderBottom:'1px solid var(--bd)' }}>
              {['Form Name','Submissions','Fields','Status',''].map(h => (
                <th key={h} style={{ padding:'12px 20px', fontSize:'11px', fontWeight:600, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.05em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {forms.length === 0 && (
              <tr><td colSpan="5" style={{ padding:'32px', textAlign:'center', color:'var(--t2)', fontSize:'13px' }}>No forms yet. Create one above.</td></tr>
            )}
            {forms.map((form, i) => (
              <tr key={form.id} style={{ borderBottom: i < forms.length-1 ? '1px solid var(--bd)' : 'none' }}>
                <td style={{ padding:'14px 20px', fontSize:'13px', fontWeight:600, color:'var(--t1)' }}>{form.name}</td>
                <td style={{ padding:'14px 20px', fontSize:'13px', color:'var(--t2)' }}>{(form.submissions || 0).toLocaleString()}</td>
                <td style={{ padding:'14px 20px', fontSize:'13px', color:'var(--t2)' }}>{form.fields} Fields</td>
                <td style={{ padding:'14px 20px' }}>
                  <span onClick={() => toggleStatus(form.id)} style={{ padding:'2px 8px', borderRadius:10, fontSize:11, fontWeight:600, cursor:'pointer', color: form.status === 'Active' ? 'var(--green)' : 'var(--t3)', background: form.status === 'Active' ? 'var(--gbg)' : 'rgba(255,255,255,0.04)', border:`1px solid ${form.status === 'Active' ? 'var(--gbd)' : 'var(--bd)'}` }}>
                    {form.status}
                  </span>
                </td>
                <td style={{ padding:'14px 20px', textAlign:'right' }}>
                  <button onClick={() => openEdit(form)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--t2)', marginRight:'12px' }}><I n="pencil" s={14}/></button>
                  <button onClick={() => deleteForm(form.id)} style={{ background:'none', border:'none', cursor:'pointer', color:'#f87171' }}><I n="trash" s={14}/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// 9. SMART LISTS
// ─────────────────────────────────────────────
const SmartListsTab = () => {
  const [segments, setSegments] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [viewingSegmentId, setViewingSegmentId] = useState(null);

  // Segment form
  const [segFormOpen, setSegFormOpen] = useState(false);
  const [editingSeg,  setEditingSeg]  = useState(null);
  const [segName, setSegName] = useState('');
  const [segDesc, setSegDesc] = useState('');
  const [segError, setSegError] = useState('');

  // Contact form
  const [contactFormOpen,  setContactFormOpen]  = useState(false);
  const [editingContact,   setEditingContact]   = useState(null);
  const [contactName,  setContactName]  = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactError, setContactError] = useState('');

  const segColors = ['#8b5cf6','#f43f5e','#0ea5e9','#f59e0b','#10b981','#ec4899'];
  const viewingSegment = segments.find(s => s.id === viewingSegmentId) || null;

  const fetchSegments = async () => {
    try {
      const res = await wFetch('/segments');
      if (res.ok) {
        const data = await res.json();
        setSegments(Array.isArray(data) ? data : []);
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchSegments(); }, []);

  // ── Segment CRUD ──
  const openCreateSeg = () => { setSegName(''); setSegDesc(''); setEditingSeg(null); setSegError(''); setSegFormOpen(true); };
  const openEditSeg   = seg => { setSegName(seg.name); setSegDesc(seg.description || seg.desc || ''); setEditingSeg(seg); setSegError(''); setSegFormOpen(true); };
  const cancelSegForm = () => { setSegFormOpen(false); setEditingSeg(null); setSegError(''); };

  const saveSeg = async () => {
    if (!segName.trim()) { setSegError('Segment name is required'); return; }
    setSegError('');
    try {
      if (editingSeg) {
        const res = await wFetch(`/segments/${editingSeg.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: segName, description: segDesc })
        });
        if (!res.ok) throw new Error('Failed to update segment');
      } else {
        const res = await wFetch('/segments', {
          method: 'POST',
          body: JSON.stringify({ name: segName, description: segDesc, color: segColors[segments.length % segColors.length] })
        });
        if (!res.ok) throw new Error('Failed to create segment');
      }
      await fetchSegments();
      cancelSegForm();
    } catch (err) { setSegError(err.message || 'Something went wrong'); }
  };

  const deleteSeg = async id => {
    if (!window.confirm('Delete this segment?')) return;
    try {
      const res = await wFetch(`/segments/${id}`, { method:'DELETE' });
      if (res.ok) {
        if (viewingSegmentId === id) setViewingSegmentId(null);
        await fetchSegments();
      }
    } catch (err) { console.error(err); }
  };

  // ── Contact CRUD ──
  const openAddContact  = () => { setContactName(''); setContactPhone(''); setEditingContact(null); setContactError(''); setContactFormOpen(true); };
  const openEditContact = c => { setContactName(c.name); setContactPhone(c.phone || c.phoneNumber || ''); setEditingContact(c); setContactError(''); setContactFormOpen(true); };
  const cancelContactForm = () => { setContactFormOpen(false); setEditingContact(null); setContactError(''); };

  const saveContact = async () => {
    if (!contactName.trim()) { setContactError('Name is required'); return; }
    if (!contactPhone.trim()) { setContactError('Phone number is required'); return; }
    setContactError('');
    try {
      if (editingContact) {
        const res = await wFetch(`/segments/${viewingSegmentId}/contacts/${editingContact.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: contactName, phone: contactPhone })
        });
        if (!res.ok) throw new Error('Failed to update contact');
      } else {
        const res = await wFetch(`/segments/${viewingSegmentId}/contacts`, {
          method: 'POST',
          body: JSON.stringify({ name: contactName, phone: contactPhone })
        });
        if (!res.ok) throw new Error('Failed to add contact');
      }
      await fetchSegments();
      cancelContactForm();
    } catch (err) { setContactError(err.message || 'Something went wrong'); }
  };

  const deleteContact = async contactId => {
    if (!window.confirm('Remove this contact from the segment?')) return;
    try {
      await wFetch(`/segments/${viewingSegmentId}/contacts/${contactId}`, { method:'DELETE' });
      await fetchSegments();
    } catch (err) { console.error(err); }
  };

  if (loading) return <div style={{ color:'var(--t2)', fontSize:13, padding:20 }}>Loading...</div>;

  // ── Segment detail view ──
  if (viewingSegment) {
    const contacts = viewingSegment.contacts || [];
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
            <button onClick={() => setViewingSegmentId(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--t2)', fontSize:13, display:'flex', alignItems:'center', gap:6 }}>
              <I n="arrow" s={14} c="var(--t2)" style={{ transform:'rotate(180deg)' }} /> Back to Segments
            </button>
            <span style={{ color:'var(--t3)' }}>/</span>
            <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:'18px', color:'var(--t1)' }}>{viewingSegment.name}</h2>
          </div>
          <Btn onClick={openAddContact} style={{ boxShadow:'var(--glow)' }}><I n="plus" s={14} c="#060A10" /> Add Contact</Btn>
        </div>

        {contactFormOpen && (
          <div style={{ ...card, padding:'20px', display:'flex', flexDirection:'column', gap:'12px' }}>
            <p style={{ fontSize:13, fontWeight:700, color:'var(--t1)', fontFamily:"'Syne',sans-serif" }}>{editingContact ? 'Edit Contact' : 'Add Contact'}</p>
            <div style={{ display:'flex', gap:'16px', flexWrap:'wrap' }}>
              <div style={{ flex:1, minWidth:'200px', display:'flex', flexDirection:'column', gap:'6px' }}>
                <label style={{ fontSize:'11px', fontWeight:600, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.05em' }}>Name</label>
                <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="e.g. Alice Smith"
                  style={{ padding:'10px 14px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, outline:'none', width:'100%', boxSizing:'border-box' }} />
              </div>
              <div style={{ flex:1, minWidth:'200px', display:'flex', flexDirection:'column', gap:'6px' }}>
                <label style={{ fontSize:'11px', fontWeight:600, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.05em' }}>Phone Number</label>
                <input value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="e.g. +919999988888"
                  style={{ padding:'10px 14px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, outline:'none', width:'100%', boxSizing:'border-box' }} />
              </div>
            </div>
            {contactError && <p style={{ fontSize:12, color:'#f87171', margin:0 }}>⚠️ {contactError}</p>}
            <div style={{ display:'flex', gap:8 }}>
              <Btn onClick={saveContact} style={{ boxShadow:'var(--glow)' }}>{editingContact ? 'Update Contact' : 'Add Contact'}</Btn>
              <Btn variant="ghost" onClick={cancelContactForm}>Cancel</Btn>
            </div>
          </div>
        )}

        <div style={{ ...card, overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', textAlign:'left' }}>
            <thead>
              <tr style={{ borderBottom:'1px solid var(--bd)' }}>
                {['Name','Phone',''].map(h => (
                  <th key={h} style={{ padding:'12px 20px', fontSize:'11px', fontWeight:600, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contacts.length === 0 && (
                <tr><td colSpan="3" style={{ padding:'32px', textAlign:'center', color:'var(--t2)', fontSize:'13px' }}>No contacts yet. Add one above.</td></tr>
              )}
              {contacts.map((c, i) => (
                <tr key={c.id} style={{ borderBottom: i < contacts.length-1 ? '1px solid var(--bd)' : 'none' }}>
                  <td style={{ padding:'14px 20px', fontSize:'13px', fontWeight:600, color:'var(--t1)' }}>{c.name}</td>
                  <td style={{ padding:'14px 20px', fontSize:'13px', color:'var(--t2)' }}>{c.phone || c.phoneNumber || '—'}</td>
                  <td style={{ padding:'14px 20px', textAlign:'right' }}>
                    <button onClick={() => openEditContact(c)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--t2)', marginRight:'12px' }}><I n="pencil" s={14}/></button>
                    <button onClick={() => deleteContact(c.id)} style={{ background:'none', border:'none', cursor:'pointer', color:'#f87171' }}><I n="trash" s={14}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Segment list view ──
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'36px', height:'36px', borderRadius:'8px', background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="users" s={18} c="var(--t2)" />
          </div>
          <div>
            <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:'18px', color:'var(--t1)', marginBottom:'2px' }}>Smart Lists</h2>
            <p style={{ fontSize:'13px', color:'var(--t2)' }}>Segment your contacts for targeted messaging</p>
          </div>
        </div>
        <Btn onClick={openCreateSeg} style={{ boxShadow:'var(--glow)' }}><I n="plus" s={14} c="#060A10" /> Create Segment</Btn>
      </div>

      {segFormOpen && (
        <div style={{ ...card, padding:'20px', display:'flex', flexDirection:'column', gap:'12px' }}>
          <p style={{ fontSize:13, fontWeight:700, color:'var(--t1)', fontFamily:"'Syne',sans-serif" }}>{editingSeg ? 'Edit Segment' : 'New Segment'}</p>
          <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
            <label style={{ fontSize:'11px', fontWeight:600, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.05em' }}>Segment Name</label>
            <input value={segName} onChange={e => setSegName(e.target.value)} placeholder="e.g. VIP Customers"
              style={{ padding:'10px 14px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, outline:'none', width:'100%', maxWidth:'400px', boxSizing:'border-box' }} />
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
            <label style={{ fontSize:'11px', fontWeight:600, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.05em' }}>Description (optional)</label>
            <input value={segDesc} onChange={e => setSegDesc(e.target.value)} placeholder="e.g. High-value customers"
              style={{ padding:'10px 14px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, outline:'none', width:'100%', maxWidth:'400px', boxSizing:'border-box' }} />
          </div>
          {segError && <p style={{ fontSize:12, color:'#f87171', margin:0 }}>⚠️ {segError}</p>}
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={saveSeg} style={{ boxShadow:'var(--glow)' }}>{editingSeg ? 'Update Segment' : 'Create Segment'}</Btn>
            <Btn variant="ghost" onClick={cancelSegForm}>Cancel</Btn>
          </div>
        </div>
      )}

      {segments.length === 0 ? (
        <div style={{ ...card, padding:'60px 28px', display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center', gap:14 }}>
          <div style={{ width:52, height:52, borderRadius:14, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="users" s={24} c="var(--t2)" />
          </div>
          <div>
            <p style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:17, color:'var(--t1)', marginBottom:6 }}>No Segments Yet</p>
            <p style={{ fontSize:13, color:'var(--t2)' }}>Create your first customer segment to get started.</p>
          </div>
          <Btn onClick={openCreateSeg} style={{ boxShadow:'var(--glow)' }}><I n="plus" s={14} c="#060A10" /> Create First Segment</Btn>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))', gap:'16px' }}>
          {segments.map(list => (
            <div key={list.id} style={{ ...card, padding:'20px', display:'flex', flexDirection:'column', gap:'12px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                <div style={{ width:'32px', height:'32px', borderRadius:'8px', background:`${list.color || '#8b5cf6'}22`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <I n="users" s={16} c={list.color || '#8b5cf6'} />
                </div>
                <div style={{ display:'flex', gap:'8px' }}>
                  <button onClick={() => openEditSeg(list)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--t3)' }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--t1)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--t3)'}><I n="pencil" s={14}/></button>
                  <button onClick={() => deleteSeg(list.id)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--t3)' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--t3)'}><I n="trash" s={14}/></button>
                </div>
              </div>
              <div>
                <h3 style={{ fontSize:'15px', fontWeight:600, color:'var(--t1)', marginBottom:'4px' }}>{list.name}</h3>
                <p style={{ fontSize:'12px', color:'var(--t2)' }}>{list.description || list.desc || ''}</p>
              </div>
              <div style={{ borderTop:'1px solid var(--bd)', paddingTop:'12px', marginTop:'auto', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontSize:'13px', fontWeight:600, color:'var(--t1)' }}>{(list.contacts || []).length.toLocaleString()} Contacts</span>
                <button onClick={() => setViewingSegmentId(list.id)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'12px', color:'var(--green)', fontWeight:600, padding:0 }}>View List →</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export default function AutomationView() {
  const [activeTab, setActiveTab] = useState('basic');

  const renderContent = () => {
    switch (activeTab) {
      case 'basic':       return <BasicAutomationsTab />;
      case 'custom':      return <CustomAutoReplyTab />;
      case 'workflows':   return <WorkflowsTab />;
      case 'ai-intent':   return <AIIntentMatchingTab />;
      case 'wa-agent':    return <WhatsAppAIAgentTab />;
      case 'ig-quick':    return <InstagramQuickflowsTab />;
      case 'voice-ai':    return <VoiceAITab />;
      case 'wa-forms':    return <WhatsAppFormsTab />;
      case 'interactive': return <SmartListsTab />;
      default:            return null;
    }
  };

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'#060B18' }}>

      {/* Horizontal Tab Bar */}
      <div style={{ padding:'20px 32px 0 32px', borderBottom:'1px solid var(--bd)', display:'flex', gap:'4px', overflowX:'auto', flexShrink:0, background:'var(--surf)' }}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{
                display:'flex', alignItems:'center', gap:'8px', padding:'12px 16px', cursor:'pointer',
                background: isActive ? 'rgba(30,191,94,0.1)' : 'transparent', border:'none',
                borderBottom: isActive ? '2px solid var(--green)' : '2px solid transparent',
                color: isActive ? 'var(--green)' : 'var(--t2)', transition:'all .15s',
                whiteSpace:'nowrap', borderRadius:'8px 8px 0 0', fontFamily:"'Plus Jakarta Sans',sans-serif",
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--t1)'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--t2)'; }}>
              <I n={tab.icon} s={15} c={isActive ? 'var(--green)' : 'currentColor'} />
              <span style={{ fontSize:'13px', fontWeight: isActive ? 600 : 500 }}>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content Area */}
      <div style={{ flex:1, overflowY:'auto', padding:'32px' }}>
        <div style={{ maxWidth:'1000px', margin:'0 auto' }}>
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
