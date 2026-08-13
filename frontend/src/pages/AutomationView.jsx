import { useState, useEffect, useCallback, useRef } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { apiFetch } from '../lib/api.js';
import { wJson } from '../lib/automationApi.js';
import { validateMeaningfulText } from '../lib/validation.js';

const card = { background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', boxShadow:'var(--card-shadow)' };
const inputStyle = { width:'100%', padding:'10px 13px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, outline:'none', fontFamily:"'Manrope',sans-serif", boxSizing:'border-box' };
const labelStyle = { display:'block', fontSize:'11px', fontWeight:600, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 };

const Toggle = ({ on, onToggle, disabled = false }) => (
  <div onClick={disabled ? undefined : onToggle} style={{ width:36, height:20, borderRadius:20, background: on ? 'var(--green)' : 'rgba(255,255,255,0.1)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, transition:'background .2s', position:'relative', border:`1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`, flexShrink:0 }}>
    <div style={{ position:'absolute', top:2, left: on ? 17 : 2, width:14, height:14, borderRadius:'50%', background:'white', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,0.4)' }} />
  </div>
);

const Banner = ({ tone = 'info', children }) => {
  const palette = {
    error: { bd:'rgba(239,68,68,.25)', bg:'rgba(239,68,68,.06)', fg:'#f87171' },
    warn:  { bd:'rgba(245,158,11,.3)', bg:'rgba(245,158,11,.06)', fg:'#fbbf24' },
    ok:    { bd:'var(--gbd)',          bg:'var(--gbg)',           fg:'var(--green)' },
    info:  { bd:'var(--bd)',           bg:'rgba(255,255,255,0.03)', fg:'var(--t2)' },
  }[tone];
  return (
    <div style={{ ...card, padding:'11px 15px', border:`1px solid ${palette.bd}`, background:palette.bg, display:'flex', alignItems:'center', gap:8 }}>
      <I n="alertc" s={14} c={palette.fg} />
      <span style={{ fontSize:12.5, color:palette.fg, lineHeight:1.5 }}>{children}</span>
    </div>
  );
};

// The FREE plan carries no automation features, so the entire tab 403s. The old
// code swallowed that and rendered an empty, broken-looking screen; this says
// what actually happened.
const PlanLocked = ({ feature }) => (
  <div style={{ ...card, padding:'40px 28px', display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center', gap:14 }}>
    <div style={{ width:56, height:56, borderRadius:14, background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.25)', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <I n="lock" s={26} c="#f59e0b" />
    </div>
    <div>
      <h3 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:17, fontWeight:700, color:'var(--t1)', marginBottom:6 }}>Not included in your plan</h3>
      <p style={{ fontSize:13, color:'var(--t2)', maxWidth:420 }}>
        {feature === 'workflows'
          ? 'Workflows are available on the Pro plan and above.'
          : 'Automation is available on the Starter plan and above.'}
        {' '}Upgrade to turn this on.
      </p>
    </div>
    <Btn onClick={() => { window.location.href = '/dashboard/settings?tab=billing'; }} style={{ boxShadow:'var(--glow)' }}>
      View plans
    </Btn>
  </div>
);

const Loading = () => <div style={{ color:'var(--t2)', fontSize:13, padding:20 }}>Loading…</div>;

const TabHeader = ({ icon, color, bg, title, subtitle, badge, children }) => (
  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:16, flexWrap:'wrap' }}>
    <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
      <div style={{ width:'36px', height:'36px', borderRadius:'8px', background:bg, border:`1px solid ${color}44`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        <I n={icon} s={18} c={color} />
      </div>
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <h2 style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:'18px', color:'var(--t1)' }}>{title}</h2>
          {badge}
        </div>
        <p style={{ fontSize:'13px', color:'var(--t2)', marginTop:2 }}>{subtitle}</p>
      </div>
    </div>
    {children}
  </div>
);

const Pill = ({ children, tone = 'green' }) => (
  <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20, background: tone === 'green' ? 'var(--gbg)' : 'rgba(245,158,11,0.1)', border:`1px solid ${tone === 'green' ? 'var(--gbd)' : 'rgba(245,158,11,0.3)'}`, color: tone === 'green' ? 'var(--green)' : '#f59e0b', textTransform:'uppercase', letterSpacing:'.05em' }}>
    {children}
  </span>
);

// ── SUB-TABS ──
// Tabs promoted to first-class sidebar destinations (see NAV_GROUPS in
// Dashboard.jsx). Keep in step with the routes there.
const TAB_ROUTES = {
  'wa-agent':  '/dashboard/ai-agent',
  'ai-intent': '/dashboard/intent-matching',
};

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

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ─────────────────────────────────────────────
// 1. BASIC AUTOMATIONS
// ─────────────────────────────────────────────
const BasicAutomationsTab = () => {
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(null);
  const [banner, setBanner] = useState(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    wJson('/automation/basic').then(r => {
      if (r.locked) setLocked(r.feature || 'automation');
      else if (r.ok) setCfg(r.data);
      else setBanner({ tone:'error', text:r.error });
      setLoading(false);
    });
  }, []);

  // Every save goes through here so a rejected write always rolls the UI back
  // and says why — the old toggles flipped green on a 403 and saved nothing.
  const patch = async (updates, { optimistic = true } = {}) => {
    const previous = cfg;
    if (optimistic) setCfg(c => ({ ...c, ...updates }));
    setSaving(true);
    const r = await wJson('/automation/basic', { method:'PATCH', body: JSON.stringify(updates) });
    setSaving(false);

    if (!r.ok) {
      setCfg(previous);
      if (r.locked) setLocked(r.feature || 'automation');
      else setBanner({ tone:'error', text:r.error });
      return false;
    }
    setCfg(r.data);
    setBanner({ tone:'ok', text:'Saved.' });
    return true;
  };

  if (loading) return <Loading />;
  if (locked) return <PlanLocked feature={locked} />;
  if (!cfg) return <Banner tone="error">{banner?.text || 'Could not load automations.'}</Banner>;

  const blocks = [
    {
      key: 'ooo',
      title: 'Out of Office Message',
      desc: 'Replies automatically outside your working hours, and to anyone messaging a conversation you already closed.',
      on: cfg.autoOooEnabled,
      toggle: () => patch({ autoOooEnabled: !cfg.autoOooEnabled }),
      messageField: 'oooMessage',
    },
    {
      key: 'welcome',
      title: 'Welcome Message',
      desc: 'Greets customers the first time they message you, and returning customers who come back after 24 hours.',
      on: cfg.autoWelcomeEnabled,
      toggle: () => patch({ autoWelcomeEnabled: !cfg.autoWelcomeEnabled }),
      messageField: 'welcomeMessage',
    },
    {
      key: 'delayed',
      title: 'Delayed Response Message',
      desc: 'Sent when nobody has replied within your chosen window. Skipped automatically if your team answers in time.',
      on: cfg.autoDelayedEnabled,
      toggle: () => patch({ autoDelayedEnabled: !cfg.autoDelayedEnabled }),
      messageField: 'delayedMessage',
      extra: 'delay',
    },
  ];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <TabHeader icon="play" color="var(--green)" bg="rgba(53,232,242,0.1)"
        title="Basic Automations" subtitle="Welcome, out-of-office and delayed auto-replies" />

      {banner && <Banner tone={banner.tone}>{banner.text}</Banner>}

      {blocks.map(b => (
        <div key={b.key} style={{ ...card, padding:0 }}>
          <div style={{ padding:'16px 20px', display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16 }}>
            <div style={{ flex:1 }}>
              <h3 style={{ fontSize:'14px', fontWeight:600, color:'var(--t1)', marginBottom:8 }}>{b.title}</h3>
              <p style={{ fontSize:'12px', color:'var(--t2)', lineHeight:1.5 }}>{b.desc}</p>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:'8px', flexShrink:0 }}>
              <span style={{ fontSize:'12px', fontWeight:600, color: b.on ? 'var(--green)' : 'var(--t3)' }}>{b.on ? 'Enabled' : 'Disabled'}</span>
              <Toggle on={b.on} onToggle={b.toggle} disabled={saving} />
            </div>
          </div>

          <div style={{ borderTop:'1px solid var(--bd)', padding:'12px 20px' }}>
            <button onClick={() => setExpanded(expanded === b.key ? null : b.key)}
              style={{ background:'none', border:'none', padding:0, cursor:'pointer', color:'var(--green)', fontSize:12, fontWeight:600, display:'flex', alignItems:'center', gap:6 }}>
              <I n="pencil" s={11} c="var(--green)" /> {expanded === b.key ? 'Hide message' : 'Edit message'}
            </button>

            {expanded === b.key && (
              <div style={{ marginTop:14, display:'flex', flexDirection:'column', gap:12 }}>
                <div>
                  <label style={labelStyle}>Message sent to the customer</label>
                  <textarea rows={3} value={cfg[b.messageField] || ''}
                    onChange={e => setCfg(c => ({ ...c, [b.messageField]: e.target.value }))}
                    style={{ ...inputStyle, resize:'vertical' }} maxLength={1000} />
                </div>
                {b.extra === 'delay' && (
                  <div style={{ maxWidth:220 }}>
                    <label style={labelStyle}>Wait before sending</label>
                    <select value={cfg.delayedAfterMinutes}
                      onChange={e => setCfg(c => ({ ...c, delayedAfterMinutes: parseInt(e.target.value, 10) }))}
                      style={inputStyle}>
                      {[5, 10, 15, 30, 60, 120, 240].map(m => (
                        <option key={m} value={m} style={{ background:'#0a0b0e' }}>
                          {m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <Btn size="sm" disabled={saving}
                    onClick={async () => {
                      const err = validateMeaningfulText(cfg[b.messageField], 'Message');
                      if (err) { setBanner({ tone:'error', text:err }); return; }
                      const payload = { [b.messageField]: cfg[b.messageField] };
                      if (b.extra === 'delay') payload.delayedAfterMinutes = cfg.delayedAfterMinutes;
                      await patch(payload, { optimistic:false });
                    }}>
                    {saving ? 'Saving…' : 'Save message'}
                  </Btn>
                </div>
              </div>
            )}
          </div>
        </div>
      ))}

      <WorkingHours cfg={cfg} patch={patch} saving={saving} />
    </div>
  );
};

// Drives the out-of-office automation: outside these hours, OOO replies fire.
const WorkingHours = ({ cfg, patch, saving }) => {
  const [hours, setHours] = useState(cfg.businessHours);
  const [enabled, setEnabled] = useState(cfg.businessHoursEnabled);

  useEffect(() => { setHours(cfg.businessHours); setEnabled(cfg.businessHoursEnabled); }, [cfg]);

  const setDay = (day, patchDay) =>
    setHours(h => ({ ...h, days: h.days.map(d => d.day === day ? { ...d, ...patchDay } : d) }));

  return (
    <div style={{ ...card, padding:0 }}>
      <div style={{ padding:'16px 20px', display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16 }}>
        <div style={{ flex:1 }}>
          <h3 style={{ fontSize:'14px', fontWeight:600, color:'var(--t1)', marginBottom:8, display:'flex', alignItems:'center', gap:8 }}>
            <I n="clock" s={14} c="var(--t2)" /> Working Hours
          </h3>
          <p style={{ fontSize:'12px', color:'var(--t2)', lineHeight:1.5 }}>
            When this is off, your inbox is treated as always open and the out-of-office reply only fires on reopened conversations.
          </p>
        </div>
        <Toggle on={enabled} disabled={saving}
          onToggle={async () => {
            const next = !enabled;
            setEnabled(next);
            // null clears working hours server-side → "always open".
            const ok = await patch({ businessHours: next ? hours : null }, { optimistic:false });
            if (!ok) setEnabled(!next);
          }} />
      </div>

      {enabled && (
        <div style={{ borderTop:'1px solid var(--bd)', padding:'16px 20px', display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ maxWidth:280 }}>
            <label style={labelStyle}>Timezone</label>
            <input value={hours?.tz || ''} onChange={e => setHours(h => ({ ...h, tz: e.target.value }))}
              placeholder="Asia/Kolkata" style={inputStyle} />
          </div>

          {(hours?.days || []).map(d => (
            <div key={d.day} style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
              <div style={{ width:110, display:'flex', alignItems:'center', gap:8 }}>
                <Toggle on={d.enabled} onToggle={() => setDay(d.day, { enabled: !d.enabled })} />
                <span style={{ fontSize:12.5, color: d.enabled ? 'var(--t1)' : 'var(--t3)' }}>{DAY_NAMES[d.day]}</span>
              </div>
              <input type="time" value={d.start} disabled={!d.enabled}
                onChange={e => setDay(d.day, { start: e.target.value })}
                style={{ ...inputStyle, width:120, opacity: d.enabled ? 1 : .4 }} />
              <span style={{ color:'var(--t3)', fontSize:12 }}>to</span>
              <input type="time" value={d.end} disabled={!d.enabled}
                onChange={e => setDay(d.day, { end: e.target.value })}
                style={{ ...inputStyle, width:120, opacity: d.enabled ? 1 : .4 }} />
            </div>
          ))}

          <div>
            <Btn size="sm" disabled={saving} onClick={() => patch({ businessHours: hours }, { optimistic:false })}>
              {saving ? 'Saving…' : 'Save working hours'}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────
// 2. CUSTOM AUTO REPLY
// ─────────────────────────────────────────────
const CustomAutoReplyTab = () => {
  const [triggers, setTriggers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editing,  setEditing]  = useState(null);
  const [kw,   setKw]   = useState('');
  const [resp, setResp] = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    wJson('/automation/triggers').then(r => {
      if (r.locked) setLocked(r.feature || 'automation');
      else if (r.ok && Array.isArray(r.data)) setTriggers(r.data);
      setLoading(false);
    });
  }, []);

  const openCreate = () => { setKw(''); setResp(''); setEditing(null); setError(''); setCreating(true); };
  const openEdit   = t  => { setKw(t.keyword); setResp(t.responseTemplate); setEditing(t); setError(''); setCreating(true); };
  const cancel     = () => { setCreating(false); setEditing(null); setError(''); };

  const save = async () => {
    const kwError = validateMeaningfulText(kw, 'Keyword');
    if (kwError) { setError(kwError); return; }
    const respError = validateMeaningfulText(resp, 'Response message');
    if (respError) { setError(respError); return; }
    const normalized = kw.trim().toUpperCase();
    if (triggers.some(t => t.keyword === normalized && t.id !== editing?.id)) {
      setError('A trigger for this keyword already exists');
      return;
    }
    setError('');
    setSaving(true);

    const r = editing
      ? await wJson(`/automation/triggers/${editing.id}`, { method:'PATCH', body: JSON.stringify({ keyword: normalized, responseTemplate: resp }) })
      : await wJson('/automation/triggers', { method:'POST', body: JSON.stringify({ keyword: normalized, responseTemplate: resp, isActive: true }) });
    setSaving(false);

    if (!r.ok) { setError(r.error); return; }
    setTriggers(p => editing ? p.map(t => t.id === editing.id ? r.data : t) : [r.data, ...p]);
    cancel();
  };

  // Deleting a trigger is irreversible, so it goes through a confirmation
  // dialog rather than firing on the first click of a small icon button.
  const del = async () => {
    const target = confirmDelete;
    if (!target || deleting) return;
    setDeleting(true);
    const r = await wJson(`/automation/triggers/${target.id}`, { method:'DELETE' });
    setDeleting(false);
    if (r.ok) {
      setTriggers(p => p.filter(t => t.id !== target.id));
      setConfirmDelete(null);
    } else {
      setError(r.error);
      setConfirmDelete(null);
    }
  };

  const toggleActive = async t => {
    const next = !t.isActive;
    setTriggers(p => p.map(x => x.id === t.id ? { ...x, isActive: next } : x));
    const r = await wJson(`/automation/triggers/${t.id}`, { method:'PATCH', body: JSON.stringify({ isActive: next }) });
    if (!r.ok) {
      setTriggers(p => p.map(x => x.id === t.id ? t : x));
      setError(r.error);
    }
  };

  if (loading) return <Loading />;
  if (locked) return <PlanLocked feature={locked} />;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <TabHeader icon="msg" color="var(--green)" bg="rgba(53,232,242,0.1)"
        title="Custom Auto Reply" subtitle="Keyword-based automatic replies for common questions">
        <Btn onClick={openCreate} style={{ boxShadow:'var(--glow)' }}><I n="plus" s={14} c="#08090c" /> Add Trigger</Btn>
      </TabHeader>

      <Banner>Keywords match whole words only — a trigger for “HI” no longer fires on “this”. When two keywords match, the longer one wins.</Banner>

      {creating && (
        <div style={{ ...card, padding:'20px', display:'flex', flexDirection:'column', gap:'12px' }}>
          <p style={{ fontSize:13, fontWeight:700, color:'var(--t1)', fontFamily:"'Space Grotesk',sans-serif" }}>{editing ? 'Edit Trigger' : 'New Trigger'}</p>
          <div style={{ maxWidth:220 }}>
            <label style={labelStyle}>Keyword</label>
            <input value={kw} onChange={e => setKw(e.target.value.toUpperCase())} placeholder="e.g. STOP"
              style={{ ...inputStyle, color:'var(--green)', fontFamily:'monospace', letterSpacing:'.05em' }} />
          </div>
          <div>
            <label style={labelStyle}>Auto-reply Message</label>
            <textarea value={resp} onChange={e => setResp(e.target.value)} placeholder="Auto-reply message…" rows={3}
              style={{ ...inputStyle, resize:'vertical' }} />
          </div>
          {error && <p style={{ fontSize:12, color:'#f87171', margin:0 }}>⚠️ {error}</p>}
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={save} disabled={saving} style={{ boxShadow:'var(--glow)' }}>{saving ? 'Saving…' : editing ? 'Update Trigger' : 'Save Trigger'}</Btn>
            <Btn variant="ghost" onClick={cancel}>Cancel</Btn>
          </div>
        </div>
      )}

      {!creating && error && <Banner tone="error">{error}</Banner>}

      <div style={{ ...card, overflow:'hidden' }}>
        {triggers.length === 0 && (
          <div style={{ padding:'32px', textAlign:'center', color:'var(--t2)', fontSize:13 }}>No triggers yet. Add one above.</div>
        )}
        {triggers.map((t, i) => (
          <div key={t.id} style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 20px', borderBottom: i < triggers.length-1 ? '1px solid var(--bd)' : 'none', opacity: t.isActive ? 1 : 0.55, transition:'opacity .2s' }}>
            <span style={{ padding:'3px 10px', borderRadius:6, fontSize:12, fontWeight:700, fontFamily:'monospace', background:'rgba(53,232,242,0.08)', border:'1px solid var(--gbd)', color:'var(--green)', letterSpacing:'.05em', flexShrink:0 }}>{t.keyword}</span>
            <p style={{ flex:1, fontSize:13, color:'var(--t2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.responseTemplate}</p>
            <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
              <Toggle on={t.isActive} onToggle={() => toggleActive(t)} />
              <IconBtn icon="pencil" onClick={() => openEdit(t)} title="Edit trigger" />
              <IconBtn icon="trash" danger onClick={() => setConfirmDelete(t)} title="Delete trigger" />
            </div>
          </div>
        ))}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this trigger?"
          message={<>The keyword <strong style={{ color:'var(--green)', fontFamily:'monospace' }}>{confirmDelete.keyword}</strong> will stop auto-replying to incoming messages. This can't be undone.</>}
          confirmLabel={deleting ? 'Deleting…' : 'Delete Trigger'}
          busy={deleting}
          onConfirm={del}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
};

// Small modal used for irreversible actions. Confirms on Enter, cancels on
// Escape, and blocks a second click while the request is in flight.
const ConfirmDialog = ({ title, message, confirmLabel = 'Delete', busy = false, onConfirm, onCancel }) => {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
      if (e.key === 'Enter' && !busy) onConfirm?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onConfirm, onCancel]);

  return (
    <div onClick={onCancel} role="dialog" aria-modal="true"
      style={{ position:'fixed', inset:0, background:'rgba(3,5,12,0.78)', backdropFilter:'blur(4px)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ ...card, width:'100%', maxWidth:420, padding:24, display:'flex', flexDirection:'column', gap:14 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:38, height:38, borderRadius:10, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.22)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <I n="alertt" s={17} c="#f87171" />
          </div>
          <p style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:16, color:'var(--t1)' }}>{title}</p>
        </div>
        <p style={{ fontSize:13, color:'var(--t2)', lineHeight:1.55 }}>{message}</p>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <Btn variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Btn>
          <Btn onClick={onConfirm} disabled={busy}
            style={{ background:'#ef4444', color:'#fff', border:'1px solid #ef4444', opacity: busy ? 0.6 : 1 }}>
            {confirmLabel}
          </Btn>
        </div>
      </div>
    </div>
  );
};

const IconBtn = ({ icon, onClick, danger = false, title }) => (
  <button onClick={onClick} title={title} style={{ width:28, height:28, borderRadius:6, background: danger ? 'rgba(239,68,68,0.07)' : 'rgba(255,255,255,0.04)', border:`1px solid ${danger ? 'rgba(239,68,68,0.2)' : 'var(--bd)'}`, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
    <I n={icon} s={12} c={danger ? '#f87171' : 'var(--t2)'} />
  </button>
);

// ─────────────────────────────────────────────
// 3. WORKFLOWS
// ─────────────────────────────────────────────
const blankTrigger = () => ({ id: 'step_1', type: 'trigger', subtype: 'keyword', value: 'ORDER' });

// Renders the result of analysing a business website: what the AI understood
// about the business, and the workflows it proposes for it.
const InsightList = ({ label, items }) => {
  if (!items?.length) return null;
  return (
    <div>
      <p style={{ fontSize:10.5, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>{label}</p>
      <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
        {items.map((t, i) => (
          <span key={i} style={{ padding:'3px 9px', borderRadius:11, fontSize:11.5, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t2)' }}>{t}</span>
        ))}
      </div>
    </div>
  );
};

const COMPLEXITY_TONE = { Low:'var(--green)', Medium:'#fbbf24', High:'#f87171' };

const WebsiteAnalysisPanel = ({ data, savingWfId, savedWfIds, onGenerate, onEdit }) => {
  const [openId, setOpenId] = useState(null);
  const a = data.analysis || {};
  const wfs = data.recommendedWorkflows || [];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {/* Business summary + detected industry */}
      <div style={{ border:'1px solid var(--gbd)', background:'var(--gbg)', borderRadius:10, padding:'14px 16px' }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
          <div style={{ minWidth:0 }}>
            <h4 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:16, fontWeight:800, color:'var(--t1)' }}>{data.business?.name}</h4>
            <a href={data.sourceUrl} target="_blank" rel="noreferrer noopener"
              style={{ fontSize:11.5, color:'var(--t3)', textDecoration:'none', wordBreak:'break-all' }}>{data.sourceUrl}</a>
          </div>
          <span style={{ padding:'4px 11px', borderRadius:12, fontSize:11.5, fontWeight:700, background:'rgba(53,232,242,0.14)', border:'1px solid var(--gbd)', color:'var(--green)', whiteSpace:'nowrap' }}>
            {data.business?.industry}
          </span>
        </div>
        {data.business?.summary && (
          <p style={{ fontSize:12.5, color:'var(--t2)', lineHeight:1.6, marginTop:9 }}>{data.business.summary}</p>
        )}
        {data.pagesAnalysed?.length > 0 && (
          <p style={{ fontSize:11, color:'var(--t3)', marginTop:8 }}>Analysed {data.pagesAnalysed.length} page{data.pagesAnalysed.length === 1 ? '' : 's'}</p>
        )}
      </div>

      {data.partial && data.notes?.length > 0 && (
        <Banner tone="warn">{data.notes.join(' ')} The workflows below are based on what could be read.</Banner>
      )}

      {/* Business insights */}
      <div style={{ border:'1px solid var(--bd)', borderRadius:10, background:'rgba(255,255,255,0.02)', padding:'14px 16px', display:'flex', flexDirection:'column', gap:12 }}>
        <p style={{ fontSize:12.5, fontWeight:700, color:'var(--t1)', fontFamily:"'Space Grotesk',sans-serif" }}>Business insights</p>
        <InsightList label="Primary services" items={a.primaryServices} />
        <InsightList label="Products" items={a.products} />
        <InsightList label="Target customers" items={a.targetCustomers} />
        <InsightList label="Customer pain points" items={a.painPoints} />
        <InsightList label="Common customer intents" items={a.commonIntents} />
        <InsightList label="Lead sources" items={a.leadSources} />
        <InsightList label="Sales funnel" items={a.salesFunnel} />
        <InsightList label="Marketing opportunities" items={a.marketingOpportunities} />
        <InsightList label="Retention opportunities" items={a.retentionOpportunities} />
        {(a.bookingFlow || a.supportFlow) && (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {a.bookingFlow && <p style={{ fontSize:12, color:'var(--t2)', lineHeight:1.55 }}><strong style={{ color:'var(--t1)' }}>Booking: </strong>{a.bookingFlow}</p>}
            {a.supportFlow && <p style={{ fontSize:12, color:'var(--t2)', lineHeight:1.55 }}><strong style={{ color:'var(--t1)' }}>Support: </strong>{a.supportFlow}</p>}
          </div>
        )}
        {a.faqs?.length > 0 && (
          <div>
            <p style={{ fontSize:10.5, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>Likely FAQs</p>
            <ul style={{ margin:0, paddingLeft:16, display:'flex', flexDirection:'column', gap:3 }}>
              {a.faqs.map((q, i) => <li key={i} style={{ fontSize:12, color:'var(--t2)', lineHeight:1.5 }}>{q}</li>)}
            </ul>
          </div>
        )}
      </div>

      {/* Recommended workflows */}
      <div>
        <p style={{ fontSize:12.5, fontWeight:700, color:'var(--t1)', fontFamily:"'Space Grotesk',sans-serif", marginBottom:9 }}>
          Recommended workflows ({wfs.length})
        </p>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(290px, 1fr))', gap:10 }}>
          {wfs.map(wf => {
            const saved = savedWfIds.has(wf.id);
            const busy = savingWfId === wf.id;
            const open = openId === wf.id;
            return (
              <div key={wf.id} style={{ border:`1px solid ${saved ? 'var(--gbd)' : 'var(--bd)'}`, borderRadius:10, background: saved ? 'var(--gbg)' : 'rgba(255,255,255,0.02)', padding:'13px 14px', display:'flex', flexDirection:'column', gap:8 }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:8, alignItems:'flex-start' }}>
                  <h5 style={{ fontSize:13.5, fontWeight:700, color:'var(--t1)' }}>{wf.title}</h5>
                  <span style={{ fontSize:10, fontWeight:700, color:COMPLEXITY_TONE[wf.complexity] || 'var(--t3)', whiteSpace:'nowrap', border:`1px solid ${COMPLEXITY_TONE[wf.complexity] || 'var(--bd)'}33`, borderRadius:9, padding:'2px 7px' }}>
                    {wf.complexity}
                  </span>
                </div>
                {wf.description && <p style={{ fontSize:12, color:'var(--t2)', lineHeight:1.5 }}>{wf.description}</p>}
                {wf.benefit && (
                  <p style={{ fontSize:11.5, color:'var(--green)', lineHeight:1.45 }}>↑ {wf.benefit}</p>
                )}
                <p style={{ fontSize:11, color:'var(--t3)' }}>{wf.trigger} · {wf.nodes.length} steps</p>

                <button onClick={() => setOpenId(open ? null : wf.id)}
                  style={{ alignSelf:'flex-start', background:'none', border:'none', padding:0, cursor:'pointer', color:'var(--t2)', fontSize:11.5, fontWeight:600, fontFamily:"'Manrope',sans-serif" }}>
                  {open ? 'Hide steps' : 'Preview steps'}
                </button>
                {open && (
                  <div style={{ display:'flex', flexDirection:'column', gap:5, borderTop:'1px solid var(--bd)', paddingTop:8 }}>
                    {wf.nodes.map((n, i) => (
                      <div key={i} style={{ fontSize:11.5, color:'var(--t2)', lineHeight:1.45 }}>
                        <span style={{ color: n.type === 'trigger' ? '#f59e0b' : 'var(--green)', fontWeight:700 }}>{n.subtype}</span>
                        {n.value ? ` — ${n.value}` : ''}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display:'flex', gap:6, marginTop:2, flexWrap:'wrap' }}>
                  <Btn size="sm" onClick={() => onGenerate(wf)} disabled={busy || saved}
                    style={saved ? {} : { boxShadow:'var(--glow)' }}>
                    {busy ? 'Generating…' : saved ? 'Created ✓' : 'Generate Workflow'}
                  </Btn>
                  <Btn size="sm" variant="ghost" onClick={() => onEdit(wf)} disabled={busy}>Edit in builder</Btn>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const WorkflowsTab = () => {
  const [workflows, setWorkflows] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState([blankTrigger()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [simulating, setSimulating] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiPreview, setAiPreview] = useState(null);
  // Website-analysis result, when the input was a URL. Kept separate from
  // aiPreview so the single-workflow path is unaffected.
  const [aiSite, setAiSite] = useState(null);
  const [savingWfId, setSavingWfId] = useState(null);
  const [savedWfIds, setSavedWfIds] = useState(new Set());
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiError, setAiError] = useState('');

  const fetchWorkflows = useCallback(async () => {
    const r = await wJson('/workflows');
    if (r.locked) { setLocked(r.feature || 'workflows'); setLoading(false); return; }
    if (r.ok) setWorkflows(Array.isArray(r.data) ? r.data : []);
    else setError(r.error);
    const runsRes = await wJson('/workflows/runs');
    if (runsRes.ok && Array.isArray(runsRes.data)) setRuns(runsRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  const openCreate = () => { setName(''); setSteps([blankTrigger()]); setEditing(null); setError(''); setCreating(true); setSelectedStepId(null); };
  const openEdit = w => {
    setName(w.name);
    const wSteps = Array.isArray(w.nodes) ? w.nodes : [];
    setSteps(wSteps.length ? wSteps : [blankTrigger()]);
    setEditing(w); setError(''); setCreating(true); setSelectedStepId(null);
  };
  const cancel = () => { setCreating(false); setEditing(null); setError(''); };

  // The editor renders the same steps two ways. `list` is the original form —
  // fastest for typing — and `canvas` is the flow view, which is what makes the
  // order and the shape of a workflow legible once it is more than three steps.
  const [editorView, setEditorView] = useState('canvas');
  const [selectedStepId, setSelectedStepId] = useState(null);

  const addActionStep = () => setSteps(p => [...p, { id:`step_${Date.now()}`, type:'action', subtype:'message', value:'Hello, how can I help you today?' }]);

  // Adding from the palette. A second trigger would be ignored by the engine,
  // which runs the first one it finds, so it replaces the existing trigger
  // rather than quietly doing nothing.
  const addFromPalette = (item) => {
    const node = { id: `step_${Date.now()}`, type: item.type, subtype: item.subtype, value: item.value };
    setSteps(p => (item.type === 'trigger'
      ? [node, ...p.filter(x => x.type !== 'trigger')]
      : [...p, node]));
    setSelectedStepId(node.id);
  };
  const updateStep = (id, fields) => setSteps(p => p.map(s => s.id === id ? { ...s, ...fields } : s));
  const removeStep = id => setSteps(p => p.filter(s => s.id !== id));

  const save = async () => {
    const nameError = validateMeaningfulText(name, 'Workflow name');
    if (nameError) { setError(nameError); return; }
    const trigger = steps.find(s => s.type === 'trigger');
    if (trigger?.subtype === 'keyword' && !String(trigger.value || '').trim()) {
      setError('Give the keyword trigger a word to match, or this workflow can never fire.');
      return;
    }
    if (!steps.some(s => s.type === 'action')) {
      setError('Add at least one action — a workflow with only a trigger does nothing.');
      return;
    }
    setError('');
    setSaving(true);

    const payload = { name, isActive: editing ? editing.isActive : true, nodes: steps, edges: [] };
    const r = editing
      ? await wJson(`/workflows/${editing.id}`, { method:'PATCH', body: JSON.stringify(payload) })
      : await wJson('/workflows', { method:'POST', body: JSON.stringify(payload) });
    setSaving(false);

    if (!r.ok) { setError(r.error); return; }
    await fetchWorkflows();
    cancel();
  };

  const toggleActive = async w => {
    const next = !w.isActive;
    setWorkflows(p => p.map(x => x.id === w.id ? { ...x, isActive: next } : x));
    const r = await wJson(`/workflows/${w.id}`, { method:'PATCH', body: JSON.stringify({ isActive: next }) });
    if (!r.ok) { setWorkflows(p => p.map(x => x.id === w.id ? w : x)); setError(r.error); }
  };

  const del = async id => {
    if (!window.confirm('Delete this workflow?')) return;
    const r = await wJson(`/workflows/${id}`, { method:'DELETE' });
    if (r.ok) await fetchWorkflows();
    else setError(r.error);
  };

  // The old button hardcoded sampleMessage:'Hi' while a new workflow defaults to
  // the keyword ORDER — so the test always reported "would not run". It now
  // defaults to the workflow's own keyword and is editable.
  const openSim = w => {
    const trigger = (w.nodes || []).find(n => n.type === 'trigger');
    setSimulating({ id: w.id, sample: trigger?.subtype === 'keyword' ? (trigger.value || 'Hi') : 'Hi', result: null, busy: false });
  };

  const runSimulation = async () => {
    setSimulating(s => ({ ...s, busy: true, result: null }));
    try {
      const res = await apiFetch('/api/v1/ai/workflow/execute', {
        method: 'POST',
        body: JSON.stringify({ workflowId: simulating.id, sampleMessage: simulating.sample }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setSimulating(s => ({ ...s, busy:false, result:{ error: d.error || 'Simulation failed' } })); return; }
      setSimulating(s => ({ ...s, busy:false, result: d }));
    } catch (err) {
      setSimulating(s => ({ ...s, busy:false, result:{ error: err.message } }));
    }
  };

  const generateAiPreview = async () => {
    // A bare URL is a valid input now, and would fail the prose check below.
    const looksLikeUrl = /^(https?:\/\/)?[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(aiPrompt.trim());
    if (!looksLikeUrl && validateMeaningfulText(aiPrompt, 'Prompt')) {
      setAiError('Describe the workflow you want, or paste your website URL.'); return;
    }
    setAiLoading(true); setAiError(''); setAiPreview(null); setAiSite(null);
    const r = await wJson('/automation/workflows/ai-preview', { method:'POST', body: JSON.stringify({ prompt: aiPrompt.trim() }) });
    setAiLoading(false);
    if (!r.ok) { setAiError(r.error); return; }
    // The endpoint answers in one of two shapes: a single editable workflow
    // (a described automation) or a whole business analysis (a URL).
    if (r.data?.mode === 'website') setAiSite(r.data);
    else setAiPreview(r.data);
  };

  // One-click generate from a recommended workflow. The nodes already arrive
  // in the builder's shape, so this is a straight save with no second call.
  const saveRecommended = async (wf) => {
    setSavingWfId(wf.id); setAiError('');
    const r = await wJson('/workflows', {
      method: 'POST',
      body: JSON.stringify({ name: wf.title, isActive: true, nodes: wf.nodes, edges: wf.edges || [] }),
    });
    setSavingWfId(null);
    if (!r.ok) { setAiError(r.error); return; }
    setSavedWfIds(s => new Set([...s, wf.id]));
    await fetchWorkflows();
  };

  const editRecommendedInBuilder = (wf) => {
    setName(wf.title);
    setSteps(wf.nodes?.length ? wf.nodes : [blankTrigger()]);
    setEditing(null); setError(''); setCreating(true);
    setAiOpen(false); setAiSite(null); setAiPreview(null); setAiPrompt('');
  };

  const saveAiPreview = async () => {
    if (!aiPreview?.name || !Array.isArray(aiPreview.nodes)) { setAiError('Generate a workflow preview before saving.'); return; }
    setAiSaving(true); setAiError('');
    const r = await wJson('/workflows', {
      method: 'POST',
      body: JSON.stringify({ name: aiPreview.name, isActive: true, nodes: aiPreview.nodes, edges: aiPreview.edges || [] }),
    });
    setAiSaving(false);
    if (!r.ok) { setAiError(r.error); return; }
    await fetchWorkflows();
    setAiOpen(false); setAiPrompt(''); setAiPreview(null);
  };

  const useAiPreviewInBuilder = () => {
    if (!aiPreview) return;
    setName(aiPreview.name || 'AI Generated Workflow');
    setSteps(aiPreview.nodes?.length ? aiPreview.nodes : [blankTrigger()]);
    setEditing(null); setError(''); setCreating(true);
    setAiOpen(false); setAiPreview(null); setAiPrompt('');
  };

  const updateAiStep = (id, fields) => setAiPreview(p => {
    if (!p) return p;
    return { ...p, nodes: (p.nodes || []).map(step => {
      if (step.id !== id) return step;
      const next = { ...step, ...fields };
      if (fields.type === 'trigger' && step.type !== 'trigger') { next.subtype = 'keyword'; next.value = 'HELP'; }
      if (fields.type === 'action' && step.type !== 'action') { next.subtype = 'message'; next.value = 'Thanks for reaching out. Our team will help you shortly.'; }
      return next;
    }) };
  });

  if (loading) return <Loading />;
  if (locked) return <PlanLocked feature={locked} />;

  const runsFor = id => runs.filter(r => r.workflowId === id);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <TabHeader icon="wflow" color="#f59e0b" bg="rgba(245,158,11,0.1)"
        title="Workflows" subtitle="Multi-step automations that run on incoming messages">
        {!creating && !aiOpen && (
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'flex-end' }}>
            <Btn variant="outline" onClick={() => { setAiPrompt(''); setAiPreview(null); setAiSite(null); setSavedWfIds(new Set()); setAiError(''); setAiOpen(true); }}>
              <I n="spark" s={14} c="var(--green)" /> Create with AI
            </Btn>
            <Btn onClick={openCreate} style={{ boxShadow:'var(--glow)' }}><I n="plus" s={14} c="#08090c" /> Create Workflow</Btn>
          </div>
        )}
      </TabHeader>

      {error && <Banner tone="error">{error}</Banner>}

      {aiOpen && !creating && (
        <div style={{ ...card, padding:0, overflow:'hidden' }}>
          <div style={{ padding:'22px 24px 14px', display:'flex', justifyContent:'space-between', gap:16 }}>
            <div>
              <h3 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:18, fontWeight:800, color:'var(--t1)', marginBottom:6 }}>Create Workflow with AI</h3>
              <p style={{ fontSize:13, color:'var(--t2)' }}>Describe the automation in plain English &mdash; or paste your website URL and AI will study the business and suggest workflows built for it.</p>
            </div>
            <IconBtn icon="x" onClick={() => { if (!aiLoading && !aiSaving) { setAiOpen(false); setAiPreview(null); setAiSite(null); setSavedWfIds(new Set()); } }} />
          </div>

          <div style={{ padding:'0 24px 18px', display:'flex', flexDirection:'column', gap:14 }}>
            <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={3}
              placeholder="Describe a workflow, e.g. When someone asks about a refund, ask for their order ID, wait 5 minutes, then assign to support.&#10;&#10;Or paste a website: https://your-business.com"
              style={{ ...inputStyle, resize:'vertical', fontSize:14 }} />

            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {[
                ['Refund support flow', 'When someone asks about refund, reply asking for order ID, wait 5 minutes, then assign to support team.'],
                ['Abandoned cart follow-up', 'When a customer says cart or checkout, send a helpful checkout reminder and tag them as cart lead.'],
                ['Demo booking workflow', 'When someone asks for a demo, ask for their preferred time and assign the lead to sales.'],
                ['Analyse a website', 'https://example.com'],
              ].map(([label, prompt]) => (
                <button key={label} onClick={() => setAiPrompt(prompt)}
                  style={{ padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', cursor:'pointer', fontSize:12.5, fontWeight:600 }}>
                  {label}
                </button>
              ))}
            </div>

            {aiPreview?.provider === 'fallback' && (
              <Banner tone="warn">
                {aiPreview.fallbackReason === 'error'
                  ? 'Gemini could not be reached — this preview came from the built-in template generator.'
                  : 'No Gemini key on the server — this preview came from the built-in template generator.'}
              </Banner>
            )}
            {aiError && <Banner tone="error">{aiError}</Banner>}

            {aiSite && (
              <WebsiteAnalysisPanel
                data={aiSite}
                savingWfId={savingWfId}
                savedWfIds={savedWfIds}
                onGenerate={saveRecommended}
                onEdit={editRecommendedInBuilder}
              />
            )}

            {aiPreview && (
              <div style={{ border:'1px solid var(--bd)', borderRadius:10, background:'rgba(255,255,255,0.02)', overflow:'hidden' }}>
                <div style={{ padding:'12px 14px', borderBottom:'1px solid var(--bd)' }}>
                  <label style={labelStyle}>Workflow name</label>
                  <input value={aiPreview.name || ''} onChange={e => setAiPreview(p => ({ ...p, name: e.target.value }))}
                    style={{ ...inputStyle, maxWidth:420, fontWeight:700 }} />
                </div>
                <div style={{ padding:14, display:'flex', flexDirection:'column', gap:10 }}>
                  {(aiPreview.nodes || []).map((step, idx) => (
                    <StepRow key={step.id || idx} step={step} index={idx}
                      onChange={fields => updateAiStep(step.id, fields)}
                      onRemove={() => setAiPreview(p => (p.nodes || []).length <= 1 ? p : { ...p, nodes: p.nodes.filter(s => s.id !== step.id) })}
                      canRemove={(aiPreview.nodes || []).length > 1} allowTypeChange />
                  ))}
                  <button onClick={() => setAiPreview(p => ({ ...p, nodes: [...(p.nodes || []), { id:`step_${Date.now()}`, type:'action', subtype:'message', value:'Thanks for reaching out.' }] }))}
                    style={{ alignSelf:'flex-start', padding:'8px 12px', borderRadius:8, background:'transparent', border:'1px solid var(--bd)', color:'var(--green)', cursor:'pointer', fontSize:12, fontWeight:700 }}>
                    + Add action step
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ padding:'12px 24px', borderTop:'1px solid var(--bd)', display:'flex', gap:8, justifyContent:'flex-end', flexWrap:'wrap' }}>
            {aiPreview && <Btn variant="ghost" onClick={useAiPreviewInBuilder} disabled={aiLoading || aiSaving}>Edit in builder</Btn>}
            {aiPreview && <Btn onClick={saveAiPreview} disabled={aiLoading || aiSaving} style={{ boxShadow:'var(--glow)' }}>{aiSaving ? 'Saving…' : 'Save Workflow'}</Btn>}
            {/* In website mode each card saves itself, so only the analyse
                action belongs here. */}
            <Btn variant={(aiPreview || aiSite) ? 'outline' : 'primary'} onClick={generateAiPreview} disabled={aiLoading || aiSaving}
              style={(aiPreview || aiSite) ? {} : { boxShadow:'var(--glow)' }}>
              {aiLoading ? (aiSite ? 'Analysing…' : 'Generating…') : (aiPreview || aiSite) ? 'Regenerate' : 'Generate'}
            </Btn>
          </div>
        </div>
      )}

      {creating && (
        <div style={{ ...card, padding:'24px', display:'flex', flexDirection:'column', gap:'20px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <h3 style={{ fontSize:15, fontWeight:700, color:'var(--t1)', fontFamily:"'Space Grotesk',sans-serif" }}>{editing ? 'Edit Workflow' : 'Create New Workflow'}</h3>
            <Btn variant="ghost" size="sm" onClick={cancel}>Cancel</Btn>
          </div>

          <div style={{ maxWidth:400 }}>
            <label style={labelStyle}>Workflow Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Inbound Support Flow" style={inputStyle} />
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
              <label style={{ ...labelStyle, marginBottom:0 }}>Steps</label>
              <div style={{ display:'flex', gap:4, padding:3, borderRadius:9, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)' }}>
                {[['canvas', 'Canvas'], ['list', 'List']].map(([id, label]) => {
                  const on = editorView === id;
                  return (
                    <button key={id} onClick={() => setEditorView(id)}
                      style={{ fontSize:12, fontWeight:600, padding:'5px 12px', borderRadius:7, cursor:'pointer', border:'none', fontFamily:"'Manrope',sans-serif",
                               background: on ? 'var(--gbg)' : 'transparent', color: on ? 'var(--green)' : 'var(--t2)' }}>{label}</button>
                  );
                })}
              </div>
            </div>

            {editorView === 'list' && (
              <>
                {steps.map((step, idx) => (
                  <StepRow key={step.id} step={step} index={idx}
                    onChange={fields => updateStep(step.id, fields)}
                    onRemove={() => removeStep(step.id)}
                    canRemove={step.type === 'action'} />
                ))}
                <div><Btn variant="outline" size="sm" onClick={addActionStep}><I n="plus" s={12} c="var(--t2)" /> Add Action Step</Btn></div>
              </>
            )}

            {editorView === 'canvas' && (
              <>
                <WorkflowCanvas
                  steps={steps}
                  selectedId={selectedStepId}
                  onSelect={setSelectedStepId}
                  onChange={updateStep}
                  onAdd={addFromPalette}
                  onRemove={id => { removeStep(id); if (selectedStepId === id) setSelectedStepId(null); }}
                  trace={null}
                />

                {/* Inspector. Below the canvas rather than beside it: the canvas
                    already gives up a column to the palette, and a third one
                    leaves nothing for the flow itself on a laptop. */}
                <div style={{ border:'1px solid var(--bd)', borderRadius:10, padding:14, background:'rgba(255,255,255,0.02)' }}>
                  <div style={{ fontFamily:'var(--mono)', fontSize:9, letterSpacing:'.14em', color:'var(--t3)', textTransform:'uppercase', marginBottom:10 }}>Inspector</div>
                  {(() => {
                    const idx = steps.findIndex(x => x.id === selectedStepId);
                    if (idx === -1) {
                      return <p style={{ fontSize:12.5, color:'var(--t3)', margin:0 }}>Select a node on the canvas to edit it.</p>;
                    }
                    const step = steps[idx];
                    return (
                      <StepRow step={step} index={idx}
                        onChange={fields => updateStep(step.id, fields)}
                        onRemove={() => { removeStep(step.id); setSelectedStepId(null); }}
                        canRemove={step.type === 'action'}
                        allowTypeChange />
                    );
                  })()}
                </div>

                <p style={{ fontSize:11, color:'var(--t3)', margin:0, lineHeight:1.55 }}>
                  Steps run top to bottom in the order shown. Drag a node to reposition it; the order is the list order, which
                  the List view makes explicit.
                </p>
              </>
            )}
          </div>

          {error && <p style={{ fontSize:12, color:'#f87171', margin:0 }}>⚠️ {error}</p>}

          <div style={{ display:'flex', gap:8, borderTop:'1px solid var(--bd)', paddingTop:16 }}>
            <Btn onClick={save} disabled={saving} style={{ boxShadow:'var(--glow)' }}>{saving ? 'Saving…' : editing ? 'Update Workflow' : 'Save Workflow'}</Btn>
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
                <h3 style={{ fontSize:16, fontWeight:600, color:'var(--t1)', marginBottom:8 }}>No Workflows Yet</h3>
                <p style={{ fontSize:13, color:'var(--t2)', maxWidth:380, margin:'0 auto' }}>Build multi-step automations that reply, wait, tag contacts and hand off to an agent — all triggered by an incoming message.</p>
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'center' }}>
                <Btn onClick={() => setAiOpen(true)} style={{ boxShadow:'var(--glow)' }}><I n="spark" s={14} c="#08090c" /> Create with AI</Btn>
                <Btn variant="outline" onClick={openCreate}>Create Your First Flow</Btn>
              </div>
            </div>
          ) : workflows.map(w => (
            <WorkflowCard key={w.id} workflow={w} runs={runsFor(w.id)}
              onToggle={() => toggleActive(w)} onEdit={() => openEdit(w)} onDelete={() => del(w.id)}
              onSimulate={() => openSim(w)}
              sim={simulating?.id === w.id ? simulating : null}
              onSimChange={sample => setSimulating(s => ({ ...s, sample }))}
              onSimRun={runSimulation} onSimClose={() => setSimulating(null)} />
          ))}
        </div>
      )}
    </div>
  );
};

const TRIGGER_SUBTYPES = [['keyword', 'Keyword Match'], ['welcome', 'New Contact Welcome'], ['missed', 'Missed Inbound Call']];
const ACTION_SUBTYPES = [['message', 'Send message'], ['delay', 'Wait / Delay'], ['tag', 'Add contact tag'], ['agent', 'Assign to agent']];

// ─── Workflow canvas ─────────────────────────────────────────────────────────
//
// The same steps as the list editor, drawn as a flow.
//
// It is a chain rather than a branching graph on purpose: the engine runs a
// workflow's nodes in order, so a canvas with forks in it would draw a
// behaviour the product does not have. Every node here maps one-to-one to a
// step, edits write straight back to the same array, and the list view and the
// canvas are two renderings of one state — switch between them mid-edit and
// nothing is lost.
//
// Positions are stored on the node as `pos` when a node is dragged. The schema
// takes nodes as opaque JSON and the engine reads only type/subtype/value, so
// the extra key rides along harmlessly and a workflow built before the canvas
// existed simply falls back to auto-layout.

const NODE_W = 210;
const NODE_H = 74;
const NODE_GAP = 44;
const CANVAS_PAD = 28;

const PALETTE = [
  {
    name: 'TRIGGERS', color: '#f59e0b',
    items: TRIGGER_SUBTYPES.map(([subtype, label]) => ({
      type: 'trigger', subtype, label,
      value: subtype === 'keyword' ? 'HELP' : '',
    })),
  },
  {
    name: 'ACTIONS', color: 'var(--green)',
    items: ACTION_SUBTYPES.map(([subtype, label]) => ({
      type: 'action', subtype, label,
      value: subtype === 'message' ? 'Thanks for reaching out — how can we help?'
        : subtype === 'delay' ? '1h'
        : subtype === 'tag' ? 'VIP'
        : '',
    })),
  },
];

const NODE_ICON = {
  keyword: 'key', welcome: 'user', missed: 'phone',
  message: 'send', delay: 'clock', tag: 'file', agent: 'users',
};

// Auto-layout: a single column, in execution order. A node that has been
// dragged keeps where it was put.
const nodePosition = (step, index) => (
  step.pos && Number.isFinite(step.pos.x) && Number.isFinite(step.pos.y)
    ? step.pos
    : { x: CANVAS_PAD, y: CANVAS_PAD + index * (NODE_H + NODE_GAP) }
);

const WorkflowCanvas = ({ steps, selectedId, onSelect, onChange, onAdd, onRemove, trace }) => {
  const [dragging, setDragging] = useState(null);   // { id, dx, dy }
  const canvasRef = useRef(null);

  const positioned = steps.map((step, i) => ({ step, index: i, pos: nodePosition(step, i) }));
  const height = Math.max(
    340,
    ...positioned.map(n => n.pos.y + NODE_H + CANVAS_PAD),
  );

  const onPointerDown = (e, node) => {
    const rect = canvasRef.current.getBoundingClientRect();
    setDragging({ id: node.step.id, dx: e.clientX - rect.left - node.pos.x, dy: e.clientY - rect.top - node.pos.y });
    onSelect(node.step.id);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const rect = canvasRef.current.getBoundingClientRect();
    onChange(dragging.id, {
      pos: {
        x: Math.max(0, Math.round(e.clientX - rect.left - dragging.dx)),
        y: Math.max(0, Math.round(e.clientY - rect.top - dragging.dy)),
      },
    });
  };

  const endDrag = () => setDragging(null);

  return (
    <div style={{ display:'grid', gridTemplateColumns:'170px minmax(0,1fr)', gap:12, alignItems:'start' }} className="agent-grid">
      {/* palette */}
      <div style={{ border:'1px solid var(--bd)', borderRadius:10, padding:10, background:'rgba(255,255,255,0.02)' }}>
        <div style={{ fontFamily:'var(--mono)', fontSize:9, letterSpacing:'.14em', color:'var(--t3)', textTransform:'uppercase', marginBottom:9 }}>Click to add</div>
        {PALETTE.map(group => (
          <div key={group.name} style={{ marginBottom:12 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6 }}>
              <span style={{ width:6, height:6, borderRadius:'50%', background:group.color }} />
              <span style={{ fontFamily:'var(--mono)', fontSize:9, letterSpacing:'.1em', color:'var(--t3)' }}>{group.name}</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {group.items.map(item => (
                <button key={`${item.type}-${item.subtype}`} onClick={() => onAdd(item)}
                  style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 9px', borderRadius:8, cursor:'pointer', textAlign:'left',
                           background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t2)',
                           fontSize:11.5, fontFamily:"'Manrope',sans-serif" }}>
                  <I n={NODE_ICON[item.subtype] || 'zap'} s={12} c={group.color} />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* canvas */}
      <div
        ref={canvasRef}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        style={{ position:'relative', minHeight:340, height, borderRadius:10, border:'1px solid var(--bd)', overflow:'hidden',
                 background:'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.07) 1px, transparent 0) 0 0 / 22px 22px, rgba(5,8,20,0.4)',
                 touchAction:'none' }}>

        {/* edges, behind the cards */}
        <svg width="100%" height={height} style={{ position:'absolute', inset:0, pointerEvents:'none' }} aria-hidden="true">
          {positioned.slice(0, -1).map((node, i) => {
            const next = positioned[i + 1];
            const x1 = node.pos.x + NODE_W / 2;
            const y1 = node.pos.y + NODE_H;
            const x2 = next.pos.x + NODE_W / 2;
            const y2 = next.pos.y;
            const mid = (y1 + y2) / 2;
            const lit = trace && trace.length > i + 1;
            return (
              <path key={node.step.id}
                d={`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`}
                fill="none" strokeWidth="2" strokeDasharray="6 8"
                stroke={lit ? 'var(--green)' : 'rgba(255,255,255,0.22)'} />
            );
          })}
        </svg>

        {positioned.map((node) => {
          const { step, index, pos } = node;
          const isTrigger = step.type === 'trigger';
          const accent = isTrigger ? '#f59e0b' : 'var(--green)';
          const on = selectedId === step.id;
          const lit = trace && trace.length > index;
          return (
            <div key={step.id}
              onPointerDown={e => onPointerDown(e, node)}
              style={{ position:'absolute', left:pos.x, top:pos.y, width:NODE_W, minHeight:NODE_H,
                       padding:'11px 13px', borderRadius:13, cursor:'grab',
                       background: on ? 'rgba(255,255,255,0.07)' : 'rgba(18,20,26,0.96)',
                       border:`1px solid ${on || lit ? accent : 'var(--bd)'}`,
                       boxShadow: on || lit ? `0 0 22px ${isTrigger ? 'rgba(245,158,11,0.3)' : 'rgba(53,232,242,0.3)'}` : '0 8px 24px rgba(0,0,0,0.4)',
                       transition:'box-shadow .2s, border-color .2s' }}>
              <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:6 }}>
                <I n={NODE_ICON[step.subtype] || 'zap'} s={12} c={accent} />
                <span style={{ fontFamily:'var(--mono)', fontSize:8.5, letterSpacing:'.12em', color:accent, textTransform:'uppercase' }}>
                  {isTrigger ? 'Trigger' : `Step ${index}`}
                </span>
                <button onClick={e => { e.stopPropagation(); onRemove(step.id); }} aria-label="Remove step"
                  style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', padding:0, display:'flex', color:'var(--t3)' }}>
                  <I n="x" s={11} c="var(--t3)" />
                </button>
              </div>
              <div style={{ fontSize:12.5, fontWeight:600, color:'var(--t1)', marginBottom:2 }}>
                {(isTrigger ? TRIGGER_SUBTYPES : ACTION_SUBTYPES).find(([id]) => id === step.subtype)?.[1] || step.subtype}
              </div>
              <div style={{ fontSize:11, color:'var(--t3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {step.value || '—'}
              </div>
            </div>
          );
        })}

        {steps.length === 0 && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t3)', fontSize:12.5 }}>
            Add a trigger from the palette to start.
          </div>
        )}
      </div>
    </div>
  );
};

const StepRow = ({ step, index, onChange, onRemove, canRemove, allowTypeChange = false }) => {
  const isTrigger = step.type === 'trigger';
  const options = isTrigger ? TRIGGER_SUBTYPES : ACTION_SUBTYPES;
  const selectStyle = { padding:'7px 10px', borderRadius:7, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:12, outline:'none' };

  return (
    <div style={{ display:'flex', gap:10, alignItems:'center', padding:'10px 12px', borderRadius:8, background:'rgba(255,255,255,0.02)', border:'1px solid var(--bd)', flexWrap:'wrap' }}>
      <span style={{ width:52, fontSize:11, fontWeight:700, color:'var(--t3)' }}>Step {index + 1}</span>

      {allowTypeChange ? (
        <select value={step.type} onChange={e => onChange({ type: e.target.value })}
          style={{ ...selectStyle, background: isTrigger ? 'rgba(245,158,11,0.1)' : 'rgba(53,232,242,0.1)', color: isTrigger ? '#f59e0b' : 'var(--green)', fontWeight:700, textTransform:'uppercase', fontSize:11 }}>
          <option value="trigger" style={{ background:'#0a0b0e' }}>Trigger</option>
          <option value="action" style={{ background:'#0a0b0e' }}>Action</option>
        </select>
      ) : (
        <span style={{ background: isTrigger ? 'rgba(245,158,11,0.1)' : 'rgba(53,232,242,0.1)', color: isTrigger ? '#f59e0b' : 'var(--green)', border:`1px solid ${isTrigger ? 'rgba(245,158,11,0.2)' : 'var(--gbd)'}`, padding:'3px 9px', borderRadius:6, fontSize:11, fontWeight:700 }}>
          {isTrigger ? 'TRIGGER' : 'ACTION'}
        </span>
      )}

      <select value={step.subtype} onChange={e => onChange({ subtype: e.target.value })} style={{ ...selectStyle, minWidth:150 }}>
        {options.map(([v, label]) => <option key={v} value={v} style={{ background:'#0a0b0e' }}>{label}</option>)}
      </select>

      {step.subtype === 'delay' ? (
        <select value={step.value} onChange={e => onChange({ value: e.target.value })} style={{ ...selectStyle, minWidth:130 }}>
          {['Immediate', '5 min', '1 hour', '1 day'].map(v => <option key={v} value={v} style={{ background:'#0a0b0e' }}>{v}</option>)}
        </select>
      ) : (step.subtype === 'welcome' || step.subtype === 'missed') ? (
        <span style={{ fontSize:12, color:'var(--t3)', flex:1 }}>No configuration needed</span>
      ) : (
        <input value={step.value || ''}
          onChange={e => onChange({ value: isTrigger && step.subtype === 'keyword' ? e.target.value.toUpperCase() : e.target.value })}
          placeholder={isTrigger ? 'e.g. HELP' : step.subtype === 'tag' ? 'e.g. VIP' : step.subtype === 'agent' ? "Agent name or email" : 'Message text…'}
          style={{ ...selectStyle, flex:1, minWidth:200, color: isTrigger && step.subtype === 'keyword' ? 'var(--green)' : 'var(--t1)', fontFamily: isTrigger && step.subtype === 'keyword' ? 'monospace' : 'inherit' }} />
      )}

      {canRemove && (
        <button onClick={onRemove} style={{ padding:'7px 10px', borderRadius:7, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.22)', color:'#f87171', cursor:'pointer', fontSize:11 }}>Remove</button>
      )}
    </div>
  );
};

const stepLabel = (step) => {
  switch (step.subtype) {
    case 'keyword': return `Keyword: ${step.value}`;
    case 'welcome': return 'New contact';
    case 'missed':  return 'Missed call';
    case 'message': return `Send: "${step.value}"`;
    case 'delay':   return `Wait: ${step.value}`;
    case 'tag':     return `Tag: ${step.value}`;
    case 'agent':   return `Assign: ${step.value}`;
    default:        return step.subtype;
  }
};

const WorkflowCard = ({ workflow: w, runs, onToggle, onEdit, onDelete, onSimulate, sim, onSimChange, onSimRun, onSimClose }) => {
  const [showRuns, setShowRuns] = useState(false);

  return (
    <div style={{ ...card, padding:20, display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          <div style={{ width:32, height:32, borderRadius:8, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="wflow" s={16} c="#f59e0b" />
          </div>
          <div>
            <h3 style={{ fontSize:15, fontWeight:600, color:'var(--t1)' }}>{w.name}</h3>
            <p style={{ fontSize:11, color:'var(--t3)', marginTop:2 }}>
              {Array.isArray(w.nodes) ? w.nodes.length : 0} steps · {runs.length} run{runs.length === 1 ? '' : 's'} · updated {new Date(w.updatedAt || w.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <Toggle on={w.isActive} onToggle={onToggle} />
          <IconBtn icon="pencil" onClick={onEdit} title="Edit" />
          <IconBtn icon="trash" danger onClick={onDelete} title="Delete" />
        </div>
      </div>

      <div style={{ display:'flex', flexWrap:'wrap', gap:6, alignItems:'center', background:'rgba(255,255,255,0.01)', border:'1px solid var(--bd)', borderRadius:8, padding:'10px 14px' }}>
        {(Array.isArray(w.nodes) ? w.nodes : []).map((step, idx) => (
          <div key={step.id || idx} style={{ display:'flex', alignItems:'center', gap:6 }}>
            {idx > 0 && <I n="arrow" s={10} c="var(--t3)" />}
            <span style={{ fontSize:12, padding:'3px 8px', borderRadius:6, background: step.type === 'trigger' ? 'rgba(245,158,11,0.08)' : 'rgba(53,232,242,0.08)', border:`1px solid ${step.type === 'trigger' ? 'rgba(245,158,11,0.2)' : 'var(--gbd)'}`, color: step.type === 'trigger' ? '#f59e0b' : 'var(--green)', fontWeight:600 }}>
              {stepLabel(step)}
            </span>
          </div>
        ))}
      </div>

      {!w.isActive && <Banner tone="warn">This workflow is paused — it will not run on incoming messages.</Banner>}

      <div style={{ borderTop:'1px solid var(--bd)', paddingTop:12, display:'flex', gap:16, flexWrap:'wrap' }}>
        <button onClick={onSimulate} style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--green)', fontWeight:600, display:'flex', alignItems:'center', gap:6, padding:0 }}>
          <I n="play" s={12} c="var(--green)" /> Test this workflow
        </button>
        <button onClick={() => setShowRuns(v => !v)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--t2)', fontWeight:600, display:'flex', alignItems:'center', gap:6, padding:0 }}>
          <I n="clock" s={12} c="var(--t2)" /> {showRuns ? 'Hide' : 'Show'} run history
        </button>
      </div>

      {sim && (
        <div style={{ border:'1px solid var(--bd)', borderRadius:8, padding:14, display:'flex', flexDirection:'column', gap:10, background:'rgba(255,255,255,0.02)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:12, fontWeight:700, color:'var(--t1)' }}>Test with a sample message</span>
            <IconBtn icon="x" onClick={onSimClose} />
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <input value={sim.sample} onChange={e => onSimChange(e.target.value)}
              placeholder="Type what a customer would send…" style={{ ...inputStyle, flex:1, minWidth:220 }} />
            <Btn size="sm" onClick={onSimRun} disabled={sim.busy}>{sim.busy ? 'Running…' : 'Run test'}</Btn>
          </div>
          <p style={{ fontSize:11, color:'var(--t3)', margin:0 }}>Simulation only — no messages are actually sent.</p>

          {sim.result?.error && <Banner tone="error">{sim.result.error}</Banner>}
          {sim.result && !sim.result.error && (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              <span style={{ fontSize:12.5, fontWeight:700, color: sim.result.ran ? 'var(--green)' : '#f87171' }}>
                {sim.result.ran ? 'Triggered' : `Would not run — ${sim.result.reason || 'trigger did not match'}`}
              </span>
              {(sim.result.trace || []).map((t, i) => (
                <div key={i} style={{ fontSize:12, color:'var(--t2)', display:'flex', gap:8, paddingLeft:4 }}>
                  <span style={{ color:'var(--t3)', minWidth:56 }}>{t.step}</span>
                  <span style={{ flex:1 }}>{t.detail}</span>
                  <span style={{ color: t.result === 'no match' || t.result === 'skipped' ? '#f87171' : 'var(--green)' }}>{t.result}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showRuns && (
        <div style={{ border:'1px solid var(--bd)', borderRadius:8, overflow:'hidden' }}>
          {runs.length === 0 ? (
            <div style={{ padding:16, fontSize:12.5, color:'var(--t2)', textAlign:'center' }}>
              No runs yet. This workflow fires when a customer sends a matching message.
            </div>
          ) : runs.slice(0, 8).map(run => (
            <div key={run.id} style={{ padding:'10px 14px', borderBottom:'1px solid var(--bd)', display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
              <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:20, color: run.status === 'COMPLETED' ? 'var(--success)' : run.status === 'FAILED' ? '#f87171' : '#fbbf24', background: run.status === 'COMPLETED' ? 'var(--sbg)' : run.status === 'FAILED' ? 'rgba(239,68,68,.08)' : 'rgba(245,158,11,.08)' }}>
                {run.status}
              </span>
              <span style={{ fontSize:12, color:'var(--t2)', flex:1, minWidth:160 }}>
                {run.triggerMessage ? `“${run.triggerMessage}”` : '—'}
              </span>
              <span style={{ fontSize:11, color:'var(--t3)' }}>{new Date(run.startedAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────
// 4. AI INTENT MATCHING
// ─────────────────────────────────────────────
// The routing layer in front of the agent. An intent is a named thing
// customers ask for, the phrases that signal it, and where a match goes.
//
// The page keeps the two controls it always had — the global switch and the
// sensitivity threshold — because they are what decides whether any of this
// runs at all, and adds the thing that was missing: the rules themselves.

const INTENT_ICONS = ['📦', '💰', '🚚', '↩️', '😡', '📅', '🧾', '❓', '🎁', '🔧'];

const ACTION_TYPES = [
  { id: 'ai',       label: 'AI agent',       hint: 'Answer with the deployed agent' },
  { id: 'human',    label: 'Human handoff',  hint: 'Assign to a person or team' },
  { id: 'trigger',  label: 'Auto-reply',     hint: 'Send a keyword trigger’s reply' },
  { id: 'workflow', label: 'Workflow',       hint: 'Start an automation workflow' },
];

// Create/edit sheet. One dialog for both because the fields are identical and
// two near-identical forms drift the moment either is touched.
const IntentEditor = ({ intent, onClose, onSaved }) => {
  const editing = !!intent;
  const [name, setName] = useState(intent?.name || '');
  const [icon, setIcon] = useState(intent?.icon && INTENT_ICONS.includes(intent.icon) ? intent.icon : INTENT_ICONS[0]);
  const [actionType, setActionType] = useState(intent?.actionType || 'ai');
  const [actionTarget, setActionTarget] = useState(intent?.actionTarget || '');
  const [phrases, setPhrases] = useState(Array.isArray(intent?.phrases) ? intent.phrases : []);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const addPhrase = () => {
    const value = draft.trim();
    if (!value) return;
    // Case-insensitive de-dupe: "Size 9" and "size 9" match identically, so
    // storing both only makes the card longer.
    if (!phrases.some(p => p.toLowerCase() === value.toLowerCase())) setPhrases(list => [...list, value]);
    setDraft('');
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Give the intent a name.'); return; }
    if (phrases.length === 0) { setError('Add at least one phrase — an intent with no phrases can never match.'); return; }
    setSaving(true); setError(null);
    const body = JSON.stringify({ name: trimmed, icon, actionType, actionTarget, phrases });
    const r = editing
      ? await wJson(`/intents/${intent.id}`, { method: 'PATCH', body })
      : await wJson('/intents', { method: 'POST', body });
    setSaving(false);
    if (!r.ok) { setError(r.error); return; }
    onSaved();
  };

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.62)', backdropFilter:'blur(4px)', zIndex:120, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width:'100%', maxWidth:520, maxHeight:'88vh', overflowY:'auto', padding:24 }}>
        <h3 style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:17, color:'var(--t1)', marginBottom:18 }}>
          {editing ? 'Edit intent' : 'New intent'}
        </h3>

        {error && <div style={{ marginBottom:14 }}><Banner tone="error">{error}</Banner></div>}

        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <div>
            <label style={labelStyle}>Icon</label>
            <div style={{ display:'flex', flexWrap:'wrap', gap:7 }}>
              {INTENT_ICONS.map(g => (
                <button key={g} type="button" onClick={() => setIcon(g)}
                  style={{ width:36, height:36, borderRadius:9, fontSize:17, cursor:'pointer', lineHeight:1,
                           background: icon === g ? 'var(--gbg)' : 'rgba(255,255,255,0.03)',
                           border:`1px solid ${icon === g ? 'var(--gbd)' : 'var(--bd)'}` }}>{g}</button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Product availability" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Route a match to</label>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:8 }}>
              {ACTION_TYPES.map(a => {
                const on = actionType === a.id;
                return (
                  <button key={a.id} type="button" onClick={() => setActionType(a.id)}
                    style={{ textAlign:'left', padding:'10px 12px', borderRadius:9, cursor:'pointer', fontFamily:"'Manrope',sans-serif",
                             background: on ? 'var(--gbg)' : 'rgba(255,255,255,0.03)',
                             border:`1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}` }}>
                    <div style={{ fontSize:13, fontWeight:600, color: on ? 'var(--green)' : 'var(--t1)' }}>{a.label}</div>
                    <div style={{ fontSize:11, color:'var(--t3)', marginTop:2 }}>{a.hint}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label style={labelStyle}>
              {actionType === 'human' ? 'Assign to' : actionType === 'trigger' ? 'Keyword' : actionType === 'workflow' ? 'Workflow name' : 'Context note (optional)'}
            </label>
            <input value={actionTarget} onChange={e => setActionTarget(e.target.value)} style={inputStyle}
              placeholder={actionType === 'human' ? 'Support team' : actionType === 'trigger' ? 'SHIPPING' : actionType === 'workflow' ? 'Order lookup' : 'live stock check'} />
          </div>

          <div>
            <label style={labelStyle}>Phrases that signal this intent</label>
            <div style={{ display:'flex', gap:8 }}>
              <input value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPhrase(); } }}
                placeholder="in stock?" style={{ ...inputStyle, flex:1 }} />
              <Btn variant="outline" onClick={addPhrase}>Add</Btn>
            </div>
            {phrases.length > 0 && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:10 }}>
                {phrases.map(ph => (
                  <span key={ph} style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, padding:'4px 8px 4px 10px', borderRadius:20, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t2)' }}>
                    {ph}
                    <button type="button" onClick={() => setPhrases(list => list.filter(x => x !== ph))} aria-label={`Remove ${ph}`}
                      style={{ background:'none', border:'none', cursor:'pointer', display:'flex', padding:0, color:'var(--t3)' }}>
                      <I n="x" s={10} c="var(--t3)" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p style={{ fontSize:11, color:'var(--t3)', marginTop:8, lineHeight:1.5 }}>
              A whole phrase found in the message scores highest; otherwise the score is the share of the phrase’s words present.
            </p>
          </div>
        </div>

        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:22 }}>
          <Btn variant="outline" onClick={onClose} disabled={saving}>Cancel</Btn>
          <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save intent' : 'Create intent'}</Btn>
        </div>
      </div>
    </div>
  );
};

const AIIntentMatchingTab = () => {
  const [enabled, setEnabled] = useState(false);
  const [threshold, setThreshold] = useState(0.6);
  const [llmAvailable, setLlmAvailable] = useState(true);
  const [banner, setBanner] = useState(null);
  const [saving, setSaving] = useState(false);

  const [rules, setRules] = useState([]);
  const [loadingRules, setLoadingRules] = useState(true);
  const [editor, setEditor] = useState(null);       // { intent } | { intent: null }
  const [stats, setStats] = useState(null);

  // Live tester
  const [testInput, setTestInput] = useState('do you have this in size 9?');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const loadRules = useCallback(async () => {
    const r = await wJson('/intents');
    setLoadingRules(false);
    if (r.ok && Array.isArray(r.data)) setRules(r.data);
  }, []);

  const loadStats = useCallback(async () => {
    const r = await wJson('/intents/accuracy');
    if (r.ok && r.data) setStats(r.data);
  }, []);

  useEffect(() => {
    wJson('/ai-agent/config').then(r => {
      if (!r.ok || !r.data) return;
      setEnabled(r.data.intentMatchingEnabled === true);
      setThreshold(typeof r.data.intentMatchThreshold === 'number' ? r.data.intentMatchThreshold : 0.6);
      setLlmAvailable(r.data.llmAvailable !== false);
    });
    loadRules();
    loadStats();
  }, [loadRules, loadStats]);

  // Debounced so the tester feels live without a request per keystroke.
  useEffect(() => {
    const value = testInput.trim();
    if (!value) { setTestResult(null); return undefined; }
    const t = setTimeout(async () => {
      setTesting(true);
      const r = await wJson('/intents/test', { method: 'POST', body: JSON.stringify({ message: value }) });
      setTesting(false);
      setTestResult(r.ok ? r.data : null);
    }, 320);
    return () => clearTimeout(t);
  }, [testInput, rules]);

  const persist = async (next, nextThreshold) => {
    setSaving(true); setBanner(null);
    const r = await wJson('/ai-agent/intent-matching', { method:'PATCH', body: JSON.stringify({ enabled: next, threshold: nextThreshold }) });
    setSaving(false);
    if (!r.ok) { setBanner({ tone:'error', text:r.error }); return; }
    setEnabled(r.data.intentMatchingEnabled);
    setThreshold(r.data.intentMatchThreshold);
    setBanner({ tone:'ok', text: r.data.intentMatchingEnabled
      ? 'Intent matching is on — inbound messages are routed by your intents before they reach the agent.'
      : 'Intent matching is off. Messages go straight to the agent.' });
  };

  const toggleRule = async (rule) => {
    // Optimistic: the switch is the whole interaction, and waiting a round trip
    // to move it makes the card feel broken.
    setRules(list => list.map(r => (r.id === rule.id ? { ...r, isActive: !r.isActive } : r)));
    const r = await wJson(`/intents/${rule.id}`, { method:'PATCH', body: JSON.stringify({ isActive: !rule.isActive }) });
    if (!r.ok) {
      setRules(list => list.map(x => (x.id === rule.id ? { ...x, isActive: rule.isActive } : x)));
      setBanner({ tone:'error', text:r.error });
    }
  };

  const removeRule = async (rule) => {
    if (!window.confirm(`Delete the intent “${rule.name}”? Messages it used to route will fall through to the AI agent.`)) return;
    const r = await wJson(`/intents/${rule.id}`, { method:'DELETE' });
    if (!r.ok) { setBanner({ tone:'error', text:r.error }); return; }
    loadRules();
  };

  const activeCount = rules.filter(r => r.isActive).length;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <TabHeader icon="spark" color="#c4ff46" bg="rgba(196,255,70,0.1)"
        title="Intent matching" subtitle={`Rules that route messages before the AI · ${activeCount} active`}
        badge={enabled && <Pill>On</Pill>}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <Btn variant="outline" onClick={() => setEditor({ intent: null })}>
            <I n="plus" s={13} c="var(--t2)" /> New intent
          </Btn>
          <Toggle on={enabled} onToggle={() => persist(!enabled, threshold)} disabled={saving} />
        </div>
      </TabHeader>

      {banner && <Banner tone={banner.tone}>{banner.text}</Banner>}

      <div className="intent-grid" style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) 320px', gap:16, alignItems:'start' }}>
        {/* ── the rules ── */}
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {loadingRules && (
            <div style={{ ...card, padding:'28px', textAlign:'center', color:'var(--t3)', fontSize:13 }}>Loading intents…</div>
          )}

          {!loadingRules && rules.length === 0 && (
            <div style={{ ...card, padding:'30px 24px', textAlign:'center' }}>
              <div style={{ fontSize:26, marginBottom:10 }}>🎯</div>
              <p style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)', marginBottom:6 }}>No intents yet</p>
              <p style={{ fontSize:13, color:'var(--t2)', lineHeight:1.6, maxWidth:380, margin:'0 auto 16px' }}>
                An intent is a thing customers ask for and where that question should go. Until you add one, every inbound
                message goes straight to the AI agent.
              </p>
              <Btn onClick={() => setEditor({ intent: null })}>Create your first intent</Btn>
            </div>
          )}

          {rules.map(rule => (
            <div key={rule.id} style={{ ...card, padding:'16px 18px', opacity: rule.isActive ? 1 : 0.6, transition:'opacity .15s' }}>
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <span style={{ width:36, height:36, borderRadius:10, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:17, flexShrink:0 }}>
                  {rule.icon}
                </span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:14.5, color:'var(--t1)' }}>{rule.name}</div>
                  <div style={{ fontSize:12, color:'var(--t2)', marginTop:2 }}>→ {rule.routedTo}</div>
                </div>
                <span style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--t3)', flexShrink:0, whiteSpace:'nowrap' }}>
                  {rule.matchCount30d}× / 30d
                </span>
                <button onClick={() => setEditor({ intent: rule })} aria-label={`Edit ${rule.name}`}
                  style={{ width:28, height:28, borderRadius:7, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <I n="pencil" s={12} c="var(--t2)" />
                </button>
                <button onClick={() => removeRule(rule)} aria-label={`Delete ${rule.name}`}
                  style={{ width:28, height:28, borderRadius:7, background:'rgba(239,68,68,0.07)', border:'1px solid rgba(239,68,68,0.2)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <I n="trash" s={12} c="#f87171" />
                </button>
                <Toggle on={rule.isActive} onToggle={() => toggleRule(rule)} />
              </div>
              {Array.isArray(rule.phrases) && rule.phrases.length > 0 && (
                <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:12, paddingLeft:48 }}>
                  {rule.phrases.map(ph => (
                    <span key={ph} style={{ fontFamily:'var(--mono)', fontSize:10.5, padding:'3px 9px', borderRadius:20, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t2)' }}>{ph}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── tester + accuracy ── */}
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ ...card, padding:'18px' }}>
            <div style={{ fontFamily:'var(--mono)', fontSize:10, letterSpacing:'.14em', color:'var(--t3)', textTransform:'uppercase', marginBottom:10 }}>Test a message</div>
            <input value={testInput} onChange={e => setTestInput(e.target.value)} placeholder="Type what a customer might say…" style={inputStyle} />

            {testResult && (
              <div style={{ marginTop:14 }}>
                <div style={{ fontFamily:'var(--mono)', fontSize:9.5, letterSpacing:'.12em', color:'var(--t3)', textTransform:'uppercase', marginBottom:8 }}>
                  {testResult.matched ? 'Matched intent' : 'No match'}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                  <span style={{ fontSize:19 }}>{testResult.matched ? testResult.intent.icon : '🤖'}</span>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:13.5, fontWeight:700, color:'var(--t1)' }}>
                      {testResult.matched ? testResult.intent.name : 'Falls through to the AI agent'}
                    </div>
                    <div style={{ fontSize:11.5, color:'var(--t2)' }}>
                      confidence {Math.round((testResult.confidence || 0) * 100)}% · threshold {Math.round(testResult.threshold * 100)}%
                    </div>
                  </div>
                </div>
                {/* The bar is read against the threshold, so the threshold is
                    drawn on it — a percentage alone does not tell you whether
                    it was enough. */}
                <div style={{ position:'relative', height:6, borderRadius:6, background:'rgba(255,255,255,0.07)', overflow:'hidden', marginBottom:4 }}>
                  <div style={{ width:`${Math.round((testResult.confidence || 0) * 100)}%`, height:'100%', borderRadius:6, background: testResult.matched ? 'var(--green)' : '#fbbf24', transition:'width .2s' }} />
                </div>
                <div style={{ position:'relative', height:10, marginBottom:10 }}>
                  <span style={{ position:'absolute', left:`${Math.round(testResult.threshold * 100)}%`, top:-10, width:1, height:12, background:'var(--t3)' }} />
                </div>
                <div style={{ fontSize:12, color:'var(--t2)' }}>
                  Routed to <strong style={{ color:'var(--t1)' }}>{testResult.routedTo}</strong>
                </div>
                {testResult.matched && testResult.matchedPhrase && (
                  <div style={{ fontSize:11, color:'var(--t3)', marginTop:6 }}>
                    matched on “{testResult.matchedPhrase}”
                  </div>
                )}
                {!testResult.enabled && (
                  <p style={{ fontSize:11, color:'#fbbf24', marginTop:10, lineHeight:1.5 }}>
                    Intent matching is switched off, so this routing is a preview — live messages still go straight to the agent.
                  </p>
                )}
              </div>
            )}
            {testing && !testResult && <p style={{ fontSize:12, color:'var(--t3)', marginTop:12 }}>Matching…</p>}
          </div>

          <div style={{ ...card, padding:'18px' }}>
            <div style={{ fontFamily:'var(--mono)', fontSize:10, letterSpacing:'.14em', color:'var(--t3)', textTransform:'uppercase', marginBottom:12 }}>
              Match accuracy · {stats?.days ?? 30}d
            </div>
            {!stats || stats.total === 0 ? (
              <p style={{ fontSize:12, color:'var(--t3)', lineHeight:1.6 }}>
                No routed messages yet. Once inbound messages start flowing through these intents, their hit rate appears here.
              </p>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
                {[
                  ['Auto-matched',           stats.matched,     'var(--lime)'],
                  ['Fell through to AI',     stats.fellThrough, 'var(--cyan)'],
                  ['Mismatched (corrected)', stats.mismatched,  '#fbbf24'],
                ].map(([label, value, colour]) => (
                  <div key={label}>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:5 }}>
                      <span style={{ color:'var(--t2)' }}>{label}</span>
                      <span style={{ color:colour, fontWeight:700, fontFamily:'var(--mono)' }}>{value.pct}%</span>
                    </div>
                    <div style={{ height:4, borderRadius:4, background:'rgba(255,255,255,0.07)', overflow:'hidden' }}>
                      <div style={{ width:`${value.pct}%`, height:'100%', background:colour, borderRadius:4 }} />
                    </div>
                  </div>
                ))}
                <p style={{ fontSize:10.5, color:'var(--t3)', marginTop:2 }}>{stats.total.toLocaleString()} routed messages</p>
              </div>
            )}
          </div>

          {/* Sensitivity stays with the tester: it is the number the confidence
              bar above is measured against. */}
          <div style={{ ...card, padding:'18px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
              <label htmlFor="intent-sensitivity" style={{ fontSize:12, fontWeight:600, color:'var(--t1)' }}>Match sensitivity</label>
              <span style={{ fontSize:12, color:'var(--t2)' }}>
                {Math.round(threshold * 100)}% — {threshold >= 0.75 ? 'strict' : threshold >= 0.5 ? 'balanced' : 'loose'}
              </span>
            </div>
            <input id="intent-sensitivity" type="range" min="0.3" max="0.9" step="0.05" value={threshold}
              onChange={e => setThreshold(parseFloat(e.target.value))}
              onMouseUp={() => enabled && persist(true, threshold)}
              onTouchEnd={() => enabled && persist(true, threshold)}
              style={{ width:'100%', accentColor:'var(--green)' }} />
            <p style={{ fontSize:11, color:'var(--t3)', marginTop:8, lineHeight:1.5 }}>
              {llmAvailable
                ? 'Anything below this falls through to the AI agent, which answers in its own words.'
                : 'The server has no AI model configured, so anything that falls through gets your default auto-reply instead of a generated answer.'}
            </p>
          </div>
        </div>
      </div>

      {editor && (
        <IntentEditor
          intent={editor.intent}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); loadRules(); loadStats(); }}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────
// 5. WHATSAPP AI AGENT
// ─────────────────────────────────────────────

// How a campaign's own status reads on the agent's usage list. Deliberately
// the campaign's real status rather than a made-up on/off: a paused (cancelled)
// campaign still has customers holding a message with a live CTA.
const CAMPAIGN_TONE = {
  RUNNING:   { label:'Active',    fg:'var(--success)', bg:'var(--sbg)',          bd:'var(--sbd)' },
  SCHEDULED: { label:'Scheduled', fg:'#9d6bff',      bg:'rgba(157,107,255,.08)',  bd:'rgba(157,107,255,.25)' },
  COMPLETED: { label:'Completed', fg:'var(--success)', bg:'var(--sbg)',          bd:'var(--sbd)' },
  DRAFT:     { label:'Draft',     fg:'var(--t2)',    bg:'rgba(255,255,255,.05)', bd:'var(--bd)' },
  CANCELLED: { label:'Paused',    fg:'#fbbf24',      bg:'rgba(245,158,11,.08)',  bd:'rgba(245,158,11,.25)' },
  FAILED:    { label:'Failed',    fg:'#f87171',      bg:'rgba(239,68,68,.08)',   bd:'rgba(239,68,68,.25)' },
};
// The eight things that make an agent answer well, in the order you configure
// them. The section rail is the page's spine: each one edits a different part
// of what the model is handed, and lumping them into one long form was what
// made the previous version unreadable once it grew past three fields.
const AGENT_SECTIONS = [
  { id: 'identity',    icon: 'user',   label: 'Identity',          kicker: 'Identity & tone',        blurb: 'How the agent introduces itself and speaks to customers.' },
  { id: 'purpose',     icon: 'spark',  label: 'Purpose',           kicker: 'What it is for',         blurb: 'The job this agent exists to do. Given to the model as standing context.' },
  { id: 'knowledge',   icon: 'db',     label: 'Knowledge',         kicker: 'Knowledge sources',      blurb: 'What the agent is allowed to know. It answers only from these.' },
  { id: 'instructions',icon: 'note',   label: 'Instructions',      kicker: 'Answering rules',        blurb: 'How to answer — length, formatting, what to do when unsure.' },
  { id: 'campaign',    icon: 'send',   label: 'Campaign awareness',kicker: 'Campaigns using it',     blurb: 'Where this agent is attached, and what it answers about there.' },
  { id: 'escalation',  icon: 'wflow',  label: 'Escalation',        kicker: 'Escalation & handoff',   blurb: 'When the agent steps back and brings in a human.' },
  { id: 'safety',      icon: 'shield', label: 'Safety',            kicker: 'Guardrails',             blurb: 'What the agent must never do, in its own words.' },
  { id: 'performance', icon: 'chart',  label: 'Performance',       kicker: 'Readiness',              blurb: 'What is still missing before this agent is ready for customers.' },
];

const AGENT_LANGUAGES = ['English', 'हिंदी', 'Hinglish', 'मराठी', 'বাংলা', 'தமிழ்', 'తెలుగు', 'ગુજરાતી'];

// Escalation rules mirror backend ESCALATION_RULES. The ids are the contract;
// the labels are this page's business.
const ESCALATION_RULES = [
  { id: 'refund',            label: 'Refund or complaint intent',  hint: 'Anything about money going back' },
  { id: 'negativeSentiment', label: 'Negative sentiment detected',  hint: 'Frustration, anger, repeated complaints' },
  { id: 'asksForHuman',      label: 'Customer asks for a human',    hint: 'An explicit request always wins' },
  { id: 'highIntent',        label: 'High purchase intent',         hint: 'Hand a ready buyer to a person' },
];

const SOURCE_STATUS = {
  READY:   { label: 'CONNECTED', fg: 'var(--success)', bg: 'var(--sbg)',              bd: 'var(--sbd)' },
  PENDING: { label: 'INDEXING',  fg: '#fbbf24',        bg: 'rgba(245,158,11,.08)',   bd: 'rgba(245,158,11,.28)' },
  ERROR:   { label: 'FAILED',    fg: '#f87171',        bg: 'rgba(239,68,68,.08)',    bd: 'rgba(239,68,68,.25)' },
};

const SectionIntro = ({ section }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ fontFamily:'var(--mono)', fontSize:10, letterSpacing:'.16em', textTransform:'uppercase', color:'var(--t3)', marginBottom:7 }}>Configure</div>
    <h3 style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:19, color:'var(--t1)', letterSpacing:'-.02em' }}>{section.kicker}</h3>
    <p style={{ fontSize:13, color:'var(--t2)', marginTop:5, lineHeight:1.6, maxWidth:520 }}>{section.blurb}</p>
  </div>
);

const WhatsAppAIAgentTab = () => {
  const [cfg, setCfg] = useState(null);
  const [section, setSection] = useState('identity');

  // Identity
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [languages, setLanguages] = useState(['English']);
  // The sections added alongside it
  const [purpose, setPurpose] = useState('');
  const [instructions, setInstructions] = useState('');
  const [safetyNote, setSafetyNote] = useState('');
  const [escThreshold, setEscThreshold] = useState(0.65);
  const [escRules, setEscRules] = useState({});

  const [knowledge, setKnowledge] = useState('');
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [uploadNote, setUploadNote] = useState(null);
  const [sources, setSources] = useState([]);
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [addingSource, setAddingSource] = useState(false);

  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [banner, setBanner] = useState(null);

  // Test Lab
  const [testMsg, setTestMsg] = useState('What are your business hours?');
  const [thread, setThread] = useState([]);
  const [testing, setTesting] = useState(false);
  const [usage, setUsage] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [testMode, setTestMode] = useState('general');
  const [testCampaignId, setTestCampaignId] = useState('');

  const load = useCallback(() => wJson('/ai-agent/config').then(r => {
    if (!r.ok || !r.data) return;
    const d = r.data;
    setCfg(d);
    setName(d.aiAgentName || '');
    setSystemPrompt(d.aiAgentPrompt || '');
    setKnowledge(d.aiAgentKnowledge || '');
    setPurpose(d.aiAgentPurpose || '');
    setInstructions(d.aiAgentInstructions || '');
    setSafetyNote(d.aiAgentSafetyNote || '');
    setLanguages(Array.isArray(d.aiAgentLanguages) && d.aiAgentLanguages.length ? d.aiAgentLanguages : ['English']);
    setEscThreshold(typeof d.escalationThreshold === 'number' ? d.escalationThreshold : 0.65);
    setEscRules(d.escalationRules || {});
  }), []);
  useEffect(() => { load(); }, [load]);

  // Structured knowledge sources are the workspace's one corpus — the same
  // rows the website widget indexes. Surfacing them here rather than giving the
  // agent a private second knowledge base is deliberate: two corpora that
  // disagree is how an agent and a widget end up quoting different return
  // policies.
  const loadSources = useCallback(() => wJson('/widgets/knowledge').then(r => {
    if (r.ok && Array.isArray(r.data)) setSources(r.data);
  }), []);
  useEffect(() => { loadSources(); }, [loadSources]);

  const loadUsage = useCallback(() => wJson('/ai-agent/campaigns').then(r => {
    if (r.ok && r.data) setUsage(r.data);
  }), []);
  useEffect(() => { loadUsage(); }, [loadUsage]);

  useEffect(() => {
    wJson('/campaigns?limit=100').then(r => {
      const list = Array.isArray(r.data) ? r.data : r.data?.data;
      if (r.ok && Array.isArray(list)) setCampaigns(list);
    });
  }, []);

  const validateFields = () => {
    if (name.trim()) { const e = validateMeaningfulText(name, 'Agent name'); if (e) return e; }
    if (systemPrompt.trim()) { const e = validateMeaningfulText(systemPrompt, 'Persona'); if (e) return e; }
    return null;
  };

  // One payload for every section: the page saves the whole agent, so moving
  // between sections can never lose an edit made in the one you left.
  const payload = () => JSON.stringify({
    name, systemPrompt, knowledge, purpose, instructions, safetyNote,
    languages, escalationThreshold: escThreshold, escalationRules: escRules,
  });

  const save = async () => {
    const fieldError = validateFields();
    if (fieldError) { setBanner({ tone:'error', text:fieldError }); return; }
    setSaving(true); setBanner(null);
    const r = await wJson('/ai-agent/config', { method:'PATCH', body: payload() });
    setSaving(false);
    if (!r.ok) { setBanner({ tone:'error', text:r.error }); return; }
    setCfg(r.data);
    setBanner({ tone:'ok', text:'Configuration saved.' });
  };

  const deploy = async () => {
    const fieldError = validateFields();
    if (fieldError) { setBanner({ tone:'error', text:fieldError }); return; }
    setDeploying(true); setBanner(null);
    await wJson('/ai-agent/config', { method:'PATCH', body: payload() });
    const r = await wJson(cfg?.aiAgentEnabled ? '/ai-agent/undeploy' : '/ai-agent/deploy', { method:'POST' });
    setDeploying(false);
    if (!r.ok) { setBanner({ tone:'error', text:r.error }); return; }
    setBanner({ tone:'ok', text: r.data.aiAgentEnabled
      ? 'Agent deployed — it now answers inbound messages when no automation rule matches, and can be attached to campaigns.'
      : 'Agent undeployed.' });
    load();
  };

  const uploadKnowledgeDoc = async (file) => {
    if (!file) return;
    setUploadingDoc(true);
    setUploadNote(null);
    const fd = new FormData();
    fd.append('file', file);
    const r = await wJson('/ai-agent/knowledge/upload', { method: 'POST', body: fd });
    setUploadingDoc(false);
    if (!r.ok) { setUploadNote({ error: r.error }); return; }
    const d = r.data;
    setKnowledge(d.knowledge);
    setUploadNote({
      truncated: d.truncated,
      text: d.truncated
        ? `Added ${d.added.toLocaleString()} characters from "${d.fileName}", but ${d.dropped.toLocaleString()} had to be dropped — the knowledge base holds ${d.limit.toLocaleString()} characters and is now full.`
        : `Added ${d.added.toLocaleString()} characters from "${d.fileName}". Using ${d.used.toLocaleString()} of ${d.limit.toLocaleString()}.`,
    });
  };

  const addUrlSource = async () => {
    const url = newSourceUrl.trim();
    if (!url) return;
    setAddingSource(true); setBanner(null);
    const r = await wJson('/widgets/knowledge', { method:'POST', body: JSON.stringify({ kind:'url', url }) });
    setAddingSource(false);
    if (!r.ok) { setBanner({ tone:'error', text:r.error }); return; }
    setNewSourceUrl('');
    loadSources();
    load();   // readiness moves the moment a source connects
  };

  const removeSource = async (source) => {
    if (!window.confirm(`Remove "${source.title}" from the agent's knowledge?`)) return;
    const r = await wJson(`/widgets/knowledge/${source.id}`, { method:'DELETE' });
    if (!r.ok) { setBanner({ tone:'error', text:r.error }); return; }
    loadSources();
    load();
  };

  const runTest = async () => {
    const question = testMsg.trim();
    if (!question) return;
    if (testMode === 'campaign' && !testCampaignId) {
      setThread(t => [...t, { role:'error', text:'Select a campaign to test against.' }]);
      return;
    }
    setTesting(true);
    setThread(t => [...t, { role:'customer', text: question }]);
    const r = await wJson('/ai-agent/test', { method:'POST', body: JSON.stringify({
      message: question,
      mode: testMode,
      ...(testMode === 'campaign' ? { campaignId: testCampaignId } : {}),
    }) });
    setTesting(false);
    setTestMsg('');
    if (r.ok && r.data?.ok) {
      setThread(t => [...t, {
        role: 'agent',
        text: r.data.reply,
        sources: r.data.sources || [],
        grounding: r.data.grounding,
        context: r.data.context,
      }]);
    } else {
      setThread(t => [...t, { role:'error', text: r.data?.reason || r.data?.error || r.error || 'Test failed' }]);
    }
  };

  const deployed = cfg?.aiAgentEnabled === true;
  const llmMissing = cfg && cfg.llmAvailable === false;
  const readiness = cfg?.readiness;
  const active = AGENT_SECTIONS.find(x => x.id === section) || AGENT_SECTIONS[0];

  const toggleLanguage = (lang) => setLanguages(list =>
    list.includes(lang) ? list.filter(l => l !== lang) : [...list, lang]);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <TabHeader icon="bot" color="#9d6bff" bg="rgba(157,107,255,0.1)"
        title={name || 'WhatsApp AI Agent'}
        subtitle={deployed
          ? 'Deployed · answering campaign CTAs and inbound messages'
          : 'Not deployed · configure it here, then put it live'}
        badge={deployed && <Pill>Live</Pill>}>
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <Btn variant="outline" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Btn>
          <Btn onClick={deploy} disabled={deploying || llmMissing}
            style={deployed ? { background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.3)', color:'#f87171', boxShadow:'none' } : { boxShadow:'var(--glow)' }}>
            {deploying ? 'Working…' : deployed ? 'Undeploy agent' : <><I n="play" s={14} c="#08090c"/> Deploy agent</>}
          </Btn>
        </div>
      </TabHeader>

      {llmMissing && <Banner tone="warn">No LLM provider is configured on the server. Set <code>GEMINI_API_KEY</code> in the backend environment to enable deployment and live testing.</Banner>}
      {banner && <Banner tone={banner.tone}>{banner.text}</Banner>}

      <div className="agent-grid" style={{ display:'grid', gridTemplateColumns:'190px minmax(0,1fr) 330px', gap:16, alignItems:'start' }}>

        {/* ── section rail + readiness ── */}
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ ...card, padding:8, display:'flex', flexDirection:'column', gap:2 }}>
            {AGENT_SECTIONS.map(sec => {
              const on = sec.id === section;
              return (
                <button key={sec.id} onClick={() => setSection(sec.id)}
                  style={{ display:'flex', alignItems:'center', gap:9, padding:'9px 10px', borderRadius:9, border:'none', cursor:'pointer', textAlign:'left', width:'100%',
                           fontFamily:"'Manrope',sans-serif", fontSize:13, fontWeight: on ? 700 : 500,
                           color: on ? 'var(--t1)' : 'var(--t2)',
                           background: on ? 'rgba(157,107,255,0.12)' : 'transparent',
                           borderLeft: `2px solid ${on ? '#9d6bff' : 'transparent'}` }}>
                  <I n={sec.icon} s={14} c={on ? '#9d6bff' : 'var(--t3)'} />
                  {sec.label}
                </button>
              );
            })}
          </div>

          {readiness && (
            <div style={{ ...card, padding:16 }}>
              <div style={{ fontFamily:'var(--mono)', fontSize:9.5, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--t3)', marginBottom:8 }}>AI readiness</div>
              <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:800, fontSize:30, color: readiness.score >= 80 ? 'var(--lime)' : readiness.score >= 50 ? 'var(--accent)' : '#fbbf24', letterSpacing:'-.03em', lineHeight:1 }}>
                {readiness.score}%
              </div>
              <div style={{ height:4, borderRadius:4, background:'rgba(255,255,255,0.07)', overflow:'hidden', margin:'10px 0 9px' }}>
                <div style={{ width:`${readiness.score}%`, height:'100%', borderRadius:4, background:'var(--grad-cta)', transition:'width .3s' }} />
              </div>
              <p style={{ fontSize:11.5, color:'var(--t2)', lineHeight:1.5 }}>
                {readiness.nextStep ? readiness.nextStep : 'Everything is configured.'}
              </p>
            </div>
          )}
        </div>

        {/* ── section body ── */}
        <div style={{ ...card, padding:22, minWidth:0 }}>
          <SectionIntro section={active} />

          {section === 'identity' && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <div>
                <label style={labelStyle}>Agent name</label>
                <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} maxLength={80} placeholder="Support Agent" />
              </div>
              <div>
                <label style={labelStyle}>Persona & tone</label>
                <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={5} maxLength={4000}
                  style={{ ...inputStyle, resize:'vertical' }}
                  placeholder="Warm, concise and helpful. Speaks like a knowledgeable store associate — never pushy, never robotic." />
              </div>
              <div>
                <label style={labelStyle}>Languages</label>
                <div style={{ display:'flex', flexWrap:'wrap', gap:7 }}>
                  {AGENT_LANGUAGES.map(lang => {
                    const on = languages.includes(lang);
                    return (
                      <button key={lang} type="button" onClick={() => toggleLanguage(lang)}
                        style={{ fontSize:12.5, fontWeight:600, padding:'6px 13px', borderRadius:100, cursor:'pointer', fontFamily:"'Manrope',sans-serif",
                                 background: on ? 'var(--gbg)' : 'rgba(255,255,255,0.03)',
                                 border:`1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`,
                                 color: on ? 'var(--green)' : 'var(--t2)' }}>{lang}</button>
                    );
                  })}
                </div>
                <p style={{ fontSize:11, color:'var(--t3)', marginTop:8, lineHeight:1.5 }}>
                  The agent replies in the customer’s language. This tells it which ones you actually support.
                </p>
              </div>
            </div>
          )}

          {section === 'purpose' && (
            <div>
              <label style={labelStyle}>What this agent is for</label>
              <textarea value={purpose} onChange={e => setPurpose(e.target.value)} rows={6} maxLength={2000}
                style={{ ...inputStyle, resize:'vertical' }}
                placeholder="Answer questions about live offers and orders for our D2C footwear store, and hand anything about refunds to the support team." />
              <p style={{ fontSize:11.5, color:'var(--t3)', marginTop:8, lineHeight:1.6 }}>
                One or two sentences. This rides along with every reply as standing context, so it is worth being specific
                about the business rather than the tone — tone belongs in Identity.
              </p>
            </div>
          )}

          {section === 'knowledge' && (
            <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
              {/* Structured sources first: they are the ones with a status. */}
              <div>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:10, flexWrap:'wrap' }}>
                  <span style={{ fontFamily:'var(--mono)', fontSize:10, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--t3)' }}>
                    Connected sources · {sources.length}
                  </span>
                </div>

                {sources.length === 0 && (
                  <p style={{ fontSize:12.5, color:'var(--t3)', lineHeight:1.6, marginBottom:12 }}>
                    Nothing connected yet. Add your website, product pages or a policy page and the agent can answer from them.
                  </p>
                )}

                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {sources.map(src => {
                    const tone = SOURCE_STATUS[src.status] || SOURCE_STATUS.PENDING;
                    return (
                      <div key={src.id} style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 13px', borderRadius:10, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)' }}>
                        <I n={src.kind === 'url' ? 'globe' : src.kind === 'file' ? 'file' : 'note'} s={15} c="var(--t2)" />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:'var(--t1)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{src.title}</div>
                          <div style={{ fontSize:11, color:'var(--t3)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                            {src.error
                              ? src.error
                              : `${(src.chars || 0).toLocaleString()} characters${src.fetchedAt ? ` · read ${new Date(src.fetchedAt).toLocaleDateString('en-IN', { day:'numeric', month:'short' })}` : ''}`}
                          </div>
                        </div>
                        <span style={{ fontFamily:'var(--mono)', fontSize:9, letterSpacing:'.06em', padding:'3px 8px', borderRadius:6, flexShrink:0, background:tone.bg, border:`1px solid ${tone.bd}`, color:tone.fg }}>
                          {tone.label}
                        </span>
                        <button onClick={() => removeSource(src)} aria-label={`Remove ${src.title}`}
                          style={{ width:26, height:26, borderRadius:7, background:'rgba(239,68,68,0.07)', border:'1px solid rgba(239,68,68,0.2)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                          <I n="trash" s={11} c="#f87171" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap' }}>
                  <input value={newSourceUrl} onChange={e => setNewSourceUrl(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addUrlSource(); } }}
                    placeholder="https://yourstore.com/faq" style={{ ...inputStyle, flex:'1 1 220px' }} />
                  <Btn variant="outline" onClick={addUrlSource} disabled={addingSource}>
                    {addingSource ? 'Reading…' : 'Add source'}
                  </Btn>
                </div>
                <p style={{ fontSize:11, color:'var(--t3)', marginTop:7, lineHeight:1.5 }}>
                  Shared with the website widget — one corpus, so the agent and the widget can never quote different policies.
                </p>
              </div>

              {/* The inline base stays: it is what short, hand-written facts
                  belong in, and it is what the campaign reply path already
                  reads. */}
              <div style={{ borderTop:'1px solid var(--bd)', paddingTop:16 }}>
                <label style={labelStyle}>Notes the agent should always know</label>
                <textarea value={knowledge} onChange={e => setKnowledge(e.target.value)} rows={6} maxLength={12000}
                  style={{ ...inputStyle, resize:'vertical' }}
                  placeholder={"Business hours: Mon-Sat 9am-7pm IST\nReturns: within 7 days with receipt\nShipping: 2-4 business days"} />

                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginTop:7, flexWrap:'wrap' }}>
                  <label style={{ display:'inline-flex', alignItems:'center', gap:7, fontSize:12, color:'var(--t2)', cursor: uploadingDoc ? 'wait' : 'pointer' }}>
                    <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 11px', borderRadius:8, border:'1px solid var(--bd)', background:'rgba(255,255,255,0.04)', fontWeight:600 }}>
                      <I n="file" s={12} c="var(--t2)" />
                      {uploadingDoc ? 'Reading…' : 'Upload document'}
                    </span>
                    <input type="file" accept=".pdf,.docx,.txt,.md,.csv" disabled={uploadingDoc}
                      onChange={e => { uploadKnowledgeDoc(e.target.files?.[0]); e.target.value = ''; }}
                      style={{ display:'none' }} />
                  </label>
                  <span style={{ fontSize:11, color: knowledge.length >= 12000 ? '#fbbf24' : 'var(--t3)' }}>
                    {knowledge.length.toLocaleString()} / 12,000
                  </span>
                </div>

                <p style={{ fontSize:11, color:'var(--t3)', marginTop:5, lineHeight:1.5 }}>
                  PDF, Word (.docx) or plain text. The text is extracted and appended to whatever is above — the file itself is not stored.
                </p>

                {uploadNote && (
                  <div style={{ marginTop:8, padding:'8px 11px', borderRadius:8, fontSize:11.5, lineHeight:1.5,
                    background: uploadNote.error ? 'rgba(239,68,68,.08)' : uploadNote.truncated ? 'rgba(245,158,11,.08)' : 'var(--gbg)',
                    border: `1px solid ${uploadNote.error ? 'rgba(239,68,68,.25)' : uploadNote.truncated ? 'rgba(245,158,11,.28)' : 'var(--gbd)'}`,
                    color: uploadNote.error ? '#f87171' : uploadNote.truncated ? '#fbbf24' : 'var(--green)' }}>
                    {uploadNote.error || uploadNote.text}
                  </div>
                )}
              </div>
            </div>
          )}

          {section === 'instructions' && (
            <div>
              <label style={labelStyle}>How the agent should answer</label>
              <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={8} maxLength={4000}
                style={{ ...inputStyle, resize:'vertical' }}
                placeholder={"Keep replies to two or three sentences.\nAlways confirm the size before promising stock.\nIf a fact is not in the campaign or the knowledge base, say so and offer a human."} />
              <p style={{ fontSize:11.5, color:'var(--t3)', marginTop:8, lineHeight:1.6 }}>
                One instruction per line reads best. These are appended to the persona, so they win where the two disagree.
              </p>
            </div>
          )}

          {section === 'campaign' && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                <p style={{ fontSize:13, color:'var(--t2)' }}>
                  {usage === null ? 'Checking campaigns…'
                    : usage.total === 0 ? 'No campaign uses this agent yet — turn it on in the AI Agent step of the campaign wizard.'
                    : `Attached to ${usage.total} campaign${usage.total === 1 ? '' : 's'}.`}
                </p>
                <Btn variant="outline" size="sm" onClick={loadUsage}>Refresh</Btn>
              </div>

              {usage?.campaigns?.length > 0 && (
                <div style={{ border:'1px solid var(--bd)', borderRadius:10, overflow:'hidden' }}>
                  {usage.campaigns.map((c, i) => (
                    <div key={c.id} style={{ padding:'12px 14px', borderBottom: i < usage.campaigns.length - 1 ? '1px solid var(--bd)' : 'none', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                      <div style={{ flex:1, minWidth:180 }}>
                        <p style={{ fontSize:13, fontWeight:600, color:'var(--t1)' }}>{c.name}</p>
                        <p style={{ fontSize:11.5, color:'var(--t3)', marginTop:2 }}>
                          CTA “{c.aiAgentCtaLabel || 'Ask Anything'}”
                          {c.totalContacts ? ` · ${c.totalContacts} recipient${c.totalContacts === 1 ? '' : 's'}` : ''}
                        </p>
                      </div>
                      {c.activeSessions > 0 && (
                        <span style={{ fontSize:11, fontWeight:600, color:'var(--green)' }}>
                          {c.activeSessions} chat{c.activeSessions === 1 ? '' : 's'} live
                        </span>
                      )}
                      <span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:20, textTransform:'capitalize',
                        color: CAMPAIGN_TONE[c.status]?.fg || 'var(--t2)',
                        background: CAMPAIGN_TONE[c.status]?.bg || 'rgba(255,255,255,0.05)',
                        border: `1px solid ${CAMPAIGN_TONE[c.status]?.bd || 'var(--bd)'}` }}>
                        {CAMPAIGN_TONE[c.status]?.label || c.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ padding:'11px 14px', background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', borderRadius:8, fontSize:11.5, color:'var(--t3)', lineHeight:1.6 }}>
                Reply order on inbound messages: <strong style={{ color:'var(--t2)' }}>active campaign AI chat</strong> → form in progress → workflow → keyword trigger → intent match → welcome/out-of-office → <strong style={{ color:'var(--t2)' }}>this agent</strong>.
              </div>
            </div>
          )}

          {section === 'escalation' && (
            <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8 }}>
                  <label htmlFor="esc-threshold" style={{ fontSize:13, fontWeight:600, color:'var(--t1)' }}>Confidence threshold for handoff</label>
                  <span style={{ fontFamily:'var(--mono)', fontSize:14, fontWeight:700, color:'var(--accent)' }}>{Math.round(escThreshold * 100)}%</span>
                </div>
                <input id="esc-threshold" type="range" min="0.3" max="0.95" step="0.05" value={escThreshold}
                  onChange={e => setEscThreshold(parseFloat(e.target.value))}
                  style={{ width:'100%', accentColor:'var(--green)' }} />
                <p style={{ fontSize:12, color:'var(--t2)', marginTop:9, lineHeight:1.6 }}>
                  Below {Math.round(escThreshold * 100)}% confidence, or on any of the intents below, the agent stops answering
                  and hands the conversation to a human in the shared inbox.
                </p>
              </div>

              <div>
                <div style={{ fontFamily:'var(--mono)', fontSize:10, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--t3)', marginBottom:10 }}>Always escalate on</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {ESCALATION_RULES.map(rule => (
                    <div key={rule.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 13px', borderRadius:10, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)' }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:600, color:'var(--t1)' }}>{rule.label}</div>
                        <div style={{ fontSize:11, color:'var(--t3)', marginTop:2 }}>{rule.hint}</div>
                      </div>
                      <Toggle on={escRules[rule.id] === true} onToggle={() => setEscRules(r => ({ ...r, [rule.id]: !r[rule.id] }))} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {section === 'safety' && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <div style={{ display:'flex', gap:12, alignItems:'flex-start', padding:'14px 16px', borderRadius:10, background:'var(--gbg)', border:'1px solid var(--gbd)' }}>
                <I n="shield" s={17} c="var(--green)" />
                <p style={{ fontSize:12.5, color:'var(--t2)', lineHeight:1.6 }}>
                  Always on: the agent is instructed never to state a discount, price or date that is not in the campaign or a
                  connected source. Asked something neither covers, it says so and offers a human rather than filling the gap.
                </p>
              </div>
              <div>
                <label style={labelStyle}>Your own guardrails</label>
                <textarea value={safetyNote} onChange={e => setSafetyNote(e.target.value)} rows={6} maxLength={2000}
                  style={{ ...inputStyle, resize:'vertical' }}
                  placeholder={"Never promise a delivery date for a made-to-order item.\nNever quote a competitor.\nNever ask for card details in chat."} />
              </div>
            </div>
          )}

          {section === 'performance' && (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {!readiness && <p style={{ fontSize:13, color:'var(--t3)' }}>Loading…</p>}
              {readiness?.checks?.map(check => (
                <div key={check.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', borderRadius:10,
                  background: check.done ? 'var(--sbg)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${check.done ? 'var(--sbd)' : 'var(--bd)'}` }}>
                  <I n={check.done ? 'checkc' : 'alertc'} s={16} c={check.done ? 'var(--success)' : 'var(--t3)'} />
                  <span style={{ flex:1, fontSize:13, color: check.done ? 'var(--t1)' : 'var(--t2)' }}>{check.label}</span>
                  <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--t3)', flexShrink:0 }}>{check.weight} pts</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Test Lab ── */}
        <div style={{ ...card, padding:18, display:'flex', flexDirection:'column', gap:12, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <span style={{ fontFamily:'var(--mono)', fontSize:10, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--t1)' }}>Test lab</span>
            <span style={{ fontFamily:'var(--mono)', fontSize:9, letterSpacing:'.06em', padding:'2px 7px', borderRadius:5, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t3)' }}>
              not live · sandbox
            </span>
          </div>
          <p style={{ fontSize:12, color:'var(--t2)', lineHeight:1.55 }}>
            Ask what a customer would ask. Every answer shows the sources it was given and how much of it traces back to them.
          </p>

          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {[['general', 'General'], ['campaign', 'Campaign context']].map(([id, label]) => {
              const on = testMode === id;
              return (
                <button key={id} onClick={() => { setTestMode(id); setThread([]); }}
                  style={{ fontSize:12, fontWeight:600, padding:'6px 12px', borderRadius:100, cursor:'pointer', fontFamily:"'Manrope',sans-serif",
                           background: on ? 'var(--gbg)' : 'rgba(255,255,255,0.03)',
                           border:`1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`,
                           color: on ? 'var(--green)' : 'var(--t2)' }}>{label}</button>
              );
            })}
          </div>

          {testMode === 'campaign' && (
            <select value={testCampaignId} onChange={e => { setTestCampaignId(e.target.value); setThread([]); }} style={inputStyle}>
              <option value="">— Select a campaign —</option>
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.aiAgentEnabled ? ' · agent attached' : ''}</option>
              ))}
            </select>
          )}

          <div style={{ display:'flex', flexDirection:'column', gap:10, maxHeight:340, overflowY:'auto', padding:'2px 0' }}>
            {thread.length === 0 && (
              <p style={{ fontSize:12, color:'var(--t3)', lineHeight:1.6 }}>
                Nothing tested yet. Answers appear here with their sources.
              </p>
            )}
            {thread.map((m, i) => {
              if (m.role === 'customer') {
                return (
                  <div key={i} style={{ alignSelf:'flex-end', maxWidth:'88%', borderRadius:'13px 4px 13px 13px', background:'rgba(53,232,242,0.14)', border:'1px solid var(--gbd)', padding:'8px 11px' }}>
                    <p style={{ fontSize:12.5, color:'var(--t1)', lineHeight:1.5 }}>{m.text}</p>
                  </div>
                );
              }
              if (m.role === 'error') {
                return (
                  <div key={i} style={{ borderRadius:9, background:'rgba(239,68,68,.06)', border:'1px solid rgba(239,68,68,.25)', padding:'9px 12px' }}>
                    <p style={{ fontSize:12, color:'#f87171', lineHeight:1.5 }}>{m.text}</p>
                  </div>
                );
              }
              const pct = m.grounding == null ? null : Math.round(m.grounding * 100);
              return (
                <div key={i} style={{ alignSelf:'flex-start', maxWidth:'96%', minWidth:0 }}>
                  {m.sources?.length > 0 && (
                    <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:6 }}>
                      {m.sources.map(src => (
                        <span key={src.kind} style={{ fontFamily:'var(--mono)', fontSize:8.5, letterSpacing:'.06em', textTransform:'uppercase', padding:'2px 7px', borderRadius:5,
                          background: src.kind === 'campaign' ? 'rgba(53,232,242,0.12)' : src.kind === 'knowledge' ? 'rgba(196,255,70,0.12)' : 'rgba(157,107,255,0.12)',
                          border: `1px solid ${src.kind === 'campaign' ? 'var(--gbd)' : src.kind === 'knowledge' ? 'rgba(196,255,70,0.3)' : 'rgba(157,107,255,0.3)'}`,
                          color: src.kind === 'campaign' ? 'var(--cyan)' : src.kind === 'knowledge' ? 'var(--lime)' : 'var(--violet)' }}>
                          {src.label}
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ borderRadius:'4px 13px 13px 13px', background:'rgba(255,255,255,0.045)', border:'1px solid var(--bd)', padding:'10px 12px' }}>
                    <p style={{ fontSize:12.5, color:'var(--t1)', lineHeight:1.55, whiteSpace:'pre-wrap' }}>{m.text}</p>
                  </div>
                  {pct != null && (
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:7 }}
                      title="Share of the answer's distinctive words that appear in the sources the agent was given. Low means the model supplied it from its own knowledge rather than yours.">
                      <span style={{ fontFamily:'var(--mono)', fontSize:8.5, letterSpacing:'.1em', color:'var(--t3)', textTransform:'uppercase' }}>Grounding</span>
                      <span style={{ flex:1, height:4, borderRadius:4, background:'rgba(255,255,255,0.07)', overflow:'hidden' }}>
                        <span style={{ display:'block', width:`${pct}%`, height:'100%', borderRadius:4, background: pct >= 60 ? 'var(--lime)' : pct >= 30 ? '#fbbf24' : '#f87171' }} />
                      </span>
                      <span style={{ fontFamily:'var(--mono)', fontSize:10, color: pct >= 60 ? 'var(--lime)' : pct >= 30 ? '#fbbf24' : '#f87171' }}>{pct}%</span>
                    </div>
                  )}
                  {m.context && (
                    <details style={{ fontSize:11, color:'var(--t3)', marginTop:7 }}>
                      <summary style={{ cursor:'pointer', color:'var(--t2)' }}>Campaign content the agent was given</summary>
                      <pre style={{ marginTop:7, whiteSpace:'pre-wrap', fontFamily:"'Manrope',sans-serif", lineHeight:1.55 }}>
                        {[m.context.header, m.context.body, m.context.footer].filter(Boolean).join('\n\n') || '(no text content)'}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ marginTop:'auto', display:'flex', gap:8 }}>
            <input value={testMsg} onChange={e => setTestMsg(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runTest(); } }}
              placeholder="Ask a test question…" style={{ ...inputStyle, flex:1 }} />
            <Btn variant="outline" onClick={runTest} disabled={testing || llmMissing}>{testing ? '…' : 'Test'}</Btn>
          </div>

          <div style={{ display:'flex', flexWrap:'wrap', gap:5, paddingTop:4, borderTop:'1px solid var(--bd)' }}>
            <span style={{ fontFamily:'var(--mono)', fontSize:8.5, letterSpacing:'.1em', color:'var(--t3)', textTransform:'uppercase', marginRight:4, paddingTop:5 }}>Legend</span>
            {[['Campaign context', 'var(--cyan)'], ['Knowledge base', 'var(--lime)'], ['Persona & profile', 'var(--violet)']].map(([label, colour]) => (
              <span key={label} style={{ fontFamily:'var(--mono)', fontSize:8.5, letterSpacing:'.06em', textTransform:'uppercase', padding:'2px 7px', borderRadius:5, marginTop:3, color:colour, border:`1px solid ${colour}`, opacity:.75 }}>
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// 6. INSTAGRAM QUICKFLOWS
// ─────────────────────────────────────────────
const IG_SOURCES = [['dm', 'Direct Message'], ['comment', 'Post Comment'], ['story_reply', 'Story Reply']];

const InstagramQuickflowsTab = () => {
  const [conn, setConn] = useState(null);
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(null);
  const [banner, setBanner] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const c = await wJson('/instagram/connection');
    if (c.locked) { setLocked(c.feature || 'automation'); setLoading(false); return; }
    if (c.ok) setConn(c.data);
    const f = await wJson('/instagram/flows');
    if (f.ok && Array.isArray(f.data)) setFlows(f.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // The OAuth callback redirects back here with a result in the query string.
    const params = new URLSearchParams(window.location.search);
    if (params.get('instagram') === 'connected') setBanner({ tone:'ok', text:'Instagram account connected.' });
    const err = params.get('instagram_error');
    if (err) setBanner({ tone:'error', text:`Instagram connection failed: ${err.replace(/_/g, ' ')}.` });
  }, [load]);

  const connect = async () => {
    const r = await wJson('/instagram/auth-url', { method:'POST' });
    if (!r.ok) { setBanner({ tone: r.data?.code === 'INSTAGRAM_NOT_CONFIGURED' ? 'warn' : 'error', text:r.error }); return; }
    window.location.href = r.data.url;
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect this Instagram account? Your flows are kept but will stop running.')) return;
    const r = await wJson('/instagram/connection', { method:'DELETE' });
    if (r.ok) { setBanner({ tone:'ok', text:'Instagram disconnected.' }); load(); }
    else setBanner({ tone:'error', text:r.error });
  };

  const openCreate = () => { setEditing(null); setForm({ name:'', source:'dm', keyword:'', responseTemplate:'', alsoSendDm:false }); };
  const openEdit = f => { setEditing(f); setForm({ ...f }); };

  const save = async () => {
    const nameError = validateMeaningfulText(form.name, 'Flow name');
    if (nameError) { setBanner({ tone:'error', text:nameError }); return; }
    const respError = validateMeaningfulText(form.responseTemplate, 'Reply message');
    if (respError) { setBanner({ tone:'error', text:respError }); return; }
    setSaving(true);
    const payload = {
      name: form.name, source: form.source, keyword: form.keyword || '',
      responseTemplate: form.responseTemplate, alsoSendDm: !!form.alsoSendDm,
    };
    const r = editing
      ? await wJson(`/instagram/flows/${editing.id}`, { method:'PATCH', body: JSON.stringify(payload) })
      : await wJson('/instagram/flows', { method:'POST', body: JSON.stringify(payload) });
    setSaving(false);
    if (!r.ok) { setBanner({ tone:'error', text:r.error }); return; }
    setForm(null); setEditing(null); setBanner(null);
    load();
  };

  const toggle = async f => {
    const next = !f.isActive;
    setFlows(p => p.map(x => x.id === f.id ? { ...x, isActive: next } : x));
    const r = await wJson(`/instagram/flows/${f.id}`, { method:'PATCH', body: JSON.stringify({ isActive: next }) });
    if (!r.ok) { setFlows(p => p.map(x => x.id === f.id ? f : x)); setBanner({ tone:'error', text:r.error }); }
  };

  const del = async id => {
    if (!window.confirm('Delete this flow?')) return;
    const r = await wJson(`/instagram/flows/${id}`, { method:'DELETE' });
    if (r.ok) load(); else setBanner({ tone:'error', text:r.error });
  };

  if (loading) return <Loading />;
  if (locked) return <PlanLocked feature={locked} />;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <TabHeader icon="insta" color="#dc2743" bg="linear-gradient(45deg,#f09433,#dc2743,#bc1888)"
        title="Instagram Quickflows" subtitle="Auto-reply to Instagram DMs, comments and story replies"
        badge={conn?.connected && <Pill>Connected</Pill>}>
        {conn?.connected && <Btn onClick={openCreate} style={{ boxShadow:'var(--glow)' }}><I n="plus" s={14} c="#08090c"/> New IG Flow</Btn>}
      </TabHeader>

      {banner && <Banner tone={banner.tone}>{banner.text}</Banner>}

      {!conn?.configured && (
        <Banner tone="warn">
          Instagram isn’t configured on this server yet. Set <code>INSTAGRAM_APP_ID</code> and <code>INSTAGRAM_APP_SECRET</code> in the backend environment, then point the Meta webhook at <code>/api/v1/webhook/instagram</code>.
        </Banner>
      )}

      {!conn?.connected ? (
        <div style={{ ...card, padding:'40px 24px', textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap:16 }}>
          <div style={{ width:64, height:64, borderRadius:16, background:'rgba(255,255,255,0.02)', border:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="insta" s={32} c="var(--t3)" />
          </div>
          <div>
            <h3 style={{ fontSize:16, fontWeight:600, color:'var(--t1)', marginBottom:8 }}>Connect your Instagram account</h3>
            <p style={{ fontSize:13, color:'var(--t2)', maxWidth:420, margin:'0 auto' }}>
              Once connected, you can auto-reply to DMs, comments on your posts and story replies.
            </p>
          </div>
          <Btn onClick={connect} disabled={!conn?.configured} style={{ boxShadow:'var(--glow)' }}>Connect Instagram Account</Btn>
        </div>
      ) : (
        <>
          <div style={{ ...card, padding:'14px 18px', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <I n="insta" s={16} c="#dc2743" />
              <div>
                <p style={{ fontSize:13, fontWeight:600, color:'var(--t1)' }}>{conn.username ? `@${conn.username}` : 'Instagram account'}</p>
                <p style={{ fontSize:11, color:'var(--t3)' }}>Connected {new Date(conn.connectedAt).toLocaleDateString()}</p>
              </div>
            </div>
            <Btn variant="outline" size="sm" onClick={disconnect} style={{ borderColor:'#f8717133', color:'#f87171' }}>Disconnect</Btn>
          </div>

          {form && (
            <div style={{ ...card, padding:20, display:'flex', flexDirection:'column', gap:12 }}>
              <p style={{ fontSize:13, fontWeight:700, color:'var(--t1)', fontFamily:"'Space Grotesk',sans-serif" }}>{editing ? 'Edit Flow' : 'New Instagram Flow'}</p>
              <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                <div style={{ flex:1, minWidth:200 }}>
                  <label style={labelStyle}>Flow name</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Price enquiries" style={inputStyle} />
                </div>
                <div style={{ minWidth:180 }}>
                  <label style={labelStyle}>Trigger on</label>
                  <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} style={inputStyle}>
                    {IG_SOURCES.map(([v, l]) => <option key={v} value={v} style={{ background:'#0a0b0e' }}>{l}</option>)}
                  </select>
                </div>
                <div style={{ minWidth:160 }}>
                  <label style={labelStyle}>Keyword (optional)</label>
                  <input value={form.keyword} onChange={e => setForm(f => ({ ...f, keyword: e.target.value.toUpperCase() }))}
                    placeholder="Blank = all" style={{ ...inputStyle, fontFamily:'monospace', color:'var(--green)' }} />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Reply message</label>
                <textarea value={form.responseTemplate} onChange={e => setForm(f => ({ ...f, responseTemplate: e.target.value }))}
                  rows={3} style={{ ...inputStyle, resize:'vertical' }} />
              </div>
              {form.source === 'comment' && (
                <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12.5, color:'var(--t2)', cursor:'pointer' }}>
                  <input type="checkbox" checked={!!form.alsoSendDm} onChange={e => setForm(f => ({ ...f, alsoSendDm: e.target.checked }))}
                    style={{ width:15, height:15, accentColor:'var(--green)' }} />
                  Also send the commenter a DM
                </label>
              )}
              <div style={{ display:'flex', gap:8 }}>
                <Btn onClick={save} disabled={saving} style={{ boxShadow:'var(--glow)' }}>{saving ? 'Saving…' : editing ? 'Update Flow' : 'Create Flow'}</Btn>
                <Btn variant="ghost" onClick={() => { setForm(null); setEditing(null); }}>Cancel</Btn>
              </div>
            </div>
          )}

          <div style={{ ...card, overflow:'hidden' }}>
            {flows.length === 0 ? (
              <div style={{ padding:32, textAlign:'center', color:'var(--t2)', fontSize:13 }}>No Instagram flows yet. Create one above.</div>
            ) : flows.map((f, i) => (
              <div key={f.id} style={{ padding:'14px 18px', borderBottom: i < flows.length-1 ? '1px solid var(--bd)' : 'none', display:'flex', gap:12, alignItems:'center', flexWrap:'wrap', opacity: f.isActive ? 1 : .55 }}>
                <span style={{ fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:6, background:'rgba(220,39,67,0.1)', border:'1px solid rgba(220,39,67,0.25)', color:'#f472b6' }}>
                  {IG_SOURCES.find(([v]) => v === f.source)?.[1] || f.source}
                </span>
                {f.keyword
                  ? <span style={{ fontSize:12, fontFamily:'monospace', color:'var(--green)' }}>{f.keyword}</span>
                  : <span style={{ fontSize:11, color:'var(--t3)' }}>all messages</span>}
                <div style={{ flex:1, minWidth:180 }}>
                  <p style={{ fontSize:13, fontWeight:600, color:'var(--t1)' }}>{f.name}</p>
                  <p style={{ fontSize:12, color:'var(--t2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.responseTemplate}</p>
                </div>
                <span style={{ fontSize:11, color:'var(--t3)' }}>{f.triggeredCount} fired</span>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <Toggle on={f.isActive} onToggle={() => toggle(f)} />
                  <IconBtn icon="pencil" onClick={() => openEdit(f)} />
                  <IconBtn icon="trash" danger onClick={() => del(f.id)} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────
// 7. VOICE AI
// ─────────────────────────────────────────────
const VoiceAITab = () => {
  const [cfg, setCfg] = useState(null);
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(null);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null);
  const [openCall, setOpenCall] = useState(null);

  const load = useCallback(async () => {
    const r = await wJson('/automation/voice');
    if (r.locked) { setLocked(r.feature || 'automation'); setLoading(false); return; }
    if (r.ok) setCfg(r.data);
    const c = await wJson('/automation/voice/calls');
    if (c.ok && Array.isArray(c.data)) setCalls(c.data);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const patch = async (updates) => {
    setSaving(true); setBanner(null);
    const r = await wJson('/automation/voice', { method:'PATCH', body: JSON.stringify(updates) });
    setSaving(false);
    if (!r.ok) { setBanner({ tone:'error', text:r.error }); return false; }
    setCfg(r.data);
    setBanner({ tone:'ok', text:'Saved.' });
    return true;
  };

  if (loading) return <Loading />;
  if (locked) return <PlanLocked feature={locked} />;
  if (!cfg) return <Banner tone="error">Could not load voice settings.</Banner>;

  if (!cfg.voiceAiEnabled) {
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
        <TabHeader icon="phone" color="var(--green)" bg="rgba(53,232,242,0.1)"
          title="Voice AI - Inbound Calls" subtitle="An AI receptionist that answers calls and captures leads" />
        {banner && <Banner tone={banner.tone}>{banner.text}</Banner>}
        <div style={{ ...card, padding:'40px', display:'flex', flexDirection:'column', alignItems:'center', gap:'28px' }}>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'40px', width:'100%', justifyContent:'center' }}>
            <div style={{ flex:1, minWidth:'280px', display:'flex', flexDirection:'column', gap:'16px' }}>
              <p style={{ fontSize:'20px', fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, color:'var(--t1)', lineHeight:1.3 }}>
                Get an <span style={{ color:'var(--green)' }}>AI Receptionist</span> to handle your calls 24/7.
              </p>
              <ul style={{ display:'flex', flexDirection:'column', gap:'12px', padding:0, listStyle:'none' }}>
                {['AI answers calls 24x7', 'Callers are saved as contacts automatically', 'Transfers to your team when asked', 'Full transcript of every call'].map((item, i) => (
                  <li key={i} style={{ display:'flex', alignItems:'center', gap:'12px', fontSize:'14px', color:'var(--t1)' }}>
                    <I n="check" s={16} c="var(--green)" /> {item}
                  </li>
                ))}
              </ul>
            </div>
            <div style={{ flex:1, minWidth:'300px' }}>
              <p style={{ fontSize:'14px', fontWeight:700, color:'var(--t1)', marginBottom:'16px', textAlign:'center' }}>How It Works</p>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:'rgba(255,255,255,0.02)', padding:'20px', borderRadius:'12px', border:'1px solid var(--bd)' }}>
                {[['phone', 'Call comes in', 'rgba(255,255,255,0.05)', 'var(--t2)'], ['spark', 'AI answers', '#581c87', '#e9d5ff'], ['users', 'Lead captured', 'var(--green)', '#000']].map(([icon, label, bg, fg], i, arr) => (
                  <div key={label} style={{ display:'contents' }}>
                    {i > 0 && <I n="arrow" s={14} c="var(--t3)" />}
                    <div style={{ textAlign:'center' }}>
                      <div style={{ width:'40px', height:'40px', borderRadius:'50%', background:bg, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 8px' }}>
                        <I n={icon} s={18} c={fg} />
                      </div>
                      <p style={{ fontSize:'11px', color:'var(--t2)', fontWeight:600 }}>{label}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <Btn style={{ padding:'12px 32px', fontSize:'15px', boxShadow:'var(--glow)' }} disabled={saving}
            onClick={() => patch({ voiceAiEnabled: true })}>Get Started Now →</Btn>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <TabHeader icon="phone" color="var(--green)" bg="rgba(53,232,242,0.1)"
        title="Voice AI - Receptionist" subtitle="Configure how the AI answers your inbound calls" badge={<Pill>Active</Pill>}>
        <Btn variant="outline" onClick={() => patch({ voiceAiEnabled: false })} style={{ borderColor:'#f8717133', color:'#f87171' }}>Deactivate</Btn>
      </TabHeader>

      {banner && <Banner tone={banner.tone}>{banner.text}</Banner>}

      {!cfg.voiceAiInboundPhone && (
        <Banner tone="warn">
          Set the inbound number below, then point that number’s “A call comes in” webhook at <code>/api/v1/voice/incoming</code> (and its status callback at <code>/api/v1/voice/status</code>) in your Twilio console.
        </Banner>
      )}

      <div style={{ ...card, padding:'24px', display:'flex', flexDirection:'column', gap:'18px' }}>
        <div style={{ display:'flex', gap:'20px', flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:'220px' }}>
            <label style={labelStyle}>Agent name</label>
            <input value={cfg.voiceAiName || ''} onChange={e => setCfg(c => ({ ...c, voiceAiName: e.target.value }))} style={inputStyle} />
          </div>
          <div style={{ flex:1, minWidth:'220px' }}>
            <label style={labelStyle}>Inbound number (the AI answers this)</label>
            <input value={cfg.voiceAiInboundPhone || ''} onChange={e => setCfg(c => ({ ...c, voiceAiInboundPhone: e.target.value }))}
              placeholder="+14155551234" style={inputStyle} />
          </div>
          <div style={{ flex:1, minWidth:'220px' }}>
            <label style={labelStyle}>Transfer to (human handoff)</label>
            <input value={cfg.voiceAiPhone || ''} onChange={e => setCfg(c => ({ ...c, voiceAiPhone: e.target.value }))}
              placeholder="+14155559876" style={inputStyle} />
          </div>
        </div>

        <div>
          <label style={labelStyle}>Greeting (the first thing callers hear)</label>
          <input value={cfg.voiceAiGreeting || ''} onChange={e => setCfg(c => ({ ...c, voiceAiGreeting: e.target.value }))} style={inputStyle} />
        </div>

        <div>
          <label style={labelStyle}>Agent instructions</label>
          <textarea value={cfg.voiceAiPrompt || ''} onChange={e => setCfg(c => ({ ...c, voiceAiPrompt: e.target.value }))}
            rows={4} style={{ ...inputStyle, resize:'vertical' }} />
          <span style={{ fontSize:'11px', color:'var(--t3)' }}>Tell the AI what to gather. It transfers the call if the caller asks for a human.</span>
        </div>

        <div>
          <Btn disabled={saving} style={{ boxShadow:'var(--glow)' }}
            onClick={() => patch({
              voiceAiName: cfg.voiceAiName, voiceAiPrompt: cfg.voiceAiPrompt, voiceAiPhone: cfg.voiceAiPhone,
              voiceAiInboundPhone: cfg.voiceAiInboundPhone, voiceAiGreeting: cfg.voiceAiGreeting,
            })}>
            {saving ? 'Saving…' : 'Save Settings'}
          </Btn>
        </div>
      </div>

      <div style={{ ...card, overflow:'hidden' }}>
        <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', gap:8 }}>
          <I n="clock" s={14} c="var(--t2)" />
          <span style={{ fontSize:13, fontWeight:700, color:'var(--t1)' }}>Recent calls</span>
        </div>
        {calls.length === 0 ? (
          <div style={{ padding:28, textAlign:'center', color:'var(--t2)', fontSize:13 }}>No calls yet.</div>
        ) : calls.map((c, i) => (
          <div key={c.id} style={{ borderBottom: i < calls.length-1 ? '1px solid var(--bd)' : 'none' }}>
            <div onClick={() => setOpenCall(openCall === c.id ? null : c.id)}
              style={{ padding:'12px 18px', display:'flex', gap:12, alignItems:'center', flexWrap:'wrap', cursor:'pointer' }}>
              <span style={{ fontSize:12.5, fontWeight:600, color:'var(--t1)', minWidth:130 }}>{c.leadName || c.fromPhone}</span>
              <span style={{ flex:1, fontSize:12, color:'var(--t2)', minWidth:180 }}>{c.leadSummary || '—'}</span>
              {c.forwarded && <Pill tone="amber">Transferred</Pill>}
              <span style={{ fontSize:11, color:'var(--t3)' }}>{c.durationSec}s · {new Date(c.startedAt).toLocaleString()}</span>
            </div>
            {openCall === c.id && (
              <div style={{ padding:'0 18px 14px', display:'flex', flexDirection:'column', gap:6 }}>
                {(Array.isArray(c.transcript) ? c.transcript : []).map((t, idx) => (
                  <div key={idx} style={{ display:'flex', gap:8, fontSize:12 }}>
                    <span style={{ minWidth:52, color: t.role === 'caller' ? '#9d6bff' : 'var(--green)', fontWeight:600 }}>{t.role === 'caller' ? 'Caller' : 'AI'}</span>
                    <span style={{ color:'var(--t2)' }}>{t.text}</span>
                  </div>
                ))}
                {c.leadEmail && <p style={{ fontSize:12, color:'var(--t3)', marginTop:4 }}>Email captured: {c.leadEmail}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// 8. WHATSAPP FORMS
// ─────────────────────────────────────────────
const FIELD_TYPES = [['text', 'Text'], ['email', 'Email'], ['phone', 'Phone'], ['number', 'Number'], ['choice', 'Multiple choice']];

// Live rendering of what the customer sees while filling the form in the
// chat. The runtime asks one question per inbound message, so the preview
// walks the same cursor — the progress bar is the real question count, not
// decoration.
const FormPreview = ({ name, schema }) => {
  const fields = (schema || []).filter(f => String(f.label || '').trim());
  const [step, setStep] = useState(0);
  const active = Math.min(step, Math.max(0, fields.length - 1));
  const field = fields[active];

  useEffect(() => { if (step > fields.length - 1) setStep(Math.max(0, fields.length - 1)); }, [fields.length, step]);

  return (
    <div style={{ ...card, padding:16, display:'flex', flexDirection:'column', gap:12, minWidth:270 }}>
      <p style={{ fontSize:12, fontWeight:700, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.07em' }}>Preview</p>
      <div style={{ border:'1px solid var(--bd)', borderRadius:14, background:'rgba(255,255,255,0.02)', overflow:'hidden', display:'flex', flexDirection:'column', minHeight:300 }}>
        <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ color:'var(--t3)', fontSize:13 }}>✕</span>
          <span style={{ flex:1, textAlign:'center', fontSize:12.5, fontWeight:600, color:'var(--t1)' }}>{name?.trim() || 'Untitled form'}</span>
        </div>

        {/* one segment per question — fills as the customer answers */}
        <div style={{ display:'flex', gap:4, padding:'10px 14px 0' }}>
          {(fields.length ? fields : [null]).map((_, i) => (
            <div key={i} style={{ flex:1, height:3, borderRadius:2, background: i <= active && fields.length ? 'var(--green)' : 'rgba(255,255,255,0.10)' }} />
          ))}
        </div>

        <div style={{ padding:'14px', flex:1, display:'flex', flexDirection:'column', gap:10 }}>
          {fields.length === 0 ? (
            <p style={{ fontSize:12, color:'var(--t3)' }}>Add a question to see the preview.</p>
          ) : (
            <>
              <p style={{ fontSize:11, color:'var(--t3)' }}>Question {active + 1} of {fields.length}</p>
              <p style={{ fontSize:13.5, fontWeight:600, color:'var(--t1)', lineHeight:1.45 }}>{field.label}</p>
              {field.type === 'choice' && (field.options || []).length > 0 ? (
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {(field.options || []).map((o, i) => (
                    <div key={i} style={{ padding:'8px 11px', borderRadius:8, border:'1px solid var(--bd)', background:'rgba(255,255,255,0.03)', fontSize:12, color:'var(--t2)' }}>{o}</div>
                  ))}
                </div>
              ) : (
                <div style={{ padding:'9px 11px', borderRadius:8, border:'1px solid var(--bd)', background:'rgba(255,255,255,0.03)', fontSize:12, color:'var(--t3)' }}>
                  {{ email:'name@example.com', phone:'+91 98765 43210', number:'Enter a number' }[field.type] || 'Type your answer…'}
                </div>
              )}
              {field.required === false && <span style={{ fontSize:10.5, color:'var(--t3)' }}>Optional — they can skip this</span>}
            </>
          )}
        </div>

        <div style={{ padding:'10px 14px', borderTop:'1px solid var(--bd)', display:'flex', gap:8 }}>
          <button disabled={active === 0} onClick={() => setStep(s => Math.max(0, s - 1))}
            style={{ padding:'8px 12px', borderRadius:8, border:'1px solid var(--bd)', background:'transparent', color:'var(--t2)', fontSize:12, cursor: active === 0 ? 'not-allowed' : 'pointer', opacity: active === 0 ? 0.45 : 1 }}>Back</button>
          <button disabled={active >= fields.length - 1} onClick={() => setStep(s => Math.min(fields.length - 1, s + 1))}
            style={{ flex:1, padding:'8px 12px', borderRadius:8, border:'none', background: 'var(--grad-cta)', color: 'var(--ink)', fontSize:12, fontWeight:700, cursor: active >= fields.length - 1 ? 'not-allowed' : 'pointer', opacity: active >= fields.length - 1 ? 0.45 : 1 }}>Next</button>
        </div>
      </div>
    </div>
  );
};

const FORM_NAME_MAX = 20;

const WhatsAppFormsTab = () => {
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(null);
  const [banner, setBanner] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  // 'create' mirrors the builder tab, 'list' the saved forms.
  const [view, setView] = useState('list');
  const [templates, setTemplates] = useState([]);
  const [categoryOpts, setCategoryOpts] = useState([]);
  const [pickedTemplate, setPickedTemplate] = useState(null);
  const [catOpen, setCatOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await wJson('/whatsapp-forms');
    if (r.locked) { setLocked(r.feature || 'automation'); setLoading(false); return; }
    if (r.ok && Array.isArray(r.data)) setForms(r.data);
    else if (!r.ok) setBanner({ tone:'error', text:r.error });
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Presets and the category vocabulary come from the server so they can't
  // drift from the field types the form runtime accepts.
  useEffect(() => {
    wJson('/whatsapp-forms/templates').then(r => {
      if (!r.ok || !r.data) return;
      setTemplates(Array.isArray(r.data.templates) ? r.data.templates : []);
      setCategoryOpts(Array.isArray(r.data.categories) ? r.data.categories : []);
    });
  }, []);

  const blankDraft = () => ({
    name:'', keyword:'', status:'Draft', categories:[],
    completionMessage:"Thanks! We've recorded your response.",
    schema:[{ label:'', type:'text', required:true, options:[] }],
  });

  const openCreate = () => {
    setEditing(null);
    setPickedTemplate(null);
    setDraft(blankDraft());
    setView('create');
  };

  // Applying a template replaces the questions wholesale, but never discards a
  // name the user has already typed.
  const applyTemplate = (tpl) => {
    setPickedTemplate(tpl.id);
    setDraft(d => ({
      ...(d || blankDraft()),
      keyword: tpl.keyword || '',
      categories: Array.isArray(tpl.categories) ? [...tpl.categories] : [],
      completionMessage: tpl.completionMessage || "Thanks! We've recorded your response.",
      schema: (tpl.schema || []).map(f => ({ ...f, options: [...(f.options || [])] })),
    }));
  };

  const openEdit = f => {
    setEditing(f);
    setPickedTemplate(null);
    setDraft({
      name: f.name, keyword: f.keyword || '', status: f.status,
      categories: Array.isArray(f.categories) ? f.categories : [],
      completionMessage: f.completionMessage || '',
      schema: Array.isArray(f.schema) && f.schema.length ? f.schema : [{ label:'', type:'text', required:true, options:[] }],
    });
    setView('create');
  };

  const setField = (idx, patchField) =>
    setDraft(d => ({ ...d, schema: d.schema.map((f, i) => i === idx ? { ...f, ...patchField } : f) }));

  // `status` is passed explicitly so "Save as Draft" and "Publish" are two
  // deliberate actions rather than a dropdown the user has to remember to set.
  const save = async (status) => {
    const nameError = validateMeaningfulText(draft.name, 'Form name');
    if (nameError) { setBanner({ tone:'error', text:nameError }); return; }
    const cleanSchema = draft.schema.filter(f => String(f.label || '').trim());
    if (cleanSchema.length === 0) { setBanner({ tone:'error', text:'Add at least one question.' }); return; }
    if (status === 'Active' && !String(draft.keyword || '').trim()) {
      setBanner({ tone:'error', text:'An active form needs a keyword so customers can start it.' });
      return;
    }
    setSaving(true);
    const payload = {
      name: draft.name, keyword: draft.keyword || '', status,
      categories: draft.categories || [],
      completionMessage: draft.completionMessage, schema: cleanSchema,
    };
    const r = editing
      ? await wJson(`/whatsapp-forms/${editing.id}`, { method:'PATCH', body: JSON.stringify(payload) })
      : await wJson('/whatsapp-forms', { method:'POST', body: JSON.stringify(payload) });
    setSaving(false);
    if (!r.ok) { setBanner({ tone:'error', text:r.error }); return; }
    setDraft(null); setEditing(null); setPickedTemplate(null);
    setBanner({ tone:'success', text: status === 'Active' ? 'Form published — customers can start it with its keyword.' : 'Saved as draft.' });
    setView('list');
    load();
  };

  const del = async id => {
    if (!window.confirm('Delete this form?')) return;
    const r = await wJson(`/whatsapp-forms/${id}`, { method:'DELETE' });
    if (r.ok) load(); else setBanner({ tone:'error', text:r.error });
  };

  const toggleStatus = async f => {
    const next = f.status === 'Active' ? 'Draft' : 'Active';
    const r = await wJson(`/whatsapp-forms/${f.id}`, { method:'PATCH', body: JSON.stringify({ status: next }) });
    if (r.ok) load(); else setBanner({ tone:'error', text:r.error });
  };

  const viewSubmissions = async f => {
    setViewing(f);
    const r = await wJson(`/whatsapp-forms/${f.id}/submissions`);
    setSubmissions(r.ok && Array.isArray(r.data) ? r.data : []);
  };

  if (loading) return <Loading />;
  if (locked) return <PlanLocked feature={locked} />;

  if (viewing) {
    const fields = Array.isArray(viewing.schema) ? viewing.schema : [];
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <IconBtn icon="arrow" onClick={() => setViewing(null)} />
          <div>
            <h2 style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:18, color:'var(--t1)' }}>{viewing.name}</h2>
            <p style={{ fontSize:13, color:'var(--t2)' }}>{submissions.length} submission{submissions.length === 1 ? '' : 's'}</p>
          </div>
        </div>
        <div style={{ ...card, overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', textAlign:'left', minWidth:520 }}>
            <thead>
              <tr style={{ borderBottom:'1px solid var(--bd)' }}>
                {['When', ...fields.map(f => f.label), 'Status'].map((h, i) => (
                  <th key={i} style={{ padding:'12px 16px', fontSize:11, fontWeight:600, color:'var(--t3)', textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {submissions.length === 0 && (
                <tr><td colSpan={fields.length + 2} style={{ padding:32, textAlign:'center', color:'var(--t2)', fontSize:13 }}>No submissions yet.</td></tr>
              )}
              {submissions.map(s => (
                <tr key={s.id} style={{ borderBottom:'1px solid var(--bd)' }}>
                  <td style={{ padding:'12px 16px', fontSize:12, color:'var(--t2)', whiteSpace:'nowrap' }}>{new Date(s.createdAt).toLocaleString()}</td>
                  {fields.map(f => (
                    <td key={f.key} style={{ padding:'12px 16px', fontSize:12.5, color:'var(--t1)' }}>{s.answers?.[f.key] ?? '—'}</td>
                  ))}
                  <td style={{ padding:'12px 16px' }}>
                    <Pill tone={s.completed ? 'green' : 'amber'}>{s.completed ? 'Complete' : `Q${s.cursor + 1}`}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <TabHeader icon="note" color="var(--t2)" bg="rgba(255,255,255,0.04)"
        title="WhatsApp Forms" subtitle="Collect structured answers one question at a time, right inside the chat">
        {view === 'list' && <Btn onClick={openCreate} style={{ boxShadow:'var(--glow)' }}><I n="plus" s={14} c="#08090c"/> Create Form</Btn>}
      </TabHeader>

      {/* Create New Form / View All Forms */}
      <div style={{ display:'flex', gap:4, borderBottom:'1px solid var(--bd)' }}>
        {[['create', editing ? 'Edit Form' : 'Create New Form'], ['list', `View All Forms (${forms.length})`]].map(([id, label]) => (
          <button key={id} onClick={() => { if (id === 'create' && !draft) openCreate(); else setView(id); }}
            style={{ padding:'9px 14px', background:'none', border:'none', borderBottom:`2px solid ${view === id ? 'var(--green)' : 'transparent'}`,
                     color: view === id ? 'var(--t1)' : 'var(--t2)', fontSize:13, fontWeight:600, cursor:'pointer',
                     fontFamily:"'Manrope',sans-serif", marginBottom:-1 }}>
            {label}
          </button>
        ))}
      </div>

      {banner && <Banner tone={banner.tone}>{banner.text}</Banner>}
      {view === 'list' && <Banner>A customer starts a form by sending its keyword. Each answer is validated, and they can send “cancel” to stop at any point.</Banner>}

      {view === 'create' && draft && (
        <div style={{ display:'flex', gap:16, alignItems:'flex-start', flexWrap:'wrap' }}>
        <div style={{ ...card, padding:20, display:'flex', flexDirection:'column', gap:14, flex:1, minWidth:340 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <p style={{ fontSize:13, fontWeight:700, color:'var(--t1)', fontFamily:"'Space Grotesk',sans-serif" }}>{editing ? 'Edit Form' : 'Create WhatsApp Form'}</p>
            <div style={{ display:'flex', gap:8 }}>
              <Btn variant="ghost" onClick={() => save('Draft')} disabled={saving}>{saving ? 'Saving…' : 'Save as Draft'}</Btn>
              <Btn onClick={() => save('Active')} disabled={saving} style={{ boxShadow:'var(--glow)' }}>{editing ? 'Update & Publish' : 'Publish'}</Btn>
            </div>
          </div>

          {/* Templates — prefill the question set */}
          {!editing && templates.length > 0 && (
            <div>
              <label style={labelStyle}>Templates</label>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {templates.map(t => (
                  <label key={t.id} onClick={() => applyTemplate(t)}
                    style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'9px 11px', borderRadius:8, cursor:'pointer',
                             border:`1px solid ${pickedTemplate === t.id ? 'var(--gbd)' : 'var(--bd)'}`,
                             background: pickedTemplate === t.id ? 'var(--gbg)' : 'rgba(255,255,255,0.02)' }}>
                    <span style={{ width:14, height:14, borderRadius:'50%', flexShrink:0, marginTop:2,
                                   border:`1.5px solid ${pickedTemplate === t.id ? 'var(--green)' : 'var(--bd)'}`,
                                   background: pickedTemplate === t.id ? 'var(--green)' : 'transparent' }} />
                    <span style={{ minWidth:0 }}>
                      <span style={{ display:'block', fontSize:12.5, fontWeight:600, color:'var(--t1)' }}>{t.title}</span>
                      <span style={{ display:'block', fontSize:11.5, color:'var(--t3)' }}>{t.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
            <div style={{ flex:1, minWidth:220 }}>
              <label style={labelStyle}>Form name</label>
              <div style={{ position:'relative' }}>
                {/* No maxLength/slice: a form saved before this limit existed
                    (the API allows 120) would otherwise be silently truncated
                    the moment its name was edited. Growth past the limit is
                    blocked; an existing longer name stays and can be shortened. */}
                <input value={draft.name}
                  onChange={e => setDraft(d => {
                    const next = e.target.value;
                    const current = d.name || '';
                    if (next.length <= FORM_NAME_MAX || next.length < current.length) return { ...d, name: next };
                    return d;
                  })}
                  placeholder="e.g. Customer Feedback" style={{ ...inputStyle, paddingRight:52 }} />
                <span style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', fontSize:11,
                               color: (draft.name || '').length >= FORM_NAME_MAX ? '#fbbf24' : 'var(--t3)' }}>
                  {(draft.name || '').length}/{FORM_NAME_MAX}
                </span>
              </div>
            </div>
            <div style={{ minWidth:180 }}>
              <label style={labelStyle}>Start keyword</label>
              <input value={draft.keyword} onChange={e => setDraft(d => ({ ...d, keyword: e.target.value.toUpperCase() }))}
                placeholder="e.g. FEEDBACK" style={{ ...inputStyle, fontFamily:'monospace', color:'var(--green)' }} />
            </div>
          </div>

          {/* Categories — display-only tags used to filter the forms list */}
          <div>
            <label style={labelStyle}>Categories</label>
            <div style={{ position:'relative' }}>
              <button onClick={() => setCatOpen(o => !o)}
                style={{ ...inputStyle, width:'100%', textAlign:'left', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                <span style={{ color: (draft.categories || []).length ? 'var(--t1)' : 'var(--t3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {(draft.categories || []).length ? draft.categories.join(', ') : 'Select categories'}
                </span>
                <span style={{ color:'var(--t3)', fontSize:10 }}>▼</span>
              </button>
              {catOpen && (
                <div style={{ position:'absolute', zIndex:20, top:'calc(100% + 4px)', left:0, right:0, borderRadius:9,
                              border:'1px solid var(--bd)', background:'#0a0b0e', boxShadow:'0 12px 30px rgba(0,0,0,0.5)', padding:6,
                              maxHeight:220, overflowY:'auto' }}>
                  {categoryOpts.map(cat => {
                    const on = (draft.categories || []).includes(cat);
                    return (
                      <label key={cat} onClick={() => setDraft(d => ({
                        ...d,
                        categories: on ? d.categories.filter(c => c !== cat) : [...(d.categories || []), cat],
                      }))}
                        style={{ display:'flex', alignItems:'center', gap:9, padding:'7px 9px', borderRadius:6, cursor:'pointer',
                                 background: on ? 'var(--gbg)' : 'transparent', fontSize:12.5, color:'var(--t1)' }}>
                        <span style={{ width:14, height:14, borderRadius:4, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                                       border:`1.5px solid ${on ? 'var(--green)' : 'var(--bd)'}`, background: on ? 'var(--green)' : 'transparent' }}>
                          {on && <I n="check" s={9} c="#08090c" w={3} />}
                        </span>
                        {cat}
                      </label>
                    );
                  })}
                  <button onClick={() => setCatOpen(false)}
                    style={{ width:'100%', marginTop:4, padding:'7px', borderRadius:6, border:'1px solid var(--bd)', background:'transparent', color:'var(--t2)', fontSize:11.5, cursor:'pointer' }}>Done</button>
                </div>
              )}
            </div>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <label style={labelStyle}>Questions</label>
            {draft.schema.map((f, idx) => (
              <div key={idx} style={{ border:'1px solid var(--bd)', borderRadius:8, padding:12, background:'rgba(255,255,255,0.02)', display:'flex', flexDirection:'column', gap:10 }}>
                <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                  <span style={{ fontSize:11, fontWeight:700, color:'var(--t3)', width:24 }}>Q{idx + 1}</span>
                  <input value={f.label} onChange={e => setField(idx, { label: e.target.value })}
                    placeholder="What should the customer be asked?" style={{ ...inputStyle, flex:1, minWidth:220 }} />
                  <select value={f.type || 'text'} onChange={e => setField(idx, { type: e.target.value })} style={{ ...inputStyle, width:150 }}>
                    {FIELD_TYPES.map(([v, l]) => <option key={v} value={v} style={{ background:'#0a0b0e' }}>{l}</option>)}
                  </select>
                  <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'var(--t2)', cursor:'pointer' }}>
                    <input type="checkbox" checked={f.required !== false} onChange={e => setField(idx, { required: e.target.checked })}
                      style={{ width:14, height:14, accentColor:'var(--green)' }} />
                    Required
                  </label>
                  {draft.schema.length > 1 && (
                    <button onClick={() => setDraft(d => ({ ...d, schema: d.schema.filter((_, i) => i !== idx) }))}
                      style={{ padding:'6px 10px', borderRadius:7, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.22)', color:'#f87171', cursor:'pointer', fontSize:11 }}>Remove</button>
                  )}
                </div>
                {f.type === 'choice' && (
                  <input value={(f.options || []).join(', ')}
                    onChange={e => setField(idx, { options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                    placeholder="Comma-separated options, e.g. Yes, No, Maybe" style={inputStyle} />
                )}
              </div>
            ))}
            <button onClick={() => setDraft(d => ({ ...d, schema: [...d.schema, { label:'', type:'text', required:true, options:[] }] }))}
              style={{ alignSelf:'flex-start', padding:'8px 12px', borderRadius:8, background:'transparent', border:'1px solid var(--bd)', color:'var(--green)', cursor:'pointer', fontSize:12, fontWeight:700 }}>
              + Add question
            </button>
          </div>

          <div>
            <label style={labelStyle}>Message after the last answer</label>
            <input value={draft.completionMessage} onChange={e => setDraft(d => ({ ...d, completionMessage: e.target.value }))} style={inputStyle} />
          </div>

          <div style={{ display:'flex', gap:8 }}>
            <Btn variant="ghost" onClick={() => { setDraft(null); setEditing(null); setPickedTemplate(null); setView('list'); }}>Cancel</Btn>
          </div>
        </div>

        <FormPreview name={draft.name} schema={draft.schema} />
        </div>
      )}

      {view === 'list' && (
      <div style={{ ...card, overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', textAlign:'left', minWidth:600 }}>
          <thead>
            <tr style={{ borderBottom:'1px solid var(--bd)' }}>
              {['Form Name','Categories','Keyword','Questions','Submissions','Status',''].map(h => (
                <th key={h} style={{ padding:'12px 18px', fontSize:11, fontWeight:600, color:'var(--t3)', textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {forms.length === 0 && (
              <tr><td colSpan="7" style={{ padding:32, textAlign:'center', color:'var(--t2)', fontSize:13 }}>No forms yet. Create one from the Create New Form tab.</td></tr>
            )}
            {forms.map((f, i) => (
              <tr key={f.id} style={{ borderBottom: i < forms.length-1 ? '1px solid var(--bd)' : 'none' }}>
                <td style={{ padding:'14px 18px', fontSize:13, fontWeight:600, color:'var(--t1)' }}>{f.name}</td>
                <td style={{ padding:'14px 18px' }}>
                  {Array.isArray(f.categories) && f.categories.length ? (
                    <span style={{ display:'inline-flex', gap:5, flexWrap:'wrap' }}>
                      {f.categories.map(c => (
                        <span key={c} style={{ padding:'2px 8px', borderRadius:11, fontSize:10.5, fontWeight:600, background:'rgba(255,255,255,0.05)', border:'1px solid var(--bd)', color:'var(--t2)', whiteSpace:'nowrap' }}>{c}</span>
                      ))}
                    </span>
                  ) : <span style={{ fontSize:12.5, color:'var(--t3)' }}>—</span>}
                </td>
                <td style={{ padding:'14px 18px', fontSize:12.5, fontFamily:'monospace', color: f.keyword ? 'var(--green)' : 'var(--t3)' }}>{f.keyword || '—'}</td>
                <td style={{ padding:'14px 18px', fontSize:13, color:'var(--t2)' }}>{Array.isArray(f.schema) ? f.schema.length : f.fields}</td>
                <td style={{ padding:'14px 18px', fontSize:13, color:'var(--t2)' }}>
                  <button onClick={() => viewSubmissions(f)} style={{ background:'none', border:'none', padding:0, cursor:'pointer', color:'var(--green)', fontSize:13, fontWeight:600 }}>
                    {(f.submissions || 0).toLocaleString()}
                  </button>
                </td>
                <td style={{ padding:'14px 18px' }}>
                  <span onClick={() => toggleStatus(f)} style={{ cursor:'pointer' }}>
                    <Pill tone={f.status === 'Active' ? 'green' : 'amber'}>{f.status}</Pill>
                  </span>
                </td>
                <td style={{ padding:'14px 18px', textAlign:'right', whiteSpace:'nowrap' }}>
                  <span style={{ display:'inline-flex', gap:8 }}>
                    <IconBtn icon="pencil" onClick={() => openEdit(f)} />
                    <IconBtn icon="trash" danger onClick={() => del(f.id)} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
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

  const [segFormOpen, setSegFormOpen] = useState(false);
  const [editingSeg,  setEditingSeg]  = useState(null);
  const [segName, setSegName] = useState('');
  const [segDesc, setSegDesc] = useState('');
  const [segError, setSegError] = useState('');

  const [contactFormOpen,  setContactFormOpen]  = useState(false);
  const [editingContact,   setEditingContact]   = useState(null);
  const [contactName,  setContactName]  = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactError, setContactError] = useState('');

  const segColors = ['#8b5cf6','#f43f5e','#9d6bff','#f59e0b','#25d366','#ec4899'];
  const viewingSegment = segments.find(s => s.id === viewingSegmentId) || null;

  const fetchSegments = useCallback(async () => {
    const r = await wJson('/segments');
    if (r.ok && Array.isArray(r.data)) setSegments(r.data);
    setLoading(false);
  }, []);
  useEffect(() => { fetchSegments(); }, [fetchSegments]);

  const openCreateSeg = () => { setSegName(''); setSegDesc(''); setEditingSeg(null); setSegError(''); setSegFormOpen(true); };
  const openEditSeg   = seg => { setSegName(seg.name); setSegDesc(seg.description || seg.desc || ''); setEditingSeg(seg); setSegError(''); setSegFormOpen(true); };
  const cancelSegForm = () => { setSegFormOpen(false); setEditingSeg(null); setSegError(''); };

  const saveSeg = async () => {
    const nameError = validateMeaningfulText(segName, 'Segment name');
    if (nameError) { setSegError(nameError); return; }
    setSegError('');
    // `desc`, not `description` — matches segmentSchemas/Prisma's Segment.desc.
    const r = editingSeg
      ? await wJson(`/segments/${editingSeg.id}`, { method:'PATCH', body: JSON.stringify({ name: segName, desc: segDesc }) })
      : await wJson('/segments', { method:'POST', body: JSON.stringify({ name: segName, desc: segDesc, color: segColors[segments.length % segColors.length] }) });
    if (!r.ok) { setSegError(r.error); return; }
    await fetchSegments();
    cancelSegForm();
  };

  const deleteSeg = async id => {
    if (!window.confirm('Delete this segment?')) return;
    const r = await wJson(`/segments/${id}`, { method:'DELETE' });
    if (r.ok) { if (viewingSegmentId === id) setViewingSegmentId(null); await fetchSegments(); }
  };

  const openAddContact  = () => { setContactName(''); setContactPhone(''); setEditingContact(null); setContactError(''); setContactFormOpen(true); };
  const openEditContact = c => { setContactName(c.name); setContactPhone(c.phone || c.phoneNumber || ''); setEditingContact(c); setContactError(''); setContactFormOpen(true); };
  const cancelContactForm = () => { setContactFormOpen(false); setEditingContact(null); setContactError(''); };

  const saveContact = async () => {
    if (!contactName.trim()) { setContactError('Name is required'); return; }
    if (!contactPhone.trim()) { setContactError('Phone number is required'); return; }
    setContactError('');
    const r = editingContact
      ? await wJson(`/segments/${viewingSegmentId}/contacts/${editingContact.id}`, { method:'PATCH', body: JSON.stringify({ name: contactName, phone: contactPhone }) })
      : await wJson(`/segments/${viewingSegmentId}/contacts`, { method:'POST', body: JSON.stringify({ name: contactName, phone: contactPhone }) });
    if (!r.ok) { setContactError(r.error); return; }
    await fetchSegments();
    cancelContactForm();
  };

  const deleteContact = async contactId => {
    if (!window.confirm('Remove this contact from the segment?')) return;
    const r = await wJson(`/segments/${viewingSegmentId}/contacts/${contactId}`, { method:'DELETE' });
    if (r.ok) await fetchSegments();
  };

  if (loading) return <Loading />;

  if (viewingSegment) {
    const list = viewingSegment.contacts || [];
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
            <IconBtn icon="arrow" onClick={() => setViewingSegmentId(null)} />
            <div>
              <h2 style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:'18px', color:'var(--t1)' }}>{viewingSegment.name}</h2>
              <p style={{ fontSize:'13px', color:'var(--t2)' }}>{viewingSegment.description || viewingSegment.desc || 'No description'}</p>
            </div>
          </div>
          <Btn onClick={openAddContact} style={{ boxShadow:'var(--glow)' }}><I n="plus" s={14} c="#08090c"/> Add Customer</Btn>
        </div>

        {contactFormOpen && (
          <div style={{ ...card, padding:'20px', display:'flex', flexDirection:'column', gap:'12px' }}>
            <p style={{ fontSize:13, fontWeight:700, color:'var(--t1)', fontFamily:"'Space Grotesk',sans-serif" }}>{editingContact ? 'Edit Contact' : 'Add Contact'}</p>
            <div style={{ display:'flex', gap:'12px', flexWrap:'wrap' }}>
              <div style={{ flex:1, minWidth:'200px' }}>
                <label style={labelStyle}>Name</label>
                <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="e.g. Alice Smith" style={inputStyle} />
              </div>
              <div style={{ flex:1, minWidth:'200px' }}>
                <label style={labelStyle}>Phone Number</label>
                <input value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="e.g. +14155552671" style={inputStyle} />
              </div>
            </div>
            {contactError && <p style={{ fontSize:12, color:'#f87171', margin:0 }}>⚠️ {contactError}</p>}
            <div style={{ display:'flex', gap:8 }}>
              <Btn onClick={saveContact} style={{ boxShadow:'var(--glow)' }}>{editingContact ? 'Update' : 'Add'}</Btn>
              <Btn variant="ghost" onClick={cancelContactForm}>Cancel</Btn>
            </div>
          </div>
        )}

        <div style={{ ...card, overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', textAlign:'left', minWidth:420 }}>
            <thead>
              <tr style={{ borderBottom:'1px solid var(--bd)' }}>
                {['Name','Phone Number','Actions'].map(h => (
                  <th key={h} style={{ padding:'12px 20px', fontSize:'11px', fontWeight:600, color:'var(--t3)', textTransform:'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan="3" style={{ padding:'32px', textAlign:'center', color:'var(--t2)', fontSize:'13px' }}>No contacts in this segment yet.</td></tr>
              )}
              {list.map(c => (
                <tr key={c.id} style={{ borderBottom:'1px solid var(--bd)' }}>
                  <td style={{ padding:'14px 20px', fontSize:'13px', fontWeight:600, color:'var(--t1)' }}>{c.name}</td>
                  <td style={{ padding:'14px 20px', fontSize:'13px', color:'var(--t2)' }}>{c.phone || c.phoneNumber}</td>
                  <td style={{ padding:'14px 20px' }}>
                    <span style={{ display:'inline-flex', gap:8 }}>
                      <IconBtn icon="pencil" onClick={() => openEditContact(c)} />
                      <IconBtn icon="trash" danger onClick={() => deleteContact(c.id)} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <TabHeader icon="users" color="var(--t2)" bg="rgba(255,255,255,0.04)"
        title="Smart Lists" subtitle="Segment your contacts for targeted messaging">
        <Btn onClick={openCreateSeg} style={{ boxShadow:'var(--glow)' }}><I n="plus" s={14} c="#08090c" /> Create Segment</Btn>
      </TabHeader>

      {segFormOpen && (
        <div style={{ ...card, padding:'20px', display:'flex', flexDirection:'column', gap:'12px' }}>
          <p style={{ fontSize:13, fontWeight:700, color:'var(--t1)', fontFamily:"'Space Grotesk',sans-serif" }}>{editingSeg ? 'Edit Segment' : 'New Segment'}</p>
          <div style={{ maxWidth:400 }}>
            <label style={labelStyle}>Segment Name</label>
            <input value={segName} onChange={e => setSegName(e.target.value)} placeholder="e.g. VIP Customers" style={inputStyle} />
          </div>
          <div style={{ maxWidth:400 }}>
            <label style={labelStyle}>Description (optional)</label>
            <input value={segDesc} onChange={e => setSegDesc(e.target.value)} placeholder="e.g. High-value customers" style={inputStyle} />
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
            <p style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:17, color:'var(--t1)', marginBottom:6 }}>No Segments Yet</p>
            <p style={{ fontSize:13, color:'var(--t2)' }}>Create your first customer segment to get started.</p>
          </div>
          <Btn onClick={openCreateSeg} style={{ boxShadow:'var(--glow)' }}><I n="plus" s={14} c="#08090c" /> Create First Segment</Btn>
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
                  <IconBtn icon="pencil" onClick={() => openEditSeg(list)} />
                  <IconBtn icon="trash" danger onClick={() => deleteSeg(list.id)} />
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
// MAIN
// ─────────────────────────────────────────────
const TAB_IDS = new Set(TABS.map(t => t.id));

export default function AutomationView({ initialTab }) {
  // Persist the selected tab in the URL (?tab=) so a refresh or a shared link
  // lands back on the same tab. Dashboard's router only looks at pathname, so
  // this doesn't interact with the outer route.
  //
  // `initialTab` seeds it for the sections that are really one tab of this
  // page given its own route — /dashboard/ai-agent, /dashboard/intent-matching.
  // An explicit ?tab= still wins, so those routes stay shareable once the user
  // switches tabs within them.
  const [activeTab, setActiveTab] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('tab');
    if (TAB_IDS.has(fromUrl)) return fromUrl;
    return TAB_IDS.has(initialTab) ? initialTab : 'basic';
  });

  // /dashboard/automation, /dashboard/ai-agent and /dashboard/intent-matching
  // all render *this* component, so React reconciles them as the same element
  // and never remounts on a move between them — the lazy useState initialiser
  // above runs once and never again. Without this, clicking "Intent Matching"
  // in the sidebar changed the URL but left the panel on whatever tab was
  // already open. Following the prop is what actually switches the view.
  useEffect(() => {
    if (TAB_IDS.has(initialTab)) setActiveTab(initialTab);
  }, [initialTab]);

  // Tabs that are their own sidebar destination own a path of their own;
  // everything else lives under Automation as ?tab=. Writing the owning path
  // keeps the address bar, a refresh, and the sidebar highlight agreeing with
  // the panel on screen. The popstate tells the router to re-read the path —
  // it re-renders but does not remount, so no fetch is repeated.
  const selectTab = (id) => {
    setActiveTab(id);
    const owned = TAB_ROUTES[id];
    const target = owned || `/dashboard/automation?tab=${encodeURIComponent(id)}`;
    if (window.location.pathname + window.location.search === target) return;
    window.history.replaceState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

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
      <div style={{ padding:'20px 32px 0 32px', borderBottom:'1px solid var(--bd)', display:'flex', gap:'4px', overflowX:'auto', flexShrink:0, background:'var(--surf)' }}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => selectTab(tab.id)}
              style={{
                display:'flex', alignItems:'center', gap:'8px', padding:'12px 16px', cursor:'pointer',
                background: isActive ? 'rgba(53,232,242,0.1)' : 'transparent', border:'none',
                borderBottom: isActive ? '2px solid var(--green)' : '2px solid transparent',
                color: isActive ? 'var(--green)' : 'var(--t2)', transition:'all .15s',
                whiteSpace:'nowrap', borderRadius:'8px 8px 0 0', fontFamily:"'Manrope',sans-serif",
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--t1)'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--t2)'; }}>
              <I n={tab.icon} s={15} c={isActive ? 'var(--green)' : 'currentColor'} />
              <span style={{ fontSize:'13px', fontWeight: isActive ? 600 : 500 }}>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'32px' }}>
        <div style={{ maxWidth:'1000px', margin:'0 auto' }}>
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
