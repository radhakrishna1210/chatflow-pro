import { useState, useEffect } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';

const card = { background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', boxShadow:'var(--card-shadow)' };

const Toggle = ({ on, onToggle, disabled = false }) => (
  <div onClick={disabled ? undefined : onToggle} style={{ width:36, height:20, borderRadius:20, background: on ? 'var(--green)' : 'rgba(255,255,255,0.1)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, transition:'background .2s', position:'relative', border:`1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`, flexShrink:0 }}>
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

// ─── Workflows ───
const WorkflowsTab = () => {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState([
    { id: 'step_1', type: 'trigger', subtype: 'keyword', value: 'ORDER' }
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [simulatingId, setSimulatingId] = useState(null);
  const [simResult, setSimResult] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiPreview, setAiPreview] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiGuided, setAiGuided] = useState(true);

  const fetchWorkflows = async () => {
    try {
      const res = await wFetch('/workflows');
      if (res.ok) {
        const data = await res.json();
        setWorkflows(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkflows();
  }, []);

  const openCreate = () => {
    setName('');
    setSteps([{ id: 'step_1', type: 'trigger', subtype: 'keyword', value: 'ORDER' }]);
    setEditing(null);
    setError('');
    setCreating(true);
  };

  const openAiCreate = () => {
    setAiPrompt('');
    setAiPreview(null);
    setAiError('');
    setAiGuided(true);
    setAiOpen(true);
  };

  const closeAiCreate = (force = false) => {
    if (!force && (aiLoading || aiSaving)) return;
    setAiOpen(false);
    setAiPrompt('');
    setAiPreview(null);
    setAiError('');
  };

  const openEdit = (w) => {
    setName(w.name);
    const wSteps = Array.isArray(w.nodes) ? w.nodes : [];
    setSteps(wSteps.length ? wSteps : [{ id: 'step_1', type: 'trigger', subtype: 'keyword', value: 'ORDER' }]);
    setEditing(w);
    setError('');
    setCreating(true);
  };

  const cancel = () => {
    setCreating(false);
    setEditing(null);
    setError('');
  };

  const addActionStep = () => {
    setSteps(p => [
      ...p,
      { id: `step_${Date.now()}`, type: 'action', subtype: 'message', value: 'Hello, how can I help you today?' }
    ]);
  };

  const updateStep = (id, fields) => {
    setSteps(p => p.map(s => s.id === id ? { ...s, ...fields } : s));
  };

  const removeStep = (id) => {
    setSteps(p => p.filter(s => s.id !== id));
  };

  const save = async () => {
    if (!name.trim()) {
      setError('Workflow name is required');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const payload = {
        name,
        isActive: editing ? editing.isActive : true,
        nodes: steps,
        edges: []
      };

      if (editing) {
        const res = await wFetch(`/workflows/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to update workflow');
      } else {
        const res = await wFetch('/workflows', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to create workflow');
      }
      await fetchWorkflows();
      cancel();
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (w) => {
    const updated = { ...w, isActive: !w.isActive };
    setWorkflows(p => p.map(x => x.id === w.id ? updated : x));
    try {
      await wFetch(`/workflows/${w.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: updated.isActive })
      });
    } catch (err) {
      setWorkflows(p => p.map(x => x.id === w.id ? w : x));
    }
  };

  const del = async (id) => {
    if (!window.confirm('Delete this workflow?')) return;
    try {
      await wFetch(`/workflows/${id}`, { method: 'DELETE' });
      await fetchWorkflows();
    } catch (err) {
      console.error(err);
    }
  };

  const runSimulation = async (w) => {
    setSimulatingId(w.id);
    setSimResult('');
    const token = localStorage.getItem('accessToken');
    try {
      const res = await fetch('/api/v1/ai/workflow/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ workflowId: w.id, sampleMessage: 'Hi' })
      });
      if (res.ok) {
        const d = await res.json();
        if (d.ran) {
          const actions = (d.trace || []).filter(t => t.step === 'action').length;
          setSimResult(`Triggered — ${actions} action${actions === 1 ? '' : 's'} would run. ${d.note || ''}`);
        } else {
          setSimResult(`Would not run: ${d.reason || 'trigger did not match'}`);
        }
      } else {
        const d = await res.json().catch(() => ({}));
        setSimResult(d.error || 'Failed to run simulation');
      }
    } catch {
      setSimResult('Failed to run simulation due to error');
    } finally {
      setTimeout(() => {
        setSimulatingId(null);
        setSimResult('');
      }, 6000);
    }
  };

  const generateAiPreview = async () => {
    if (!aiPrompt.trim()) {
      setAiError('Describe the workflow you want AI to create.');
      return;
    }
    setAiLoading(true);
    setAiError('');
    setAiPreview(null);
    try {
      const res = await wFetch('/automation/workflows/ai-preview', {
        method: 'POST',
        body: JSON.stringify({ prompt: aiPrompt })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to generate workflow preview');
      setAiPreview(data);
    } catch (err) {
      setAiError(err.message || 'Failed to generate workflow preview');
    } finally {
      setAiLoading(false);
    }
  };

  const saveAiPreview = async () => {
    if (!aiPreview?.name || !Array.isArray(aiPreview.nodes)) {
      setAiError('Generate a workflow preview before saving.');
      return;
    }
    setAiSaving(true);
    setAiError('');
    try {
      const res = await wFetch('/workflows', {
        method: 'POST',
        body: JSON.stringify({
          name: aiPreview.name,
          isActive: true,
          nodes: aiPreview.nodes,
          edges: aiPreview.edges || []
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save workflow');
      await fetchWorkflows();
      closeAiCreate(true);
    } catch (err) {
      setAiError(err.message || 'Failed to save workflow');
    } finally {
      setAiSaving(false);
    }
  };

  const useAiPreviewInBuilder = () => {
    if (!aiPreview) return;
    setName(aiPreview.name || 'AI Generated Workflow');
    setSteps(Array.isArray(aiPreview.nodes) && aiPreview.nodes.length ? aiPreview.nodes : [{ id: 'step_1', type: 'trigger', subtype: 'keyword', value: 'HELP' }]);
    setEditing(null);
    setError('');
    setCreating(true);
    closeAiCreate(true);
  };

  const updateAiPreview = (fields) => {
    setAiPreview(p => p ? { ...p, ...fields } : p);
  };

  const updateAiPreviewStep = (id, fields) => {
    setAiPreview(p => {
      if (!p) return p;
      const nodes = Array.isArray(p.nodes) ? p.nodes : [];
      return {
        ...p,
        nodes: nodes.map(step => {
          if (step.id !== id) return step;
          const next = { ...step, ...fields };
          if (fields.type === 'trigger' && step.type !== 'trigger') {
            next.subtype = 'keyword';
            next.value = 'HELP';
          }
          if (fields.type === 'action' && step.type !== 'action') {
            next.subtype = 'message';
            next.value = 'Thanks for reaching out. Our team will help you shortly.';
          }
          return next;
        })
      };
    });
  };

  const addAiPreviewAction = () => {
    setAiPreview(p => {
      if (!p) return p;
      const nodes = Array.isArray(p.nodes) ? p.nodes : [];
      return {
        ...p,
        nodes: [
          ...nodes,
          { id: `step_${Date.now()}`, type: 'action', subtype: 'message', value: 'Thanks for reaching out. Our team will help you shortly.' }
        ]
      };
    });
  };

  const removeAiPreviewStep = (id) => {
    setAiPreview(p => {
      if (!p) return p;
      const nodes = Array.isArray(p.nodes) ? p.nodes : [];
      if (nodes.length <= 1) return p;
      return { ...p, nodes: nodes.filter(step => step.id !== id) };
    });
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'36px', height:'36px', borderRadius:'8px', background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="wflow" s={18} c="#f59e0b" />
          </div>
          <div>
            <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:'18px', color:'var(--t1)', marginBottom:'2px' }}>Workflows</h2>
            <p style={{ fontSize:'13px', color:'var(--t2)' }}>Build multi-step automation flows with triggers and actions</p>
          </div>
        </div>
        {!creating && !aiOpen && (
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', justifyContent:'flex-end' }}>
            <Btn variant="outline" onClick={openAiCreate}>
              <I n="spark" s={14} c="var(--green)" /> Create with AI
            </Btn>
            <Btn onClick={openCreate} style={{ boxShadow:'var(--glow)' }}>
              <I n="plus" s={14} c="#060A10" /> Create Workflow
            </Btn>
          </div>
        )}
      </div>

      {aiOpen && !creating && (
        <div style={{
            width:'100%', minHeight:0, overflow:'hidden', display:'flex', flexDirection:'column',
            background:'linear-gradient(180deg,#080d18 0%,#070b13 100%)', border:'1px solid rgba(30,191,94,0.34)',
            borderRadius:14, boxShadow:'0 0 0 1px rgba(30,191,94,0.08), 0 22px 80px rgba(0,0,0,0.52)'
          }}>
            <div style={{ padding:'28px 32px 18px', display:'flex', justifyContent:'space-between', gap:18 }}>
              <div>
                <h3 style={{ fontFamily:"'Syne',sans-serif", fontSize:21, fontWeight:800, color:'var(--t1)', marginBottom:8, letterSpacing:'-.02em' }}>Create Workflow with AI</h3>
                <p style={{ fontSize:13, color:'var(--t2)', lineHeight:1.45 }}>Describe your business flow or automation logic below to build a ready-to-save workflow.</p>
              </div>
              <button onClick={() => closeAiCreate()} style={{ width:34, height:34, borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <I n="x" s={13} c="var(--t2)" />
              </button>
            </div>

            <div style={{ padding:'0 32px 22px', display:'flex', flexDirection:'column', gap:18 }}>
              <div style={{ minHeight:130, display:'flex', position:'relative', flexShrink:0 }}>
                <textarea
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  placeholder="Describe your ideal WhatsApp workflow or onboarding flow..."
                  style={{ width:'100%', minHeight:130, padding:0, background:'transparent', border:'none', color:'var(--t1)', fontSize:17, fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none', resize:'vertical', boxSizing:'border-box', lineHeight:1.55 }}
                />
              </div>

              <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                {[
                  ['Refund support flow', 'When someone asks about refund, reply asking for order ID, wait 5 minutes, then assign to support team.'],
                  ['Abandoned cart follow-up', 'When a customer says cart or checkout, send a helpful checkout reminder and tag them as cart lead.'],
                  ['Demo booking workflow', 'When someone asks for a demo, ask for their preferred time and assign the lead to sales.'],
                  ['Order tracking flow', 'When someone asks about order status, ask for order ID and assign to support team.'],
                ].map(([label, prompt]) => (
                  <button key={label} onClick={() => setAiPrompt(prompt)}
                    style={{ padding:'10px 14px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:"'Plus Jakarta Sans',sans-serif" }}>
                    {label}
                  </button>
                ))}
                {aiPreview?.provider === 'fallback' && (
                  <span style={{ fontSize:11, color:'#fbbf24', padding:'4px 8px', borderRadius:6, border:'1px solid rgba(245,158,11,0.24)', background:'rgba(245,158,11,0.08)' }}>
                    Gemini key not configured, using local preview
                  </span>
                )}
              </div>

              {aiError && <p style={{ fontSize:12, color:'#f87171', margin:0 }}>{aiError}</p>}

              {aiPreview && (
                <div style={{ border:'1px solid var(--bd)', borderRadius:10, background:'rgba(255,255,255,0.025)', overflow:'hidden' }}>
                  <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
                    <div style={{ flex:1, minWidth:220 }}>
                      <p style={{ fontSize:11, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.06em', fontWeight:700, marginBottom:4 }}>Preview</p>
                      <input value={aiPreview.name || ''} onChange={e => updateAiPreview({ name: e.target.value })}
                        style={{ width:'100%', maxWidth:420, padding:'8px 10px', borderRadius:7, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:14, fontWeight:700, outline:'none', boxSizing:'border-box' }} />
                    </div>
                    <span style={{ fontSize:11, color:'var(--t2)' }}>{Array.isArray(aiPreview.nodes) ? aiPreview.nodes.length : 0} steps</span>
                  </div>

                  <div style={{ padding:16, display:'flex', flexDirection:'column', gap:10 }}>
                    {(aiPreview.nodes || []).map((step, idx) => (
                      <div key={step.id || idx} style={{ display:'flex', gap:10, alignItems:'center', padding:'10px 12px', borderRadius:8, background:'rgba(255,255,255,0.025)', border:'1px solid var(--bd)', flexWrap:'wrap' }}>
                        <span style={{ width:54, fontSize:11, color:'var(--t3)', fontWeight:700 }}>Step {idx + 1}</span>
                        <select value={step.type} onChange={e => updateAiPreviewStep(step.id, { type: e.target.value })}
                          style={{ padding:'7px 10px', borderRadius:7, background: step.type === 'trigger' ? 'rgba(245,158,11,0.1)' : 'rgba(30,191,94,0.1)', border:`1px solid ${step.type === 'trigger' ? 'rgba(245,158,11,0.22)' : 'var(--gbd)'}`, color: step.type === 'trigger' ? '#f59e0b' : 'var(--green)', fontSize:11, fontWeight:700, outline:'none', textTransform:'uppercase' }}>
                          <option value="trigger" style={{ background:'#07090F' }}>Trigger</option>
                          <option value="action" style={{ background:'#07090F' }}>Action</option>
                        </select>
                        <select value={step.subtype} onChange={e => updateAiPreviewStep(step.id, { subtype: e.target.value })}
                          style={{ padding:'7px 10px', borderRadius:7, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:12, outline:'none', minWidth:145 }}>
                          {step.type === 'trigger' ? (
                            <>
                              <option value="keyword" style={{ background:'#07090F' }}>Keyword Match</option>
                              <option value="welcome" style={{ background:'#07090F' }}>New Contact Welcome</option>
                              <option value="missed" style={{ background:'#07090F' }}>Missed Inbound Call</option>
                            </>
                          ) : (
                            <>
                              <option value="message" style={{ background:'#07090F' }}>Send message</option>
                              <option value="delay" style={{ background:'#07090F' }}>Wait / Delay</option>
                              <option value="tag" style={{ background:'#07090F' }}>Add tag</option>
                              <option value="agent" style={{ background:'#07090F' }}>Assign agent</option>
                            </>
                          )}
                        </select>
                        {step.subtype === 'delay' ? (
                          <select value={step.value} onChange={e => updateAiPreviewStep(step.id, { value: e.target.value })}
                            style={{ padding:'7px 10px', borderRadius:7, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:12, outline:'none', minWidth:130 }}>
                            <option value="Immediate" style={{ background:'#07090F' }}>Immediate</option>
                            <option value="5 min" style={{ background:'#07090F' }}>5 Minutes</option>
                            <option value="1 hour" style={{ background:'#07090F' }}>1 Hour</option>
                            <option value="1 day" style={{ background:'#07090F' }}>1 Day</option>
                          </select>
                        ) : (
                          <input value={step.value || ''} onChange={e => updateAiPreviewStep(step.id, { value: step.type === 'trigger' && step.subtype === 'keyword' ? e.target.value.toUpperCase() : e.target.value })}
                            placeholder={step.type === 'trigger' ? 'e.g. HELP' : 'Step value...'}
                            style={{ flex:1, minWidth:220, padding:'7px 10px', borderRadius:7, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color: step.type === 'trigger' && step.subtype === 'keyword' ? 'var(--green)' : 'var(--t1)', fontSize:12, outline:'none', boxSizing:'border-box' }} />
                        )}
                        <button onClick={() => removeAiPreviewStep(step.id)} disabled={(aiPreview.nodes || []).length <= 1}
                          style={{ padding:'7px 10px', borderRadius:7, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.22)', color:'#f87171', cursor:(aiPreview.nodes || []).length <= 1 ? 'not-allowed' : 'pointer', fontSize:11, opacity:(aiPreview.nodes || []).length <= 1 ? 0.45 : 1 }}>
                          Remove
                        </button>
                      </div>
                    ))}
                    <button onClick={addAiPreviewAction}
                      style={{ alignSelf:'flex-start', padding:'8px 12px', borderRadius:8, background:'transparent', border:'1px solid var(--bd)', color:'var(--green)', cursor:'pointer', fontSize:12, fontWeight:700 }}>
                      + Add action step
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ padding:'14px 32px', borderTop:'1px solid var(--bd)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap', background:'rgba(255,255,255,0.015)' }}>
              <label style={{ display:'flex', alignItems:'center', gap:9, color:'var(--green)', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                <input type="checkbox" checked={aiGuided} onChange={e => setAiGuided(e.target.checked)}
                  style={{ width:16, height:16, accentColor:'var(--green)', cursor:'pointer' }} />
                Guided Flow
              </label>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'flex-end' }}>
                {aiPreview && <Btn variant="ghost" onClick={() => closeAiCreate()} disabled={aiLoading || aiSaving}>Cancel</Btn>}
                {aiPreview && <Btn onClick={useAiPreviewInBuilder} disabled={aiLoading || aiSaving} style={{ boxShadow:'var(--glow)' }}>Edit Preview</Btn>}
                {aiPreview && <Btn onClick={saveAiPreview} disabled={aiLoading || aiSaving} style={{ boxShadow:'var(--glow)' }}>
                {aiSaving ? 'Saving...' : 'Save Workflow'}
                </Btn>}
                <Btn onClick={generateAiPreview} disabled={aiLoading || aiSaving} style={{ minWidth:90, justifyContent:'center', boxShadow:'var(--glow)' }}>
                  {aiLoading ? 'Sending...' : aiPreview ? 'Send Again' : 'Send'}
                </Btn>
              </div>
            </div>
        </div>
      )}

      {creating && (
        <div style={{ ...card, padding:'24px', display:'flex', flexDirection:'column', gap:'20px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <h3 style={{ fontSize:15, fontWeight:700, color:'var(--t1)', fontFamily:"'Syne',sans-serif" }}>
              {editing ? 'Edit Workflow' : 'Create New Workflow'}
            </h3>
            <Btn variant="ghost" size="sm" onClick={cancel}>Cancel</Btn>
          </div>

          {/* Workflow Name */}
          <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
            <label style={{ fontSize:'11px', fontWeight:600, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.05em' }}>Workflow Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Inbound Support Flow"
              style={{ padding:'10px 14px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, outline:'none', width:'100%', maxWidth:'400px', boxSizing:'border-box' }} />
          </div>

          {/* Steps list */}
          <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
            <label style={{ fontSize:'11px', fontWeight:600, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.05em' }}>Steps Configuration</label>
            
            {steps.map((step, idx) => (
              <div key={step.id} style={{ display:'flex', gap:10, alignItems:'center', background:'rgba(255,255,255,0.02)', border:'1px solid var(--bd)', borderRadius:8, padding:14 }}>
                <span style={{ fontSize:11, fontWeight:700, color:'var(--t3)', width:55 }}>Step {idx+1}</span>
                
                {step.type === 'trigger' ? (
                  <>
                    <span style={{ background:'rgba(245,158,11,0.1)', color:'#f59e0b', border:'1px solid rgba(245,158,11,0.2)', padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600 }}>TRIGGER</span>
                    <select value={step.subtype} onChange={e => updateStep(step.id, { subtype: e.target.value })}
                      style={{ padding:'6px 10px', borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:12, outline:'none' }}>
                      <option value="keyword" style={{ background:'#07090F' }}>Keyword Match</option>
                      <option value="welcome" style={{ background:'#07090F' }}>New Contact Welcome</option>
                      <option value="missed" style={{ background:'#07090F' }}>Missed Inbound Call</option>
                    </select>
                    {step.subtype === 'keyword' && (
                      <input value={step.value} onChange={e => updateStep(step.id, { value: e.target.value.toUpperCase() })} placeholder="e.g. HELP"
                        style={{ padding:'6px 10px', borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--green)', fontSize:12, fontFamily:'monospace', outline:'none', width:120 }} />
                    )}
                  </>
                ) : (
                  <>
                    <span style={{ background:'rgba(30,191,94,0.1)', color:'var(--green)', border:'1px solid var(--gbd)', padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600 }}>ACTION</span>
                    <select value={step.subtype} onChange={e => updateStep(step.id, { subtype: e.target.value })}
                      style={{ padding:'6px 10px', borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:12, outline:'none' }}>
                      <option value="message" style={{ background:'#07090F' }}>Send message reply</option>
                      <option value="delay" style={{ background:'#07090F' }}>Wait / Delay</option>
                      <option value="tag" style={{ background:'#07090F' }}>Add Customer Tag</option>
                      <option value="agent" style={{ background:'#07090F' }}>Assign to Agent</option>
                    </select>
                    
                    {step.subtype === 'message' && (
                      <input value={step.value} onChange={e => updateStep(step.id, { value: e.target.value })} placeholder="Message text..."
                        style={{ flex:1, padding:'6px 10px', borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:12, outline:'none' }} />
                    )}
                    {step.subtype === 'delay' && (
                      <select value={step.value} onChange={e => updateStep(step.id, { value: e.target.value })}
                        style={{ padding:'6px 10px', borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:12, outline:'none' }}>
                        <option value="Immediate" style={{ background:'#07090F' }}>Immediate</option>
                        <option value="5 min" style={{ background:'#07090F' }}>5 Minutes</option>
                        <option value="1 hour" style={{ background:'#07090F' }}>1 Hour</option>
                        <option value="1 day" style={{ background:'#07090F' }}>1 Day</option>
                      </select>
                    )}
                    {(step.subtype === 'tag' || step.subtype === 'agent') && (
                      <input value={step.value} onChange={e => updateStep(step.id, { value: e.target.value })} placeholder={step.subtype === 'tag' ? "e.g. VIP" : "e.g. John Doe"}
                        style={{ padding:'6px 10px', borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:12, outline:'none', width:150 }} />
                    )}
                    
                    <button onClick={() => removeStep(step.id)} style={{ padding:'4px 8px', background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:6, cursor:'pointer', color:'#f87171', fontSize:11 }}>
                      Remove
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          <div style={{ display:'flex', gap:10 }}>
            <Btn variant="outline" size="sm" onClick={addActionStep}>
              <I n="plus" s={12} c="var(--t2)" /> Add Action Step
            </Btn>
          </div>

          {error && <p style={{ fontSize:12, color:'#f87171', margin:0 }}>⚠️ {error}</p>}

          <div style={{ display:'flex', gap:8, borderTop:'1px solid var(--bd)', paddingTop:16 }}>
            <Btn onClick={save} disabled={saving} style={{ boxShadow:'var(--glow)' }}>
              {saving ? 'Saving...' : editing ? 'Update Workflow' : 'Save Workflow'}
            </Btn>
            <Btn variant="ghost" onClick={cancel}>Cancel</Btn>
          </div>
        </div>
      )}

      {!creating && !aiOpen && (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {workflows.length === 0 ? (
            <div style={{ ...card, padding:'40px 28px', display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center', gap:16 }}>
              <div style={{ width:64, height:64, borderRadius:16, background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <I n="wflow" s={32} c="#f59e0b" />
              </div>
              <div>
                <h3 style={{ fontSize:16, fontWeight:600, color:'var(--t1)', marginBottom:8 }}>No Workflows Created Yet</h3>
                <p style={{ fontSize:13, color:'var(--t2)', maxWidth:360, margin:'0 auto' }}>Design powerful multi-step automation flows with custom triggers, delays, and action sequences.</p>
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'center' }}>
                <Btn onClick={openAiCreate} style={{ boxShadow:'var(--glow)' }}><I n="spark" s={14} c="#060A10" /> Create with AI</Btn>
                <Btn variant="outline" onClick={openCreate}>Create Your First Flow</Btn>
              </div>
            </div>
          ) : (
            workflows.map(w => (
              <div key={w.id} style={{ ...card, padding:20, display:'flex', flexDirection:'column', gap:14 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div style={{ display:'flex', gap:12, alignItems:'center' }}>
                    <div style={{ width:32, height:32, borderRadius:8, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <I n="wflow" s={16} c="#f59e0b" />
                    </div>
                    <div>
                      <h3 style={{ fontSize:15, fontWeight:600, color:'var(--t1)' }}>{w.name}</h3>
                      <p style={{ fontSize:11, color:'var(--t3)', marginTop:2 }}>
                        Steps: {Array.isArray(w.nodes) ? w.nodes.length : 0} | Updated {new Date(w.updatedAt || w.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <Toggle on={w.isActive} onToggle={() => toggleActive(w)} />
                    <button onClick={() => openEdit(w)} style={{ width:28, height:28, borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <I n="pencil" s={12} c="var(--t2)" />
                    </button>
                    <button onClick={() => del(w.id)} style={{ width:28, height:28, borderRadius:6, background:'rgba(239,68,68,0.07)', border:'1px solid rgba(239,68,68,0.2)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <I n="trash" s={12} c="#f87171" />
                    </button>
                  </div>
                </div>

                {/* Steps summary */}
                <div style={{ display:'flex', flexWrap:'wrap', gap:6, alignItems:'center', background:'rgba(255,255,255,0.01)', border:'1px solid var(--bd)', borderRadius:8, padding:'10px 14px' }}>
                  {Array.isArray(w.nodes) && w.nodes.map((step, idx) => (
                    <div key={step.id} style={{ display:'flex', alignItems:'center', gap:6 }}>
                      {idx > 0 && <I n="arrow" s={10} c="var(--t3)" />}
                      <span style={{ fontSize:12, padding:'3px 8px', borderRadius:6, background: step.type === 'trigger' ? 'rgba(245,158,11,0.08)' : 'rgba(30,191,94,0.08)', border:`1px solid ${step.type === 'trigger' ? 'rgba(245,158,11,0.2)' : 'var(--gbd)'}`, color: step.type === 'trigger' ? '#f59e0b' : 'var(--green)', fontWeight:600 }}>
                        {step.subtype === 'keyword' ? `Keyword: ${step.value}` : step.subtype === 'welcome' ? 'Welcome' : step.subtype === 'missed' ? 'Missed Call' : step.subtype === 'message' ? `Send: "${step.value}"` : step.subtype === 'delay' ? `Wait: ${step.value}` : step.subtype === 'tag' ? `Tag: ${step.value}` : `Assign: ${step.value}`}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Simulation trigger */}
                <div style={{ display:'flex', justifyContent:'flex-end', borderTop:'1px solid var(--bd)', paddingTop:12 }}>
                  {simulatingId === w.id ? (
                    <span style={{ fontSize:12, color: (simResult.includes('Failed') || simResult.includes('Would not run')) ? '#f87171' : 'var(--green)', fontWeight:600, display:'flex', alignItems:'center', gap:6 }}>
                      {simResult ? <>{(simResult.includes('Failed') || simResult.includes('Would not run')) ? <I n="alertc" s={12} c="#f87171" /> : <I n="check" s={12} c="var(--green)" />} {simResult}</> : 'Running Simulation...'}
                    </span>
                  ) : (
                    <button onClick={() => runSimulation(w)} style={{ background:'transparent', border:'none', cursor:'pointer', fontSize:12, color:'var(--green)', fontWeight:600, display:'flex', alignItems:'center', gap:6, padding:0 }}>
                      <I n="play" s={12} c="var(--green)" /> Run AI Test Simulation
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ─── AI Intent Matching ───
const AIIntentMatchingTab = () => {
  const [enabled, setEnabled] = useState(false);
  const [threshold, setThreshold] = useState(0.6);
  const [llmAvailable, setLlmAvailable] = useState(true);
  const [triggerCount, setTriggerCount] = useState(null);
  const [banner, setBanner] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    wFetch('/ai-agent/config').then(r => r.ok ? r.json() : null).then(d => {
      if (!d) return;
      setEnabled(d.intentMatchingEnabled === true);
      setThreshold(typeof d.intentMatchThreshold === 'number' ? d.intentMatchThreshold : 0.6);
      setLlmAvailable(d.llmAvailable !== false);
    }).catch(() => {});
    wFetch('/automation/triggers').then(r => r.ok ? r.json() : []).then(d => setTriggerCount(Array.isArray(d) ? d.length : 0)).catch(() => {});
  }, []);

  const persist = async (next, nextThreshold) => {
    setSaving(true); setBanner(null);
    try {
      const res = await wFetch('/ai-agent/intent-matching', { method: 'PATCH', body: JSON.stringify({ enabled: next, threshold: nextThreshold }) });
      const d = await res.json();
      if (!res.ok) { setBanner({ error: d.error || 'Save failed' }); return; }
      setEnabled(d.intentMatchingEnabled); setThreshold(d.intentMatchThreshold);
      setBanner({ ok: d.intentMatchingEnabled ? 'Intent matching is ON — inbound messages will be fuzzy-routed to your keyword triggers.' : 'Intent matching is off.' });
    } catch (e) { setBanner({ error: e.message }); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'36px', height:'36px', borderRadius:'8px', background:'rgba(167,139,250,0.1)', border:'1px solid rgba(167,139,250,0.3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="spark" s={18} c="#a78bfa" />
          </div>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:'18px', color:'var(--t1)' }}>AI Intent Matching</h2>
              {enabled && <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20, background:'var(--gbg)', border:'1px solid var(--gbd)', color:'var(--green)', textTransform:'uppercase', letterSpacing:'.05em' }}>On</span>}
            </div>
            <p style={{ fontSize:'13px', color:'var(--t2)', marginTop:2 }}>Route messages to the best keyword trigger — even without an exact match</p>
          </div>
        </div>
        <Toggle on={enabled} onToggle={() => persist(!enabled, threshold)} disabled={saving} />
      </div>

      {banner && (
        <div style={{ ...card, padding:'11px 15px', border:`1px solid ${banner.error ? 'rgba(239,68,68,.25)' : 'var(--gbd)'}`, background: banner.error ? 'rgba(239,68,68,.06)' : 'var(--gbg)' }}>
          <span style={{ fontSize:12.5, color: banner.error ? '#f87171' : 'var(--green)' }}>{banner.error || banner.ok}</span>
        </div>
      )}

      <div style={{ ...card, padding:'22px 24px', display:'flex', flexDirection:'column', gap:16 }}>
        <p style={{ fontSize:13, color:'var(--t2)', lineHeight:1.6 }}>
          When someone writes "my package hasn't arrived" and you have a trigger for the keyword <em>shipping</em>, intent matching connects them —
          {llmAvailable
            ? ' using the server\u2019s AI model to understand the message, with a keyword-similarity fallback.'
            : ' currently using keyword similarity only (set GEMINI_API_KEY on the server for full AI understanding).'}
        </p>

        <div>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
            <label style={{ fontSize:12, fontWeight:600, color:'var(--t1)' }}>Match sensitivity</label>
            <span style={{ fontSize:12, color:'var(--t2)' }}>{Math.round(threshold * 100)}% — {threshold >= 0.75 ? 'strict (fewer, safer matches)' : threshold >= 0.5 ? 'balanced' : 'loose (more matches, more risk)'}</span>
          </div>
          <input type="range" min="0.3" max="0.9" step="0.05" value={threshold}
            onChange={e => setThreshold(parseFloat(e.target.value))}
            onMouseUp={() => enabled && persist(true, threshold)}
            onTouchEnd={() => enabled && persist(true, threshold)}
            style={{ width:'100%', accentColor:'var(--green)' }} />
        </div>

        <div style={{ padding:'12px 16px', background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', borderRadius:8, fontSize:12, color:'var(--t2)', display:'flex', alignItems:'center', gap:8 }}>
          <I n="alertc" s={14} c="var(--t3)" />
          {triggerCount === null ? 'Checking your keyword triggers…'
            : triggerCount === 0 ? 'You have no keyword triggers yet — add some in Custom Auto Reply first; intent matching routes messages to them.'
            : `Intent matching routes to your ${triggerCount} keyword trigger${triggerCount === 1 ? '' : 's'} from Custom Auto Reply. Exact matches always win; intent matching only handles the fuzzy cases.`}
        </div>
      </div>
    </div>
  );
};

// ─── WhatsApp AI Agent ───
const WhatsAppAIAgentTab = () => {
  const [cfg, setCfg] = useState(null);
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [knowledge, setKnowledge] = useState('');
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [testMsg, setTestMsg] = useState('What are your business hours?');
  const [testReply, setTestReply] = useState(null);
  const [testing, setTesting] = useState(false);
  const [banner, setBanner] = useState(null);

  const load = () => wFetch('/ai-agent/config').then(r => r.ok ? r.json() : null).then(d => {
    if (!d) return;
    setCfg(d); setName(d.aiAgentName || ''); setSystemPrompt(d.aiAgentPrompt || ''); setKnowledge(d.aiAgentKnowledge || '');
  }).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true); setBanner(null);
    try {
      const res = await wFetch('/ai-agent/config', { method: 'PATCH', body: JSON.stringify({ name, systemPrompt, knowledge }) });
      const d = await res.json();
      if (!res.ok) { setBanner({ error: d.error || 'Save failed' }); return; }
      setBanner({ ok: 'Configuration saved.' });
      load();
    } catch (e) { setBanner({ error: e.message }); }
    finally { setSaving(false); }
  };

  const deploy = async () => {
    setDeploying(true); setBanner(null);
    try {
      await wFetch('/ai-agent/config', { method: 'PATCH', body: JSON.stringify({ name, systemPrompt, knowledge }) });
      const res = await wFetch(cfg?.aiAgentEnabled ? '/ai-agent/undeploy' : '/ai-agent/deploy', { method: 'POST' });
      const d = await res.json();
      if (!res.ok) { setBanner({ error: d.error || 'Deploy failed' }); return; }
      setBanner({ ok: d.aiAgentEnabled ? 'Agent deployed — it now answers inbound messages when no automation rule matches.' : 'Agent undeployed.' });
      load();
    } catch (e) { setBanner({ error: e.message }); }
    finally { setDeploying(false); }
  };

  const runTest = async () => {
    if (!testMsg.trim()) return;
    setTesting(true); setTestReply(null);
    try {
      const res = await wFetch('/ai-agent/test', { method: 'POST', body: JSON.stringify({ message: testMsg }) });
      const d = await res.json();
      setTestReply(d.ok ? { ok: d.reply } : { error: d.reason || d.error || 'Test failed' });
    } catch (e) { setTestReply({ error: e.message }); }
    finally { setTesting(false); }
  };

  const deployed = cfg?.aiAgentEnabled === true;
  const llmMissing = cfg && cfg.llmAvailable === false;
  const inputStyle = { width: '100%', padding: '10px 13px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 13, outline: 'none', fontFamily: "'Plus Jakarta Sans',sans-serif" };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'36px', height:'36px', borderRadius:'8px', background:'rgba(56,189,248,0.1)', border:'1px solid rgba(56,189,248,0.3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="bot" s={18} c="#38bdf8" />
          </div>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:'18px', color:'var(--t1)' }}>WhatsApp AI Agent</h2>
              {deployed && <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20, background:'var(--gbg)', border:'1px solid var(--gbd)', color:'var(--green)', textTransform:'uppercase', letterSpacing:'.05em' }}>Live</span>}
            </div>
            <p style={{ fontSize:'13px', color:'var(--t2)', marginTop:2 }}>Answers inbound messages when no automation rule matches</p>
          </div>
        </div>
        <Btn onClick={deploy} disabled={deploying || llmMissing}
          style={deployed ? { background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.3)', color:'#f87171', boxShadow:'none' } : { boxShadow:'var(--glow)' }}>
          {deploying ? 'Working…' : deployed ? 'Undeploy Agent' : <><I n="play" s={14} c="#060913"/> Deploy Agent</>}
        </Btn>
      </div>

      {llmMissing && (
        <div style={{ ...card, padding:'12px 16px', border:'1px solid rgba(245,158,11,0.3)', background:'rgba(245,158,11,0.06)', display:'flex', alignItems:'center', gap:8 }}>
          <I n="alertc" s={14} c="#fbbf24" />
          <span style={{ fontSize:12.5, color:'#fbbf24' }}>No LLM provider is configured on the server. Set <code>GEMINI_API_KEY</code> in the backend environment to enable deployment and live testing.</span>
        </div>
      )}
      {banner && (
        <div style={{ ...card, padding:'11px 15px', border:`1px solid ${banner.error ? 'rgba(239,68,68,.25)' : 'var(--gbd)'}`, background: banner.error ? 'rgba(239,68,68,.06)' : 'var(--gbg)' }}>
          <span style={{ fontSize:12.5, color: banner.error ? '#f87171' : 'var(--green)' }}>{banner.error || banner.ok}</span>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <div style={{ ...card, padding:20, display:'flex', flexDirection:'column', gap:14 }}>
          <h3 style={{ fontFamily:"'Syne',sans-serif", fontSize:14, fontWeight:700, color:'var(--t1)' }}>Configuration</h3>
          <div>
            <label style={{ display:'block', fontSize:11.5, fontWeight:600, color:'var(--t2)', marginBottom:6 }}>Agent name</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} maxLength={80} />
          </div>
          <div>
            <label style={{ display:'block', fontSize:11.5, fontWeight:600, color:'var(--t2)', marginBottom:6 }}>System prompt (personality + rules)</label>
            <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={4} style={{ ...inputStyle, resize:'vertical' }} maxLength={4000} />
          </div>
          <div>
            <label style={{ display:'block', fontSize:11.5, fontWeight:600, color:'var(--t2)', marginBottom:6 }}>Knowledge base (FAQs, hours, policies — the agent only answers from this)</label>
            <textarea value={knowledge} onChange={e => setKnowledge(e.target.value)} rows={6} style={{ ...inputStyle, resize:'vertical' }} maxLength={12000} placeholder={"Business hours: Mon-Sat 9am-7pm IST\nReturns: within 7 days with receipt\nShipping: 2-4 business days across India"} />
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end' }}>
            <Btn variant="outline" size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Config'}</Btn>
          </div>
        </div>

        <div style={{ ...card, padding:20, display:'flex', flexDirection:'column', gap:14 }}>
          <h3 style={{ fontFamily:"'Syne',sans-serif", fontSize:14, fontWeight:700, color:'var(--t1)' }}>Test the agent</h3>
          <p style={{ fontSize:12, color:'var(--t2)' }}>Runs your current prompt + knowledge against the model — exactly what a customer would get.</p>
          <textarea value={testMsg} onChange={e => setTestMsg(e.target.value)} rows={3} style={{ ...inputStyle, resize:'vertical' }} />
          <Btn variant="outline" size="sm" onClick={runTest} disabled={testing || llmMissing} style={{ alignSelf:'flex-start' }}>
            {testing ? 'Asking…' : 'Run Test'}
          </Btn>
          {testReply && (
            <div style={{ background: testReply.error ? 'rgba(239,68,68,.06)' : '#ECE5DD', borderRadius:10, padding:12 }}>
              {testReply.error
                ? <span style={{ fontSize:12.5, color:'#f87171' }}>{testReply.error}</span>
                : <div style={{ background:'#fff', borderRadius:'0 8px 8px 8px', padding:'9px 12px', display:'inline-block', maxWidth:'92%' }}>
                    <p style={{ fontSize:12.5, color:'#111', lineHeight:1.5, whiteSpace:'pre-wrap', margin:0, fontFamily:'system-ui,sans-serif' }}>{testReply.ok}</p>
                  </div>}
            </div>
          )}
          <div style={{ marginTop:'auto', padding:'10px 14px', background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', borderRadius:8, fontSize:11.5, color:'var(--t3)', lineHeight:1.5 }}>
            Reply order on inbound messages: exact keyword trigger → AI intent match → welcome/out-of-office → <strong style={{ color:'var(--t2)' }}>this agent</strong> (only when deployed).
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Instagram Quickflows ───
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

// ─── Voice AI ───
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
      const res = await wFetch('/automation/voice', {
        method: 'PATCH',
        body: JSON.stringify({ voiceAiName: name, voiceAiPrompt: prompt, voiceAiPhone: phone })
      });
      if (!res.ok) throw new Error('Failed to save voice settings');
      // Re-fetch to confirm persisted state
      const refetch = await wFetch('/automation/voice');
      if (refetch.ok) {
        const d = await refetch.json();
        if (d) {
          setName(d.voiceAiName || 'MyCallGenie');
          setPrompt(d.voiceAiPrompt || 'Greet the caller and ask for their details.');
          setPhone(d.voiceAiPhone || '');
        }
      }
    } catch (err) {
      console.error(err);
      alert('Failed to save voice settings. Please try again.');
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

// ─── WhatsApp Forms ───
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

// ─── Smart Lists ───
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
      const res = await wFetch(`/segments/${viewingSegmentId}/contacts/${contactId}`, { method:'DELETE' });
      if (res.ok) await fetchSegments();
    } catch (err) { console.error(err); }
  };

  if (viewingSegment) {
    const list = viewingSegment.contacts || [];
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
            <button onClick={() => setViewingSegmentId(null)} style={{ width:28, height:28, borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t2)' }}><I n="arrow" s={12}/></button>
            <div>
              <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:'18px', color:'var(--t1)', marginBottom:'2px' }}>{viewingSegment.name}</h2>
              <p style={{ fontSize:'13px', color:'var(--t2)' }}>{viewingSegment.description || viewingSegment.desc || 'No description'}</p>
            </div>
          </div>
          <Btn onClick={openAddContact} style={{ boxShadow:'var(--glow)' }}><I n="plus" s={14} c="#060A10"/> Add Customer</Btn>
        </div>

        {contactFormOpen && (
          <div style={{ ...card, padding:'20px', display:'flex', flexDirection:'column', gap:'12px' }}>
            <p style={{ fontSize:13, fontWeight:700, color:'var(--t1)', fontFamily:"'Syne',sans-serif" }}>{editingContact ? 'Edit Contact' : 'Add Contact'}</p>
            <div style={{ display:'flex', gap:'12px', flexWrap:'wrap' }}>
              <div style={{ display:'flex', flexDirection:'column', gap:'6px', flex:1, minWidth:'200px' }}>
                <label style={{ fontSize:'11px', fontWeight:600, color:'var(--t2)' }}>Name</label>
                <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="e.g. Alice Smith"
                  style={{ padding:'10px 14px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, outline:'none' }} />
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:'6px', flex:1, minWidth:'200px' }}>
                <label style={{ fontSize:'11px', fontWeight:600, color:'var(--t2)' }}>Phone Number</label>
                <input value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="e.g. +14155552671"
                  style={{ padding:'10px 14px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, outline:'none' }} />
              </div>
            </div>
            {contactError && <p style={{ fontSize:12, color:'#f87171', margin:0 }}>⚠️ {contactError}</p>}
            <div style={{ display:'flex', gap:8, marginTop:'4px' }}>
              <Btn onClick={saveContact} style={{ boxShadow:'var(--glow)' }}>{editingContact ? 'Update' : 'Add'}</Btn>
              <Btn variant="ghost" onClick={cancelContactForm}>Cancel</Btn>
            </div>
          </div>
        )}

        <div style={{ ...card, overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', textAlign:'left' }}>
            <thead>
              <tr style={{ borderBottom:'1px solid var(--bd)' }}>
                {['Name','Phone Number','Actions'].map(h => (
                  <th key={h} style={{ padding:'12px 20px', fontSize:'11px', fontWeight:600, color:'var(--t3)', textTransform:'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan="3" style={{ padding:'32px', textAlign:'center', color:'var(--t2)', fontSize:'13px' }}>No contacts in this segment yet. Add some above.</td></tr>
              )}
              {list.map(c => (
                <tr key={c.id} style={{ borderBottom:'1px solid var(--bd)' }}>
                  <td style={{ padding:'14px 20px', fontSize:'13px', fontWeight:600, color:'var(--t1)' }}>{c.name}</td>
                  <td style={{ padding:'14px 20px', fontSize:'13px', color:'var(--t2)' }}>{c.phone || c.phoneNumber}</td>
                  <td style={{ padding:'14px 20px' }}>
                    <button onClick={() => openEditContact(c)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--t3)', marginRight:12 }}><I n="pencil" s={14}/></button>
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

// ─── Main Component ───
export default function AutomationView({ initialTab } = {}) {
  const [activeTab, setActiveTab] = useState(() => TABS.some(t => t.id === initialTab) ? initialTab : 'basic');

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
