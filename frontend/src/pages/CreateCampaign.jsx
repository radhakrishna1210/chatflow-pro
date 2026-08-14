import { useState, useEffect, useRef, useCallback } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { useIsMobile } from '../lib/useMediaQuery.js';
import { wFetch } from '../lib/api.js';
import { validateMeaningfulText } from '../lib/validation.js';
import WalletStatusBanner from '../components/WalletStatusBanner.jsx';

// Extract body text from Meta components array
const getBodyText = (components) => {
  if (!components) return '';
  const arr = Array.isArray(components) ? components : (typeof components === 'string' ? JSON.parse(components) : []);
  return arr.find(c => c.type === 'BODY' || c.type === 'body')?.text ?? '';
};

const getComponents = (components) => {
  if (!components) return [];
  try {
    const arr = Array.isArray(components) ? components : (typeof components === 'string' ? JSON.parse(components) : []);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
};

// The quick-reply buttons the template was approved with. Meta refuses buttons
// that were not part of the approved template, so this is exactly what the
// customer can tap — the AI CTA has to ride on one of these or be typed.
const quickReplyButtons = (components) =>
  (getComponents(components).find(c => String(c?.type || '').toUpperCase() === 'BUTTONS')?.buttons ?? [])
    .filter(b => String(b?.type || '').toUpperCase() === 'QUICK_REPLY')
    .map(b => String(b?.text || '').trim())
    .filter(Boolean);

const ctaKey = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ─── constants & helpers ───────────────────────────────────────
const card = {
  background: 'var(--surf)',
  border: '1px solid var(--bd)',
  borderRadius: 'var(--rl)',
  boxShadow: 'var(--card-shadow)',
};

const DEFAULT_RULES = [
  { id: 'r1', enabled: true, triggerType: 'exact',    keyword: 'STOP', actionType: 'optout', replyText: '' },
  { id: 'r2', enabled: true, triggerType: 'exact',    keyword: 'YES',  actionType: 'reply',  replyText: 'Thank you for your interest! Our team will reach out shortly.' },
  { id: 'r3', enabled: true, triggerType: 'exact',    keyword: 'HELP', actionType: 'reply',  replyText: 'Need help? Reply with your query and our support team will assist you.' },
  { id: 'r4', enabled: true, triggerType: 'any',      keyword: '',     actionType: 'reply',  replyText: "Sorry, I didn't understand that. Reply HELP for assistance." },
];

const SMART_SCHEDULE = [
  { attempt: 1, delay: '1h 1m',   cumulative: '~1h from send' },
  { attempt: 2, delay: '2h 32m',  cumulative: '~3h 33m from send' },
  { attempt: 3, delay: '4h 48m',  cumulative: '~8h 21m from send' },
  { attempt: 4, delay: '8h 15m',  cumulative: '~16h 36m from send' },
  { attempt: 5, delay: '14h 30m', cumulative: '~31h 6m from send' },
  { attempt: 6, delay: '24h',     cumulative: '~55h 6m from send' },
];

const CAT_STYLE = {
  MARKETING:      { bg: 'rgba(196,255,70,.12)', bd: 'rgba(196,255,70,.3)',  c: '#d8ff8a' },
  UTILITY:        { bg: 'rgba(14,165,233,.12)',  bd: 'rgba(14,165,233,.3)',   c: '#9d6bff' },
  AUTHENTICATION: { bg: 'rgba(245,158,11,.12)',  bd: 'rgba(245,158,11,.3)',   c: '#fbbf24' },
};

// ─── shared small components ───────────────────────────────────
const CatBadge = ({ cat }) => {
  const v = CAT_STYLE[cat] || CAT_STYLE.UTILITY;
  return (
    <span style={{ padding: '2px 8px', borderRadius: '5px', fontSize: '10px', fontWeight: 700, letterSpacing: '.04em', background: v.bg, border: `1px solid ${v.bd}`, color: v.c }}>
      {cat}
    </span>
  );
};

const StatusBadge = ({ s }) => {
  const cfg = {
    Approved: { bg: 'var(--gbg)', bd: 'var(--gbd)', c: 'var(--green)' },
    Active:   { bg: 'var(--gbg)', bd: 'var(--gbd)', c: 'var(--green)' },
    Pending:  { bg: 'rgba(245,158,11,.1)', bd: 'rgba(245,158,11,.25)', c: '#fbbf24' },
  };
  const v = cfg[s] || cfg.Pending;
  return (
    <span style={{ padding: '2px 9px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, background: v.bg, border: `1px solid ${v.bd}`, color: v.c }}>
      {s}
    </span>
  );
};

const Toggle = ({ on, onToggle }) => (
  <div onClick={onToggle} style={{ width: '42px', height: '23px', borderRadius: '20px', background: on ? 'var(--green)' : 'rgba(255,255,255,0.1)', cursor: 'pointer', transition: 'background .2s', position: 'relative', border: `1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`, flexShrink: 0 }}>
    <div style={{ position: 'absolute', top: '2px', left: on ? '21px' : '2px', width: '17px', height: '17px', borderRadius: '50%', background: 'white', transition: 'left .2s', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }} />
  </div>
);

const TypeBtn = ({ label, sub, selected, onClick, disabled = false }) => (
  <div onClick={disabled ? undefined : onClick} style={{ padding: '13px 16px', borderRadius: '10px', border: `1.5px solid ${selected ? 'var(--green)' : 'var(--bd)'}`, background: selected ? 'var(--gbg)' : 'rgba(255,255,255,0.02)', cursor: disabled ? 'not-allowed' : 'pointer', transition: 'all .15s', flex: 1, opacity: disabled ? 0.5 : 1 }}>
  <div style={{ fontWeight: 600, fontSize: '13px', color: selected ? 'var(--green)' : 'var(--t1)', marginBottom: sub ? '3px' : 0 }}>{label}</div>
    {sub && <div style={{ fontSize: '11px', color: 'var(--t2)' }}>{sub}</div>}
  </div>
);

const Chev = ({ open }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform .25s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--t2)' }}>
    <polyline points="6,9 12,15 18,9" />
  </svg>
);

const InfoAlert = ({ children }) => (
  <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(14,165,233,.06)', border: '1px solid rgba(14,165,233,.18)', color: '#9d6bff', fontSize: '12px', lineHeight: 1.55, display: 'flex', gap: '9px', alignItems: 'flex-start' }}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '1px' }}>
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    {children}
  </div>
);

const ArrowBtn = ({ dir, onClick, disabled }) => (
  <button onClick={onClick} disabled={disabled} style={{ width: '26px', height: '26px', borderRadius: '6px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1, color: 'var(--t2)' }}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      {dir === 'up' ? <polyline points="18,15 12,9 6,15" /> : <polyline points="6,9 12,15 18,9" />}
    </svg>
  </button>
);

const SLabel = ({ children }) => (
  <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '10px' }}>{children}</p>
);

// ─── accordion wrapper ─────────────────────────────────────────
const StepHeader = ({ n, title, done, open, locked, onToggle }) => (
  <div onClick={locked ? undefined : onToggle} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '15px 20px', cursor: locked ? 'not-allowed' : 'pointer', userSelect: 'none', opacity: locked ? 0.45 : 1 }}>
    <div style={{ width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, background: done ? 'var(--green)' : open ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)', border: `1.5px solid ${done ? 'var(--green)' : open ? 'var(--bdm)' : 'var(--bd)'}`, color: done ? '#08090c' : 'var(--t2)', transition: 'all .2s' }}>
      {done ? <I n="check" s={13} c="#08090c" w={2.5} /> : n}
    </div>
    <div style={{ flex: 1 }}>
      <span style={{ fontSize: '14px', fontWeight: 600, color: open ? 'var(--t1)' : done ? 'var(--t1)' : 'var(--t2)', transition: 'color .15s' }}>{title}</span>
      {n > 4 && <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--t3)', fontWeight: 400 }}>Optional</span>}
    </div>
    <Chev open={open} />
  </div>
);

const StepWrap = ({ n, badge, title, done, open, locked, onToggle, children }) => (
  <div style={{ ...card, overflow: 'visible', flexShrink: 0, transition: 'border-color .2s', borderColor: open ? 'var(--bdm)' : 'var(--bd)' }}>
    <StepHeader n={badge ?? n} title={title} done={done} open={open} locked={locked} onToggle={onToggle} />
    {open && <div style={{ borderTop: '1px solid var(--bd)', padding: '20px' }}>{children}</div>}
  </div>
);

// ─── Step 1 ───────────────────────────────────────────────────
const Step1 = ({ campaignType, setCampaignType, numbers, selectedNumberId, setSelectedNumberId, onNext }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
    <div>
      <SLabel>Campaign Type</SLabel>
      <div style={{ display: 'flex', gap: '10px' }}>
        <TypeBtn label="One Time Campaign" sub="Broadcast to many contacts at once" selected={campaignType === 'onetime'} onClick={() => setCampaignType('onetime')} />
        <TypeBtn label="Ongoing Campaign" sub="Triggered automatically by events" selected={campaignType === 'ongoing'} onClick={() => setCampaignType('ongoing')} />
      </div>
    </div>
    <div>
      <SLabel>WhatsApp Send-From Number</SLabel>
      {numbers.length === 0 ? (
        <div style={{ padding:'20px', borderRadius:'10px', border:'1px dashed var(--bd)', textAlign:'center', color:'var(--t3)', fontSize:13 }}>
          No number connected yet. Go to <strong style={{ color:'var(--t2)' }}>Number Setup</strong> to connect one.
        </div>
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px' }}>
        {numbers.map(n => {
          const sel = selectedNumberId === n.id;
          return (
            <div key={n.id} onClick={() => setSelectedNumberId(n.id)}
              style={{ padding: '14px', borderRadius: '10px', border: `1.5px solid ${sel ? 'var(--green)' : 'var(--bd)'}`, background: sel ? 'var(--gbg)' : 'rgba(255,255,255,0.02)', cursor: 'pointer', transition: 'all .15s' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <StatusBadge s={n.status === 'ACTIVE' ? 'Active' : (n.status ?? 'Active')} />
                {sel && (
                  <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <I n="check" s={9} c="#08090c" w={3} />
                  </div>
                )}
              </div>
              <p style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: '13px', color: sel ? 'var(--green)' : 'var(--t1)', marginBottom: '3px' }}>{n.phoneNumber}</p>
              <p style={{ fontSize: '11px', color: 'var(--t2)' }}>{n.displayName ?? '—'}</p>
            </div>
          );
        })}
      </div>
      )}
    </div>
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <Btn onClick={onNext} disabled={!selectedNumberId}>Save &amp; Next</Btn>
    </div>
  </div>
);

// ─── Step 0 · Goal ─────────────────────────────────────────────
//
// What the campaign is for. It is the first question because it is the one that
// changes the answers to the rest: the goal is bound into the AI agent's
// context, so a customer asking "what is this?" gets an answer that knows
// whether it is an offer or an announcement.
const CAMPAIGN_GOALS = [
  { id: 'sales',    icon: 'credit', title: 'Drive sales',        body: 'Promote an offer and convert in chat' },
  { id: 'launch',   icon: 'zap',    title: 'Announce a launch',  body: 'A new product, drop or feature' },
  { id: 'reengage', icon: 'rotate', title: 'Re-engage',          body: 'Win back customers who went quiet' },
  { id: 'nurture',  icon: 'note',   title: 'Educate & nurture',  body: 'Share something useful, build the relationship' },
];

const GoalStep = ({ goal, setGoal, onNext }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.6 }}>
      This tunes the templates suggested next, and rides along as context for the AI agent if you attach one.
    </p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 10 }}>
      {CAMPAIGN_GOALS.map(g => {
        const on = goal === g.id;
        return (
          <button key={g.id} type="button" onClick={() => setGoal(on ? null : g.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '15px 16px', borderRadius: 13, cursor: 'pointer', textAlign: 'left',
                     fontFamily: "'Manrope',sans-serif",
                     background: on ? 'var(--gbg)' : 'rgba(255,255,255,0.02)',
                     border: `1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`, transition: 'all .15s' }}>
            <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                           background: on ? 'rgba(53,232,242,0.14)' : 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)' }}>
              <I n={g.icon} s={15} c={on ? 'var(--green)' : 'var(--t2)'} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--t1)' }}>{g.title}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--t3)', marginTop: 2 }}>{g.body}</span>
            </span>
            <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                           background: on ? 'var(--green)' : 'transparent', border: `1px solid ${on ? 'var(--green)' : 'var(--bd)'}` }}>
              {on && <I n="check" s={10} c="#08090c" w={3} />}
            </span>
          </button>
        );
      })}
    </div>
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <Btn onClick={onNext}>Continue</Btn>
    </div>
  </div>
);

// ─── Pre-launch review ─────────────────────────────────────────
//
// Every reason a launch could go wrong or go out weaker than intended, in one
// place, before the button. The accordion already gates step by step; what it
// could not do is answer "am I ready?" without opening nine panes.
//
// A check is either a pass or a warning — never an error — because anything
// that genuinely blocks a send already disables Go Live. These are the things
// worth knowing and choosing to ignore.
const ReviewPanel = ({ checks, canLaunch, onLaunch, launching }) => {
  const warnings = checks.filter(c => !c.ok).length;
  return (
    <div style={{ border: '1px solid var(--bd)', borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <I n={warnings === 0 ? 'checkc' : 'alertt'} s={16} c={warnings === 0 ? 'var(--success)' : '#fbbf24'} />
        <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--t1)' }}>Pre-launch checks</span>
        <span style={{ fontSize: 12, color: 'var(--t2)' }}>
          {warnings === 0 ? 'Everything checks out.' : `${warnings} thing${warnings === 1 ? '' : 's'} worth a look.`}
        </span>
      </div>

      <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {checks.map(check => (
          <div key={check.title} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '10px 12px', borderRadius: 9,
            background: check.ok ? 'var(--sbg)' : 'rgba(245,158,11,0.06)',
            border: `1px solid ${check.ok ? 'var(--sbd)' : 'rgba(245,158,11,0.25)'}` }}>
            <I n={check.ok ? 'checkc' : 'alertt'} s={15} c={check.ok ? 'var(--success)' : '#fbbf24'} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: check.ok ? 'var(--t1)' : '#fbbf24' }}>{check.title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 2, lineHeight: 1.5 }}>{check.detail}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '14px 18px', borderTop: '1px solid var(--bd)', display: 'flex', justifyContent: 'flex-end' }}>
        <Btn onClick={onLaunch} disabled={!canLaunch || launching} style={{ boxShadow: canLaunch && !launching ? 'var(--glow)' : 'none' }}>
          {launching ? 'Launching…' : 'Launch campaign'}
        </Btn>
      </div>
    </div>
  );
};

// ─── Step 2 ───────────────────────────────────────────────────
const Step2 = ({ templates, selectedTemplateId, setSelectedTemplateId, templateBody, setTemplateBody, onNext }) => {
  const selected = templates.find(t => t.id === selectedTemplateId);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {!selected ? (
        <div style={{ maxHeight: '340px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
          {templates.length === 0 ? (
            <div style={{ textAlign:'center', padding:'32px', color:'var(--t2)', fontSize:13 }}>
              No approved templates yet. Sync templates from the Templates page first.
            </div>
          ) : templates.map(t => {
            const body = getBodyText(t.components);
            return (
              <div key={t.id}
                onClick={() => { setSelectedTemplateId(t.id); setTemplateBody(body); }}
                style={{ padding: '14px 16px', borderRadius: '10px', border: '1px solid var(--bd)', background: 'rgba(255,255,255,0.02)', cursor: 'pointer', transition: 'border-color .15s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--bdm)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--bd)'}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '7px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--t1)' }}>{t.name}</span>
                  <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                    <span style={{ fontSize:'10px', color:'var(--t3)' }}>{t.language}</span>
                    <CatBadge cat={t.category} />
                  </div>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--t2)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {body || <span style={{ color:'var(--t3)', fontStyle:'italic' }}>No body text</span>}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div style={{ padding: '14px 16px', borderRadius: '10px', background: 'var(--gbg)', border: '1px solid var(--gbd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
            <div>
              <p style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: '14px', color: 'var(--green)', marginBottom: '5px' }}>{selected.name}</p>
              <CatBadge cat={selected.category} />
            </div>
            <Btn variant="ghost" size="sm" onClick={() => { setSelectedTemplateId(null); setTemplateBody(''); }}>Choose Another</Btn>
          </div>
          <div>
            <SLabel>Template Body</SLabel>
            <textarea value={templateBody} onChange={e => setTemplateBody(e.target.value)}
              style={{ width: '100%', minHeight: '110px', padding: '10px 13px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '13px', fontFamily: "'Manrope',sans-serif", outline: 'none', resize: 'vertical', lineHeight: 1.55, boxSizing: 'border-box', transition: 'border-color .15s' }}
              onFocus={e => e.target.style.borderColor = 'var(--gbd)'}
              onBlur={e => e.target.style.borderColor = 'var(--bd)'} />
            <p style={{ fontSize: '11px', color: 'var(--t3)', marginTop: '5px' }}>Use &#123;&#123;1&#125;&#125;, &#123;&#123;2&#125;&#125; for variable placeholders</p>
          </div>
        </>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Btn onClick={onNext} disabled={!selectedTemplateId}>Save &amp; Next</Btn>
      </div>
    </div>
  );
};

// ─── Step 3 ───────────────────────────────────────────────────
const Step3 = ({ audienceMethod, setAudienceMethod, contacts, selectedContactIds, setSelectedContactIds, toggleContact, onContactsReload, onNext }) => {
  const [search, setSearch]       = useState('');
  const [manualName, setManualName]   = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [csvFile, setCsvFile]     = useState(null);
  const [csvDragging, setCsvDragging] = useState(false);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvErr, setCsvErr]             = useState('');
  const [csvResult, setCsvResult]       = useState(null);
  const [manualAdded, setManualAdded] = useState([]);
  const fileRef = useRef(null);
  const [clusters, setClusters] = useState([]);
  const [selectedClusterId, setSelectedClusterId] = useState('');
  const [clusterLoading, setClusterLoading] = useState(false);

  const downloadSample = () => {
    const csvContent = [
      'name,phoneNumber,email,tags',
      'Aarav,+917410066251,aarav@example.com,test',
      'Vivaan,+918983416795,vivaan@example.com,test',
      'Krishna,+919226573383,krishna@example.com,test',
      'Arjun,+918080178330,arjun@example.com,test',
      'Rohan,+919604609921,rohan@example.com,test',
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'sample_contacts.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const uploadCsv = async () => {
    if (!csvFile || csvUploading) return;
    setCsvErr(''); setCsvResult(null); setCsvUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', csvFile);
      const res = await wFetch('/contacts/import', {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        let msg = `Upload failed (${res.status})`;
        try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
        setCsvErr(msg);
      } else {
        const result = await res.json();
        setCsvResult(result);
        if (result.contacts && result.contacts.length > 0) {
          const ids = result.contacts.map(c => c.id);
          setSelectedContactIds?.(prev => {
            const next = new Set(prev);
            ids.forEach(id => next.add(id));
            return next;
          });
          onContactsReload?.();
        }
      }
    } catch (e) {
      setCsvErr(e.message || 'Could not upload file.');
    } finally {
      setCsvUploading(false);
    }
  };

  useEffect(() => {
    if (audienceMethod === 'cluster' && clusters.length === 0) {
      wFetch('/clusters')
        .then(r => r.ok && r.json())
        .then(d => { if (Array.isArray(d)) setClusters(d); })
        .catch(() => {});
    }
  }, [audienceMethod]);

  const handleSelectCluster = async (cid) => {
    setSelectedClusterId(cid);
    if (!cid) {
      setSelectedContactIds?.(new Set());
      return;
    }
    setClusterLoading(true);
    try {
      const res = await wFetch(`/clusters/${cid}`);
      if (res.ok) {
        const data = await res.json();
        const ids = (data.memberContacts ?? []).map(c => c.id);
        setSelectedContactIds?.(new Set(ids));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setClusterLoading(false);
    }
  };

  const filtered = contacts.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (c.name?.toLowerCase().includes(q)) || (c.phoneNumber ?? c.phone ?? '').includes(search);
  });

  const [addingManual, setAddingManual] = useState(false);
  const addManual = async () => {
    if (!manualPhone.trim() || addingManual) return;
    setAddingManual(true);
    try {
      const res = await wFetch('/contacts', {
        method: 'POST',
        body: JSON.stringify({ name: manualName || 'Unknown', phoneNumber: manualPhone.trim() }),
      });
      if (!res.ok) throw new Error(`add contact failed (${res.status}): ${await res.text()}`);
      const contact = await res.json();
      setManualAdded(prev => [...prev, { id: contact.id, name: contact.name, phone: contact.phoneNumber }]);
      toggleContact(contact.id);
      setManualName(''); setManualPhone('');
    } catch (err) {
      console.error('[add manual contact]', err);
      alert(`Couldn't add contact: ${err.message}`);
    } finally {
      setAddingManual(false);
    }
  };

  const tabs = [
    { id: 'list',    label: 'Select from List' },
    { id: 'manual',  label: 'Enter Manually' },
    { id: 'csv',     label: 'Upload CSV' },
    { id: 'cluster', label: 'Select Cluster' },
    { id: 'segment', label: 'Select Segment', disabled: true },
  ];

  const total = selectedContactIds.size;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <div key={t.id} onClick={t.disabled ? undefined : () => setAudienceMethod(t.id)}
            style={{ padding: '7px 14px', borderRadius: '8px', border: `1px solid ${audienceMethod === t.id ? 'var(--green)' : 'var(--bd)'}`, background: audienceMethod === t.id ? 'var(--gbg)' : 'transparent', cursor: t.disabled ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 500, color: audienceMethod === t.id ? 'var(--green)' : t.disabled ? 'var(--t3)' : 'var(--t2)', transition: 'all .15s', opacity: t.disabled ? 0.45 : 1, display: 'flex', alignItems: 'center', gap: '6px' }}>
            {t.label}
            {t.disabled && <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', color: 'var(--t3)' }}>Soon</span>}
          </div>
        ))}
      </div>

      {audienceMethod === 'list' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)', marginBottom: '10px' }}>
            <I n="search" s={13} c="var(--t2)" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contacts…"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--t1)', fontSize: '13px', fontFamily: "'Manrope',sans-serif" }} />
          </div>
          <div style={{ maxHeight: '260px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {filtered.map(c => {
              const sel = selectedContactIds.has(c.id);
              return (
                <div key={c.id} onClick={() => toggleContact(c.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 12px', borderRadius: '8px', cursor: 'pointer', background: sel ? 'rgba(53,232,242,0.05)' : 'transparent', transition: 'background .12s' }}
                  onMouseEnter={e => { if (!sel) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                  onMouseLeave={e => { if (!sel) e.currentTarget.style.background = sel ? 'rgba(53,232,242,0.05)' : 'transparent'; }}>
                  <div style={{ width: '16px', height: '16px', borderRadius: '4px', border: `1.5px solid ${sel ? 'var(--green)' : 'var(--bd)'}`, background: sel ? 'var(--green)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
                    {sel && <I n="check" s={9} c="#08090c" w={3} />}
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--t1)', flex: 1 }}>{c.name}</span>
                  <span style={{ fontSize: '12px', color: 'var(--t2)' }}>{c.phoneNumber ?? c.phone}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {audienceMethod === 'manual' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Name (optional)"
              style={{ flex: 1, padding: '9px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '13px', fontFamily: "'Manrope',sans-serif", outline: 'none' }} />
            <input value={manualPhone} onChange={e => setManualPhone(e.target.value.replace(/[^0-9+\s]/g, ''))} placeholder="+91 98765 43210"
              style={{ flex: 1, padding: '9px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '13px', fontFamily: "'Manrope',sans-serif", outline: 'none' }}
              onKeyDown={e => e.key === 'Enter' && addManual()} />
            <Btn size="sm" onClick={addManual} disabled={!manualPhone.trim()}>Add Contact</Btn>
          </div>
          {manualAdded.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 13px', borderRadius: '8px', background: 'var(--gbg)', border: '1px solid var(--gbd)' }}>
              <I n="check" s={13} c="var(--green)" />
              <span style={{ fontSize: '13px', color: 'var(--t1)', flex: 1 }}>{c.name} — {c.phone}</span>
            </div>
          ))}
        </div>
      )}

      {audienceMethod === 'csv' && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Btn variant="outline" size="sm" onClick={downloadSample}>
              <I n="download" s={13} c="var(--t2)" />
              Download Sample CSV
            </Btn>
          </div>
          {csvErr && (
            <div style={{ padding:'9px 12px', borderRadius:8, background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.25)', color:'#f87171', fontSize:12 }}>{csvErr}</div>
          )}
          {csvResult && (
            <div style={{ padding:'10px 13px', borderRadius:8, background:'var(--gbg)', border:'1px solid var(--gbd)', color:'var(--green)', fontSize:13, fontWeight:600 }}>
              ✓ Imported {csvResult.imported} contact{csvResult.imported !== 1 ? 's' : ''} and added to audience.
            </div>
          )}
          <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display:'none' }} onChange={e => { setCsvFile(e.target.files[0]); setCsvResult(null); }} />
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setCsvDragging(true); }}
            onDragLeave={() => setCsvDragging(false)}
            onDrop={e => { e.preventDefault(); setCsvDragging(false); const f = e.dataTransfer.files[0]; if (f) { setCsvFile(f); setCsvResult(null); } }}
            style={{
              border:`2px dashed ${csvDragging ? 'var(--green)' : 'var(--bd)'}`,
              borderRadius:12, padding:'30px 18px', textAlign:'center', cursor:'pointer',
              transition:'all .2s', background: csvDragging ? 'var(--gbg)' : 'rgba(255,255,255,0.01)',
            }}>
            <div style={{ display:'flex', justifyContent:'center', marginBottom:10 }}>
              <div style={{ width:44, height:44, borderRadius:12, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--t2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17,8 12,3 7,8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
            </div>
            {csvFile ? (
              <>
                <p style={{ fontSize:14, fontWeight:600, color:'var(--green)' }}>{csvFile.name}</p>
                <p style={{ fontSize:11, color:'var(--t3)', marginTop:4 }}>{(csvFile.size/1024).toFixed(1)} KB — click to choose a different file</p>
              </>
            ) : (
              <>
                <p style={{ fontSize:14, fontWeight:600, color:'var(--t1)', marginBottom:5 }}>Drop CSV here or click to browse</p>
                <p style={{ fontSize:12, color:'var(--t2)' }}>
                  Columns: <code style={{ color:'var(--green)', fontFamily:'monospace' }}>name</code>, <code style={{ color:'var(--green)', fontFamily:'monospace' }}>phoneNumber</code>, <code style={{ color:'var(--t2)', fontFamily:'monospace' }}>email</code>, <code style={{ color:'var(--t2)', fontFamily:'monospace' }}>tags</code>
                </p>
              </>
            )}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:8, background:'rgba(14,165,233,.06)', border:'1px solid rgba(14,165,233,.18)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9d6bff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span style={{ fontSize:12, color:'#b9a3ff', lineHeight:1.5 }}>
              Phone numbers must include country code (e.g. <code style={{ fontFamily:'monospace', color:'#b9a3ff' }}>+919876543210</code>). Tags column is comma-separated.
            </span>
          </div>
          <div style={{ padding:'14px 16px', borderRadius:8, background:'rgba(14,165,233,.06)', border:'1px solid rgba(14,165,233,.18)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9d6bff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span style={{ fontSize:13, fontWeight:600, color:'#b9a3ff' }}>Instructions for uploading CSV</span>
            </div>
            <ul style={{ paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: '#b9a3ff', lineHeight: 1.5 }}>
              <li>Upload a CSV file to bulk import contacts.</li>
              <li>
                Required columns:
                <ul style={{ listStyleType: 'none', paddingLeft: 16, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <li>- <code style={{ fontFamily: 'monospace', color: '#b9a3ff' }}>phoneNumber</code> (required)</li>
                  <li>- <code style={{ fontFamily: 'monospace', color: '#b9a3ff' }}>name</code> (optional)</li>
                  <li>- <code style={{ fontFamily: 'monospace', color: '#b9a3ff' }}>email</code> (optional)</li>
                  <li>- <code style={{ fontFamily: 'monospace', color: '#b9a3ff' }}>tags</code> (optional)</li>
                </ul>
              </li>
              <li>
                Phone numbers must include country code.
                <div style={{ marginTop: 4 }}>
                  Example:<br />
                  <code style={{ fontFamily: 'monospace', color: '#b9a3ff' }}>+919876543210</code>
                </div>
              </li>
              <li>
                Tags must be comma-separated.
                <div style={{ marginTop: 4 }}>
                  Example:<br />
                  <code style={{ fontFamily: 'monospace', color: '#b9a3ff' }}>vip,customer</code>
                </div>
              </li>
              <li>Duplicate phone numbers in the CSV will be skipped.</li>
              <li>Existing contacts are matched using phone number.</li>
              <li>Invalid rows will not be imported.</li>
            </ul>
          </div>
          {csvFile && (
            <Btn onClick={uploadCsv} disabled={csvUploading} style={{ alignSelf:'flex-end', boxShadow: 'var(--glow)' }}>
              {csvUploading ? 'Uploading…' : 'Import Contacts'}
            </Btn>
          )}
        </div>
      )}

      {audienceMethod === 'cluster' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.5 }}>
            Choose an existing contact cluster. All contacts belonging to the selected cluster will be dynamically added to your audience.
          </div>
          <select
            value={selectedClusterId}
            onChange={(e) => handleSelectCluster(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', borderRadius: 8, background: 'var(--surf)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 13, fontFamily: "'Manrope',sans-serif", outline: 'none' }}
          >
            <option value="">-- Select a Cluster --</option>
            {clusters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.memberCount ?? 0} contacts)
              </option>
            ))}
          </select>
          {clusterLoading && (
            <div style={{ fontSize: 12, color: 'var(--t2)' }}>Loading cluster contacts...</div>
          )}
          {selectedClusterId && !clusterLoading && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--gbg)', border: '1px solid var(--gbd)', color: 'var(--green)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <I n="check" s={14} c="var(--green)" />
              <span>Included {selectedContactIds.size} contact{selectedContactIds.size !== 1 ? 's' : ''} from selected cluster.</span>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '4px', borderTop: '1px solid var(--bd)' }}>
        <span style={{ fontSize: '13px', color: total > 0 ? 'var(--green)' : 'var(--t2)', fontWeight: 500 }}>
          {total > 0 ? `${total} contact${total !== 1 ? 's' : ''} selected` : 'No contacts selected'}
        </span>
        <Btn onClick={onNext} disabled={total === 0 && audienceMethod !== 'csv'}>Save &amp; Next</Btn>
      </div>
    </div>
  );
};

// ─── Step 4 ───────────────────────────────────────────────────
const inr = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const Step4 = ({ scheduleType, setScheduleType, scheduledAt, setScheduledAt, summary, estimate, estimating, estimateError, onLaunch, launching }) => {
  const minDate = new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16);
  const ready   = !!(summary.contactCount > 0 && summary.templateName && summary.numberPhone && summary.campaignName);
  // The wallet must cover the whole campaign before it can start. The server
  // enforces this too — this just refuses the click instead of failing later.
  const affordable = !estimate || estimate.sufficientBalance;
  const hasSendable = !estimate || estimate.validContacts > 0;
  const canLaunch = ready && affordable && hasSendable && !launching && (scheduleType === 'immediately' || !!scheduledAt);

  const costRows = estimate ? [
    ['Total Contacts',      estimate.totalContacts.toLocaleString(), null],
    ['Valid Contacts',      estimate.validContacts.toLocaleString(), 'var(--green)'],
    ['Duplicate Contacts',  estimate.duplicateContacts.toLocaleString(), estimate.duplicateContacts > 0 ? '#fbbf24' : null],
    ['Blocked (Opted Out)', estimate.blockedContacts.toLocaleString(), estimate.blockedContacts > 0 ? '#f87171' : null],
    ['Invalid Numbers',     estimate.invalidContacts.toLocaleString(), estimate.invalidContacts > 0 ? '#f87171' : null],
    ['Cost Per Message',    inr(estimate.costPerMessage), null],
    ['Total Campaign Cost', inr(estimate.totalCost), 'var(--t1)'],
    ['Wallet Balance',      inr(estimate.walletBalance), null],
    ['Balance After Campaign', inr(estimate.remainingBalance), estimate.sufficientBalance ? 'var(--green)' : '#f87171'],
  ] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <SLabel>Send Time</SLabel>
        <div style={{ display: 'flex', gap: '10px' }}>
          <TypeBtn label="Send Immediately" sub="Send to all contacts right now" selected={scheduleType === 'immediately'} onClick={() => setScheduleType('immediately')} />
          <TypeBtn label="Schedule for Later" sub="Pick a specific date and time" selected={scheduleType === 'custom'} onClick={() => setScheduleType('custom')} />
        </div>
      </div>
      {scheduleType === 'custom' && (
        <div>
          <SLabel>Date &amp; Time</SLabel>
          <input type="datetime-local" value={scheduledAt || ''} min={minDate} onChange={e => setScheduledAt(e.target.value)}
            style={{ padding: '9px 13px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '13px', fontFamily: "'Manrope',sans-serif", outline: 'none', colorScheme: 'dark' }} />
        </div>
      )}
      <div style={{ ...card, padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: '14px', color: 'var(--t1)' }}>Campaign Summary</span>
          <span style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 700, background: ready ? 'var(--gbg)' : 'rgba(245,158,11,.1)', border: `1px solid ${ready ? 'var(--gbd)' : 'rgba(245,158,11,.25)'}`, color: ready ? 'var(--green)' : '#fbbf24' }}>
            {ready ? 'Ready' : 'Incomplete'}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
          {[
            ['Campaign Name', summary.campaignName || '—'],
            ['Type',          summary.campaignType === 'onetime' ? 'One Time' : 'Ongoing'],
            ['Template',      summary.templateName || '—'],
            ['Contacts',      `${summary.contactCount} selected`],
            ['Send From',     summary.numberPhone  || '—'],
            ['Send Time',     scheduleType === 'immediately' ? 'Immediately' : (scheduledAt ? new Date(scheduledAt).toLocaleString() : 'Not set')],
            ['AI Agent',      summary.aiAgent || 'Off'],
          ].map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: '11px', color: 'var(--t3)', marginBottom: '2px' }}>{k}</div>
              <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--t1)' }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Cost breakdown, priced by the server against the same rules the
          launch uses — so what's approved here is exactly what's charged. */}
      <div style={{ ...card, padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: '14px', color: 'var(--t1)' }}>Cost &amp; Wallet</span>
          {estimating && <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>Calculating…</span>}
        </div>

        {estimateError ? (
          <p style={{ fontSize: 12.5, color: '#f87171' }}>{estimateError}</p>
        ) : !estimate ? (
          <p style={{ fontSize: 12.5, color: 'var(--t3)' }}>Select your audience to see the campaign cost.</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px 24px' }}>
              {costRows.map(([k, v, color]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 12.5, color: 'var(--t2)' }}>{k}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: color || 'var(--t1)' }}>{v}</span>
                </div>
              ))}
            </div>

            {estimate.blockedContacts > 0 && (
              <p style={{ marginTop: 12, fontSize: 11.5, color: '#fbbf24', lineHeight: 1.5 }}>
                {estimate.blockedContacts} contact{estimate.blockedContacts === 1 ? ' has' : 's have'} opted out and will be skipped —
                you are not charged for them, and the campaign continues for everyone else.
              </p>
            )}

            {!estimate.sufficientBalance && (
              <div style={{ marginTop: 14, padding: '11px 14px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)' }}>
                <p style={{ fontSize: 12.5, color: '#f87171', fontWeight: 600 }}>Insufficient Wallet Balance. Please recharge your wallet.</p>
                <p style={{ fontSize: 11.5, color: '#f8c6c6', marginTop: 4 }}>
                  This campaign needs {inr(estimate.totalCost)} but your wallet holds {inr(estimate.walletBalance)}.
                  Add at least {inr(estimate.totalCost - estimate.walletBalance)} to continue.
                </p>
                <Btn size="sm" variant="outline" style={{ marginTop: 10 }}
                  onClick={() => window.dispatchEvent(new CustomEvent('app:nav', { detail: { section: 'payments', subTab: 'wallet' } }))}>
                  Recharge Wallet
                </Btn>
              </div>
            )}

            {estimate.validContacts === 0 && (
              <p style={{ marginTop: 12, fontSize: 12.5, color: '#f87171' }}>
                There is nobody left to send to — every selected contact is a duplicate, invalid, or has opted out.
              </p>
            )}
          </>
        )}
      </div>

      <Btn onClick={onLaunch} disabled={!canLaunch} style={{ width: '100%', justifyContent: 'center', boxShadow: canLaunch ? 'var(--glow)' : 'none' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
          <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11A22.35 22.35 0 0 1 12 15z"/>
        </svg>
        {launching ? 'Launching…' : estimate ? `Launch Campaign · ${inr(estimate.totalCost)}` : 'Launch Campaign'}
      </Btn>
    </div>
  );
};

// ─── Step 5 · AI Agent ─────────────────────────────────────────
// Attaches a deployed WhatsApp AI Agent to the campaign. Tapping the CTA on
// the delivered message opens a chat with that agent, primed with the exact
// message this campaign sent — so the customer can ask about anything in it
// without repeating what it said.
const CTA_PRESETS = ['Ask Anything', 'Have a Question?', 'Need Help?', 'Agent Support'];
const CTA_MAX = 25;

const StepAiAgent = ({ enabled, setEnabled, agents, agentId, setAgentId, ctaLabel, setCtaLabel, template, onNext }) => {
  const deployed = agents.filter(a => a.deployed);
  const quickReplies = quickReplyButtons(template?.components);
  const matching = quickReplies.find(t => ctaKey(t) === ctaKey(ctaLabel));
  const custom = ctaLabel.trim() && !CTA_PRESETS.some(p => ctaKey(p) === ctaKey(ctaLabel));

  const openAgentSettings = () =>
    window.dispatchEvent(new CustomEvent('app:nav', { detail: { section: 'automation', subTab: 'wa-agent' } }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ paddingTop: '2px' }}>
          <Toggle on={enabled} onToggle={() => setEnabled(!enabled)} />
        </div>
        <div>
          <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--t1)', marginBottom: '3px' }}>Enable AI Agent for this Campaign</p>
          <p style={{ fontSize: '12px', color: 'var(--t2)', lineHeight: 1.55 }}>
            Customers who tap the CTA start a chat with your agent, which already knows what this campaign said.
          </p>
        </div>
      </div>

      {enabled && (
        <>
          {deployed.length === 0 ? (
            <div style={{ padding: '13px 16px', borderRadius: 8, background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.25)' }}>
              <p style={{ fontSize: 12.5, color: '#fbbf24', lineHeight: 1.55 }}>
                No deployed AI agent yet. Add a system prompt and knowledge base under
                Automation → WhatsApp AI Agent, then deploy it.
              </p>
              <Btn size="sm" variant="outline" style={{ marginTop: 10 }} onClick={openAgentSettings}>Open AI Agent settings</Btn>
            </div>
          ) : (
            <div>
              <SLabel>Select AI Agent</SLabel>
              <select value={agentId || ''} onChange={e => setAgentId(e.target.value || null)}
                style={{ width: '100%', maxWidth: 380, padding: '10px 14px', borderRadius: 8, background: 'var(--surf)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 13, fontFamily: "'Manrope',sans-serif", outline: 'none' }}>
                <option value="">— Select an agent —</option>
                {deployed.map(a => <option key={a.id} value={a.id}>{a.name} · deployed</option>)}
              </select>
            </div>
          )}

          <div>
            <SLabel>CTA Label</SLabel>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: 10 }}>
              {CTA_PRESETS.map(p => {
                const sel = ctaKey(p) === ctaKey(ctaLabel);
                return (
                  <div key={p} onClick={() => setCtaLabel(p)}
                    style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${sel ? 'var(--green)' : 'var(--bd)'}`, background: sel ? 'var(--gbg)' : 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: sel ? 'var(--green)' : 'var(--t2)', transition: 'all .15s' }}>
                    {p}
                  </div>
                );
              })}
            </div>
            <input value={ctaLabel} onChange={e => setCtaLabel(e.target.value.slice(0, CTA_MAX))}
              placeholder="Or type your own label"
              style={{ width: '100%', maxWidth: 380, padding: '9px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 13, fontFamily: "'Manrope',sans-serif", outline: 'none' }} />
            <p style={{ fontSize: '11px', color: 'var(--t3)', marginTop: 5 }}>
              {custom ? 'Custom label · ' : ''}{ctaLabel.length}/{CTA_MAX} characters — WhatsApp's button limit.
            </p>
          </div>

          {/* Whether the CTA is tappable is decided by the approved template:
              Meta rejects buttons it never reviewed, so one cannot be bolted on
              at send time. Better said here than discovered after launch. */}
          {quickReplies.length === 0 ? (
            <div style={{ padding: '11px 14px', borderRadius: 8, background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.25)', fontSize: 12.5, color: '#fbbf24', lineHeight: 1.55 }}>
              This template has no quick-reply button, so WhatsApp can't render a tappable CTA. The agent
              still starts when a customer replies “{ctaLabel || 'Ask Anything'}”. For a real button, add a
              quick-reply button to the template and let Meta approve it.
            </div>
          ) : matching ? (
            <InfoAlert>Customers tap <strong>{matching}</strong> on this template to start the chat.</InfoAlert>
          ) : (
            <div style={{ padding: '11px 14px', borderRadius: 8, background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.25)', fontSize: 12.5, color: '#fbbf24', lineHeight: 1.55 }}>
              This template's quick-reply button reads “{quickReplies[0]}” — that is the button customers see,
              and tapping it starts the agent. Match the CTA label to it, or leave it: typing
              “{ctaLabel}” works too.
            </div>
          )}

          <InfoAlert>
            The agent answers from the exact message this campaign sends plus its own knowledge base, and is
            told never to invent prices, dates or terms that aren't in either.
          </InfoAlert>
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Btn onClick={onNext} disabled={enabled && (!agentId || !ctaLabel.trim())}>Save &amp; Next</Btn>
      </div>
    </div>
  );
};

// ─── Step 6 · Reply Flows ───────────────────────────────────────────────────
const StepReplyFlows = ({ initial, onSaved }) => {
  const [rules, setRules] = useState(initial && initial.length ? initial : DEFAULT_RULES);
  const [saved, setSaved] = useState(false);

  const update = (id, key, val) => setRules(prev => prev.map(r => r.id === id ? { ...r, [key]: val } : r));
  const remove = id => setRules(prev => prev.filter(r => r.id !== id));
  const move = (idx, dir) => {
    const arr = [...rules]; const to = idx + dir;
    if (to < 0 || to >= arr.length) return;
    [arr[idx], arr[to]] = [arr[to], arr[idx]];
    setRules(arr);
  };
  const addRule = () => setRules(prev => [...prev, { id: `r${Date.now()}`, enabled: true, triggerType: 'contains', keyword: '', actionType: 'reply', replyText: '' }]);

  const actionColor = { reply: 'var(--green)', assign: '#9d6bff', optout: '#f87171' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {rules.map((rule, idx) => (
        <div key={rule.id} style={{ padding: '14px 16px', borderRadius: '10px', border: `1px solid ${rule.enabled ? 'var(--bd)' : 'rgba(255,255,255,0.05)'}`, background: 'rgba(255,255,255,0.02)', opacity: rule.enabled ? 1 : 0.55, transition: 'all .15s' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <div style={{ paddingTop: '1px' }}>
              <Toggle on={rule.enabled} onToggle={() => update(rule.id, 'enabled', !rule.enabled)} />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Trigger</label>
                  <select value={rule.triggerType} onChange={e => update(rule.id, 'triggerType', e.target.value)}
                    style={{ padding: '6px 10px', borderRadius: '7px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '12px', fontFamily: "'Manrope',sans-serif", outline: 'none', minWidth: '120px' }}>
                    <option value="contains">Contains</option>
                    <option value="exact">Exact match</option>
                    <option value="any">Any message</option>
                  </select>
                </div>
                {rule.triggerType !== 'any' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 100px' }}>
                    <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Keyword</label>
                    <input value={rule.keyword} onChange={e => update(rule.id, 'keyword', e.target.value)} placeholder="e.g. STOP"
                      style={{ padding: '6px 10px', borderRadius: '7px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '12px', fontFamily: "'Manrope',sans-serif", outline: 'none' }} />
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Action</label>
                  <select value={rule.actionType} onChange={e => update(rule.id, 'actionType', e.target.value)}
                    style={{ padding: '6px 10px', borderRadius: '7px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--bd)', color: actionColor[rule.actionType] || 'var(--t1)', fontSize: '12px', fontFamily: "'Manrope',sans-serif", outline: 'none', minWidth: '140px', fontWeight: 600 }}>
                    <option value="reply">Reply</option>
                    <option value="assign">Assign to agent</option>
                    <option value="optout">Opt-out</option>
                  </select>
                </div>
              </div>
              {rule.actionType === 'reply' && (
                <textarea value={rule.replyText} onChange={e => update(rule.id, 'replyText', e.target.value)} placeholder="Enter auto-reply message…"
                  style={{ width: '100%', minHeight: '60px', padding: '8px 10px', borderRadius: '7px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '12px', fontFamily: "'Manrope',sans-serif", outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5 }} />
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingTop: '1px' }}>
              <ArrowBtn dir="up"   onClick={() => move(idx, -1)} disabled={idx === 0} />
              <ArrowBtn dir="down" onClick={() => move(idx,  1)} disabled={idx === rules.length - 1} />
              <button onClick={() => remove(rule.id)} style={{ width: '26px', height: '26px', borderRadius: '6px', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f87171' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3,6 5,6 21,6"/>
                  <path d="M19,6l-1,14H6L5,6M10,11v6M14,11v6M9,6V4h6v2"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '4px' }}>
        <Btn variant="outline" onClick={addRule}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Rule
        </Btn>
        <Btn onClick={() => { onSaved?.(rules); setSaved(true); setTimeout(() => setSaved(false), 1800); }}>
          {saved ? 'Saved ✓' : 'Save Flow'}
        </Btn>
      </div>
    </div>
  );
};

// ─── Step 7 · Retries ───────────────────────────────────────────────────
const TpPicker = ({ label, h, m, ap, onH, onM, onAp }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
    <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>{label}</label>
    <div style={{ display: 'flex', gap: '5px' }}>
      {[{ v: h, fn: onH, opts: Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')), w: 58 },
        { v: m, fn: onM, opts: ['00', '15', '30', '45'], w: 58 },
        { v: ap, fn: onAp, opts: ['AM', 'PM'], w: 58 }].map((s, i) => (
        <select key={i} value={s.v} onChange={e => s.fn(e.target.value)}
          style={{ width: `${s.w}px`, padding: '6px 6px', borderRadius: '7px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '12px', fontFamily: "'Manrope',sans-serif", outline: 'none' }}>
          {s.opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ))}
    </div>
  </div>
);

const parseTimeSplit = (str, defH, defM, defAp) => {
  if (!str) return [defH, defM, defAp];
  const parts = String(str).split(' ');
  const time = (parts[0] || '').split(':');
  return [time[0] || defH, time[1] || defM, parts[1] || defAp];
};

const StepRetries = ({ initial = null, onRetryToggle, onSaved, onCommit }) => {
  const [active, setActive]   = useState(initial?.active ?? false);
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');
  const [pattern, setPattern] = useState(initial?.pattern ?? 'smart');
  const [initSH, initSM, initSAp] = parseTimeSplit(initial?.noRetryStart, '09', '00', 'PM');
  const [initEH, initEM, initEAp] = parseTimeSplit(initial?.noRetryEnd, '06', '00', 'AM');
  const [sH, setSH] = useState(initSH); const [sM, setSM] = useState(initSM); const [sAp, setSAp] = useState(initSAp);
  const [eH, setEH] = useState(initEH); const [eM, setEM] = useState(initEM); const [eAp, setEAp] = useState(initEAp);
  const [saved, setSaved] = useState(false);

  const toggle = (v) => { setActive(v); onRetryToggle?.(v); };
  const buildConfig = () => ({ active, endDate, pattern, noRetryStart: `${sH}:${sM} ${sAp}`, noRetryEnd: `${eH}:${eM} ${eAp}` });

  // The config used to reach the parent only on "Save Retry Config". Turning
  // retries on and moving to the next step therefore launched the campaign
  // with retryConfig: null, and handleRecipientFailure() marked every
  // retryable failure permanent instead of scheduling a retry — while Step 8
  // still disabled fallbacks because `retriesActive` tracks the toggle
  // separately. Lifting every change keeps the launch payload honest; the
  // button stays purely as confirmation.
  useEffect(() => {
    onSaved?.(buildConfig());
  }, [active, endDate, pattern, sH, sM, sAp, eH, eM, eAp]);

  const commit = () => {
    onSaved?.(buildConfig());
    onCommit?.();
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ paddingTop: '2px' }}>
          <Toggle on={active} onToggle={() => toggle(!active)} />
        </div>
        <div>
          <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--t1)', marginBottom: '3px' }}>Activate Retries</p>
          <p style={{ fontSize: '12px', color: 'var(--t2)' }}>Automatically retry undelivered messages</p>
        </div>
      </div>
      {active && (
        <>
          <div>
            <SLabel>Retry End Date</SLabel>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              style={{ padding: '9px 13px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '13px', fontFamily: "'Manrope',sans-serif", outline: 'none', colorScheme: 'dark' }} />
          </div>
          <div>
            <SLabel>Retry Pattern</SLabel>
            <div style={{ display: 'flex', gap: '10px' }}>
              <TypeBtn label="Smart Retries" sub="Variable intervals (1h, 2.5h, 4.8h…)" selected={pattern === 'smart'} onClick={() => setPattern('smart')} />
              <TypeBtn label="24 Hourly Retries" sub="Every hour for 24 hours" selected={pattern === 'hourly'} onClick={() => setPattern('hourly')} />
            </div>
          </div>
          <div>
            <SLabel>No-Retry Window</SLabel>
            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
              <TpPicker label="Start" h={sH} m={sM} ap={sAp} onH={setSH} onM={setSM} onAp={setSAp} />
              <TpPicker label="End"   h={eH} m={eM} ap={eAp} onH={setEH} onM={setEM} onAp={setEAp} />
            </div>
          </div>
          {pattern === 'smart' && (
            <div style={{ ...card, overflow: 'hidden' }}>
              <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--bd)' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Smart Retry Schedule</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--bd)' }}>
                    {['Attempt', 'Delay', 'Cumulative from send'].map(h => (
                      <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: '10px', fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.07em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SMART_SCHEDULE.map((row, i) => (
                    <tr key={i} style={{ borderBottom: i < SMART_SCHEDULE.length - 1 ? '1px solid var(--bd)' : 'none' }}>
                      <td style={{ padding: '8px 14px', fontSize: '12px', color: 'var(--t2)', fontWeight: 600 }}>#{row.attempt}</td>
                      <td style={{ padding: '8px 14px', fontSize: '13px', color: 'var(--green)', fontWeight: 700 }}>{row.delay}</td>
                      <td style={{ padding: '8px 14px', fontSize: '12px', color: 'var(--t2)' }}>{row.cumulative}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <InfoAlert>A message is only charged once, however many attempts it takes. Every failure that could succeed later — frequency capping, rate limits, timeouts, transient Meta errors — is retried on this schedule. Failures that can never succeed (an invalid number, a blocked recipient, a rejected template) are marked Failed straight away and never retried.</InfoAlert>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Btn onClick={commit}>{saved ? 'Saved ✓' : 'Save Retry Config'}</Btn>
      </div>
    </div>
  );
};

// ─── Step 8 · Conversion Tracking ───────────────────────────────────────────────────
const CBox = ({ checked, onToggle, label }) => (
  <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
    <div style={{ width: '18px', height: '18px', borderRadius: '5px', border: `1.5px solid ${checked ? 'var(--green)' : 'var(--bd)'}`, background: checked ? 'var(--green)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s', flexShrink: 0 }}>
      {checked && <I n="check" s={11} c="#08090c" w={3} />}
    </div>
    <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--t1)' }}>{label}</span>
  </div>
);

const StepTracking = ({ onSaved }) => {
  const [utmOn, setUtmOn]   = useState(false);
  const [evtOn, setEvtOn]   = useState(false);
  const [utm, setUtm]       = useState({ source: '', medium: '', campaign: '', content: '', term: '' });
  const [evtName, setEvtName] = useState('');
  const [saved, setSaved] = useState(false);

  const commit = () => {
    onSaved?.({ utmEnabled: utmOn, utm, eventsEnabled: evtOn, eventName: evtName });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  };

  const utmFields = [
    { k: 'source',   label: 'utm_source',   req: true },
    { k: 'medium',   label: 'utm_medium',   req: true },
    { k: 'campaign', label: 'utm_campaign', req: true },
    { k: 'content',  label: 'utm_content',  req: false },
    { k: 'term',     label: 'utm_term',     req: false },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
      <div>
        <CBox checked={utmOn} onToggle={() => setUtmOn(!utmOn)} label="Via UTM Parameters" />
        {utmOn && (
          <div style={{ marginTop: '14px', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px' }}>
            {utmFields.map(f => (
              <div key={f.k} style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--t2)', letterSpacing: '.04em' }}>
                  {f.label} {f.req && <span style={{ color: '#f87171' }}>*</span>}
                </label>
                <input value={utm[f.k]} onChange={e => setUtm(p => ({ ...p, [f.k]: e.target.value }))} placeholder={f.label}
                  style={{ padding: '8px 10px', borderRadius: '7px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '12px', fontFamily: "'Manrope',sans-serif", outline: 'none' }} />
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ borderTop: '1px solid var(--bd)', paddingTop: '18px' }}>
        <CBox checked={evtOn} onToggle={() => setEvtOn(!evtOn)} label="Via Custom Events" />
        {evtOn && (
          <div style={{ marginTop: '12px' }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--t2)', letterSpacing: '.04em', display: 'block', marginBottom: '6px' }}>Conversion Event Name</label>
            <input value={evtName} onChange={e => setEvtName(e.target.value)} placeholder="e.g. purchase, signup"
              style={{ width: '256px', padding: '9px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '13px', fontFamily: "'Manrope',sans-serif", outline: 'none' }} />
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Btn onClick={commit}>{saved ? 'Saved ✓' : 'Save Tracking'}</Btn>
      </div>
    </div>
  );
};

// ─── Step 9 · Fallback Channels ───────────────────────────────────────────────────
const StepFallback = ({ retriesActive, onSaved }) => {
  const [caps, setCaps]       = useState({ sms: false, email: false });
  const [smsEnabled, setSmsEnabled]     = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [smsFrom, setSmsFrom]     = useState('');
  const [smsText, setSmsText]     = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailText, setEmailText] = useState('');
  const [saved, setSaved] = useState(false);
  const canEnable = !retriesActive;

  useEffect(() => {
    wFetch('/campaigns/fallback-capabilities').then(r => r.ok ? r.json() : null).then(d => { if (d) setCaps(d); }).catch(() => {});
  }, []);

  const commit = () => {
    onSaved?.({
      smsEnabled: smsEnabled && caps.sms, smsFrom, smsText,
      emailEnabled: emailEnabled && caps.email, emailSubject, emailText,
    });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  };

  const fieldStyle = { width: '100%', padding: '9px 12px', borderRadius: 7, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 13, fontFamily: "'Manrope',sans-serif", outline: 'none', boxSizing: 'border-box' };

  const ChannelCard = ({ id, label, icon, enabled, setEnabled, supported, children }) => (
    <div style={{ padding: '14px 16px', borderRadius: '10px', border: `1px solid ${enabled ? 'var(--green)' : 'var(--bd)'}`, background: 'rgba(255,255,255,0.01)', opacity: supported ? 1 : 0.45 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: enabled ? '14px' : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <I n={icon} s={16} c={enabled ? 'var(--green)' : 'var(--t2)'} />
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--t1)' }}>{label}</span>
          {!supported && <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>Not Configured</span>}
        </div>
        {supported && <Toggle on={enabled} onToggle={() => setEnabled(!enabled)} />}
      </div>
      {enabled && children}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {!canEnable && (
        <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171', fontSize: '12.5px', lineHeight: 1.5 }}>
          Fallback channels cannot be enabled when Retries are active. Disable Retries in Step 6 to configure Fallbacks.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', opacity: canEnable ? 1 : 0.5, pointerEvents: canEnable ? 'auto' : 'none' }}>
        <ChannelCard id="sms" label="SMS Fallback" icon="phone" enabled={smsEnabled} setEnabled={setSmsEnabled} supported={caps.sms}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--t2)', display: 'block', marginBottom: '5px' }}>Sender Number</label>
              <input value={smsFrom} onChange={e => setSmsFrom(e.target.value)} placeholder="e.g. +14155552671" style={fieldStyle} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--t2)', display: 'block', marginBottom: '5px' }}>SMS Message Text</label>
              <textarea value={smsText} onChange={e => setSmsText(e.target.value)} placeholder="Hello {{1}}..." style={{ ...fieldStyle, minHeight: '60px', resize: 'vertical' }} />
            </div>
          </div>
        </ChannelCard>

        <ChannelCard id="email" label="Email Fallback" icon="globe" enabled={emailEnabled} setEnabled={setEmailEnabled} supported={caps.email}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--t2)', display: 'block', marginBottom: '5px' }}>Email Subject</label>
              <input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="Important Update" style={fieldStyle} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--t2)', display: 'block', marginBottom: '5px' }}>Email Body</label>
              <textarea value={emailText} onChange={e => setEmailText(e.target.value)} placeholder="Hi {{1}}..." style={{ ...fieldStyle, minHeight: '60px', resize: 'vertical' }} />
            </div>
          </div>
        </ChannelCard>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
        <Btn onClick={commit} disabled={!canEnable}>{saved ? 'Saved ✓' : 'Save Fallback Config'}</Btn>
      </div>
    </div>
  );
};

// ─── Phone Preview ─────────────────────────────────────────────
const PhonePreview = ({ template, templateBody, ctaLabel = '' }) => {
  const [businessName, setBusinessName] = useState('Spandan');
  const [headerPreview, setHeaderPreview] = useState(null);
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      if (u.workspaceName) setBusinessName(u.workspaceName);
    } catch {}
  }, []);

  useEffect(() => {
    setHeaderPreview(null);
    if (!template) return;

    const headerComp = Array.isArray(template.components)
      ? template.components.find(c => (c.type || '').toUpperCase() === 'HEADER')
      : null;
    
    if (headerComp?.format !== 'IMAGE') return;

    if (template.headerAssetId) {
      let active = true;
      let objectUrl = null;
      wFetch(`/templates/media/${template.headerAssetId}`)
        .then(res => res.ok ? res.blob() : null)
        .then(blob => {
          if (active && blob) {
            objectUrl = URL.createObjectURL(blob);
            setHeaderPreview(objectUrl);
          } else if (active) {
            setHeaderPreview('placeholder');
          }
        })
        .catch(() => {
          if (active) setHeaderPreview('placeholder');
        });
      return () => {
        active = false;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    } else {
      const exampleUrl = headerComp?.example?.header_url?.[0] || headerComp?.example?.header_handle?.[0];
      if (exampleUrl && typeof exampleUrl === 'string' && exampleUrl.startsWith('http')) {
        setHeaderPreview(exampleUrl);
      } else {
        setHeaderPreview('placeholder');
      }
    }
  }, [template]);

  const headerComp = template && Array.isArray(template?.components)
    ? template.components.find(c => (c.type || '').toUpperCase() === 'HEADER')
    : null;
  const isImageHeader = headerComp?.format === 'IMAGE';

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '250px', borderRadius: '28px', border: '8px solid #2d3748', background: '#e2e8f0', overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,0.5)', position: 'relative' }}>
        {/* Notch */}
        <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '100px', height: '14px', background: '#2d3748', borderRadius: '0 0 10px 10px', zIndex: 5 }} />
        {/* Status Bar */}
        <div style={{ height: '22px', background: '#075E54', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', fontSize: '9px', fontWeight: 700, color: 'white', paddingTop: '4px' }}>
          <span>9:41</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <span>5G</span>
            <span>100%</span>
          </div>
        </div>
        {/* WA Header */}
        <div style={{ background: '#075E54', padding: '6px 12px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1C4.13 1 1 4.13 1 8c0 1.29.35 2.5.96 3.54L1 15l3.46-.96A7 7 0 1 0 8 1z" fill="white" /></svg>
          </div>
          <div>
            <p style={{ fontSize: '12px', fontWeight: 700, color: 'white', lineHeight: 1.1 }}>{businessName}</p>
            <p style={{ fontSize: '9px', color: 'rgba(255,255,255,0.65)' }}>Business Account</p>
          </div>
        </div>
        {/* Chat area */}
        <div style={{ background: '#ECE5DD', minHeight: '220px', padding: '10px 8px', borderRadius: '0 0 22px 22px', backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' opacity='0.04'%3E%3Cpath d='M0 0L40 0L40 40L0 40Z' fill='%23000'/%3E%3C/svg%3E\")" }}>
          {(templateBody || isImageHeader) ? (
            <div style={{ maxWidth: '88%', display: 'inline-block' }}>
              <div style={{ background: 'white', borderRadius: '0 8px 8px 8px', padding: '8px 10px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                {isImageHeader && (
                  <div style={{ marginBottom: 8, borderRadius: 6, overflow: 'hidden', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: (headerPreview && headerPreview !== 'placeholder') ? 'auto' : 120 }}>
                    {headerPreview === 'placeholder' ? (
                      <span style={{ fontSize: 12, color: '#888', padding: 20 }}>Image header</span>
                    ) : headerPreview ? (
                      <img src={headerPreview} alt="Header" style={{ width: '100%', display: 'block' }} />
                    ) : (
                      <span style={{ fontSize: 11, color: '#999', padding: 20 }}>Loading image…</span>
                    )}
                  </div>
                )}
                {templateBody && (
                  <p style={{ fontSize: '11px', color: '#111', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'system-ui, -apple-system, sans-serif', margin: 0 }}>{templateBody}</p>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '3px', marginTop: '4px' }}>
                  <span style={{ fontSize: '9px', color: '#9CA3AF' }}>{now}</span>
                  <svg width="13" height="9" viewBox="0 0 18 12" fill="none">
                    <path d="M1 6l4 4L17 1" stroke="#53bdeb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M6 6l4 4L17 1" stroke="#53bdeb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>
              {/* The AI Agent CTA, drawn the way WhatsApp renders a quick-reply
                  button: attached under the bubble, full width, its own tile. */}
              {ctaLabel.trim() && (
                <div style={{ marginTop: '2px', background: 'white', borderRadius: '8px', padding: '7px 8px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#00A5F4" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                  </svg>
                  <span style={{ fontSize: '11px', fontWeight: 500, color: '#00A5F4', fontFamily: 'system-ui, -apple-system, sans-serif' }}>{ctaLabel}</span>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '180px' }}>
              <div style={{ textAlign: 'center', background: 'rgba(0,0,0,0.05)', borderRadius: '12px', padding: '14px 18px' }}>
                <p style={{ fontSize: '11px', color: '#777', fontFamily: 'system-ui, sans-serif', lineHeight: 1.4 }}>Select a template<br/>to preview</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Top Bar ───────────────────────────────────────────────────
// The step rail from the design set's mobile builder: one segment per step,
// filled as far as the user has got. It is the whole progress indicator on a
// phone, where the accordion's own step numbers are below the fold.
const StepRail = ({ steps, current }) => (
  <div style={{ display: 'flex', gap: 4, padding: '0 14px 10px', flexShrink: 0, background: 'var(--surf)' }}>
    {steps.map((s, i) => (
      <span key={s.n} style={{
        flex: 1, height: 3, borderRadius: 3,
        background: s.done ? 'var(--accent)' : i === current ? 'rgba(53,232,242,0.45)' : 'rgba(255,255,255,0.12)',
        transition: 'background .2s ease',
      }} />
    ))}
  </div>
);

const TopBar = ({ campaignName, setCampaignName, canLaunch, onSaveDraft, onGoLive, onBack, launching, savingDraft, editing, mobile, stepLabel }) => (
  mobile ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--bd)', flexShrink: 0, background: 'var(--surf)' }}>
      <button onClick={onBack} aria-label="Back to campaigns"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)', display: 'flex', padding: 0, flexShrink: 0 }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15,18 9,12 15,6"/></svg>
      </button>
      <input value={campaignName} onChange={e => setCampaignName(e.target.value)} placeholder="New campaign"
        style={{ flex: 1, minWidth: 0, padding: '7px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 14, fontFamily: "'Manrope',sans-serif", fontWeight: 600, outline: 'none' }} />
      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)', flexShrink: 0, whiteSpace: 'nowrap' }}>{stepLabel}</span>
    </div>
  ) : (
  <div style={{ height: '58px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 24px', gap: '12px', flexShrink: 0, background: 'var(--surf)' }}>
    <button onClick={onBack}
      style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--bd)', color: 'var(--t2)', fontSize: '13px', fontFamily: "'Manrope',sans-serif", cursor: 'pointer', transition: 'all .15s', fontWeight: 500 }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15,18 9,12 15,6"/></svg>
      Campaigns
    </button>
    <div style={{ width: '1px', height: '24px', background: 'var(--bd)' }} />
    {editing && (
      <span style={{ padding: '3px 9px', borderRadius: 8, fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bd)', color: 'var(--t2)', textTransform: 'uppercase' }}>
        Editing draft
      </span>
    )}
    <input value={campaignName} onChange={e => setCampaignName(e.target.value)} placeholder="Enter Campaign Name"
      style={{ width: '280px', padding: '8px 13px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '14px', fontFamily: "'Manrope',sans-serif", fontWeight: 500, outline: 'none', transition: 'border-color .15s' }}
      onFocus={e => e.target.style.borderColor = 'var(--gbd)'}
      onBlur={e => e.target.style.borderColor = 'var(--bd)'} />
    <div style={{ flex: 1 }} />
    <Btn variant="outline" onClick={onSaveDraft} disabled={savingDraft}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/>
      </svg>
      {savingDraft ? 'Saving…' : editing ? 'Save Draft' : 'Save as Draft'}
    </Btn>
    <Btn onClick={onGoLive} disabled={!canLaunch || launching} style={{ boxShadow: canLaunch && !launching ? 'var(--glow)' : 'none' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
        <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11A22.35 22.35 0 0 1 12 15z"/>
      </svg>
      Go Live
    </Btn>
  </div>
  )
);

// ─── Main export ───────────────────────────────────────────────
// A stored ISO timestamp, in the shape <input type="datetime-local"> wants —
// local time, no zone, no seconds. new Date().toISOString() is UTC and would
// silently shift a saved schedule by the user's offset on every reopen.
const toLocalInput = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * The campaign wizard, for a new campaign or an existing draft.
 *
 * `campaignId` switches it into edit mode: the draft is loaded, every step is
 * pre-filled from what was saved, and saving updates that campaign instead of
 * creating another one. Without it the wizard behaves exactly as before.
 *
 * Opening a draft never sends anything — loading only reads, and the launch
 * path is still the explicit "Go Live" action at the end of step 4.
 */
export default function CreateCampaign({ onBack, campaignId = null }) {
  // The campaign being edited. Set from the prop when reopening a draft, and
  // also set after the first "Save Draft" of a new campaign — which is what
  // stops a second click creating a duplicate.
  const [draftId, setDraftId]                 = useState(campaignId);
  const [loadingDraft, setLoadingDraft]       = useState(!!campaignId);
  const [draftError, setDraftError]           = useState('');
  const [campaignName, setCampaignName]       = useState('');
  const [campaignType, setCampaignType]       = useState('onetime');
  const [selectedNumberId, setSelectedNumberId] = useState(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [templateBody, setTemplateBody]       = useState('');
  const [audienceMethod, setAudienceMethod]   = useState('list');
  const [selectedContactIds, setSelectedContactIds] = useState(new Set());
  const [scheduleType, setScheduleType]       = useState('immediately');
  const [scheduledAt, setScheduledAt]         = useState(null);
  const [step1Done, setStep1Done]             = useState(false);
  const [step2Done, setStep2Done]             = useState(false);
  const [step3Done, setStep3Done]             = useState(false);
  const [step4Done, setStep4Done]             = useState(false);
  // Steps 5-9 are optional, so they have no gate to advance past — but saving
  // one still has to look like it worked. They used to be hardcoded `done:
  // false`, so their circle never filled in and a saved step was
  // indistinguishable from an untouched one.
  const [savedSteps, setSavedSteps]           = useState({});
  const markStepSaved = useCallback((n) => setSavedSteps((s) => (s[n] ? s : { ...s, [n]: true })), []);
  const [openStep, setOpenStep]               = useState(0);
  // null until the sender picks one. Campaigns created before this step existed
  // have no goal, and defaulting one would misreport what they chose.
  const [goal, setGoal]                       = useState(null);
  const [retriesActive, setRetriesActive]     = useState(false);
  const [launching, setLaunching]             = useState(false);
  const [launchError, setLaunchError]         = useState('');
  const [savingDraft, setSavingDraft]         = useState(false);
  // Campaign AI Agent (step 5) — sent with the campaign so the CTA on the
  // delivered message opens a chat with the selected agent.
  const [aiAgentEnabled, setAiAgentEnabled]   = useState(false);
  const [aiAgentId, setAiAgentId]             = useState(null);
  const [aiCtaLabel, setAiCtaLabel]           = useState('Ask Anything');
  const [agents, setAgents]                   = useState([]);
  // Advanced wizard config (steps 6-9) — persisted to the campaign on launch.
  const [replyRules, setReplyRules]           = useState(null);
  const [retryConfig, setRetryConfig]         = useState(null);
  const [trackingConfig, setTrackingConfig]   = useState(null);
  const [fallbackConfig, setFallbackConfig]   = useState(null);

  const [numbers, setNumbers]     = useState([]);
  const [templates, setTemplates] = useState([]);
  const [contacts, setContacts]   = useState([]);
  // Server-priced campaign summary: valid/duplicate/blocked/invalid counts,
  // cost per message, total cost, and the wallet before and after.
  const [estimate, setEstimate]         = useState(null);
  const [estimating, setEstimating]     = useState(false);
  const [estimateError, setEstimateError] = useState('');

  const reloadContacts = () => {
    wFetch('/contacts').then(r=>r.ok&&r.json()).then(d=>{ const list=Array.isArray(d)?d:d?.data; if(Array.isArray(list)) setContacts(list); }).catch(()=>{});
  };

  useEffect(() => {
    wFetch('/whatsapp/numbers').then(r=>r.ok&&r.json()).then(d=>{ if(Array.isArray(d)) setNumbers(d); }).catch(()=>{});
    wFetch('/templates').then(r=>r.ok&&r.json()).then(d=>{ if(Array.isArray(d)) setTemplates(d.filter(t=>t.status==='APPROVED'||t.status==='Approved')); }).catch(()=>{});
    // Deployed agents the campaign can be pointed at. One deployed agent is
    // preselected so enabling the step is a single click.
    wFetch('/ai-agent/agents').then(r=>r.ok&&r.json()).then(d=>{
      if (!Array.isArray(d)) return;
      setAgents(d);
      const live = d.filter(a => a.deployed);
      if (live.length === 1) setAiAgentId(live[0].id);
    }).catch(()=>{});
    reloadContacts();
  }, []);

  // Load the draft being edited. Runs once per campaignId, before the user
  // can touch anything, so nothing it sets can overwrite a live edit.
  useEffect(() => {
    if (!campaignId) return undefined;
    let cancelled = false;
    setLoadingDraft(true);
    setDraftError('');

    wFetch(`/campaigns/${campaignId}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `Could not load this campaign (${r.status})`);
        return data;
      })
      .then((c) => {
        if (cancelled) return;
        if (c.status !== 'DRAFT') {
          // Anything already launched is a report, not a form. Editing one
          // would imply changes that cannot reach messages already sent.
          throw new Error(`This campaign is ${String(c.status).toLowerCase()} and can no longer be edited.`);
        }

        // "Untitled Draft" is the placeholder the save path substitutes for an
        // empty name; showing it back as if the user typed it would make them
        // delete it before naming the campaign properly.
        setCampaignName(c.name === 'Untitled Draft' ? '' : (c.name || ''));
        setSelectedNumberId(c.waNumberId || null);
        setSelectedTemplateId(c.templateId || null);
        setTemplateBody(getBodyText(c.template?.components) || '');
        setSelectedContactIds(new Set(c.recipientContactIds || []));

        if (c.scheduledAt) {
          setScheduleType('custom');
          setScheduledAt(toLocalInput(c.scheduledAt));
        }

        setReplyRules(c.replyRules ?? null);
        setGoal(c.goal ?? null);
        setRetryConfig(c.retryConfig ?? null);
        setTrackingConfig(c.trackingConfig ?? null);
        setFallbackConfig(c.fallbackConfig ?? null);
        setRetriesActive(!!c.retryConfig?.enabled);

        if (c.aiAgentEnabled) {
          setAiAgentEnabled(true);
          setAiAgentId(c.aiAgentId || null);
          setAiCtaLabel(c.aiAgentCtaLabel || 'Ask Anything');
        }

        // Steps gate each other, so a reopened draft has to arrive with the
        // ones its data already satisfies unlocked — otherwise everything past
        // step 1 is greyed out and the draft is no more editable than before.
        const hasNumber = !!c.waNumberId;
        const hasTemplate = !!c.templateId;
        const hasAudience = (c.recipientContactIds || []).length > 0;
        setStep1Done(hasNumber);
        setStep2Done(hasNumber && hasTemplate);
        setStep3Done(hasNumber && hasTemplate && hasAudience);
        setStep4Done(hasNumber && hasTemplate && hasAudience);
        setSavedSteps({
          ...(c.aiAgentEnabled ? { 5: true } : {}),
          ...(c.replyRules ? { 6: true } : {}),
          ...(c.retryConfig ? { 7: true } : {}),
          ...(c.trackingConfig ? { 8: true } : {}),
          ...(c.fallbackConfig ? { 9: true } : {}),
        });
        // Open the first thing still missing, so "Continue" lands where the
        // work actually stopped rather than back at step 1.
        setOpenStep(!hasNumber ? 1 : !hasTemplate ? 2 : !hasAudience ? 3 : 4);
      })
      .catch((e) => { if (!cancelled) setDraftError(e.message || 'Could not load this campaign'); })
      .finally(() => { if (!cancelled) setLoadingDraft(false); });

    return () => { cancelled = true; };
  }, [campaignId]);

  const toggleContact = id => setSelectedContactIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Re-price whenever the audience changes. Debounced because selecting
  // contacts one at a time would otherwise fire a request per click, and
  // guarded by a request id so a slow earlier response can't overwrite a
  // newer one.
  const estimateSeq = useRef(0);
  useEffect(() => {
    const ids = [...selectedContactIds];
    if (ids.length === 0) { setEstimate(null); setEstimateError(''); return undefined; }

    const seq = ++estimateSeq.current;
    setEstimating(true);
    const timer = setTimeout(async () => {
      try {
        // templateId drives per-category pricing (marketing/utility/auth), so
        // the quote matches what the launch will actually charge.
        const res = await wFetch('/campaigns/estimate', { method: 'POST', body: JSON.stringify({ contactIds: ids, templateId: selectedTemplateId }) });
        const data = await res.json().catch(() => ({}));
        if (seq !== estimateSeq.current) return; // a newer selection won
        if (!res.ok) { setEstimateError(data.error || 'Could not calculate the campaign cost'); setEstimate(null); return; }
        setEstimate(data);
        setEstimateError('');
      } catch (e) {
        if (seq === estimateSeq.current) { setEstimateError(e.message || 'Could not calculate the campaign cost'); setEstimate(null); }
      } finally {
        if (seq === estimateSeq.current) setEstimating(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [selectedContactIds, selectedTemplateId]);

  const isLocked = n => {
    if (n === 2) return !step1Done;
    if (n === 3) return !step2Done;
    if (n === 4) return !step3Done;
    return false;
  };

  const toggleStep = n => {
    if (!isLocked(n)) setOpenStep(openStep === n ? null : n);
  };

  const canLaunch = !!(
    campaignName.trim() &&
    selectedNumberId &&
    selectedTemplateId &&
    selectedContactIds.size > 0 &&
    (scheduleType === 'immediately' || scheduledAt)
  );

  // Only sent when the step was actually used — a campaign with the AI Agent
  // off carries `enabled: false` so the server clears any stale link.
  const aiAgentPayload = aiAgentEnabled && aiAgentId
    ? { enabled: true, agentId: aiAgentId, ctaLabel: aiCtaLabel.trim() || 'Ask Anything' }
    : { enabled: false };

  const parseError = async (res, fallback) => {
    try {
      const data = await res.json();
      return data.error || fallback;
    } catch {
      return fallback;
    }
  };

  // Creates the campaign the first time and updates it thereafter, then makes
  // the audience match the current selection exactly. Shared by "Save Draft"
  // and "Go Live" so the two cannot drift into saving different things.
  //
  // Returns the campaign id. Throws on failure; callers surface the message.
  const persistDraft = async () => {
    const body = {
      name: campaignName.trim() || 'Untitled Draft',
      type: campaignType,
      numberId: selectedNumberId,
      templateId: selectedTemplateId,
      replyRules, retryConfig, trackingConfig, fallbackConfig,
      aiAgent: aiAgentPayload,
      goal,
      // Kept on the draft so a schedule survives being saved and reopened.
      // It is only an intention — launchCampaign takes its own copy.
      scheduledAt: scheduleType === 'custom' && scheduledAt ? new Date(scheduledAt).toISOString() : null,
    };

    let id = draftId;
    if (id) {
      const res = await wFetch(`/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await parseError(res, `Could not save changes (${res.status})`));
    } else {
      const res = await wFetch('/campaigns', { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await parseError(res, `Could not save draft (${res.status})`));
      id = (await res.json()).id;
      setDraftId(id);
    }

    // PUT, not POST: the audience has to be able to shrink. POST only adds, so
    // a contact deselected while editing would still be messaged at launch.
    const recRes = await wFetch(`/campaigns/${id}/recipients`, {
      method: 'PUT', body: JSON.stringify({ contactIds: [...selectedContactIds] }),
    });
    if (!recRes.ok) throw new Error(await parseError(recRes, `Could not save the audience (${recRes.status})`));

    return id;
  };

  const handleGoLive = async () => {
    // `launching` also blocks the double-submit that a refresh or an
    // impatient second click would otherwise cause.
    if (!canLaunch || launching) return;
    const nameError = validateMeaningfulText(campaignName, 'Campaign name');
    if (nameError) { setLaunchError(nameError); return; }
    if (estimate && !estimate.sufficientBalance) {
      setLaunchError('Insufficient Wallet Balance. Please recharge your wallet.');
      return;
    }
    setLaunchError('');
    setLaunching(true);
    try {
      // Only send a schedule time when "Schedule for Later" is active —
      // otherwise a previously-picked datetime would silently schedule an
      // "Immediate" launch.
      const effectiveScheduledAt = scheduleType === 'custom' && scheduledAt
        ? new Date(scheduledAt).toISOString()
        : null;

      // Save first, so launching an edited draft sends what is on screen
      // rather than what was last written.
      const id = await persistDraft();

      const launchRes = await wFetch(`/campaigns/${id}/launch`, {
        method: 'POST', body: JSON.stringify({ scheduledAt: effectiveScheduledAt, retryConfig }),
      });
      if (!launchRes.ok) throw new Error(await parseError(launchRes, `Could not launch campaign (${launchRes.status})`));
      const launched = await launchRes.json().catch(() => null);

      // The launch charged the wallet — tell the sidebar, the dashboard and
      // the bell so none of them show a stale balance.
      if (launched?.summary?.walletAfter != null) {
        window.dispatchEvent(new CustomEvent('wallet:balance-updated', { detail: Number(launched.summary.walletAfter) }));
      } else {
        window.dispatchEvent(new CustomEvent('wallet:balance-updated'));
      }
      window.dispatchEvent(new CustomEvent('notifications:refresh'));
      window.dispatchEvent(new CustomEvent('app:data-updated', { detail: { campaigns: true } }));
      onBack?.();
    } catch (err) {
      console.error('[launch campaign]', err);
      setLaunchError(err.message || 'Failed to launch campaign');
    } finally {
      setLaunching(false);
    }
  };

  const handleSaveDraft = async () => {
    if (savingDraft) return; // no duplicate drafts from a double-click
    if (!selectedNumberId || !selectedTemplateId) {
      setLaunchError('Select a WhatsApp number and a template before saving a draft.');
      return;
    }
    if (campaignName.trim()) {
      const nameError = validateMeaningfulText(campaignName, 'Campaign name');
      if (nameError) { setLaunchError(nameError); return; }
    }
    setLaunchError('');
    setSavingDraft(true);
    try {
      await persistDraft();
      window.dispatchEvent(new CustomEvent('app:data-updated', { detail: { campaigns: true } }));
      onBack?.();
    } catch (err) {
      setLaunchError(err.message || 'Failed to save draft');
    } finally {
      setSavingDraft(false);
    }
  };

  const selectedNumber   = numbers.find(n => n.id === selectedNumberId);
  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);

  const summary = {
    campaignName,
    campaignType,
    templateName:  selectedTemplate?.name,
    contactCount:  selectedContactIds.size,
    numberPhone:   selectedNumber?.phoneNumber,
    aiAgent: aiAgentEnabled && aiAgentId
      ? `${agents.find(a => a.id === aiAgentId)?.name || 'Agent'} · “${aiCtaLabel}”`
      : 'Off',
  };

  const mobile = useIsMobile();

  const STEPS = [
    { n: 0, title: 'Goal',                            done: !!goal },
    { n: 1, title: 'Campaign Type & WhatsApp Number', done: step1Done },
    { n: 2, title: 'Message Template',                done: step2Done },
    { n: 3, title: 'Audience',                        done: step3Done },
    { n: 4, title: 'Schedule',                        done: step4Done },
    { n: 5, title: 'AI Agent',                        done: !!savedSteps[5] },
    { n: 6, title: 'Reply Flows',                     done: !!savedSteps[6] },
    { n: 7, title: 'Retries',                         done: !!savedSteps[7] },
    { n: 8, title: 'Conversion Tracking',             done: !!savedSteps[8] },
    { n: 9, title: 'Fallback Channels',               done: !!savedSteps[9] },
    { n: 10, title: 'Review & launch',                done: false },
  ];

  // What the review pane reports. Each one is a warning, never a blocker:
  // anything that actually stops a send already disables Go Live, and a check
  // list that repeats those would just be a second copy of the same rule.
  const reviewChecks = [
    {
      title: goal ? 'Goal set' : 'No goal chosen',
      detail: goal
        ? `${(CAMPAIGN_GOALS.find(g => g.id === goal) || {}).title} — bound into the agent's context.`
        : 'The AI agent will answer without knowing what this campaign is for.',
      ok: !!goal,
    },
    {
      title: selectedTemplate ? 'Template selected' : 'No template selected',
      detail: selectedTemplate
        ? `${selectedTemplate.name}${selectedTemplate.status ? ` · ${String(selectedTemplate.status).toLowerCase()}` : ''}`
        : 'Pick a Meta-approved template in step 2.',
      ok: !!selectedTemplate,
    },
    {
      title: selectedContactIds.size > 0 ? 'Audience selected' : 'No audience selected',
      detail: estimate
        ? `${estimate.validContacts.toLocaleString()} reachable of ${estimate.totalContacts.toLocaleString()} chosen`
        : `${selectedContactIds.size.toLocaleString()} contacts chosen`,
      ok: selectedContactIds.size > 0,
    },
    {
      title: /\{\{\s*\d+\s*\}\}/.test(templateBody || '') ? 'Personalisation active' : 'No personalisation',
      detail: /\{\{\s*\d+\s*\}\}/.test(templateBody || '')
        ? 'The message uses at least one variable.'
        : 'Every recipient gets the identical text.',
      ok: /\{\{\s*\d+\s*\}\}/.test(templateBody || ''),
    },
    {
      title: aiAgentEnabled ? 'Campaign AI attached' : 'Campaign AI off',
      detail: aiAgentEnabled
        ? `Customers can ask about this offer and get grounded answers under “${aiCtaLabel || 'Ask Anything'}”.`
        : 'Customers who reply will not get an answer about this campaign automatically.',
      ok: aiAgentEnabled,
    },
    {
      title: !estimate ? 'Cost not estimated yet'
        : estimate.sufficientBalance ? 'Wallet covers this send'
        : 'Not enough wallet balance',
      detail: estimate
        ? `${inr(estimate.totalCost)} needed · ${inr(estimate.remainingBalance)} left after`
        : 'Choose an audience and a template to price the send.',
      ok: !!estimate && estimate.sufficientBalance,
    },
    {
      title: scheduleType === 'immediately' ? 'Sends immediately' : scheduledAt ? 'Scheduled' : 'No send time set',
      detail: scheduleType === 'immediately'
        ? 'Goes out as soon as you launch.'
        : scheduledAt ? new Date(scheduledAt).toLocaleString('en-IN') : 'Pick a date and time in step 4.',
      ok: scheduleType === 'immediately' || !!scheduledAt,
    },
  ];

  // "Step 4/9" for the phone title bar: the open accordion pane if one is open,
  // otherwise the first step still outstanding — which is where the user is
  // about to go anyway.
  // Position in the list, not the stable `n` — the Goal pane is n=0 and Review
  // is n=10, so numbering by `n` would read "STEP 0 OF 11".
  const currentStepIndex = (() => {
    const byOpen = STEPS.findIndex(st => st.n === openStep);
    if (byOpen !== -1) return byOpen;
    const firstOutstanding = STEPS.findIndex(st => !st.done);
    return firstOutstanding === -1 ? STEPS.length - 1 : firstOutstanding;
  })();

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar
        campaignName={campaignName}
        setCampaignName={setCampaignName}
        canLaunch={canLaunch}
        onSaveDraft={handleSaveDraft}
        onGoLive={handleGoLive}
        onBack={onBack}
        launching={launching}
        savingDraft={savingDraft}
        editing={!!campaignId}
        mobile={mobile}
        stepLabel={`STEP ${currentStepIndex + 1}/${STEPS.length}`}
      />
      {mobile && <StepRail steps={STEPS} current={currentStepIndex} />}

      {/* A draft still loading must not show an empty form — the user would
          start typing into fields that are about to be overwritten. */}
      {loadingDraft ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t2)', fontSize: 13 }}>
          Loading draft…
        </div>
      ) : draftError ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 }}>
          <p style={{ fontSize: 13, color: '#f87171', textAlign: 'center', maxWidth: 420, lineHeight: 1.6 }}>{draftError}</p>
          <Btn variant="outline" onClick={onBack}>Back to Campaigns</Btn>
        </div>
      ) : (
      <div style={{ flex: 1, display: 'flex', flexDirection: mobile ? 'column' : 'row', overflow: mobile ? 'auto' : 'hidden' }}>
        {/* ── accordion ── */}
        <div style={{ flex: 1, overflowY: mobile ? 'visible' : 'auto', padding: mobile ? '14px 14px 4px' : '20px 24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Step 4 already spells out the exact cost against the balance, so
              a healthy banner here would repeat it — only the states that can
              block the launch are shown. */}
          <WalletStatusBanner hideWhenHealthy style={{ marginBottom: 4 }} />
          {launchError && (
            <div style={{ padding: '11px 15px', borderRadius: 9, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <p style={{ fontSize: 12.5, color: '#f87171', lineHeight: 1.5 }}>{launchError}</p>
              <button onClick={() => setLaunchError('')} aria-label="Dismiss"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)', fontSize: 16, lineHeight: 1, flexShrink: 0 }}>×</button>
            </div>
          )}
          {STEPS.map((s, i) => (
            <StepWrap key={s.n} n={s.n} badge={i + 1} title={s.title} done={s.done} open={openStep === s.n} locked={isLocked(s.n)} onToggle={() => toggleStep(s.n)}>
              {s.n === 0 && (
                <GoalStep goal={goal} setGoal={setGoal} onNext={() => setOpenStep(1)} />
              )}
              {s.n === 1 && (
                <Step1
                  campaignType={campaignType} setCampaignType={setCampaignType}
                  numbers={numbers}
                  selectedNumberId={selectedNumberId} setSelectedNumberId={setSelectedNumberId}
                  onNext={() => { setStep1Done(true); setOpenStep(2); }}
                />
              )}
              {s.n === 2 && (
                <Step2
                  templates={selectedNumberId ? templates.filter(t => !t.waNumberId || t.waNumberId === selectedNumberId) : templates}
                  selectedTemplateId={selectedTemplateId} setSelectedTemplateId={setSelectedTemplateId}
                  templateBody={templateBody} setTemplateBody={setTemplateBody}
                  onNext={() => { setStep2Done(true); setOpenStep(3); }}
                />
              )}
              {s.n === 3 && (
                <Step3
                  audienceMethod={audienceMethod} setAudienceMethod={setAudienceMethod}
                  contacts={contacts}
                  selectedContactIds={selectedContactIds} setSelectedContactIds={setSelectedContactIds} toggleContact={toggleContact}
                  onContactsReload={reloadContacts}
                  onNext={() => { setStep3Done(true); setOpenStep(4); }}
                />
              )}
              {s.n === 4 && (
                <Step4
                  scheduleType={scheduleType} setScheduleType={setScheduleType}
                  scheduledAt={scheduledAt}   setScheduledAt={setScheduledAt}
                  summary={summary}
                  estimate={estimate} estimating={estimating} estimateError={estimateError}
                  onLaunch={handleGoLive} launching={launching}
                />
              )}
              {s.n === 5 && (
                <StepAiAgent
                  enabled={aiAgentEnabled} setEnabled={setAiAgentEnabled}
                  agents={agents}
                  agentId={aiAgentId} setAgentId={setAiAgentId}
                  ctaLabel={aiCtaLabel} setCtaLabel={setAiCtaLabel}
                  template={selectedTemplate}
                  onNext={() => { markStepSaved(5); setOpenStep(6); }}
                />
              )}
              {/* Each optional step reports its own save. Retries is the odd
                  one out: it also lifts its config on every change so a launch
                  can't go out with a stale retryConfig, which would tick the
                  step the moment it mounted — hence the separate onCommit. */}
              {s.n === 6 && <StepReplyFlows initial={replyRules} onSaved={(r) => { setReplyRules(r); markStepSaved(6); }} />}
              {s.n === 7 && <StepRetries initial={retryConfig} onRetryToggle={setRetriesActive} onSaved={setRetryConfig} onCommit={() => markStepSaved(7)} />}
              {s.n === 8 && <StepTracking onSaved={(t) => { setTrackingConfig(t); markStepSaved(8); }} />}
              {s.n === 9 && <StepFallback retriesActive={retriesActive} onSaved={(f) => { setFallbackConfig(f); markStepSaved(9); }} />}
              {s.n === 10 && (
                <ReviewPanel
                  checks={reviewChecks}
                  canLaunch={canLaunch}
                  onLaunch={handleGoLive}
                  launching={launching}
                />
              )}
            </StepWrap>
          ))}
          <div style={{ height: '48px' }} />
        </div>

        {/* ── phone preview ──
            On a phone there is no room for a second column, so the preview
            moves under the steps and the whole thing becomes one scroll. */}
        <div style={{ width: mobile ? '100%' : '296px', borderLeft: mobile ? 'none' : '1px solid var(--bd)', borderTop: mobile ? '1px solid var(--bd)' : 'none', padding: mobile ? '18px 14px 28px' : '20px 18px', overflowY: mobile ? 'visible' : 'auto', flexShrink: 0, background: 'rgba(5,8,20,0.5)' }}>
          <p style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: '13px', color: 'var(--t1)', marginBottom: '16px' }}>Message Preview</p>
          <PhonePreview template={selectedTemplate} templateBody={templateBody} ctaLabel={aiAgentEnabled ? aiCtaLabel : ''} />
        </div>
      </div>
      )}

      {/* Sticky action bar. The desktop top bar carries Save Draft and Go Live;
          on a phone they would be off the top of a nine-step scroll, so they
          pin to the bottom where the design set puts the primary action. */}
      {mobile && !loadingDraft && !draftError && (
        <div style={{ flexShrink: 0, display: 'flex', gap: 10, padding: '10px 14px calc(10px + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid var(--bd)', background: 'rgba(6,9,19,0.94)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}>
          <Btn variant="outline" onClick={handleSaveDraft} disabled={savingDraft} style={{ flex: 1, justifyContent: 'center' }}>
            {savingDraft ? 'Saving…' : 'Save draft'}
          </Btn>
          <Btn onClick={handleGoLive} disabled={!canLaunch || launching} style={{ flex: 1.4, justifyContent: 'center', boxShadow: canLaunch && !launching ? 'var(--glow)' : 'none' }}>
            {launching ? 'Launching…' : 'Go Live'}
          </Btn>
        </div>
      )}
    </div>
  );
}
