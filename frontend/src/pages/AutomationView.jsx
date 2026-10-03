import { useState, useEffect, useCallback, useRef, useMemo, useContext, createContext, Fragment } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';
import { wJson } from '../lib/automationApi.js';
import { validateMeaningfulText } from '../lib/validation.js';
import {
  applyStepChange, TRIGGER_SUBTYPES, CONDITION_SUBTYPES, DEFAULT_STEP_VALUE, DELAY_CHOICES,
  subtypeLabel, stepHint, actionSubtypesFor, isCrmTrigger, leadStatusChoices, dealStageChoices, prettyEnum,
  KEYWORD_HINT, parseKeywords, templateBodyText, templateParamCount, unmappedParams, resizeParams,
  isApprovedTemplate, variablesBefore, stepNumber, stepTitle, maxSkipFor, clampSkips, insertStep,
  removeStep, moveStep, moveStepTo, newStepId, normaliseLoadedSteps, chatFlowIssue, chatFlowError,
  readRunsPage, describeRun,
} from '../lib/automationSteps.js';
import { statusLabel } from '../lib/templateHelpers.js';
import { appendUnique, hasMoreRows } from '../lib/paging.js';
import { usePolling } from '../lib/usePolling.js';
import { useRealtime, useThrottledCallback } from '../lib/realtime.js';
import MobileNavButton from '../components/MobileNavButton.jsx';
import { useIsMobile } from '../lib/useMediaQuery.js';
import { confirmDialog } from '../components/Feedback.jsx';
import { AI_AGENTS_API } from '../lib/aiAgentsApi.js';
import { can } from '../lib/permissions.js';
import { usePlanFeatures } from '../lib/usePlanFeatures.js';

const card = { background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', boxShadow:'var(--card-shadow)' };
const inputStyle = { width:'100%', padding:'10px 13px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, outline:'none', fontFamily:"'Manrope',sans-serif", boxSizing:'border-box' };
const labelStyle = { display:'block', fontSize:'11px', fontWeight:600, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 };

// Every automation write is member-level (authorize('CLIENT') or the role
// floor), so for viewers and agents every switch on this page is read-only.
const Toggle = ({ on, onToggle, disabled: disabledProp = false }) => {
  const disabled = disabledProp || !can('automation.manage');
  return (
  <div onClick={disabled ? undefined : onToggle} style={{ width:36, height:20, borderRadius:20, background: on ? 'var(--green)' : 'rgba(255,255,255,0.1)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, transition:'background .2s', position:'relative', border:`1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`, flexShrink:0 }}>
    <div style={{ position:'absolute', top:2, left: on ? 17 : 2, width:14, height:14, borderRadius:'50%', background:'white', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,0.4)' }} />
  </div>
  );
};

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
        {({ workflows: 'Workflows are', voice: 'Voice AI is', campaignAi: 'The Campaign AI Agent is' })[feature] || 'Automation is'}
        {' '}not part of your current plan. Upgrade to turn this on.
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
//
// The WhatsApp AI Agent used to be a tab here ('wa-agent'). It now lives in
// the AI Agents area with the studio and the autonomous agent, and Dashboard
// redirects /dashboard/automation?tab=wa-agent there.
const TAB_ROUTES = {
  'ai-intent': '/dashboard/intent-matching',
};

const TABS = [
  { id: 'basic',     label: 'Basic Automations',        icon: 'play'  },
  { id: 'custom',    label: 'Custom Auto Reply',         icon: 'msg'   },
  { id: 'workflows', label: 'Workflows',                 icon: 'wflow' },
  { id: 'ai-intent', label: 'AI Intent Matching',        icon: 'spark' },
  { id: 'ig-quick',  label: 'Instagram Quickflows',      icon: 'insta' },
  { id: 'voice-ai',  label: 'Voice AI - Inbound Calls',  icon: 'phone' },
  { id: 'wa-forms',  label: 'WhatsApp Forms',            icon: 'note'  },
  { id: 'interactive', label: 'Contact Lists',           icon: 'users' },
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
            // Toggling only flips the switch — the saved schedule stays on the
            // server, so turning working hours back on restores the same days.
            const ok = await patch({ businessHoursEnabled: next }, { optimistic:false });
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
const blankTrigger = () => ({ id: newStepId(), type: 'trigger', subtype: 'keyword', value: 'ORDER' });

// Shared by every step editor in the Workflows tab (the builder and the AI
// preview): the workspace's templates and its CRM lifecycle configuration.
const BuilderContext = createContext({ templates: null, templatesError: '', reloadTemplates: () => {}, crmConfig: null });

const RUNS_PAGE = 20;

const timeAgo = (d) => {
  const t = new Date(d).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(d).toLocaleDateString();
};

const TONE_STYLE = {
  ok:      { color:'var(--success)', background:'var(--sbg)' },
  error:   { color:'#f87171', background:'rgba(239,68,68,.08)' },
  muted:   { color:'var(--t3)', background:'var(--surf3)' },
  pending: { color:'#fbbf24', background:'rgba(245,158,11,.08)' },
};

const StatusPill = ({ tone = 'pending', children }) => (
  <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:20, whiteSpace:'nowrap', ...(TONE_STYLE[tone] || TONE_STYLE.pending) }}>{children}</span>
);

// The colour of one trace result, engine or simulation.
const traceTone = (result) => {
  const r = String(result || '').toLowerCase();
  if (r === 'failed' || r === 'error' || r === 'no match' || r === 'no trigger') return 'error';
  if (r === 'skipped' || r === 'waiting' || r.startsWith('no')) return 'pending';
  if (r === 'cancelled') return 'muted';
  return 'ok';
};

// "Step N" for a trace entry: the engine records the index into the run's
// action/condition list, which is exactly the builder's numbering minus one.
const traceStepLabel = (t, nodes) => {
  if (t?.step === 'trigger') return 'Trigger';
  const special = { reply: 'Customer replied', reminder: 'Reminder', cancelled: 'Stopped' }[t?.subtype];
  const n = Number.isInteger(t?.step) ? t.step + 1 : null;
  const node = n && Array.isArray(nodes) ? nodes.filter(x => x?.type === 'action' || x?.type === 'condition')[n - 1] : null;
  const kind = CONDITION_SUBTYPES.some(([id]) => id === t?.subtype) ? 'condition' : 'action';
  const what = special || (node ? subtypeLabel(node.type, node.subtype) : t?.subtype ? subtypeLabel(kind, t.subtype) : '');
  return [n ? `Step ${n}` : '', what].filter(Boolean).join(' · ');
};

const TraceList = ({ trace, nodes }) => (
  <div style={{ display:'flex', flexDirection:'column', gap:4, padding:'8px 10px', borderRadius:7, background:'rgba(255,255,255,0.02)', border:'1px solid var(--bd)' }}>
    {trace.map((t, i) => (
      <div key={i} style={{ display:'flex', gap:10, fontSize:11.5, lineHeight:1.45, flexWrap:'wrap' }}>
        <span style={{ color:'var(--t3)', minWidth:150 }}>{traceStepLabel(t, nodes)}</span>
        <span style={{ flex:1, minWidth:160, color:'var(--t2)' }}>{t.detail || '—'}</span>
        <span style={{ color: TONE_STYLE[traceTone(t.result)].color, fontWeight:600 }}>{t.result}</span>
      </div>
    ))}
  </div>
);

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

const WebsiteAnalysisPanel = ({ data, savingWfId, savedWfIds, onGenerate, onEdit, readOnly }) => {
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
                        <span style={{ color: n.type === 'trigger' ? '#f59e0b' : n.type === 'condition' ? '#9d6bff' : 'var(--green)', fontWeight:700 }}>{subtypeLabel(n.type, n.subtype)}</span>
                        {n.value ? ` — ${n.value}` : ''}
                      </div>
                    ))}
                  </div>
                )}

                {!readOnly && (
                  <div style={{ display:'flex', gap:6, marginTop:2, flexWrap:'wrap' }}>
                    <Btn size="sm" onClick={() => onGenerate(wf)} disabled={busy || saved}
                      style={saved ? {} : { boxShadow:'var(--glow)' }}>
                      {busy ? 'Generating…' : saved ? 'Saved as draft ✓' : 'Generate Workflow'}
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => onEdit(wf)} disabled={busy}>Edit in builder</Btn>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// Warnings the server attached to a save (contract C2): what it changed or
// thinks will not work. Dismissible; the builder stays open on the saved
// nodes so the person sees exactly what was stored.
const SaveNotice = ({ notice, onDismiss }) => (
  <div role="status" style={{ ...card, padding:'12px 15px', border:'1px solid rgba(245,158,11,.3)', background:'rgba(245,158,11,.06)', display:'flex', gap:10, alignItems:'flex-start' }}>
    <I n="alertt" s={15} c="#fbbf24" />
    <div style={{ flex:1, minWidth:0 }}>
      <p style={{ fontSize:12.5, fontWeight:700, color:'#fbbf24', margin:'0 0 4px' }}>{notice.title}</p>
      <ul style={{ margin:0, paddingLeft:16, display:'flex', flexDirection:'column', gap:3 }}>
        {notice.warnings.map((w, i) => <li key={i} style={{ fontSize:12.5, color:'var(--t2)', lineHeight:1.5 }}>{String(w)}</li>)}
      </ul>
    </div>
    <IconBtn icon="x" onClick={onDismiss} title="Dismiss" />
  </div>
);

// Two graphs do the same thing when every step's kind, value and skip match.
const graphKey = (nodes) => JSON.stringify((Array.isArray(nodes) ? nodes : []).map(n => [n?.type, n?.subtype, n?.value ?? '', n?.skipIfFalse ?? null, n?.templateId ?? null, n?.params ?? null, n?.remindAfter ?? null, n?.reminder ?? null]));

const sampleFor = (nodes) => {
  const trigger = (Array.isArray(nodes) ? nodes : []).find(n => n.type === 'trigger');
  // A keyword trigger may list alternatives ("ORDER, TRACK"); the first one is a valid sample.
  return trigger?.subtype === 'keyword' ? (parseKeywords(trigger.value)[0] || 'Hi') : 'Hi';
};

// The result of "Test". Fields beyond ran/reason/trace are feature-detected:
// a server that reports them (inactive workflow, which workflow would win,
// warnings) gets them shown; an older one renders exactly as before.
const SimResult = ({ result, workflowId, staleNote }) => {
  if (result?.error) return <Banner tone="error">{result.error}</Banner>;
  const trace = Array.isArray(result?.trace) ? result.trace : [];
  const inactive = result.isActive === false || result.inactive === true || result.active === false;
  const winnerRaw = result.winner ?? result.winningWorkflow ?? result.wouldRunWorkflow ?? null;
  const winnerName = typeof winnerRaw === 'string' ? winnerRaw : winnerRaw?.name;
  const winnerId = winnerRaw && typeof winnerRaw === 'object' ? winnerRaw.id : null;
  const loses = result.wouldWin === false || Boolean(winnerId && workflowId && winnerId !== workflowId);
  const wins = result.wouldWin === true || Boolean(winnerId && workflowId && winnerId === workflowId);
  const winnerReason = result.winnerReason || result.winReason || '';
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const skipped = trace.filter(t => t.result === 'skipped').length;
  const failed = trace.filter(t => t.result === 'failed').length;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      <span style={{ fontSize:12.5, fontWeight:700, color: result.ran ? 'var(--green)' : '#f87171' }}>
        {result.ran ? 'Triggered' : `Would not run — ${result.reason || 'trigger did not match'}`}
      </span>
      {inactive && <Banner tone="warn">This workflow is paused, so a real message would not start it. Turn it on to go live.</Banner>}
      {loses && (
        <Banner tone="warn">
          {winnerName ? <>Another workflow would answer this message first: <strong>{winnerName}</strong>{winnerReason ? ` — ${winnerReason}` : ''}.</> : 'Another workflow would answer this message first.'}
          {' '}Only one workflow runs per message; the most specific keyword wins.
        </Banner>
      )}
      {wins && !loses && <span style={{ fontSize:12, color:'var(--t2)' }}>Among your active workflows, this one would answer.</span>}
      {warnings.map((w, i) => <Banner key={i} tone="warn">{String(w)}</Banner>)}
      {(skipped > 0 || failed > 0) && (
        <span style={{ fontSize:12, color:'#fbbf24' }}>
          {[failed ? `${failed} step${failed === 1 ? '' : 's'} would fail` : '', skipped ? `${skipped} step${skipped === 1 ? '' : 's'} would be skipped` : ''].filter(Boolean).join(', ')} — see below.
        </span>
      )}
      {trace.length > 0 && <TraceList trace={trace} />}
      {staleNote && <span style={{ fontSize:11.5, color:'var(--t3)' }}>{staleNote}</span>}
    </div>
  );
};

const SimPanel = ({ title, sim, waitsForReply, onSample, onReplies, onRun, onClose, workflowId, staleNote }) => (
  <div style={{ border:'1px solid var(--bd)', borderRadius:8, padding:14, display:'flex', flexDirection:'column', gap:10, background:'rgba(255,255,255,0.02)' }}>
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
      <span style={{ fontSize:12, fontWeight:700, color:'var(--t1)' }}>{title}</span>
      <IconBtn icon="x" onClick={onClose} />
    </div>
    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
      <input value={sim.sample} onChange={e => onSample(e.target.value)}
        placeholder="Type what a customer would send…" style={{ ...inputStyle, flex:1, minWidth:220 }} />
      <Btn size="sm" onClick={onRun} disabled={sim.busy}>{sim.busy ? 'Running…' : 'Run test'}</Btn>
    </div>
    {waitsForReply && (
      <input value={sim.replies || ''} onChange={e => onReplies(e.target.value)}
        placeholder="Customer's replies, in order, separated by | — e.g. Track my order | 12345"
        style={{ ...inputStyle, width:'100%' }} />
    )}
    <p style={{ fontSize:11, color:'var(--t3)', margin:0 }}>Simulation only — no messages are actually sent.</p>
    {sim.result && <SimResult result={sim.result} workflowId={workflowId} staleNote={staleNote} />}
  </div>
);

const WorkflowsTab = () => {
  // Viewers and agents see workflows and their run history, but cannot build,
  // change or test them (the simulate endpoint is member-only too).
  const readOnly = !can('automation.manage');
  const [workflows, setWorkflows] = useState([]);
  // Only used against a server that does not send per-workflow run stats (C1).
  const [recentRuns, setRecentRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState([blankTrigger()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [errorFix, setErrorFix] = useState(null);
  const [saveNotice, setSaveNotice] = useState(null);
  const [simulating, setSimulating] = useState(null);
  const [draftSim, setDraftSim] = useState(null);
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
  const [runsTick, setRunsTick] = useState(0);
  const [templates, setTemplates] = useState(null);
  const [templatesError, setTemplatesError] = useState('');
  const [crmConfig, setCrmConfig] = useState(null);

  const clearError = () => { setError(''); setErrorFix(null); };

  const fetchWorkflows = useCallback(async ({ silent = false } = {}) => {
    const r = await wJson('/workflows');
    if (r.locked) { setLocked(r.feature || 'workflows'); setLoading(false); return; }
    if (r.ok) {
      const list = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.data) ? r.data.data : []);
      setWorkflows(list);
      // C1: each workflow carries runCount/lastRunAt/lastRunStatus. Without
      // them, the newest runs across the workspace still say when each one
      // last ran — never how many times, which is what used to read "0 runs".
      if (list.length && !list.some(w => 'runCount' in w || 'lastRunAt' in w)) {
        const runsRes = await wJson('/workflows/runs?limit=100');
        if (runsRes.ok) setRecentRuns(readRunsPage(runsRes.data).items);
      }
    } else if (!silent) setError(r.error);
    setLoading(false);
  }, []);

  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  // Statuses and stages for the CRM steps: the workspace's own lifecycle and
  // pipeline (Customize Your Business), on top of the built-ins.
  useEffect(() => {
    let cancelled = false;
    wJson('/crm-customization').then(r => { if (!cancelled && r.ok && r.data?.data) setCrmConfig(r.data.data); });
    return () => { cancelled = true; };
  }, []);

  const loadTemplates = useCallback(async () => {
    const r = await wJson('/templates');
    if (!r.ok) { setTemplatesError(r.error || 'Could not load templates'); setTemplates(t => t ?? []); return; }
    const list = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.data) ? r.data.data : []);
    // Authentication (OTP) templates are sent by the verification flow, not a workflow.
    setTemplates(list.filter(t => t.status !== 'DELETED' && String(t.category || '').toUpperCase() !== 'AUTHENTICATION'));
    setTemplatesError('');
  }, []);
  const needsTemplates = creating || Boolean(aiPreview);
  useEffect(() => { if (needsTemplates && templates === null) loadTemplates(); }, [needsTemplates, templates, loadTemplates]);

  // Live run counts and history: a `workflow.run` event (C4) refetches,
  // throttled; while the stream is down, a visibility-aware 30s poll does.
  const refreshRuns = useCallback(() => { fetchWorkflows({ silent: true }); setRunsTick(t => t + 1); }, [fetchWorkflows]);
  const refreshRunsSoon = useThrottledCallback(refreshRuns, 3000);
  const { live } = useRealtime((evt) => {
    if (evt.type === 'workflow.run' || evt.type === 'resync') refreshRunsSoon();
    if (evt.type === 'template.updated' && templates !== null) loadTemplates();
  });
  usePolling(refreshRuns, 30000, { enabled: !live && !loading && !locked, immediate: false });

  const triggerSubtype = steps.find(s => s.type === 'trigger')?.subtype;

  const openCreate = () => {
    if (readOnly) return;
    setName(''); setSteps([blankTrigger()]); setEditing(null); clearError(); setCreating(true);
    setSelectedStepId(null); setSaveNotice(null); setDraftSim(null);
  };
  const openEdit = w => {
    if (readOnly) return;
    setName(w.name);
    const wSteps = normaliseLoadedSteps(w.nodes);
    setSteps(wSteps.length ? wSteps : [blankTrigger()]);
    setEditing(w); clearError(); setCreating(true); setSelectedStepId(null); setSaveNotice(null); setDraftSim(null);
  };
  const cancel = () => { setCreating(false); setEditing(null); clearError(); setDraftSim(null); };

  // The editor renders the same steps two ways. `list` is the original form —
  // fastest for typing — and `canvas` is the flow view, which is what makes the
  // order and the shape of a workflow legible once it is more than three steps.
  const [editorView, setEditorView] = useState('canvas');
  const [selectedStepId, setSelectedStepId] = useState(null);

  // A new step, positioned among the non-trigger steps (0 = right after the
  // trigger). Under a CRM trigger the default action is the template step.
  const insertAt = (position, type = 'action') => {
    const subtype = type === 'condition' ? 'contains' : (isCrmTrigger(triggerSubtype) ? 'template' : 'message');
    const node = { id: newStepId(), type, subtype, value: DEFAULT_STEP_VALUE[subtype] ?? '', ...(type === 'condition' ? { skipIfFalse: 1 } : {}) };
    setSteps(p => insertStep(p, position, node));
    setSelectedStepId(node.id);
  };
  const appendStep = (type) => insertAt(steps.filter(s => s.type !== 'trigger').length, type);

  // Adding from the palette. A second trigger would be ignored by the engine,
  // which runs the first one it finds, so it replaces the existing trigger.
  // Anything else goes right after the selected step, or at the end.
  const addFromPalette = (item) => {
    const node = {
      id: newStepId(), type: item.type, subtype: item.subtype, value: item.value,
      ...(item.type === 'condition' ? { skipIfFalse: 1 } : {}),
    };
    setSteps(p => {
      if (item.type === 'trigger') return [node, ...p.filter(x => x.type !== 'trigger')];
      const body = p.filter(s => s.type !== 'trigger');
      const sel = body.findIndex(s => s.id === selectedStepId);
      const selIsTrigger = p.find(s => s.id === selectedStepId)?.type === 'trigger';
      return insertStep(p, sel >= 0 ? sel + 1 : selIsTrigger ? 0 : body.length, node);
    });
    setSelectedStepId(node.id);
  };

  const updateStep = (id, fields) => setSteps(p => clampSkips(p.map(s => (s.id === id ? applyStepChange(s, fields) : s))));
  const removeStepById = id => { setSteps(p => removeStep(p, id)); if (selectedStepId === id) setSelectedStepId(null); };
  const moveStepById = (id, dir) => setSteps(p => moveStep(p, id, dir));
  const moveStepToPos = (id, pos) => setSteps(p => moveStepTo(p, id, pos));

  const applyFix = (fix) => {
    if (fix?.kind !== 'insert_wait_reply') return;
    const node = { id: newStepId(), type: 'action', subtype: 'wait_reply', value: '' };
    setSteps(p => insertStep(p, fix.position, node));
    setSelectedStepId(node.id);
    clearError();
  };

  const save = async () => {
    const nameError = validateMeaningfulText(name, 'Workflow name');
    if (nameError) { setError(nameError); setErrorFix(null); return; }
    const trigger = steps.find(s => s.type === 'trigger');
    if (!trigger) { setError('Add a trigger from the palette — without one nothing starts this workflow.'); setErrorFix(null); return; }
    if (trigger.subtype === 'keyword' && parseKeywords(trigger.value).length === 0) {
      setError('Give the keyword trigger a word to match, or this workflow can never fire.'); setErrorFix(null);
      return;
    }
    // A score trigger with no number can never fire, and the server refuses a
    // non-numeric threshold outright rather than matching everything.
    if (trigger.subtype === 'score_above' && !Number.isFinite(Number(trigger.value))) {
      setError('Give the score trigger a number, or this workflow can never fire.'); setErrorFix(null);
      return;
    }
    const needsIdx = steps.findIndex(s =>
      s.type === 'action' && ['message', 'tag', 'task', 'owner', 'sequence', 'lead_status'].includes(s.subtype)
      && !String(s.value || '').trim());
    if (needsIdx !== -1) {
      setError(`${stepTitle(steps, needsIdx)} (${subtypeLabel('action', steps[needsIdx].subtype)}) needs a value before this workflow can run.`); setErrorFix(null);
      return;
    }
    if (!steps.some(s => s.type === 'action')) {
      setError('Add at least one action — a workflow with only a trigger does nothing.'); setErrorFix(null);
      return;
    }
    const issue = chatFlowIssue(steps, { templates });
    if (issue) { setError(issue.message); setErrorFix(issue.fix || null); return; }
    clearError();
    setSaving(true);

    const payload = { name, isActive: editing ? editing.isActive : true, nodes: steps };
    const r = editing
      ? await wJson(`/workflows/${editing.id}`, { method:'PATCH', body: JSON.stringify(payload) })
      : await wJson('/workflows', { method:'POST', body: JSON.stringify(payload) });
    setSaving(false);

    if (!r.ok) { setError(r.error); return; }
    // C2: the response may carry warnings, and the nodes as the server
    // normalised them. Feature-detected: an older server sends neither.
    const saved = r.data?.workflow && typeof r.data.workflow === 'object' ? r.data.workflow : r.data;
    const warnings = [r.data?.warnings, saved?.warnings].find(Array.isArray) || [];
    await fetchWorkflows({ silent: true });
    if (warnings.length) {
      // Stay in the builder, on what was actually stored, so the change the
      // server describes is visible and a second save is an update.
      if (Array.isArray(saved?.nodes) && saved.nodes.length) setSteps(normaliseLoadedSteps(saved.nodes));
      if (saved?.id) setEditing({ ...(editing || {}), ...saved });
      setSaveNotice({ title: `Saved "${saved?.name || name}". The server noted:`, warnings });
      return;
    }
    setSaveNotice(null);
    cancel();
  };

  const toggleActive = async w => {
    if (readOnly) return;
    const next = !w.isActive;
    setWorkflows(p => p.map(x => x.id === w.id ? { ...x, isActive: next } : x));
    const r = await wJson(`/workflows/${w.id}`, { method:'PATCH', body: JSON.stringify({ isActive: next }) });
    if (!r.ok) { setWorkflows(p => p.map(x => x.id === w.id ? w : x)); setError(r.error); }
  };

  const del = async id => {
    if (readOnly) return;
    if (!await confirmDialog('Delete this workflow?', { danger: true })) return;
    const r = await wJson(`/workflows/${id}`, { method:'DELETE' });
    if (r.ok) await fetchWorkflows();
    else setError(r.error);
  };

  // The old button hardcoded sampleMessage:'Hi' while a new workflow defaults to
  // the keyword ORDER — so the test always reported "would not run". It now
  // defaults to the workflow's own keyword and is editable.
  const openSim = w => setSimulating({ id: w.id, sample: sampleFor(w.nodes), replies: '', result: null, busy: false });

  const callSimulate = async (sim, extra) => {
    try {
      const res = await wFetch('/ai/workflow/execute', {
        method: 'POST',
        body: JSON.stringify({
          sampleMessage: sim.sample,
          replies: String(sim.replies || '').split('|').map(r => r.trim()).filter(Boolean),
          ...extra,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return { error: d.error || 'Simulation failed', status: res.status };
      return d;
    } catch (err) {
      return { error: err.message };
    }
  };

  const runSimulation = async () => {
    setSimulating(s => ({ ...s, busy: true, result: null }));
    const result = await callSimulate(simulating, { workflowId: simulating.id });
    setSimulating(s => s && ({ ...s, busy: false, result }));
  };

  // Tests what is in the builder. The unsaved steps ride along as `nodes`; a
  // server that cannot test a draft ignores them and tests the saved version,
  // which the result then says.
  const openDraftSim = () => setDraftSim({ sample: sampleFor(steps), replies: '', result: null, busy: false });
  const runDraftSimulation = async () => {
    setDraftSim(s => ({ ...s, busy: true, result: null }));
    const result = await callSimulate(draftSim, { ...(editing?.id ? { workflowId: editing.id } : {}), nodes: steps, name });
    if (result.error && !editing?.id && result.status === 400) {
      result.error = 'Save this workflow once to test it here — the server cannot test an unsaved workflow yet.';
    }
    setDraftSim(s => s && ({ ...s, busy: false, result, testedKey: graphKey(steps) }));
  };
  const draftStaleNote = (() => {
    const result = draftSim?.result;
    if (!result || result.error || !editing) return '';
    const usedDraft = result.draft === true || result.usedDraft === true || result.nodesSource === 'draft';
    if (usedDraft) return draftSim.testedKey !== graphKey(steps) ? 'You have changed steps since this test — run it again.' : '';
    return graphKey(normaliseLoadedSteps(editing.nodes)) !== draftSim.testedKey
      ? 'This tested the last saved version. Save to test your latest changes.' : '';
  })();

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
    else setAiPreview(r.data ? { ...r.data, nodes: normaliseLoadedSteps(r.data.nodes) } : r.data);
  };

  const noteWarnings = (r, title) => {
    const warnings = [r.data?.warnings, r.data?.workflow?.warnings].find(Array.isArray) || [];
    if (warnings.length) setSaveNotice({ title, warnings });
  };

  // One-click generate from a recommended workflow. The nodes already arrive
  // in the builder's shape, so this is a straight save with no second call.
  const saveRecommended = async (wf) => {
    setSavingWfId(wf.id); setAiError('');
    const r = await wJson('/workflows', {
      method: 'POST',
      body: JSON.stringify({ name: wf.title, isActive: false, nodes: wf.nodes }),
    });
    setSavingWfId(null);
    if (!r.ok) { setAiError(r.error); return; }
    noteWarnings(r, `Saved "${wf.title}" as a draft. The server noted:`);
    setSavedWfIds(s => new Set([...s, wf.id]));
    await fetchWorkflows();
  };

  const editRecommendedInBuilder = (wf) => {
    setName(wf.title);
    const ns = normaliseLoadedSteps(wf.nodes);
    setSteps(ns.length ? ns : [blankTrigger()]);
    setEditing(null); clearError(); setCreating(true); setSaveNotice(null); setDraftSim(null);
    setAiOpen(false); setAiSite(null); setAiPreview(null); setAiPrompt('');
  };

  const saveAiPreview = async () => {
    if (!aiPreview?.name || !Array.isArray(aiPreview.nodes)) { setAiError('Generate a workflow preview before saving.'); return; }
    const chatError = chatFlowError(aiPreview.nodes, { templates });
    if (chatError) { setAiError(chatError); return; }
    setAiSaving(true); setAiError('');
    const r = await wJson('/workflows', {
      method: 'POST',
      body: JSON.stringify({ name: aiPreview.name, isActive: false, nodes: aiPreview.nodes }),
    });
    setAiSaving(false);
    if (!r.ok) { setAiError(r.error); return; }
    noteWarnings(r, `Saved "${aiPreview.name}" as a draft. The server noted:`);
    await fetchWorkflows();
    setAiOpen(false); setAiPrompt(''); setAiPreview(null);
  };

  const useAiPreviewInBuilder = () => {
    if (!aiPreview) return;
    setName(aiPreview.name || 'AI Generated Workflow');
    setSteps(aiPreview.nodes?.length ? normaliseLoadedSteps(aiPreview.nodes) : [blankTrigger()]);
    setEditing(null); clearError(); setCreating(true); setSaveNotice(null); setDraftSim(null);
    setAiOpen(false); setAiPreview(null); setAiPrompt('');
  };

  const updateAiStep = (id, fields) => setAiPreview(p => {
    if (!p) return p;
    return { ...p, nodes: clampSkips((p.nodes || []).map(step => (step.id === id ? applyStepChange(step, fields) : step))) };
  });

  const builderCtx = useMemo(() => ({ templates, templatesError, reloadTemplates: loadTemplates, crmConfig }),
    [templates, templatesError, loadTemplates, crmConfig]);

  if (loading) return <Loading />;
  if (locked) return <PlanLocked feature={locked} />;

  // Run stats for a card: the server's own (C1), else the last run seen in
  // the workspace's recent runs (no count — a count from a partial page is
  // exactly the "0 runs" bug).
  const runStatsFor = (w) => {
    if ('runCount' in w || 'lastRunAt' in w) {
      return {
        count: Number.isFinite(Number(w.runCount)) && w.runCount !== null ? Number(w.runCount) : null,
        lastAt: w.lastRunAt || null,
        lastStatus: w.lastRunStatus || null,
        lastError: w.lastRunError || null,
      };
    }
    const last = recentRuns.find(r => r.workflowId === w.id);
    return { count: null, lastAt: last?.startedAt || null, lastStatus: last?.status || null, lastError: last?.error || null, lastTrace: last?.trace };
  };

  const palette = paletteFor(triggerSubtype);
  const bodyCount = steps.filter(s => s.type !== 'trigger').length;

  return (
    <BuilderContext.Provider value={builderCtx}>
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <TabHeader icon="wflow" color="#f59e0b" bg="rgba(245,158,11,0.1)"
        title="Workflows" subtitle="Multi-step automations that run on incoming messages and CRM events">
        {!creating && !aiOpen && !readOnly && (
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'flex-end' }}>
            <Btn variant="outline" onClick={() => { setAiPrompt(''); setAiPreview(null); setAiSite(null); setSavedWfIds(new Set()); setAiError(''); setAiOpen(true); }}>
              <I n="spark" s={14} c="var(--green)" /> Create with AI
            </Btn>
            <Btn onClick={openCreate} style={{ boxShadow:'var(--glow)' }}><I n="plus" s={14} c="#08090c" /> Create Workflow</Btn>
          </div>
        )}
      </TabHeader>

      {saveNotice && <SaveNotice notice={saveNotice} onDismiss={() => setSaveNotice(null)} />}
      {error && !creating && <Banner tone="error">{error}</Banner>}

      {aiOpen && !creating && !readOnly && (
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
                  ? `Gemini could not be reached — this preview came from the built-in template generator.${aiPreview.fallbackError ? ` (${aiPreview.fallbackError})` : ''}`
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
                readOnly={readOnly}
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
                    <StepRow key={step.id} step={step} index={idx} steps={aiPreview.nodes || []}
                      onChange={fields => updateAiStep(step.id, fields)}
                      onRemove={() => setAiPreview(p => (p.nodes || []).length <= 1 ? p : { ...p, nodes: removeStep(p.nodes, step.id) })}
                      canRemove={(aiPreview.nodes || []).length > 1}
                      typeChoices={['trigger', 'action', 'condition']}
                      onMove={step.type === 'trigger' ? null : dir => setAiPreview(p => ({ ...p, nodes: moveStep(p.nodes || [], step.id, dir) }))} />
                  ))}
                  <button onClick={() => setAiPreview(p => ({ ...p, nodes: [...(p.nodes || []), { id: newStepId(), type:'action', subtype:'message', value:'Thanks for reaching out.' }] }))}
                    style={{ alignSelf:'flex-start', padding:'8px 12px', borderRadius:8, background:'transparent', border:'1px solid var(--bd)', color:'var(--green)', cursor:'pointer', fontSize:12, fontWeight:700 }}>
                    + Add action step
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ padding:'12px 24px', borderTop:'1px solid var(--bd)', display:'flex', gap:8, justifyContent:'flex-end', flexWrap:'wrap' }}>
            {aiPreview && <Btn variant="ghost" onClick={useAiPreviewInBuilder} disabled={aiLoading || aiSaving}>Edit in builder</Btn>}
            {aiPreview && <Btn onClick={saveAiPreview} disabled={aiLoading || aiSaving} style={{ boxShadow:'var(--glow)' }}>{aiSaving ? 'Saving…' : 'Save as draft (inactive)'}</Btn>}
            {/* In website mode each card saves itself, so only the analyse
                action belongs here. */}
            <Btn variant={(aiPreview || aiSite) ? 'outline' : 'primary'} onClick={generateAiPreview} disabled={aiLoading || aiSaving}
              style={(aiPreview || aiSite) ? {} : { boxShadow:'var(--glow)' }}>
              {aiLoading ? (aiSite ? 'Analysing…' : 'Generating…') : (aiPreview || aiSite) ? 'Regenerate' : 'Generate'}
            </Btn>
          </div>
        </div>
      )}

      {creating && !readOnly && (
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
                {steps.map((step, idx) => {
                  const pos = stepNumber(steps, idx) ?? 0;
                  return (
                    <Fragment key={step.id}>
                      <StepRow step={step} index={idx} steps={steps}
                        onChange={fields => updateStep(step.id, fields)}
                        onRemove={() => removeStepById(step.id)}
                        canRemove={step.type !== 'trigger'}
                        typeChoices={step.type === 'trigger' ? null : ['action', 'condition']}
                        onMove={step.type === 'trigger' ? null : dir => moveStepById(step.id, dir)} />
                      {idx < steps.length - 1 && <InsertBar onInsert={type => insertAt(pos, type)} />}
                    </Fragment>
                  );
                })}
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  <Btn variant="outline" size="sm" onClick={() => appendStep('action')}><I n="plus" s={12} c="var(--t2)" /> Add Action Step</Btn>
                  <Btn variant="outline" size="sm" onClick={() => appendStep('condition')}><I n="plus" s={12} c="var(--t2)" /> Add Condition</Btn>
                </div>
              </>
            )}

            {editorView === 'canvas' && (
              <>
                <WorkflowCanvas
                  steps={steps}
                  palette={palette}
                  selectedId={selectedStepId}
                  onSelect={setSelectedStepId}
                  onAdd={addFromPalette}
                  onRemove={removeStepById}
                  onMoveTo={moveStepToPos}
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
                      <StepRow step={step} index={idx} steps={steps}
                        onChange={fields => updateStep(step.id, fields)}
                        onRemove={() => removeStepById(step.id)}
                        canRemove={step.type !== 'trigger'}
                        typeChoices={step.type === 'trigger' ? null : ['action', 'condition']}
                        onMove={step.type === 'trigger' ? null : dir => moveStepById(step.id, dir)} />
                    );
                  })()}
                </div>

                <p style={{ fontSize:11, color:'var(--t3)', margin:0, lineHeight:1.55 }}>
                  Steps run top to bottom. Drag a step up or down to reorder it, or use the ↑ ↓ buttons in the inspector.
                  Palette items are added right after the selected step ({bodyCount} step{bodyCount === 1 ? '' : 's'} so far).
                </p>
              </>
            )}
          </div>

          {error && (
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <p style={{ fontSize:12, color:'#f87171', margin:0, flex:1, minWidth:240 }}>⚠️ {error}</p>
              {errorFix && <Btn size="sm" variant="outline" onClick={() => applyFix(errorFix)}>{errorFix.label}</Btn>}
            </div>
          )}

          {draftSim && (
            <SimPanel title="Test the steps above with a sample message" sim={draftSim}
              waitsForReply={steps.some(n => n.subtype === 'wait_reply')}
              onSample={sample => setDraftSim(s => ({ ...s, sample }))}
              onReplies={replies => setDraftSim(s => ({ ...s, replies }))}
              onRun={runDraftSimulation} onClose={() => setDraftSim(null)}
              workflowId={editing?.id} staleNote={draftStaleNote} />
          )}

          <div style={{ display:'flex', gap:8, borderTop:'1px solid var(--bd)', paddingTop:16, flexWrap:'wrap' }}>
            <Btn onClick={save} disabled={saving} style={{ boxShadow:'var(--glow)' }}>{saving ? 'Saving…' : editing ? 'Update Workflow' : 'Save Workflow'}</Btn>
            {!draftSim && <Btn variant="outline" onClick={openDraftSim}><I n="play" s={12} c="var(--t2)" /> Test</Btn>}
            <Btn variant="ghost" onClick={cancel}>{saveNotice ? 'Done' : 'Cancel'}</Btn>
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
                <p style={{ fontSize:13, color:'var(--t2)', maxWidth:380, margin:'0 auto' }}>
                  {readOnly
                    ? 'No workflows have been built in this workspace yet. Workspace members can build them here.'
                    : 'Build multi-step automations that reply, wait, tag contacts and hand off to an agent — triggered by an incoming message or a CRM event.'}
                </p>
              </div>
              {!readOnly && (
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'center' }}>
                  <Btn onClick={() => setAiOpen(true)} style={{ boxShadow:'var(--glow)' }}><I n="spark" s={14} c="#08090c" /> Create with AI</Btn>
                  <Btn variant="outline" onClick={openCreate}>Create Your First Flow</Btn>
                </div>
              )}
            </div>
          ) : workflows.map(w => (
            <WorkflowCard key={w.id} workflow={w} stats={runStatsFor(w)} readOnly={readOnly} runsTick={runsTick}
              onToggle={() => toggleActive(w)} onEdit={() => openEdit(w)} onDelete={() => del(w.id)}
              onSimulate={() => openSim(w)}
              sim={simulating?.id === w.id ? simulating : null}
              onSimChange={sample => setSimulating(s => ({ ...s, sample }))}
              onSimRepliesChange={replies => setSimulating(s => ({ ...s, replies }))}
              onSimRun={runSimulation} onSimClose={() => setSimulating(null)} />
          ))}
        </div>
      )}
    </div>
    </BuilderContext.Provider>
  );
};

// A thin "insert here" control between two steps in the list view.
const InsertBar = ({ onInsert }) => (
  <div style={{ display:'flex', alignItems:'center', gap:8, margin:'-4px 0', paddingLeft:12 }}>
    <span style={{ width:1, height:14, background:'var(--bd)' }} />
    <span style={{ fontSize:10.5, color:'var(--t3)' }}>Insert</span>
    {[['action', '+ Action'], ['condition', '+ Condition']].map(([type, label]) => (
      <button key={type} onClick={() => onInsert(type)}
        style={{ fontSize:10.5, fontWeight:600, padding:'2px 8px', borderRadius:6, cursor:'pointer', background:'transparent',
                 border:'1px dashed var(--bd)', color: type === 'condition' ? '#9d6bff' : 'var(--green)', fontFamily:"'Manrope',sans-serif" }}>
        {label}
      </button>
    ))}
  </div>
);

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
// Layout is always the execution order. Dragging a node up or down reorders
// the steps for real; it used to move the card freely while the order stayed
// the same, which drew a flow the engine would not run.

const NODE_W = 230;
const NODE_H = 74;
const NODE_GAP = 44;
const CANVAS_PAD = 28;
const ROW_H = NODE_H + NODE_GAP;

// The `media` trigger's kinds; '' is any media (backend workflowGraph.js MEDIA_KINDS).
const MEDIA_TRIGGER_CHOICES = [
  ['', 'Any media'], ['audio', 'Voice note / audio'], ['image', 'Photo'],
  ['video', 'Video'], ['document', 'Document'], ['sticker', 'Sticker'],
];

// Steps needing no configuration at all.
const NO_CONFIG_SUBTYPES = ['welcome', 'lead_created'];

// Friendlier starting values than the reset defaults, for palette clicks.
const PALETTE_VALUE = {
  message: 'Thanks for reaching out — how can we help?', tag: 'VIP',
  contains: 'yes', has_tag: 'VIP', field_equals: 'plan=premium', field_set: 'order_number',
};
const TYPE_COLOR = { trigger: '#f59e0b', action: 'var(--green)', condition: '#9d6bff' };

// The palette follows the trigger: under a CRM trigger the template step is
// listed first, since it is the only send that reaches every contact.
const paletteFor = (triggerSubtype) => [
  { name: 'TRIGGERS', color: TYPE_COLOR.trigger,
    items: TRIGGER_SUBTYPES.map(([subtype, label]) => ({ type: 'trigger', subtype, label, value: DEFAULT_STEP_VALUE[subtype] ?? '' })) },
  { name: 'ACTIONS', color: TYPE_COLOR.action,
    items: actionSubtypesFor(triggerSubtype).map(([subtype, label]) => ({ type: 'action', subtype, label, value: PALETTE_VALUE[subtype] ?? DEFAULT_STEP_VALUE[subtype] ?? '' })) },
  { name: 'CONDITIONS', color: TYPE_COLOR.condition,
    items: CONDITION_SUBTYPES.map(([subtype, label]) => ({ type: 'condition', subtype, label, value: PALETTE_VALUE[subtype] ?? '' })) },
];

const NODE_ICON = {
  keyword: 'key', welcome: 'user', media: 'file',
  message: 'send', buttons: 'check', delay: 'clock', tag: 'tag', agent: 'users',
  wait_reply: 'msg', template: 'file', task: 'note', owner: 'user', sequence: 'layers',
  lead_created: 'target', lead_status: 'target', deal_stage: 'briefcase', score_above: 'activity',
  contains: 'filter', equals: 'filter', is_new_contact: 'user', has_tag: 'tag', field_equals: 'filter', field_set: 'filter',
};

const WorkflowCanvas = ({ steps, palette, selectedId, onSelect, onAdd, onRemove, onMoveTo }) => {
  const [drag, setDrag] = useState(null);   // { id, startY, dy, moved }
  const triggerSubtype = steps.find(s => s.type === 'trigger')?.subtype;
  const hasTrigger = steps[0]?.type === 'trigger';
  const height = Math.max(340, CANVAS_PAD * 2 + steps.length * ROW_H - NODE_GAP);

  // Where a dragged step would land, as a 0-based position among the
  // non-trigger steps.
  const targetFor = (d) => {
    if (!d) return null;
    const from = steps.findIndex(s => s.id === d.id);
    const centre = CANVAS_PAD + from * ROW_H + d.dy + NODE_H / 2;
    const rowIdx = Math.round((centre - CANVAS_PAD - NODE_H / 2) / ROW_H);
    const min = hasTrigger ? 1 : 0;
    return Math.max(min, Math.min(steps.length - 1, rowIdx)) - min;
  };
  const target = drag?.moved ? targetFor(drag) : null;
  const fromRow = drag ? steps.findIndex(s => s.id === drag.id) : -1;
  const targetRow = target === null ? null : target + (hasTrigger ? 1 : 0);

  const onPointerDown = (e, step) => {
    onSelect(step.id);
    if (step.type === 'trigger' || e.button > 0) return;
    if (e.target.closest?.('button')) return;
    setDrag({ id: step.id, startY: e.clientY, dy: 0, moved: false });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    setDrag(d => d && ({ ...d, dy, moved: d.moved || Math.abs(dy) > 5 }));
  };
  const endDrag = () => {
    if (drag?.moved) onMoveTo(drag.id, targetFor(drag));
    setDrag(null);
  };

  return (
    <div style={{ display:'grid', gridTemplateColumns:'170px minmax(0,1fr)', gap:12, alignItems:'start' }} className="agent-grid">
      {/* palette */}
      <div style={{ border:'1px solid var(--bd)', borderRadius:10, padding:10, background:'rgba(255,255,255,0.02)' }}>
        <div style={{ fontFamily:'var(--mono)', fontSize:9, letterSpacing:'.14em', color:'var(--t3)', textTransform:'uppercase', marginBottom:9 }}>Click to add</div>
        {palette.map(group => (
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
        style={{ position:'relative', minHeight:340, height, borderRadius:10, border:'1px solid var(--bd)', overflow:'hidden',
                 background:'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.07) 1px, transparent 0) 0 0 / 22px 22px, rgba(5,8,20,0.4)',
                 touchAction: drag ? 'none' : 'pan-y' }}>

        {/* edges, behind the cards */}
        <svg width="100%" height={height} style={{ position:'absolute', inset:0, pointerEvents:'none' }} aria-hidden="true">
          {steps.slice(0, -1).map((step, i) => {
            const x = CANVAS_PAD + NODE_W / 2;
            const y1 = CANVAS_PAD + i * ROW_H + NODE_H;
            const y2 = CANVAS_PAD + (i + 1) * ROW_H;
            return <path key={step.id} d={`M ${x} ${y1} L ${x} ${y2}`} fill="none" strokeWidth="2" strokeDasharray="6 8" stroke="rgba(255,255,255,0.22)" />;
          })}
        </svg>

        {/* where a dragged step will land */}
        {targetRow !== null && targetRow !== fromRow && (
          <div style={{ position:'absolute', left:CANVAS_PAD - 8, width:NODE_W + 16, height:2, background:'var(--green)', borderRadius:2,
                        top: targetRow < fromRow
                          ? CANVAS_PAD + targetRow * ROW_H - NODE_GAP / 2
                          : CANVAS_PAD + targetRow * ROW_H + NODE_H + NODE_GAP / 2 }} />
        )}

        {steps.map((step, index) => {
          const isTrigger = step.type === 'trigger';
          const accent = TYPE_COLOR[step.type] || 'var(--green)';
          const on = selectedId === step.id;
          const dragging = drag?.id === step.id && drag.moved;
          const hint = stepHint(triggerSubtype, step);
          return (
            <div key={step.id}
              onPointerDown={e => onPointerDown(e, step)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={() => setDrag(null)}
              style={{ position:'absolute', left:CANVAS_PAD, top:CANVAS_PAD + index * ROW_H, width:NODE_W, minHeight:NODE_H,
                       transform: dragging ? `translateY(${drag.dy}px)` : 'none', zIndex: dragging ? 5 : 1,
                       padding:'11px 13px', borderRadius:13, cursor: isTrigger ? 'pointer' : dragging ? 'grabbing' : 'grab',
                       background: on ? 'rgba(255,255,255,0.07)' : 'rgba(18,20,26,0.96)',
                       border:`1px solid ${on ? accent : 'var(--bd)'}`,
                       boxShadow: dragging ? '0 14px 34px rgba(0,0,0,0.55)' : on ? `0 0 22px ${isTrigger ? 'rgba(245,158,11,0.3)' : 'rgba(53,232,242,0.3)'}` : '0 8px 24px rgba(0,0,0,0.4)',
                       transition: dragging ? 'none' : 'box-shadow .2s, border-color .2s' }}>
              <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:6 }}>
                <I n={NODE_ICON[step.subtype] || 'zap'} s={12} c={accent} />
                <span style={{ fontFamily:'var(--mono)', fontSize:8.5, letterSpacing:'.12em', color:accent, textTransform:'uppercase' }}>
                  {stepTitle(steps, index)}{step.type === 'condition' ? ' · If' : ''}
                </span>
                {hint?.tone === 'warn' && <span title={hint.text} style={{ display:'flex' }}><I n="alertt" s={11} c="#fbbf24" /></span>}
                {!isTrigger && (
                  <button onClick={e => { e.stopPropagation(); onRemove(step.id); }} aria-label="Remove step"
                    style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', padding:0, display:'flex', color:'var(--t3)' }}>
                    <I n="x" s={11} c="var(--t3)" />
                  </button>
                )}
              </div>
              <div style={{ fontSize:12.5, fontWeight:600, color:'var(--t1)', marginBottom:2 }}>
                {subtypeLabel(step.type, step.subtype)}
              </div>
              <div style={{ fontSize:11, color:'var(--t3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {step.type === 'condition'
                  ? `${step.value || '—'} · otherwise skip ${step.skipIfFalse ?? 1}`
                  : step.value || '—'}
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

const selectStyle = { padding:'7px 10px', borderRadius:7, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:12, outline:'none' };
const optBg = { background:'#0a0b0e' };

const StepHint = ({ hint, onUseTemplate }) => (
  <div style={{ flexBasis:'100%', display:'flex', gap:8, alignItems:'flex-start', padding:'7px 10px', borderRadius:7,
                background: hint.tone === 'warn' ? 'rgba(245,158,11,.06)' : 'rgba(255,255,255,0.03)',
                border:`1px solid ${hint.tone === 'warn' ? 'rgba(245,158,11,.25)' : 'var(--bd)'}` }}>
    <I n={hint.tone === 'warn' ? 'alertt' : 'info'} s={13} c={hint.tone === 'warn' ? '#fbbf24' : 'var(--t2)'} />
    <span style={{ flex:1, fontSize:11.5, lineHeight:1.5, color: hint.tone === 'warn' ? '#fbbf24' : 'var(--t2)' }}>{hint.text}</span>
    {onUseTemplate && (
      <button onClick={onUseTemplate}
        style={{ fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:6, cursor:'pointer', whiteSpace:'nowrap', background:'transparent', border:'1px solid rgba(245,158,11,.4)', color:'#fbbf24' }}>
        Use a template instead
      </button>
    )}
  </div>
);

// Inserts a variable token into a text field's value.
const VariablePicker = ({ variables, onPick }) => (
  <select value="" onChange={e => { if (e.target.value) onPick(e.target.value); }}
    style={{ ...selectStyle, padding:'6px 8px', minWidth:0, maxWidth:180, color:'var(--t2)' }} aria-label="Insert a variable">
    <option value="" style={optBg}>Insert variable…</option>
    {variables.map(v => <option key={v.token} value={v.token} style={optBg}>{v.token} — {v.label}</option>)}
  </select>
);

const TemplateStepEditor = ({ step, steps, index, onChange }) => {
  const { templates, templatesError, reloadTemplates } = useContext(BuilderContext);
  const list = templates || [];
  const current = list.find(t => step.templateId && t.id === step.templateId) || list.find(t => t.name === step.value) || null;
  const body = current ? templateBodyText(current) : '';
  const count = current ? templateParamCount(body) : 0;
  const params = resizeParams(step.params, count);
  const missing = current ? unmappedParams(count, step.params) : [];
  const variables = variablesBefore(steps, index);
  const sorted = [...list].sort((a, b) => Number(isApprovedTemplate(b)) - Number(isApprovedTemplate(a)) || String(a.name).localeCompare(String(b.name)));
  const unapprovedCount = list.filter(t => !isApprovedTemplate(t)).length;

  const pick = (id) => {
    const t = list.find(x => x.id === id);
    if (!t) return;
    const n = templateParamCount(templateBodyText(t));
    onChange({ templateId: t.id, value: t.name, params: resizeParams(step.templateId === t.id ? step.params : [], n) });
  };
  const setParam = (i, v) => { const next = [...params]; next[i] = v; onChange({ params: next }); };

  return (
    <div style={{ flexBasis:'100%', display:'flex', flexDirection:'column', gap:8, paddingLeft:62 }}>
      {templates === null ? (
        <span style={{ fontSize:12, color:'var(--t3)' }}>Loading templates…</span>
      ) : (
        <select value={current?.id || (step.value ? '__missing' : '')} onChange={e => pick(e.target.value)} style={{ ...selectStyle, maxWidth:520 }}>
          <option value="" disabled style={optBg}>Choose an approved template…</option>
          {step.value && !current && <option value="__missing" disabled style={optBg}>{step.value} (not found in this workspace)</option>}
          {sorted.map(t => (
            <option key={t.id} value={t.id} disabled={!isApprovedTemplate(t)} style={optBg}>
              {t.name}{t.language ? ` · ${t.language}` : ''} — {statusLabel(t.status)}{isApprovedTemplate(t) ? '' : ' (not sendable)'}
            </option>
          ))}
        </select>
      )}
      {templatesError && (
        <span style={{ fontSize:11.5, color:'#f87171' }}>
          {templatesError} <button onClick={reloadTemplates} style={{ background:'none', border:'none', color:'var(--green)', cursor:'pointer', fontSize:11.5, padding:0 }}>Retry</button>
        </span>
      )}
      {templates !== null && !templatesError && !list.some(isApprovedTemplate) && (
        <span style={{ fontSize:11.5, color:'#fbbf24' }}>No approved templates yet. Create one under Templates and wait for Meta to approve it.</span>
      )}
      {unapprovedCount > 0 && (
        <span style={{ fontSize:11, color:'var(--t3)' }}>Pending and rejected templates are listed but cannot be chosen until Meta approves them.</span>
      )}
      {step.value && !current && templates !== null && (
        <span style={{ fontSize:11.5, color:'#fbbf24' }}>"{step.value}" is not one of this workspace's templates — choose one from the list.</span>
      )}
      {current && !isApprovedTemplate(current) && (
        <span style={{ fontSize:11.5, color:'#fbbf24' }}>This template is {statusLabel(current.status).toLowerCase()} — it cannot be sent until Meta approves it.</span>
      )}
      {current && body && (
        <div style={{ fontSize:11.5, color:'var(--t2)', lineHeight:1.5, padding:'7px 10px', borderRadius:7, background:'rgba(255,255,255,0.02)', border:'1px solid var(--bd)', whiteSpace:'pre-wrap' }}>{body}</div>
      )}
      {count > 0 && (
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <span style={{ fontSize:11, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.05em' }}>Fill the template's variables</span>
          {params.map((p, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
              <code style={{ fontSize:11.5, color:'var(--green)', minWidth:40 }}>{`{{${i + 1}}}`}</code>
              <input value={p} onChange={e => setParam(i, e.target.value)}
                placeholder="Text, or a variable such as {{name}}"
                style={{ ...selectStyle, flex:1, minWidth:180, borderColor: missing.includes(i + 1) ? 'rgba(245,158,11,.5)' : 'var(--bd)' }} />
              <VariablePicker variables={variables} onPick={tok => setParam(i, `${p}${tok}`)} />
            </div>
          ))}
          {missing.length > 0 && (
            <span style={{ fontSize:11.5, color:'#fbbf24' }}>
              {missing.map(m => `{{${m}}}`).join(', ')} {missing.length === 1 ? 'is' : 'are'} not filled — Meta refuses a template send with an empty variable.
            </span>
          )}
        </div>
      )}
    </div>
  );
};

const KeywordEditor = ({ value, onChange }) => {
  const chips = parseKeywords(value);
  return (
    <>
      <input value={value || ''} onChange={e => onChange(e.target.value.toUpperCase())}
        placeholder="e.g. ORDER, TRACK"
        style={{ ...selectStyle, flex:1, minWidth:200, color:'var(--green)', fontFamily:'monospace' }} />
      <div style={{ flexBasis:'100%', paddingLeft:62, display:'flex', flexDirection:'column', gap:6 }}>
        {chips.length > 0 && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
            {chips.map(k => (
              <span key={k} style={{ fontSize:11, fontFamily:'monospace', padding:'2px 8px', borderRadius:10, background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.25)', color:'#f59e0b' }}>{k}</span>
            ))}
          </div>
        )}
        <span style={{ fontSize:11, color:'var(--t3)', lineHeight:1.5 }}>{KEYWORD_HINT}</span>
      </div>
    </>
  );
};

const StepRow = ({ step, index, steps = [], onChange, onRemove, canRemove, typeChoices = null, onMove = null }) => {
  const { crmConfig } = useContext(BuilderContext);
  const isTrigger = step.type === 'trigger';
  const isCondition = step.type === 'condition';
  const triggerSubtype = steps.find(s => s.type === 'trigger')?.subtype;
  const options = isTrigger ? TRIGGER_SUBTYPES : isCondition ? CONDITION_SUBTYPES : actionSubtypesFor(triggerSubtype);
  const accent = TYPE_COLOR[step.type] || 'var(--green)';
  const accentBg = isTrigger ? 'rgba(245,158,11,0.1)' : isCondition ? 'rgba(157,107,255,0.12)' : 'rgba(53,232,242,0.1)';
  const hint = stepHint(triggerSubtype, step);
  const maxSkip = maxSkipFor(steps, index);
  const bodyIdx = stepNumber(steps, index);
  const bodyCount = steps.filter(s => s.type !== 'trigger').length;
  const moveBtn = { padding:'5px 8px', borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t2)', fontSize:11, lineHeight:1 };

  const valueEditor = (() => {
    if (step.subtype === 'template') return null; // full-width editor below
    if (step.subtype === 'delay') {
      return (
        <select value={step.value} onChange={e => onChange({ value: e.target.value })} style={{ ...selectStyle, minWidth:130 }}>
          {[...new Set([...DELAY_CHOICES, step.value].filter(Boolean))].map(v => <option key={v} value={v} style={optBg}>{v}</option>)}
        </select>
      );
    }
    if (NO_CONFIG_SUBTYPES.includes(step.subtype)) return <span style={{ fontSize:12, color:'var(--t3)', flex:1 }}>No configuration needed</span>;
    if (step.subtype === 'lead_status') {
      const choices = leadStatusChoices(crmConfig, { forAction: !isTrigger, current: step.value });
      return (
        <select value={step.value || ''} onChange={e => onChange({ value: e.target.value })} style={{ ...selectStyle, flex:1, minWidth:180 }}>
          {/* A trigger with no value means "any status change"; an action must name one. */}
          {isTrigger
            ? <option value="" style={optBg}>Any status</option>
            : <option value="" disabled style={optBg}>Choose a status…</option>}
          {choices.map(c => <option key={c.key} value={c.key} style={optBg}>{c.label}</option>)}
        </select>
      );
    }
    if (step.subtype === 'deal_stage') {
      return (
        <select value={step.value || ''} onChange={e => onChange({ value: e.target.value })} style={{ ...selectStyle, flex:1, minWidth:180 }}>
          <option value="" style={optBg}>Any stage</option>
          {dealStageChoices(crmConfig, { current: step.value }).map(c => <option key={c.key} value={c.key} style={optBg}>{c.label}</option>)}
        </select>
      );
    }
    if (step.subtype === 'media') {
      return (
        <select value={step.value || ''} onChange={e => onChange({ value: e.target.value })} style={{ ...selectStyle, flex:1, minWidth:180 }}>
          {MEDIA_TRIGGER_CHOICES.map(([v, label]) => <option key={v} value={v} style={optBg}>{label}</option>)}
        </select>
      );
    }
    if (isTrigger && step.subtype === 'keyword') return <KeywordEditor value={step.value} onChange={value => onChange({ value })} />;
    return (
      <input value={step.value || ''}
        type={step.subtype === 'score_above' ? 'number' : 'text'}
        onChange={e => onChange({ value: e.target.value })}
        placeholder={
          step.subtype === 'score_above' ? 'Score threshold, e.g. 70'
          : step.subtype === 'field_equals' ? 'field=value, e.g. plan=premium'
          : step.subtype === 'field_set' ? 'field name, e.g. order_number'
          : isCondition ? 'text to look for'
          : step.subtype === 'tag' ? 'e.g. VIP'
          : step.subtype === 'buttons' ? 'Question | Option A | Option B (max 20 chars each)'
          : step.subtype === 'wait_reply' ? 'Save reply as (optional), e.g. order_id'
          : step.subtype === 'agent' ? 'Agent name or email (blank: round-robin)'
          : step.subtype === 'task' ? 'Task title, e.g. Call the new lead'
          : step.subtype === 'owner' ? 'Member name or email'
          : step.subtype === 'sequence' ? 'Name of a published sequence'
          : 'Message text — use {{name}} or {{custom.order_number}}'
        }
        style={{ ...selectStyle, flex:1, minWidth:200 }} />
    );
  })();

  return (
    <div style={{ display:'flex', gap:10, alignItems:'center', padding:'10px 12px', borderRadius:8, background:'rgba(255,255,255,0.02)', border:'1px solid var(--bd)', flexWrap:'wrap' }}>
      <span style={{ width:52, fontSize:11, fontWeight:700, color:'var(--t3)' }}>{stepTitle(steps, index)}</span>

      {typeChoices ? (
        <select value={step.type} onChange={e => onChange({ type: e.target.value })}
          style={{ ...selectStyle, background: accentBg, color: accent, fontWeight:700, textTransform:'uppercase', fontSize:11 }}>
          {typeChoices.map(t => <option key={t} value={t} style={optBg}>{t === 'condition' ? 'Condition' : t === 'trigger' ? 'Trigger' : 'Action'}</option>)}
        </select>
      ) : (
        <span style={{ background: accentBg, color: accent, border:`1px solid ${accent}44`, padding:'3px 9px', borderRadius:6, fontSize:11, fontWeight:700 }}>
          {isTrigger ? 'TRIGGER' : isCondition ? 'IF' : 'ACTION'}
        </span>
      )}

      <select value={step.subtype} onChange={e => onChange({ subtype: e.target.value })} style={{ ...selectStyle, minWidth:150 }}>
        {options.map(([v, label]) => <option key={v} value={v} style={optBg}>{label}</option>)}
      </select>

      {valueEditor}

      {/* What a condition guards. Steps below it are skipped when the answer is
          no, which is how a branch is expressed without a graph editor. Only
          as many steps as actually follow it can be skipped. */}
      {isCondition && (maxSkip > 0 ? (
        <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11.5, color:'var(--t2)', whiteSpace:'nowrap' }}>
          otherwise skip
          <select value={Math.min(step.skipIfFalse ?? 1, maxSkip)} onChange={e => onChange({ skipIfFalse: Number(e.target.value) })}
            style={{ ...selectStyle, padding:'5px 8px', minWidth:0 }}>
            {Array.from({ length: maxSkip }, (_, i) => i + 1).map(n => <option key={n} value={n} style={optBg}>{n}</option>)}
          </select>
          step{Math.min(step.skipIfFalse ?? 1, maxSkip) === 1 ? '' : 's'}
          {bodyIdx !== null && <span style={{ color:'var(--t3)' }}>
            (step{Math.min(step.skipIfFalse ?? 1, maxSkip) === 1 ? ` ${bodyIdx + 1}` : `s ${bodyIdx + 1}–${bodyIdx + Math.min(step.skipIfFalse ?? 1, maxSkip)}`})
          </span>}
        </label>
      ) : (
        <span style={{ fontSize:11.5, color:'#fbbf24' }}>Add the steps this condition should guard below it.</span>
      ))}

      <div style={{ display:'flex', gap:6, marginLeft:'auto' }}>
        {onMove && (
          <>
            <button onClick={() => onMove(-1)} disabled={bodyIdx === null || bodyIdx <= 1} title="Move up" aria-label="Move step up"
              style={{ ...moveBtn, cursor: bodyIdx > 1 ? 'pointer' : 'not-allowed', opacity: bodyIdx > 1 ? 1 : 0.4 }}>↑</button>
            <button onClick={() => onMove(1)} disabled={bodyIdx === null || bodyIdx >= bodyCount} title="Move down" aria-label="Move step down"
              style={{ ...moveBtn, cursor: bodyIdx < bodyCount ? 'pointer' : 'not-allowed', opacity: bodyIdx < bodyCount ? 1 : 0.4 }}>↓</button>
          </>
        )}
        {canRemove && (
          <button onClick={onRemove} style={{ padding:'7px 10px', borderRadius:7, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.22)', color:'#f87171', cursor:'pointer', fontSize:11 }}>Remove</button>
        )}
      </div>

      {step.subtype === 'template' && step.type === 'action' && (
        <TemplateStepEditor step={step} steps={steps} index={index} onChange={onChange} />
      )}

      {/* Free-text sends can use the same variables as a template parameter. */}
      {step.type === 'action' && step.subtype === 'message' && (
        <div style={{ flexBasis:'100%', paddingLeft:62, display:'flex' }}>
          <VariablePicker variables={variablesBefore(steps, index)} onPick={tok => onChange({ value: `${step.value || ''}${tok}` })} />
        </div>
      )}

      {/* A nudge for a customer who goes quiet mid-question. Both fields are
          needed; with either blank no reminder is sent. */}
      {step.subtype === 'wait_reply' && (
        <div style={{ display:'flex', alignItems:'center', gap:6, flexBasis:'100%', paddingLeft:62, flexWrap:'wrap' }}>
          <span style={{ fontSize:11.5, color:'var(--t2)', whiteSpace:'nowrap' }}>If no reply, remind after</span>
          <select value={step.remindAfter || ''} onChange={e => onChange({ remindAfter: e.target.value })}
            style={{ ...selectStyle, padding:'5px 8px', minWidth:0 }}>
            {[...new Set(['', '5 min', '15 min', '1 hour', '4 hours', step.remindAfter].filter(v => v !== undefined))].map(v => (
              <option key={v || 'none'} value={v} style={optBg}>{v || 'Never'}</option>
            ))}
          </select>
          {step.remindAfter && (
            <input value={step.reminder || ''} onChange={e => onChange({ reminder: e.target.value })}
              placeholder="Reminder text, e.g. Just checking in — could you send your order ID?"
              style={{ ...selectStyle, flex:1, minWidth:200 }} />
          )}
        </div>
      )}

      {hint && <StepHint hint={hint} onUseTemplate={hint.key === 'crmChatStep' ? () => onChange({ subtype: 'template' }) : null} />}
    </div>
  );
};

const stepLabel = (step) => {
  switch (step.subtype) {
    case 'keyword': return `Keyword: ${parseKeywords(step.value).join(', ')}`;
    case 'welcome': return 'New contact';
    case 'media': return `Media received${step.value ? `: ${(MEDIA_TRIGGER_CHOICES.find(([v]) => v === step.value) || [, step.value])[1]}` : ''}`;
    case 'missed':  return 'Missed call (no longer supported — choose another trigger)';
    case 'message': return `Send: "${step.value}"`;
    case 'buttons': {
      const [q, ...opts] = String(step.value || '').split('|').map(x => x.trim()).filter(Boolean);
      return `Ask: "${q || ''}" [${opts.join(' / ')}]`;
    }
    case 'wait_reply': {
      const base = step.value ? `Wait for reply → {{${step.value}}}` : 'Wait for reply';
      return step.remindAfter && step.reminder ? `${base} (remind after ${step.remindAfter})` : base;
    }
    case 'template': return `Template: ${step.value}`;
    case 'contains': return `If message contains "${step.value}"`;
    case 'equals':   return `If message is "${step.value}"`;
    case 'is_new_contact': return 'If new contact';
    case 'has_tag':  return `If tagged "${step.value}"`;
    case 'field_equals': return `If ${step.value}`;
    case 'field_set': return `If ${step.value} is set`;
    case 'delay':   return `Wait: ${step.value}`;
    case 'tag':     return `Tag: ${step.value}`;
    case 'agent':   return `Hand to ${step.value || 'an agent'} (automation pauses)`;
    case 'lead_created': return 'Lead created';
    case 'lead_status':  return step.value ? `Lead status: ${prettyEnum(step.value)}` : 'Lead status changes';
    case 'deal_stage':   return step.value ? `Deal stage: ${prettyEnum(step.value)}` : 'Deal stage changes';
    case 'score_above':  return `Lead score reaches ${step.value}`;
    case 'task':     return `Create task: "${step.value}"`;
    case 'owner':    return `Assign owner: ${step.value}`;
    case 'sequence': return `Enrol in: ${step.value}`;
    default:        return subtypeLabel(step.type, step.subtype);
  }
};

// One run in a workflow's history: its outcome, what started it, the error,
// and — on demand — the step-by-step trace.
const RunRow = ({ run }) => {
  const [open, setOpen] = useState(false);
  const d = describeRun(run);
  const trace = Array.isArray(run.trace) ? run.trace : [];
  return (
    <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--bd)', display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
      <StatusPill tone={d.tone}>{d.label}</StatusPill>
      <span style={{ fontSize:12, color:'var(--t2)', flex:1, minWidth:160 }}>
        {run.triggerMessage ? `“${run.triggerMessage}”` : run.conversationId ? '—' : 'Started by a CRM event'}
      </span>
      <span style={{ fontSize:11, color:'var(--t3)' }} title={new Date(run.startedAt).toLocaleString()}>{timeAgo(run.startedAt)}</span>
      {trace.length > 0 && (
        <button onClick={() => setOpen(v => !v)}
          style={{ background:'none', border:'none', cursor:'pointer', fontSize:11.5, color:'var(--green)', fontWeight:600, padding:0 }}>
          {open ? 'Hide steps' : `Steps (${trace.length})`}
        </button>
      )}
      {d.suppressed
        ? <span style={{ flexBasis:'100%', fontSize:11.5, color:'var(--t2)' }}>Didn't run — {d.reason}</span>
        : d.reason && <span style={{ flexBasis:'100%', fontSize:11.5, color: d.tone === 'error' ? '#f87171' : 'var(--t2)' }}>{d.reason}</span>}
      {open && <div style={{ flexBasis:'100%' }}><TraceList trace={trace} nodes={run.nodes} /></div>}
    </div>
  );
};

// A workflow's own run history, paged ("Load more"), refreshed whenever
// `tick` changes (a live `workflow.run` event or the fallback poll).
const RunHistory = ({ workflowId, tick }) => {
  const [runs, setRuns] = useState([]);
  const [total, setTotal] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState('');
  const runsRef = useRef([]);

  const fetchPage = useCallback(async (offset, limit) => {
    const res = await wFetch(`/workflows/runs?workflowId=${encodeURIComponent(workflowId)}&limit=${limit}&offset=${offset}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
    const page = readRunsPage(body, res.headers?.get?.('X-Total-Count'));
    // Defensive: never show another workflow's runs.
    return { ...page, items: page.items.filter(r => !r.workflowId || r.workflowId === workflowId) };
  }, [workflowId]);

  // First load and every refresh re-read the newest rows — as many as are on
  // screen, up to 100 — and keep any older pages beyond that.
  useEffect(() => {
    let cancelled = false;
    const limit = Math.min(100, Math.max(RUNS_PAGE, runsRef.current.length));
    fetchPage(0, limit).then(({ items, total: t }) => {
      if (cancelled) return;
      const older = runsRef.current.length > limit ? runsRef.current.slice(limit) : [];
      const next = appendUnique(items, older);
      runsRef.current = next;
      setRuns(next);
      setTotal(t);
      setHasMore(prev => (t !== null ? next.length < t : older.length ? prev : items.length >= limit));
      setErr('');
    }).catch(e => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fetchPage, tick]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const before = runsRef.current.length;
      const { items, total: t } = await fetchPage(before, RUNS_PAGE);
      const next = appendUnique(runsRef.current, items);
      runsRef.current = next;
      setRuns(next);
      setTotal(t);
      // A server that ignores `offset` sends the first page again: nothing new
      // means there is nothing more to load.
      const added = next.length - before;
      setHasMore(hasMoreRows({ loaded: next.length, total: t, lastPageSize: added === 0 ? 0 : items.length, size: RUNS_PAGE }) && added > 0);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div style={{ border:'1px solid var(--bd)', borderRadius:8, overflow:'hidden' }}>
      {err && <div style={{ padding:'10px 14px', fontSize:12, color:'#f87171' }}>{err}</div>}
      {loading ? (
        <div style={{ padding:16, fontSize:12.5, color:'var(--t2)', textAlign:'center' }}>Loading runs…</div>
      ) : runs.length === 0 ? (
        <div style={{ padding:16, fontSize:12.5, color:'var(--t2)', textAlign:'center' }}>
          No runs yet. This workflow runs when its trigger fires — see "Why didn't my workflow run?" in Resources if you expected one.
        </div>
      ) : (
        <>
          {runs.map(run => <RunRow key={run.id} run={run} />)}
          <div style={{ padding:'9px 14px', display:'flex', alignItems:'center', gap:12 }}>
            <span style={{ fontSize:11, color:'var(--t3)', flex:1 }}>
              Showing {runs.length}{total !== null ? ` of ${total}` : ''} run{(total ?? runs.length) === 1 ? '' : 's'}
            </span>
            {hasMore && <Btn size="xs" variant="ghost" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</Btn>}
          </div>
        </>
      )}
    </div>
  );
};

const WorkflowCard = ({ workflow: w, stats, readOnly, runsTick, onToggle, onEdit, onDelete, onSimulate, sim, onSimChange, onSimRepliesChange, onSimRun, onSimClose }) => {
  const nodes = Array.isArray(w.nodes) ? w.nodes : [];
  const waitsForReply = nodes.some(n => n.subtype === 'wait_reply');
  const [showRuns, setShowRuns] = useState(false);
  const stepCount = nodes.filter(n => n.type !== 'trigger').length;
  const last = stats.lastStatus ? describeRun({ status: stats.lastStatus, error: stats.lastError, trace: stats.lastTrace }) : null;

  return (
    <div style={{ ...card, padding:20, display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
        <div style={{ display:'flex', gap:12, alignItems:'center', minWidth:0 }}>
          <div style={{ width:32, height:32, borderRadius:8, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <I n="wflow" s={16} c="#f59e0b" />
          </div>
          <div style={{ minWidth:0 }}>
            <h3 style={{ fontSize:15, fontWeight:600, color:'var(--t1)' }}>{w.name}</h3>
            <p style={{ fontSize:11, color:'var(--t3)', marginTop:2, display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
              <span>{stepCount} step{stepCount === 1 ? '' : 's'}</span>
              {stats.count !== null && <span>· {stats.count} run{stats.count === 1 ? '' : 's'}</span>}
              {stats.lastAt
                ? <span title={new Date(stats.lastAt).toLocaleString()}>· last run {timeAgo(stats.lastAt)}</span>
                : stats.count === 0 && <span>· never run</span>}
              {last && <StatusPill tone={last.tone}>{last.label}</StatusPill>}
              <span>· updated {new Date(w.updatedAt || w.createdAt).toLocaleDateString()}</span>
            </p>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <Toggle on={w.isActive} onToggle={onToggle} />
          {!readOnly && <IconBtn icon="pencil" onClick={onEdit} title="Edit" />}
          {!readOnly && <IconBtn icon="trash" danger onClick={onDelete} title="Delete" />}
        </div>
      </div>

      <div style={{ display:'flex', flexWrap:'wrap', gap:6, alignItems:'center', background:'rgba(255,255,255,0.01)', border:'1px solid var(--bd)', borderRadius:8, padding:'10px 14px' }}>
        {nodes.map((step, idx) => (
          <div key={step.id || idx} style={{ display:'flex', alignItems:'center', gap:6 }}>
            {idx > 0 && <I n="arrow" s={10} c="var(--t3)" />}
            <span style={{ fontSize:12, padding:'3px 8px', borderRadius:6, background: step.type === 'trigger' ? 'rgba(245,158,11,0.08)' : step.type === 'condition' ? 'rgba(157,107,255,0.08)' : 'rgba(53,232,242,0.08)', border:`1px solid ${step.type === 'trigger' ? 'rgba(245,158,11,0.2)' : step.type === 'condition' ? 'rgba(157,107,255,0.25)' : 'var(--gbd)'}`, color: TYPE_COLOR[step.type] || 'var(--green)', fontWeight:600 }}>
              {stepLabel(step)}
            </span>
          </div>
        ))}
      </div>

      {!w.isActive && <Banner tone="warn">This workflow is paused — it will not run on incoming messages or CRM events.</Banner>}
      {last?.tone === 'error' && stats.lastError && <Banner tone="error">Last run failed: {stats.lastError}</Banner>}

      <div style={{ borderTop:'1px solid var(--bd)', paddingTop:12, display:'flex', gap:16, flexWrap:'wrap' }}>
        {/* Testing needs the member role on the server, so viewers and agents
            get the history only. */}
        {!readOnly && (
          <button onClick={onSimulate} style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--green)', fontWeight:600, display:'flex', alignItems:'center', gap:6, padding:0 }}>
            <I n="play" s={12} c="var(--green)" /> Test this workflow
          </button>
        )}
        <button onClick={() => setShowRuns(v => !v)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--t2)', fontWeight:600, display:'flex', alignItems:'center', gap:6, padding:0 }}>
          <I n="clock" s={12} c="var(--t2)" /> {showRuns ? 'Hide' : 'Show'} run history
        </button>
      </div>

      {sim && !readOnly && (
        <SimPanel title="Test with a sample message" sim={sim} waitsForReply={waitsForReply}
          onSample={onSimChange} onReplies={onSimRepliesChange} onRun={onSimRun} onClose={onSimClose} workflowId={w.id} />
      )}

      {showRuns && <RunHistory workflowId={w.id} tick={runsTick} />}
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
  // Intent matching is the campaignAi plan feature (enforced server-side).
  const { allows } = usePlanFeatures();
  const planLocked = !allows('campaignAi');
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
    wJson(`${AI_AGENTS_API.whatsapp}/config`).then(r => {
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
    const r = await wJson(`${AI_AGENTS_API.whatsapp}/intent-matching`, { method:'PATCH', body: JSON.stringify({ enabled: next, threshold: nextThreshold }) });
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
    if (!await confirmDialog(`Delete the intent “${rule.name}”? Messages it used to route will fall through to the AI agent.`, { danger: true })) return;
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
          <Btn variant="outline" onClick={() => setEditor({ intent: null })} disabled={planLocked}>
            <I n="plus" s={13} c="var(--t2)" /> New intent
          </Btn>
          <Toggle on={enabled} onToggle={() => persist(!enabled, threshold)} disabled={saving || (planLocked && !enabled)} />
        </div>
      </TabHeader>

      {planLocked && <Banner tone="warn">Intent matching is not included in your plan. Upgrade from Payments to turn it on.</Banner>}
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
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:5, flexWrap: 'wrap', rowGap: 10 }}>
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
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8, flexWrap: 'wrap', rowGap: 10 }}>
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
    if (!await confirmDialog('Disconnect this Instagram account? Your flows are kept but will stop running.', { danger: true })) return;
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
    if (!await confirmDialog('Delete this flow?', { danger: true })) return;
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

          {/* A disabled button with no explanation is the worst version of
              this. The server says exactly which credentials are missing and
              what they are, because the failure it prevents surfaces on
              instagram.com as "incorrect password" — for a password that is
              perfectly correct — and is otherwise impossible to place. */}
          {conn && !conn.configured && (
            <div style={{ maxWidth:520, textAlign:'left', padding:'12px 14px', borderRadius:10, background:'rgba(245,158,11,.07)', border:'1px solid rgba(245,158,11,.25)' }}>
              <p style={{ fontSize:12.5, fontWeight:700, color:'#fbbf24', marginBottom:6 }}>
                Instagram is not configured on this server
              </p>
              {conn.setup?.missing?.length > 0 && (
                <p style={{ fontSize:12, color:'var(--t2)', lineHeight:1.6, marginBottom:8 }}>
                  Missing: <code style={{ color:'var(--t1)' }}>{conn.setup.missing.join(', ')}</code>
                </p>
              )}
              {(conn.setup?.setupNotes || []).map((note, i) => (
                <p key={i} style={{ fontSize:11.5, color:'var(--t3)', lineHeight:1.6, marginBottom:6 }}>{note}</p>
              ))}
            </div>
          )}
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
  // Switching Voice AI on is the `voice` plan feature (enforced server-side).
  const { allows } = usePlanFeatures();
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
  if (!cfg.voiceAiEnabled && !allows('voice')) return <PlanLocked feature="voice" />;

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
    if (!await confirmDialog('Delete this form?', { danger: true })) return;
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
          <IconBtn icon="arrowLeft" onClick={() => setViewing(null)} />
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
    if (!await confirmDialog('Delete this segment?', { danger: true })) return;
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
      ? await wJson(`/segments/${viewingSegmentId}/contacts/${editingContact.id}`, { method:'PATCH', body: JSON.stringify({ name: contactName.trim(), phoneNumber: contactPhone.trim() }) })
      : await wJson(`/segments/${viewingSegmentId}/contacts`, { method:'POST', body: JSON.stringify({ name: contactName.trim(), phoneNumber: contactPhone.trim() }) });
    if (!r.ok) { setContactError(r.error); return; }
    await fetchSegments();
    cancelContactForm();
  };

  const deleteContact = async contactId => {
    if (!await confirmDialog('Remove this contact from the segment?', { danger: true })) return;
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
            <IconBtn icon="arrowLeft" onClick={() => setViewingSegmentId(null)} />
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
        title="Contact Lists" subtitle="Hand-picked lists for targeted messaging. Membership is fixed: contacts are added and removed by hand, not by rules.">
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
            <p style={{ fontSize:13, color:'var(--t2)' }}>Create a list, then add the contacts that belong in it. Lists do not update automatically.</p>
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
  // page given its own route — /dashboard/intent-matching.
  // An explicit ?tab= still wins, so those routes stay shareable once the user
  // switches tabs within them.
  const [activeTab, setActiveTab] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('tab');
    if (TAB_IDS.has(fromUrl)) return fromUrl;
    return TAB_IDS.has(initialTab) ? initialTab : 'basic';
  });

  // /dashboard/automation and /dashboard/intent-matching both render *this*
  // component, so React reconciles them as the same element
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

  const isMobile = useIsMobile();
  // Viewers and agents can look but not change anything here; the disabled
  // fieldset below makes every control in the tab body read-only at once
  // (except on Workflows, which hides its edit controls itself).
  const readOnly = !can('automation.manage');

  const renderContent = () => {
    switch (activeTab) {
      case 'basic':       return <BasicAutomationsTab />;
      case 'custom':      return <CustomAutoReplyTab />;
      case 'workflows':   return <WorkflowsTab />;
      case 'ai-intent':   return <AIIntentMatchingTab />;
      case 'ig-quick':    return <InstagramQuickflowsTab />;
      case 'voice-ai':    return <VoiceAITab />;
      case 'wa-forms':    return <WhatsAppFormsTab />;
      case 'interactive': return <SmartListsTab />;
      default:            return null;
    }
  };

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'#060B18' }}>
      {/* This page builds its own header rather than using the shell's, so it
          had no hamburger — on a phone the nav drawer was unreachable from
          Automation, the AI Agent and Intent Matching, which are three separate
          sidebar destinations. */}
      {isMobile && (
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px 0', flexShrink:0, background:'var(--surf)' }}>
          <MobileNavButton />
        </div>
      )}
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

      <div className="dash-page" style={{ flex:1, overflowY:'auto', padding:'32px' }}>
        <div style={{ maxWidth:'1000px', margin:'0 auto' }}>
          {readOnly && (
            <div role="status" style={{ ...card, padding:'11px 15px', marginBottom:16, display:'flex', alignItems:'center', gap:8 }}>
              <I n="lock" s={14} c="var(--t2)" />
              <span style={{ fontSize:12.5, color:'var(--t2)', lineHeight:1.5 }}>
                View only — automations, intents and forms are changed by workspace members. Ask a member or admin if something needs to change.
              </span>
            </div>
          )}
          {/* The Workflows tab gates its own controls, because run history has to
              stay usable for viewers and agents, which a disabled fieldset prevents. */}
          <fieldset disabled={readOnly && activeTab !== 'workflows'} style={{ border:0, padding:0, margin:0, minWidth:0 }}>
            {renderContent()}
          </fieldset>
        </div>
      </div>
    </div>
  );
}
