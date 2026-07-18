import { useState, useEffect, useRef } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';

// Extract body text from Meta components array
const getBodyText = (components) => {
  if (!components) return '';
  const arr = Array.isArray(components) ? components : (typeof components === 'string' ? JSON.parse(components) : []);
  return arr.find(c => c.type === 'BODY' || c.type === 'body')?.text ?? '';
};

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
  MARKETING:      { bg: 'rgba(167,139,250,.12)', bd: 'rgba(167,139,250,.3)',  c: '#c4b5fd' },
  UTILITY:        { bg: 'rgba(14,165,233,.12)',  bd: 'rgba(14,165,233,.3)',   c: '#38bdf8' },
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
  <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(14,165,233,.06)', border: '1px solid rgba(14,165,233,.18)', color: '#38bdf8', fontSize: '12px', lineHeight: 1.55, display: 'flex', gap: '9px', alignItems: 'flex-start' }}>
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
    <div style={{ width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, background: done ? 'var(--green)' : open ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)', border: `1.5px solid ${done ? 'var(--green)' : open ? 'var(--bdm)' : 'var(--bd)'}`, color: done ? '#060913' : 'var(--t2)', transition: 'all .2s' }}>
      {done ? <I n="check" s={13} c="#060913" w={2.5} /> : n}
    </div>
    <div style={{ flex: 1 }}>
      <span style={{ fontSize: '14px', fontWeight: 600, color: open ? 'var(--t1)' : done ? 'var(--t1)' : 'var(--t2)', transition: 'color .15s' }}>{title}</span>
      {n > 4 && <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--t3)', fontWeight: 400 }}>Optional</span>}
    </div>
    <Chev open={open} />
  </div>
);

const StepWrap = ({ n, title, done, open, locked, onToggle, children }) => (
  <div style={{ ...card, overflow: 'visible', flexShrink: 0, transition: 'border-color .2s', borderColor: open ? 'var(--bdm)' : 'var(--bd)' }}>
    <StepHeader n={n} title={title} done={done} open={open} locked={locked} onToggle={onToggle} />
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
                    <I n="check" s={9} c="#060913" w={3} />
                  </div>
                )}
              </div>
              <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: '13px', color: sel ? 'var(--green)' : 'var(--t1)', marginBottom: '3px' }}>{n.phoneNumber}</p>
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
              <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: '14px', color: 'var(--green)', marginBottom: '5px' }}>{selected.name}</p>
              <CatBadge cat={selected.category} />
            </div>
            <Btn variant="ghost" size="sm" onClick={() => { setSelectedTemplateId(null); setTemplateBody(''); }}>Choose Another</Btn>
          </div>
          <div>
            <SLabel>Template Body</SLabel>
            <textarea value={templateBody} onChange={e => setTemplateBody(e.target.value)}
              style={{ width: '100%', minHeight: '110px', padding: '10px 13px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '13px', fontFamily: "'Plus Jakarta Sans',sans-serif", outline: 'none', resize: 'vertical', lineHeight: 1.55, boxSizing: 'border-box', transition: 'border-color .15s' }}
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
const Step3 = ({ audienceMethod, setAudienceMethod, contacts, selectedContactIds, toggleContact, onNext }) => {
  const [search, setSearch]       = useState('');
  const [manualName, setManualName]   = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [csvFile, setCsvFile]     = useState(null);
  const [csvDragging, setCsvDragging] = useState(false);
  const [manualAdded, setManualAdded] = useState([]);
  const fileRef = useRef(null);

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
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--t1)', fontSize: '13px', fontFamily: "'Plus Jakarta Sans',sans-serif" }} />
          </div>
          <div style={{ maxHeight: '260px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {filtered.map(c => {
              const sel = selectedContactIds.has(c.id);
              return (
                <div key={c.id} onClick={() => toggleContact(c.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 12px', borderRadius: '8px', cursor: 'pointer', background: sel ? 'rgba(30,191,94,0.05)' : 'transparent', transition: 'background .12s' }}
                  onMouseEnter={e => { if (!sel) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                  onMouseLeave={e => { if (!sel) e.currentTarget.style.background = sel ? 'rgba(30,191,94,0.05)' : 'transparent'; }}>
                  <div style={{ width: '16px', height: '16px', borderRadius: '4px', border: `1.5px solid ${sel ? 'var(--green)' : 'var(--bd)'}`, background: sel ? 'var(--green)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
                    {sel && <I n="check" s={9} c="#060913" w={3} />}
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
              style={{ flex: 1, padding: '9px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '13px', fontFamily: "'Plus Jakarta Sans',sans-serif", outline: 'none' }} />
            <input value={manualPhone} onChange={e => setManualPhone(e.target.value.replace(/[^0-9+\s]/g, ''))} placeholder="+91 98765 43210"
              style={{ flex: 1, padding: '9px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '13px', fontFamily: "'Plus Jakarta Sans',sans-serif", outline: 'none' }}
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
        <div>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => setCsvFile(e.target.files[0])} />
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setCsvDragging(true); }}
            onDragLeave={() => setCsvDragging(false)}
            onDrop={e => { e.preventDefault(); setCsvDragging(false); const f = e.dataTransfer.files[0]; if (f) setCsvFile(f); }}
            style={{ border: `2px dashed ${csvDragging ? 'var(--green)' : 'var(--bd)'}`, borderRadius: '12px', padding: '36px 20px', textAlign: 'center', cursor: 'pointer', transition: 'all .2s', background: csvDragging ? 'var(--gbg)' : 'rgba(255,255,255,0.01)' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
              <div style={{ width: '46px', height: '46px', borderRadius: '12px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--t2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17,8 12,3 7,8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
            </div>
            {csvFile ? (
              <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--green)' }}>{csvFile.name}</p>
            ) : (
              <>
                <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--t1)', marginBottom: '6px' }}>Drop CSV file here or click to browse</p>
                <p style={{ fontSize: '12px', color: 'var(--t2)' }}>Required columns: <code style={{ color: 'var(--green)', fontFamily: 'monospace' }}>name</code>, <code style={{ color: 'var(--green)', fontFamily: 'monospace' }}>phone</code></p>
              </>
            )}
          </div>
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
const Step4 = ({ scheduleType, setScheduleType, scheduledAt, setScheduledAt, summary, onLaunch }) => {
  const minDate = new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16);
  const ready   = !!(summary.contactCount > 0 && summary.templateName && summary.numberPhone && summary.campaignName);
  const canLaunch = ready && (scheduleType === 'immediately' || !!scheduledAt);

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
            style={{ padding: '9px 13px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '13px', fontFamily: "'Plus Jakarta Sans',sans-serif", outline: 'none', colorScheme: 'dark' }} />
        </div>
      )}
      <div style={{ ...card, padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: '14px', color: 'var(--t1)' }}>Campaign Summary</span>
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
          ].map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: '11px', color: 'var(--t3)', marginBottom: '2px' }}>{k}</div>
              <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--t1)' }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      <Btn onClick={onLaunch} disabled={!canLaunch} style={{ width: '100%', justifyContent: 'center', boxShadow: canLaunch ? 'var(--glow)' : 'none' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
          <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11A22.35 22.35 0 0 1 12 15z"/>
        </svg>
        Launch Campaign
      </Btn>
    </div>
  );
};

// ─── Step 5 ───────────────────────────────────────────────────
const Step5 = ({ initial, onSaved }) => {
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

  const actionColor = { reply: 'var(--green)', assign: '#38bdf8', optout: '#f87171' };

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
                    style={{ padding: '6px 10px', borderRadius: '7px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '12px', fontFamily: "'Plus Jakarta Sans',sans-serif", outline: 'none', minWidth: '120px' }}>
                    <option value="contains">Contains</option>
                    <option value="exact">Exact match</option>
                    <option value="any">Any message</option>
                  </select>
                </div>
                {rule.triggerType !== 'any' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 100px' }}>
                    <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Keyword</label>
                    <input value={rule.keyword} onChange={e => update(rule.id, 'keyword', e.target.value)} placeholder="e.g. STOP"
                      style={{ padding: '6px 10px', borderRadius: '7px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '12px', fontFamily: "'Plus Jakarta Sans',sans-serif", outline: 'none' }} />
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Action</label>
                  <select value={rule.actionType} onChange={e => update(rule.id, 'actionType', e.target.value)}
                    style={{ padding: '6px 10px', borderRadius: '7px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--bd)', color: actionColor[rule.actionType] || 'var(--t1)', fontSize: '12px', fontFamily: "'Plus Jakarta Sans',sans-serif", outline: 'none', minWidth: '140px', fontWeight: 600 }}>
                    <option value="reply">Reply</option>
                    <option value="assign">Assign to agent</option>
                    <option value="optout">Opt-out</option>
                  </select>
                </div>
              </div>
              {rule.actionType === 'reply' && (
                <textarea value={rule.replyText} onChange={e => update(rule.id, 'replyText', e.target.value)} placeholder="Enter auto-reply message…"
                  style={{ width: '100%', minHeight: '60px', padding: '8px 10px', borderRadius: '7px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '12px', fontFamily: "'Plus Jakarta Sans',sans-serif", outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5 }} />
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

// ─── Step 6 ───────────────────────────────────────────────────
const TpPicker = ({ label, h, m, ap, onH, onM, onAp }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
    <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>{label}</label>
    <div style={{ display: 'flex', gap: '5px' }}>
      {[{ v: h, fn: onH, opts: Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')), w: 58 },
        { v: m, fn: onM, opts: ['00', '15', '30', '45'], w: 58 },
        { v: ap, fn: onAp, opts: ['AM', 'PM'], w: 58 }].map((s, i) => (
        <select key={i} value={s.v} onChange={e => s.fn(e.target.value)}
          style={{ width: `${s.w}px`, padding: '6px 6px', borderRadius: '7px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '12px', fontFamily: "'Plus Jakarta Sans',sans-serif", outline: 'none' }}>
          {s.opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ))}
    </div>
  </div>
);

const Step6 = ({ onRetryToggle, onSaved }) => {
  const [active, setActive]   = useState(false);
  const [endDate, setEndDate] = useState('');
  const [pattern, setPattern] = useState('smart');
  const [sH, setSH] = useState('09'); const [sM, setSM] = useState('00'); const [sAp, setSAp] = useState('PM');
  const [eH, setEH] = useState('06'); const [eM, setEM] = useState('00'); const [eAp, setEAp] = useState('AM');
  const [saved, setSaved] = useState(false);

  const toggle = (v) => { setActive(v); onRetryToggle?.(v); };
  const commit = () => {
    onSaved?.({ active, endDate, pattern, noRetryStart: `${sH}:${sM} ${sAp}`, noRetryEnd: `${eH}:${eM} ${eAp}` });
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
              style={{ padding: '9px 13px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '13px', fontFamily: "'Plus Jakarta Sans',sans-serif", outline: 'none', colorScheme: 'dark' }} />
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
      <InfoAlert>Retries are free and only apply to Meta frequency-capping failures. Messages that fail for other reasons will not be retried.</InfoAlert>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Btn onClick={commit}>{saved ? 'Saved ✓' : 'Save Retry Config'}</Btn>
      </div>
    </div>
  );
};

// ─── Step 7 ───────────────────────────────────────────────────
const CBox = ({ checked, onToggle, label }) => (
  <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
    <div style={{ width: '18px', height: '18px', borderRadius: '5px', border: `1.5px solid ${checked ? 'var(--green)' : 'var(--bd)'}`, background: checked ? 'var(--green)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s', flexShrink: 0 }}>
      {checked && <I n="check" s={11} c="#060913" w={3} />}
    </div>
    <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--t1)' }}>{label}</span>
  </div>
);

const Step7 = ({ onSaved }) => {
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
                  style={{ padding: '8px 10px', borderRadius: '7px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '12px', fontFamily: "'Plus Jakarta Sans',sans-serif", outline: 'none' }} />
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
              style={{ width: '256px', padding: '9px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '13px', fontFamily: "'Plus Jakarta Sans',sans-serif", outline: 'none' }} />
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Btn onClick={commit}>{saved ? 'Saved ✓' : 'Save Tracking'}</Btn>
      </div>
    </div>
  );
};

// ─── Step 8 ───────────────────────────────────────────────────
const Step8 = ({ retriesActive, onSaved }) => {
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

  const fieldStyle = { width: '100%', padding: '9px 12px', borderRadius: 7, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif", outline: 'none', boxSizing: 'border-box' };

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
const PhonePreview = ({ templateBody }) => {
  const [businessName, setBusinessName] = useState('ChatFlow Pro');
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      if (u.workspaceName) setBusinessName(u.workspaceName);
    } catch {}
  }, []);

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
          {templateBody ? (
            <div style={{ background: 'white', borderRadius: '0 8px 8px 8px', padding: '8px 10px', maxWidth: '88%', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'inline-block' }}>
              <p style={{ fontSize: '11px', color: '#111', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'system-ui, -apple-system, sans-serif', margin: 0 }}>{templateBody}</p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '3px', marginTop: '4px' }}>
                <span style={{ fontSize: '9px', color: '#9CA3AF' }}>{now}</span>
                <svg width="13" height="9" viewBox="0 0 18 12" fill="none">
                  <path d="M1 6l4 4L17 1" stroke="#53bdeb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M6 6l4 4L17 1" stroke="#53bdeb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
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
const TopBar = ({ campaignName, setCampaignName, canLaunch, onSaveDraft, onGoLive, onBack }) => (
  <div style={{ height: '58px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 24px', gap: '12px', flexShrink: 0, background: 'var(--surf)' }}>
    <button onClick={onBack}
      style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--bd)', color: 'var(--t2)', fontSize: '13px', fontFamily: "'Plus Jakarta Sans',sans-serif", cursor: 'pointer', transition: 'all .15s', fontWeight: 500 }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15,18 9,12 15,6"/></svg>
      Campaigns
    </button>
    <div style={{ width: '1px', height: '24px', background: 'var(--bd)' }} />
    <input value={campaignName} onChange={e => setCampaignName(e.target.value)} placeholder="Enter Campaign Name"
      style={{ width: '280px', padding: '8px 13px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: '14px', fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 500, outline: 'none', transition: 'border-color .15s' }}
      onFocus={e => e.target.style.borderColor = 'var(--gbd)'}
      onBlur={e => e.target.style.borderColor = 'var(--bd)'} />
    <div style={{ flex: 1 }} />
    <Btn variant="outline" onClick={onSaveDraft}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/>
      </svg>
      Save as Draft
    </Btn>
    <Btn onClick={onGoLive} disabled={!canLaunch} style={{ boxShadow: canLaunch ? 'var(--glow)' : 'none' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
        <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11A22.35 22.35 0 0 1 12 15z"/>
      </svg>
      Go Live
    </Btn>
  </div>
);

// ─── Main export ───────────────────────────────────────────────
export default function CreateCampaign({ onBack }) {
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
  const [openStep, setOpenStep]               = useState(1);
  const [retriesActive, setRetriesActive]     = useState(false);
  const [launching, setLaunching]             = useState(false);
  // Advanced wizard config (steps 5-7) — persisted to the campaign on launch.
  const [replyRules, setReplyRules]           = useState(null);
  const [retryConfig, setRetryConfig]         = useState(null);
  const [trackingConfig, setTrackingConfig]   = useState(null);
  const [fallbackConfig, setFallbackConfig]   = useState(null);

  const [numbers, setNumbers]     = useState([]);
  const [templates, setTemplates] = useState([]);
  const [contacts, setContacts]   = useState([]);

  useEffect(() => {
    wFetch('/whatsapp/numbers').then(r=>r.ok&&r.json()).then(d=>{ if(Array.isArray(d)) setNumbers(d); }).catch(()=>{});
    wFetch('/templates').then(r=>r.ok&&r.json()).then(d=>{ if(Array.isArray(d)) setTemplates(d.filter(t=>t.status==='APPROVED'||t.status==='Approved')); }).catch(()=>{});
    wFetch('/contacts').then(r=>r.ok&&r.json()).then(d=>{ const list=Array.isArray(d)?d:d?.data; if(Array.isArray(list)) setContacts(list); }).catch(()=>{});
  }, []);

  const toggleContact = id => setSelectedContactIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

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

  const parseError = async (res, fallback) => {
    try {
      const data = await res.json();
      return data.error || fallback;
    } catch {
      return fallback;
    }
  };

  const handleGoLive = async () => {
    if (!canLaunch || launching) return;
    setLaunching(true);
    try {
      // Only send a schedule time when "Schedule for Later" is active —
      // otherwise a previously-picked datetime would silently schedule an
      // "Immediate" launch.
      const effectiveScheduledAt = scheduleType === 'custom' && scheduledAt
        ? new Date(scheduledAt).toISOString()
        : null;

      const res = await wFetch('/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name: campaignName, type: campaignType, numberId: selectedNumberId, templateId: selectedTemplateId, replyRules, retryConfig, trackingConfig, fallbackConfig }),
      });
      if (!res.ok) throw new Error(await parseError(res, `Could not create campaign (${res.status})`));
      const campaign = await res.json();

      const recRes = await wFetch(`/campaigns/${campaign.id}/recipients`, {
        method: 'POST', body: JSON.stringify({ contactIds: [...selectedContactIds] }),
      });
      if (!recRes.ok) throw new Error(await parseError(recRes, `Could not add recipients (${recRes.status})`));

      const launchRes = await wFetch(`/campaigns/${campaign.id}/launch`, {
        method: 'POST', body: JSON.stringify({ scheduledAt: effectiveScheduledAt }),
      });
      if (!launchRes.ok) throw new Error(await parseError(launchRes, `Could not launch campaign (${launchRes.status})`));
      onBack?.();
    } catch (err) {
      console.error('[launch campaign]', err);
      alert(`Failed to launch campaign: ${err.message}`);
    } finally {
      setLaunching(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!selectedNumberId || !selectedTemplateId) {
      alert('Select a WhatsApp number and a template before saving a draft.');
      return;
    }
    try {
      const res = await wFetch('/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name: campaignName || 'Untitled Draft', type: campaignType, numberId: selectedNumberId, templateId: selectedTemplateId, replyRules, retryConfig, trackingConfig, fallbackConfig }),
      });
      if (!res.ok) throw new Error(await parseError(res, `Could not save draft (${res.status})`));
      const campaign = await res.json();
      if (selectedContactIds.size > 0) {
        await wFetch(`/campaigns/${campaign.id}/recipients`, {
          method: 'POST', body: JSON.stringify({ contactIds: [...selectedContactIds] }),
        }).catch(() => {});
      }
      onBack?.();
    } catch (err) {
      alert(`Failed to save draft: ${err.message}`);
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
  };

  const STEPS = [
    { n: 1, title: 'Campaign Type & WhatsApp Number', done: step1Done },
    { n: 2, title: 'Message Template',                done: step2Done },
    { n: 3, title: 'Audience',                        done: step3Done },
    { n: 4, title: 'Schedule',                        done: step4Done },
    { n: 5, title: 'Reply Flows',                     done: false },
    { n: 6, title: 'Retries',                         done: false },
    { n: 7, title: 'Conversion Tracking',             done: false },
    { n: 8, title: 'Fallback Channels',               done: false },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar
        campaignName={campaignName}
        setCampaignName={setCampaignName}
        canLaunch={canLaunch}
        onSaveDraft={handleSaveDraft}
        onGoLive={handleGoLive}
        onBack={onBack}
      />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* ── accordion ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {STEPS.map(s => (
            <StepWrap key={s.n} n={s.n} title={s.title} done={s.done} open={openStep === s.n} locked={isLocked(s.n)} onToggle={() => toggleStep(s.n)}>
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
                  selectedContactIds={selectedContactIds} toggleContact={toggleContact}
                  onNext={() => { setStep3Done(true); setOpenStep(4); }}
                />
              )}
              {s.n === 4 && (
                <Step4
                  scheduleType={scheduleType} setScheduleType={setScheduleType}
                  scheduledAt={scheduledAt}   setScheduledAt={setScheduledAt}
                  summary={summary}
                  onLaunch={handleGoLive}
                />
              )}
              {s.n === 5 && <Step5 initial={replyRules} onSaved={setReplyRules} />}
              {s.n === 6 && <Step6 onRetryToggle={setRetriesActive} onSaved={setRetryConfig} />}
              {s.n === 7 && <Step7 onSaved={setTrackingConfig} />}
              {s.n === 8 && <Step8 retriesActive={retriesActive} onSaved={setFallbackConfig} />}
            </StepWrap>
          ))}
          <div style={{ height: '48px' }} />
        </div>

        {/* ── phone preview ── */}
        <div style={{ width: '296px', borderLeft: '1px solid var(--bd)', padding: '20px 18px', overflowY: 'auto', flexShrink: 0, background: 'rgba(5,8,20,0.5)' }}>
          <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: '13px', color: 'var(--t1)', marginBottom: '16px' }}>Message Preview</p>
          <PhonePreview templateBody={templateBody} />
        </div>
      </div>
    </div>
  );
}
