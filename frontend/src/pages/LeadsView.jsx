import { useState, useEffect, useCallback } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { Modal } from '../components/Modal.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { FInput, FLabel, FSelect, FTextarea } from '../components/Form.jsx';
import { wFetch } from '../lib/api.js';
import { SavedViews } from '../components/SavedViews.jsx';
import { ImportExport } from '../components/ImportExport.jsx';
import { CustomFieldInputs } from '../components/CustomFields.jsx';
import RelationshipCard from '../components/RelationshipCard.jsx';
import AgentTab from '../components/AgentTab.jsx';
import { LeadDistributionModal } from '../components/LeadDistributionModal.jsx';
import { LogInteractionModal } from '../components/LogInteractionModal.jsx';
import { BulkTaskModal } from '../components/BulkTaskModal.jsx';

const STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED', 'LOST'];
const STAGES = ['QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];

const STATUS_TONE = {
  NEW: 'blue', CONTACTED: 'violet', QUALIFIED: 'green',
  UNQUALIFIED: 'gray', CONVERTED: 'green', LOST: 'red',
};

const PRESETS = [
  { id: 'all', label: 'All Leads' },
  { id: 'my', label: 'My Leads' },
  { id: 'hot', label: 'Hot 🔥' },
  { id: 'warm', label: 'Warm ⚡' },
  { id: 'cold', label: 'Cold ❄️' },
  { id: 'awaiting_task', label: 'Awaiting Task ⏳' },
  { id: 'uncontacted', label: 'Uncontacted 📭' },
];

const pretty = s => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const scoreColor = n => (n >= 70 ? 'var(--green)' : n >= 40 ? '#fbbf24' : 'var(--t2)');
const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const ErrorBanner = ({ children, onDismiss }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 12px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)', color: '#f87171', fontSize: 12.5, marginBottom: 12 }}>
    <span>{children}</span>
    {onDismiss && (
      <button onClick={onDismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
        <I n="x" s={14} c="#f87171" />
      </button>
    )}
  </div>
);

const ScoreChip = ({ score }) => (
  <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor(score), fontVariantNumeric: 'tabular-nums' }}>
    {score}
  </span>
);

const ScoreBreakdown = ({ factors }) => {
  if (!Array.isArray(factors) || factors.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--t3)' }}>No score breakdown yet — recalculate to generate one.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {factors.map(f => {
        const pct = f.maxPoints > 0 ? Math.round((f.points / f.maxPoints) * 100) : 0;
        return (
          <div key={f.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t1)' }}>{f.label}</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--t2)', fontVariantNumeric: 'tabular-nums' }}>
                {f.points}/{f.maxPoints}
              </span>
            </div>
            <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: 4 }}>
              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: pct >= 70 ? 'var(--green)' : pct >= 40 ? '#fbbf24' : 'rgba(255,255,255,0.18)', transition: 'width .3s ease' }} />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--t3)', lineHeight: 1.45 }}>{f.detail}</div>
          </div>
        );
      })}
    </div>
  );
};

const NewLeadModal = ({ onClose, onCreated }) => {
  const [mode, setMode] = useState('existing');
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (mode !== 'existing') return;
    let cancelled = false;
    wFetch(`/contacts?search=${encodeURIComponent(search)}&limit=20`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setContacts(Array.isArray(d) ? d : d.data ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [search, mode]);

  const submit = async () => {
    setErr(null);
    const body = mode === 'existing'
      ? { contactId: selected, source: source || undefined }
      : { name: name.trim(), phoneNumber: phone.trim(), email: email.trim() || undefined, source: source || undefined };
    if (mode === 'existing' && !selected) { setErr('Select a contact'); return; }
    if (mode === 'new' && !phone.trim()) { setErr('Phone number is required'); return; }
    setSaving(true);
    try {
      const res = await wFetch('/leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Could not create lead'); }
      onCreated(await res.json());
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New Lead" onClose={onClose} width={520}
      footer={<>
        <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create Lead'}</Btn>
      </>}>
      {err && <ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner>}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[['existing', 'Existing contact'], ['new', 'New contact']].map(([id, label]) => (
          <button key={id} onClick={() => setMode(id)}
            style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              background: mode === id ? 'var(--gbg)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${mode === id ? 'var(--gbd)' : 'var(--bd)'}`,
              color: mode === id ? 'var(--green)' : 'var(--t2)' }}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'existing' ? (
        <>
          <FLabel>Search contacts</FLabel>
          <FInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, phone or email" />
          <div style={{ marginTop: 10, maxHeight: 240, overflowY: 'auto', border: '1px solid var(--bd)', borderRadius: 8 }}>
            {contacts.length === 0 && <div style={{ padding: 14, fontSize: 12.5, color: 'var(--t3)' }}>No contacts found.</div>}
            {contacts.map(c => (
              <button key={c.id} onClick={() => setSelected(c.id)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer', textAlign: 'left',
                  background: selected === c.id ? 'var(--gbg)' : 'transparent', border: 'none', borderBottom: '1px solid var(--bd)' }}>
                <Avatar name={c.name} size={28} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{c.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--t3)' }}>{c.phoneNumber}</div>
                </div>
                {selected === c.id && <span style={{ marginLeft: 'auto' }}><I n="check" s={15} c="var(--green)" /></span>}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div><FLabel>Name</FLabel><FInput value={name} onChange={e => setName(e.target.value)} placeholder="Jane Doe" /></div>
          <div><FLabel required>Phone number</FLabel><FInput value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" /></div>
          <div><FLabel>Email</FLabel><FInput value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" /></div>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <FLabel>Source</FLabel>
        <FInput value={source} onChange={e => setSource(e.target.value)} placeholder="Referral, website, campaign…" />
      </div>
    </Modal>
  );
};

const ConvertModal = ({ lead, members, onClose, onConverted }) => {
  const [title, setTitle] = useState(`${lead.contact?.name || 'New'} — Deal`);
  const [value, setValue] = useState('');
  const [stage, setStage] = useState('QUALIFICATION');
  const [stages, setStages] = useState(STAGES.map(s => ({ key: s, label: pretty(s) })));
  const [closeDate, setCloseDate] = useState('');
  const [ownerUserId, setOwner] = useState(lead.ownerUserId || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    wFetch('/crm-customization/deal_setup')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d?.stages && Array.isArray(d.stages) && d.stages.length > 0) {
          setStages(d.stages.map(s => ({ key: s.key, label: s.label || pretty(s.key) })));
        }
      })
      .catch(() => {});
  }, []);

  const submit = async () => {
    if (!title.trim()) { setErr('Title is required'); return; }
    setSaving(true);
    try {
      const res = await wFetch(`/leads/${lead.id}/convert`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(), value: value ? Number(value) : undefined,
          stage, expectedCloseDate: closeDate ? new Date(closeDate).toISOString() : undefined,
          ownerUserId: ownerUserId || undefined,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Conversion failed'); }
      onConverted(await res.json());
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Convert Lead to Deal" onClose={onClose} width={480}
      footer={<>
        <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={submit} disabled={saving}>{saving ? 'Converting…' : 'Convert Lead'}</Btn>
      </>}>
      {err && <ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><FLabel required>Deal title</FLabel><FInput value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><FLabel>Value (₹)</FLabel><FInput type="number" value={value} onChange={e => setValue(e.target.value)} placeholder="0" /></div>
          <div><FLabel>Stage</FLabel><FSelect value={stage} onChange={e => setStage(e.target.value)} options={stages.map(s => ({ value: s.key, label: s.label }))} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><FLabel>Expected close</FLabel><FInput type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} /></div>
          <div><FLabel>Owner</FLabel><FSelect value={ownerUserId} onChange={e => setOwner(e.target.value)} placeholder="Unassigned" options={members.map(m => ({ value: m.user.id, label: m.user.name || m.user.email }))} /></div>
        </div>
      </div>
    </Modal>
  );
};

const DeleteConfirmModal = ({ count, onClose, onConfirmed, busy }) => (
  <Modal title={`Delete ${count === 1 ? 'Lead' : `${count} Leads`}`} onClose={onClose} width={440}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <I n="trash" s={18} c="#f87171" />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', marginBottom: 4 }}>
            Permanently delete {count === 1 ? 'this lead' : `${count} leads`}?
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.5 }}>
            This will permanently remove {count === 1 ? 'this lead' : 'these leads'} from your CRM pipeline, inbox, and segmentation. This action cannot be undone.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
        <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Btn>
        <button
          onClick={onConfirmed}
          disabled={busy}
          style={{
            padding: '7px 16px',
            borderRadius: 8,
            border: 'none',
            background: '#ef4444',
            color: '#fff',
            fontSize: 12.5,
            fontWeight: 700,
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.7 : 1,
            transition: 'opacity 0.15s ease',
          }}
        >
          {busy ? 'Deleting…' : count === 1 ? 'Delete Lead' : `Delete ${count} Leads`}
        </button>
      </div>
    </div>
  </Modal>
);

// 360° Lead View Detail Component
const LeadDetail = ({ lead, members, onChanged, onConverted, onRefresh }) => {
  const [tab, setTab] = useState('overview'); // 'overview' | 'engagements' | 'form_intent' | 'tasks' | 'notes'
  const [notes, setNotes] = useState(lead.notes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [converting, setConverting] = useState(false);
  const [loggingTouchpoint, setLoggingTouchpoint] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [customDefs, setCustomDefs] = useState([]);
  const [customValues, setCustomValues] = useState(lead.customFields || {});

  useEffect(() => { setNotes(lead.notes || ''); setErr(null); }, [lead.id]);
  useEffect(() => { setCustomValues(lead.customFields || {}); }, [lead.id, lead.customFields]);

  useEffect(() => {
    wFetch('/custom-fields?entity=lead')
      .then(r => (r.ok ? r.json() : { data: [] }))
      .then(d => setCustomDefs(d.data ?? []))
      .catch(() => {});
  }, []);

  const customDirty = JSON.stringify(customValues ?? {}) !== JSON.stringify(lead.customFields ?? {});
  const saveCustomFields = () => patch({ customFields: customValues });

  const patch = async (body) => {
    setErr(null); setBusy(true);
    try {
      const res = await wFetch(`/leads/${lead.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Update failed'); }
      onChanged(await res.json());
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const saveNotes = async () => { setSavingNotes(true); await patch({ notes }); setSavingNotes(false); };

  const recalc = async () => {
    setErr(null); setBusy(true);
    try {
      const res = await wFetch(`/leads/${lead.id}/recalculate-score`, { method: 'POST' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Recalculation failed'); }
      onChanged(await res.json());
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const toggleTaskComplete = async (taskId, completed) => {
    try {
      await wFetch(`/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !completed }),
      });
      if (onRefresh) onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  const c = lead.contact || {};
  const isConverted = lead.status === 'CONVERTED' || Boolean(lead.convertedDealId);
  const submissions = lead.LeadFormSubmission || [];
  const activities = lead.crmActivities || [];
  const tasks = lead.tasks || [];

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
      {err && <ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner>}

      {/* 360° Lead Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <Avatar name={c.name} size={48} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 18, color: 'var(--t1)' }}>
              {c.name || 'Unnamed'}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: lead.category === 'HOT' ? 'rgba(239,68,68,0.15)' : lead.category === 'WARM' ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)', color: lead.category === 'HOT' ? '#f87171' : lead.category === 'WARM' ? '#fbbf24' : '#60a5fa' }}>
              {lead.category || 'COLD'}
            </span>
            <StatusBadge label={pretty(lead.status)} tone={STATUS_TONE[lead.status]} />
            {c.optedOut && (
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
                OPTED OUT / DNC
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--t3)' }}>
            {c.phoneNumber}{c.email ? ` · ${c.email}` : ''}{lead.source ? ` · Source: ${lead.source}` : ''}
          </div>
        </div>

        {/* Lead Actions Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setLoggingTouchpoint(true)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid var(--bd)',
              color: 'var(--t1)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <I n="phone" s={13} /> Log Touchpoint
          </button>

          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('app:nav', { detail: 'crm-sales-inbox' }));
            }}
            disabled={c.optedOut}
            title={c.optedOut ? 'Contact has opted out of WhatsApp' : 'Open in CRM Sales Inbox'}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              background: c.optedOut ? 'rgba(255,255,255,0.03)' : 'rgba(53,232,242,0.12)',
              border: '1px solid rgba(53,232,242,0.25)',
              color: c.optedOut ? 'var(--t3)' : 'var(--accent, #35e8f2)',
              fontSize: 12,
              fontWeight: 600,
              cursor: c.optedOut ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <I n="msg" s={13} /> WhatsApp
          </button>

          <Btn size="sm" onClick={() => setConverting(true)} disabled={isConverted || busy}>
            {isConverted ? 'Converted' : 'Convert to Deal'}
          </Btn>
        </div>
      </div>

      {/* AI Insight & Next Best Action Card (Gap Analysis Part 1, Page 15) */}
      <div style={{
        background: 'rgba(53,232,242,0.06)',
        border: '1px solid rgba(53,232,242,0.2)',
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: 18,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <I n="spark" s={13} c="var(--accent, #35e8f2)" />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent, #35e8f2)', textTransform: 'uppercase' }}>
              AI Next Best Action
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: '#fff', fontWeight: 600 }}>
            {lead.score >= 70
              ? 'High buying intent detected. Schedule a product demo or send enterprise quote today.'
              : lead.score >= 40
              ? 'Lead has engaged with initial messaging. Log a follow-up call to assess budget and timeline.'
              : 'Early stage enquiry. Nurture with educational WhatsApp templates and sequence.'}
          </div>
        </div>
        <button
          onClick={() => setAddingTask(true)}
          style={{
            padding: '5px 12px',
            background: 'var(--accent, #35e8f2)',
            color: '#060A10',
            border: 'none',
            borderRadius: 6,
            fontSize: 11.5,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Create Task
        </button>
      </div>

      {/* 360° Lead Detail Sub-Tabs */}
      <div style={{ display: 'flex', gap: 16, borderBottom: '1px solid var(--bd)', marginBottom: 18 }}>
        {[
          { id: 'overview', label: 'Overview & Score' },
          { id: 'engagements', label: `Engagements (${activities.length})` },
          { id: 'form_intent', label: `Form Intent (${submissions.length})` },
          { id: 'tasks', label: `Tasks (${tasks.length})` },
          { id: 'notes', label: 'Notes' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 4px',
              background: 'none',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--accent, #35e8f2)' : '2px solid transparent',
              color: tab === t.id ? '#fff' : 'var(--t3)',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* SUB-TAB 1: OVERVIEW */}
      {tab === 'overview' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginBottom: 18 }}>
            <div>
              <FLabel>Status</FLabel>
              <FSelect value={lead.status} disabled={busy || isConverted}
                onChange={e => patch({ status: e.target.value })}
                options={STATUSES.map(s => ({ value: s, label: pretty(s) }))} />
            </div>
            <div>
              <FLabel>Owner</FLabel>
              <FSelect value={lead.ownerUserId || ''} disabled={busy} placeholder="Unassigned"
                onChange={e => patch({ ownerUserId: e.target.value || null })}
                options={members.map(m => ({ value: m.user.id, label: m.user.name || m.user.email }))} />
            </div>
          </div>

          <div style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 8, padding: '16px 18px', marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--t1)' }}>Lead Score</span>
                <span style={{ fontSize: 24, fontWeight: 800, color: scoreColor(lead.score), fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {lead.score}
                </span>
                <span style={{ fontSize: 11, color: 'var(--t3)' }}>/ 100</span>
              </div>
              <Btn variant="ghost" size="sm" onClick={recalc} disabled={busy}>
                <I n="refresh" s={13} c="var(--t2)" /> Recalculate
              </Btn>
            </div>
            <ScoreBreakdown factors={lead.scoreFactors} />
          </div>

          {lead.contact?.id && (
            <div style={{ marginBottom: 18 }}>
              <RelationshipCard contactId={lead.contact.id} contactName={lead.contact.name} />
            </div>
          )}

          <div style={{ marginBottom: 18 }}>
            <AgentTab targetType="lead" targetId={lead.id} />
          </div>

          {customDefs.length > 0 && (
            <div style={{ marginBottom: 18, background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--t1)', marginBottom: 10 }}>Custom Lead Fields</div>
              <CustomFieldInputs
                definitions={customDefs}
                values={customValues}
                members={members}
                onChange={setCustomValues}
                disabled={busy}
              />
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                <Btn variant="ghost" size="sm" onClick={saveCustomFields} disabled={busy || !customDirty}>
                  Save Fields
                </Btn>
              </div>
            </div>
          )}

          {lead.deals?.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--t1)', marginBottom: 10 }}>Associated Deals</div>
              {lead.deals.map(d => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', border: '1px solid var(--bd)', borderRadius: 8, marginBottom: 8, background: 'var(--surf)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{d.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>Closes {fmtDate(d.expectedCloseDate)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {d.value != null && <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>₹{Number(d.value).toLocaleString('en-IN')}</span>}
                    <StatusBadge label={pretty(d.stage)} tone={d.stage === 'CLOSED_WON' ? 'green' : d.stage === 'CLOSED_LOST' ? 'red' : 'blue'} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: ENGAGEMENTS & TOUCHPOINTS (Gap Analysis Part 1, Page 4-5) */}
      {tab === 'engagements' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, color: 'var(--t3)' }}>Unified log of calls, meetings, notes, and messages</div>
            <Btn size="sm" onClick={() => setLoggingTouchpoint(true)}>
              <I n="phone" s={13} /> + Log Touchpoint
            </Btn>
          </div>

          {activities.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', border: '1px dashed var(--bd)', borderRadius: 8, fontSize: 12.5 }}>
              No touchpoints logged yet. Click "+ Log Touchpoint" to record a call or meeting.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {activities.map((a) => (
                <div key={a.id} style={{ padding: '12px 16px', background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>
                        {a.type === 'CALL' ? '📞' : a.type === 'MEETING' ? '📅' : a.type === 'EMAIL' ? '✉️' : '📝'}
                      </span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#fff' }}>{a.type}</span>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--t3)' }}>{new Date(a.createdAt).toLocaleString('en-IN')}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                    {a.content}
                  </div>
                  {a.createdByUser && (
                    <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 6 }}>
                      Logged by {a.createdByUser.name || a.createdByUser.email}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: FORM INTENT (Gap Analysis Part 1, Page 14; Part 2, Page 24) */}
      {tab === 'form_intent' && (
        <div>
          <div style={{ fontSize: 12.5, color: 'var(--t3)', marginBottom: 14 }}>
            Direct customer responses captured via lead forms
          </div>

          {submissions.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', border: '1px dashed var(--bd)', borderRadius: 8, fontSize: 12.5 }}>
              No web form submissions associated with this lead.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {submissions.map((sub) => (
                <div key={sub.id} style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, borderBottom: '1px solid var(--bd)', paddingBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent, #35e8f2)' }}>
                      {sub.form?.title || 'Lead Capture Form'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--t3)' }}>
                      Submitted {new Date(sub.createdAt).toLocaleDateString('en-IN')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {sub.answers && typeof sub.answers === 'object' ? (
                      Object.entries(sub.answers).map(([key, val]) => (
                        <div key={key} style={{ fontSize: 12 }}>
                          <div style={{ color: 'var(--t3)', fontWeight: 600, textTransform: 'capitalize' }}>{key}</div>
                          <div style={{ color: '#fff', fontWeight: 500, marginTop: 2 }}>{String(val)}</div>
                        </div>
                      ))
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--t2)' }}>{JSON.stringify(sub.answers)}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 4: TASKS */}
      {tab === 'tasks' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 12.5, color: 'var(--t3)' }}>Operational follow-up tasks for this lead</span>
            <Btn size="sm" onClick={() => setAddingTask(true)}>+ Add Task</Btn>
          </div>

          {tasks.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', border: '1px dashed var(--bd)', borderRadius: 8, fontSize: 12.5 }}>
              No tasks assigned. Click "+ Add Task" to set a follow-up.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tasks.map((t) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--surf)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(t.completed)}
                      onChange={() => toggleTaskComplete(t.id, t.completed)}
                      style={{ cursor: 'pointer', width: 16, height: 16, accentColor: 'var(--accent)' }}
                    />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: t.completed ? 'var(--t3)' : '#fff', textDecoration: t.completed ? 'line-through' : 'none' }}>
                        {t.title}
                      </div>
                      {t.dueDate && (
                        <div style={{ fontSize: 11, color: new Date(t.dueDate) < new Date() && !t.completed ? '#f87171' : 'var(--t3)' }}>
                          Due {new Date(t.dueDate).toLocaleDateString('en-IN')}
                        </div>
                      )}
                    </div>
                  </div>
                  <StatusBadge label={t.completed ? 'Completed' : t.priority || 'NORMAL'} tone={t.completed ? 'green' : t.priority === 'HIGH' ? 'red' : 'gray'} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 5: NOTES */}
      {tab === 'notes' && (
        <div>
          <FLabel>Internal Rep Notes</FLabel>
          <FTextarea value={notes} onChange={e => setNotes(e.target.value)} rows={6} placeholder="Context, customer pain points, budget, objections…" />
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
            <Btn variant="ghost" size="sm" onClick={saveNotes} disabled={savingNotes || notes === (lead.notes || '')}>
              {savingNotes ? 'Saving…' : 'Save Notes'}
            </Btn>
          </div>
        </div>
      )}

      {converting && (
        <ConvertModal lead={lead} members={members}
          onClose={() => setConverting(false)}
          onConverted={(deal) => { setConverting(false); onConverted(deal); }} />
      )}

      {loggingTouchpoint && (
        <LogInteractionModal
          lead={lead}
          onClose={() => setLoggingTouchpoint(false)}
          onLogged={() => {
            if (onRefresh) onRefresh();
          }}
        />
      )}

      {addingTask && (
        <BulkTaskModal
          leadIds={[lead.id]}
          onClose={() => setAddingTask(false)}
          onCreated={() => {
            if (onRefresh) onRefresh();
          }}
        />
      )}
    </div>
  );
};

export default function LeadsView() {
  const [leads, setLeads] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [owner, setOwner] = useState('');
  const [preset, setPreset] = useState('all');
  const [sort, setSort] = useState('score');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState(null);

  // Selection & Bulk Actions
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showDistributionModal, setShowDistributionModal] = useState(false);
  const [bulkTaskModalOpen, setBulkTaskModalOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    if (category) qs.set('category', category);
    if (status) qs.set('status', status);
    if (owner) qs.set('ownerUserId', owner);
    if (preset && preset !== 'all') qs.set('preset', preset);
    qs.set('sort', sort);
    wFetch(`/leads?${qs}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load leads'))))
      .then(d => setLeads(d.data ?? []))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [search, category, status, owner, preset, sort]);

  const toggleSelect = (id, e) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === leads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(leads.map(l => l.id)));
    }
  };

  const handleBulkAssign = async (userId) => {
    if (selectedIds.size === 0) return;
    try {
      await wFetch('/leads/bulk-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedIds], ownerUserId: userId || null }),
      });
      setSelectedIds(new Set());
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const handleBulkStatus = async (st) => {
    if (selectedIds.size === 0 || !st) return;
    try {
      await wFetch('/leads/bulk-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedIds], status: st }),
      });
      setSelectedIds(new Set());
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const handleBulkCategory = async (cat) => {
    if (selectedIds.size === 0 || !cat) return;
    try {
      await wFetch('/leads/bulk-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedIds], category: cat }),
      });
      setSelectedIds(new Set());
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      const res = await wFetch('/leads/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedIds] }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Bulk delete failed');
      }
      setConfirmBulkDelete(false);
      if (selectedIds.has(activeId)) setActiveId(null);
      setSelectedIds(new Set());
      load();
      window.dispatchEvent(new CustomEvent('crm:pipeline-sync'));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBulkDeleting(false);
    }
  };

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    wFetch('/members').then(r => r.ok && r.json()).then(d => { if (Array.isArray(d)) setMembers(d); }).catch(() => {});
  }, []);

  const refreshDetail = () => {
    if (!activeId) return;
    wFetch(`/leads/${activeId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setDetail(d); })
      .catch(() => {});
  };

  useEffect(() => {
    if (!activeId) { setDetail(null); return; }
    let cancelled = false;
    wFetch(`/leads/${activeId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load lead'))))
      .then(d => { if (!cancelled) setDetail(d); })
      .catch(e => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, [activeId]);

  const applyUpdate = (updated) => {
    setDetail(prev => ({ ...prev, ...updated }));
    setLeads(prev => prev.map(l => (l.id === updated.id ? { ...l, ...updated } : l)));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Top Header */}
      <div style={{ height: 58, borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0, background: 'var(--surf)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, color: 'var(--t1)' }}>Leads Workspace</span>
          <span style={{ fontSize: 12.5, color: 'var(--t3)' }}>{leads.length} leads</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setShowDistributionModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid var(--bd)',
              background: 'rgba(255,255,255,0.03)',
              color: 'var(--t1)',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <I n="zap" s={13} c="var(--accent, #35e8f2)" /> Routing Rules
          </button>

          <ImportExport entity="leads" canImport onImported={load} />

          <Btn size="sm" onClick={() => setCreating(true)}>
            <I n="plus" s={14} c="#060A10" /> New Lead
          </Btn>
        </div>
      </div>

      {/* Operational Preset Tabs Bar (Gap Analysis Part 1, Page 3; Part 2, Page 18) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 24px', borderBottom: '1px solid var(--bd)', background: 'rgba(255,255,255,0.01)', overflowX: 'auto' }}>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPreset(p.id)}
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              background: preset === p.id ? 'var(--accent, #35e8f2)' : 'transparent',
              color: preset === p.id ? '#060A10' : 'var(--t2)',
              border: preset === p.id ? 'none' : '1px solid rgba(255,255,255,0.08)',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Bulk Actions Floating Bar (Gap Analysis Part 2, Page 18) */}
      {selectedIds.size > 0 && (
        <div style={{
          padding: '8px 24px',
          background: 'rgba(53,232,242,0.08)',
          borderBottom: '1px solid rgba(53,232,242,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selectedIds.size === leads.length && leads.length > 0}
                onChange={toggleSelectAll}
                style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
              />
              <span>{selectedIds.size} selected</span>
            </label>
            <button
              onClick={() => setSelectedIds(new Set())}
              style={{ background: 'none', border: 'none', color: 'var(--t3)', fontSize: 11.5, textDecoration: 'underline', cursor: 'pointer' }}
            >
              Clear
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Assign Rep */}
            <select
              onChange={(e) => { if (e.target.value) handleBulkAssign(e.target.value); }}
              defaultValue=""
              style={{ background: '#111', border: '1px solid var(--bd)', color: '#fff', fontSize: 11.5, padding: '5px 8px', borderRadius: 6 }}
            >
              <option value="" disabled>Assign Rep…</option>
              {members.map(m => (
                <option key={m.user.id} value={m.user.id}>{m.user.name || m.user.email}</option>
              ))}
            </select>

            {/* Change Status */}
            <select
              onChange={(e) => { if (e.target.value) handleBulkStatus(e.target.value); }}
              defaultValue=""
              style={{ background: '#111', border: '1px solid var(--bd)', color: '#fff', fontSize: 11.5, padding: '5px 8px', borderRadius: 6 }}
            >
              <option value="" disabled>Status…</option>
              {STATUSES.map(s => <option key={s} value={s}>{pretty(s)}</option>)}
            </select>

            {/* Move Category */}
            <select
              onChange={(e) => { if (e.target.value) handleBulkCategory(e.target.value); }}
              defaultValue=""
              style={{ background: '#111', border: '1px solid var(--bd)', color: '#fff', fontSize: 11.5, padding: '5px 8px', borderRadius: 6 }}
            >
              <option value="" disabled>Category…</option>
              <option value="HOT">HOT 🔥</option>
              <option value="WARM">WARM ⚡</option>
              <option value="COLD">COLD ❄️</option>
            </select>

            {/* Create Task */}
            <button
              onClick={() => setBulkTaskModalOpen(true)}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--bd)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
            >
              + Add Task
            </button>

            {/* Start Campaign */}
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('app:nav', { detail: 'crm-sales-inbox' }))}
              style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--accent, #35e8f2)', color: '#060A10', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
            >
              Start Campaign
            </button>

            {/* Delete */}
            <button
              onClick={() => setConfirmBulkDelete(true)}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#f87171', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Main Workspace Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Side: Lead Operational List */}
        <div style={{ width: 380, borderRight: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', flexShrink: 0, background: 'var(--surf)' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)' }}>
              <I n="search" s={14} c="var(--t3)" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search leads by name, phone, email..."
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--t1)', fontSize: 12.5 }} />
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <FSelect value={category} onChange={e => setCategory(e.target.value)} placeholder="All categories"
                options={[{ value: 'HOT', label: 'HOT 🔥' }, { value: 'WARM', label: 'WARM ⚡' }, { value: 'COLD', label: 'COLD ❄️' }]} />
              <FSelect value={status} onChange={e => setStatus(e.target.value)} placeholder="All statuses"
                options={STATUSES.map(s => ({ value: s, label: pretty(s) }))} />
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <FSelect value={sort} onChange={e => setSort(e.target.value)}
                options={[{ value: 'score', label: 'Top score' }, { value: 'newest', label: 'Newest' }]} />
              <FSelect value={owner} onChange={e => setOwner(e.target.value)} placeholder="All owners"
                options={members.map(m => ({ value: m.user.id, label: m.user.name || m.user.email }))} />
            </div>

            <SavedViews
              entity="leads"
              current={{ search, status, ownerUserId: owner, sort, category }}
              onApply={(f) => {
                setSearch(f.search ?? '');
                setStatus(f.status ?? '');
                setOwner(f.ownerUserId ?? '');
                setCategory(f.category ?? '');
                setSort(f.sort ?? 'score');
              }}
            />
          </div>

          {/* Leads Scroll Area */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading && <div style={{ padding: 18, fontSize: 12.5, color: 'var(--t3)' }}>Loading leads…</div>}
            {!loading && leads.length === 0 && (
              <div style={{ padding: '32px 20px', textAlign: 'center' }}>
                <I n="target" s={26} c="var(--t3)" />
                <div style={{ marginTop: 10, fontSize: 13, color: 'var(--t2)', fontWeight: 600 }}>No leads in this view</div>
                <div style={{ marginTop: 4, fontSize: 12, color: 'var(--t3)' }}>Adjust filters or create a new lead to populate this list.</div>
              </div>
            )}

            {leads.map(l => {
              const earliestTask = l.tasks?.[0];
              const latestAct = l.crmActivities?.[0];
              const isSelected = selectedIds.has(l.id);

              return (
                <div
                  key={l.id}
                  onClick={() => setActiveId(l.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '12px 14px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    background: isSelected ? 'rgba(53, 232, 242, 0.06)' : activeId === l.id ? 'rgba(255,255,255,0.05)' : 'transparent',
                    borderBottom: '1px solid var(--bd)',
                    borderLeft: `3px solid ${activeId === l.id ? 'var(--accent, #35e8f2)' : isSelected ? 'var(--accent)' : 'transparent'}`,
                    boxSizing: 'border-box',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={e => toggleSelect(l.id, e)}
                    onClick={e => e.stopPropagation()}
                    style={{ cursor: 'pointer', flexShrink: 0, marginTop: 3, width: 15, height: 15, accentColor: 'var(--accent)' }}
                  />

                  <Avatar name={l.contact?.name} size={32} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.contact?.name || 'Unnamed'}
                      </span>
                      <ScoreChip score={l.score} />
                    </div>

                    <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 4 }}>
                      {l.contact?.phoneNumber || 'No phone'}
                    </div>

                    <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                      <StatusBadge label={pretty(l.status)} tone={STATUS_TONE[l.status]} />
                      {l.category && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: l.category === 'HOT' ? 'rgba(239,68,68,0.15)' : l.category === 'WARM' ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)', color: l.category === 'HOT' ? '#f87171' : leadCategoryTone(l.category) }}>
                          {l.category}
                        </span>
                      )}
                      {l.owner && <span style={{ fontSize: 10.5, color: 'var(--t3)' }}>👤 {l.owner.name}</span>}
                    </div>

                    {/* Operational Next Task / Activity Indicator (Gap Analysis Part 1, Page 3; Part 2, Page 17) */}
                    {earliestTask ? (
                      <div style={{ fontSize: 10.5, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span>⏳</span>
                        <span>{earliestTask.title}</span>
                        {earliestTask.dueDate && <span>({new Date(earliestTask.dueDate).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })})</span>}
                      </div>
                    ) : latestAct ? (
                      <div style={{ fontSize: 10.5, color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span>💬</span>
                        <span>{latestAct.type}: {latestAct.content?.slice(0, 24)}...</span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 10, color: '#f87171' }}>⚠️ Awaiting first task</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side: 360° Lead View */}
        {detail ? (
          <LeadDetail
            lead={detail}
            members={members}
            onChanged={applyUpdate}
            onRefresh={refreshDetail}
            onConverted={() => {
              load();
              refreshDetail();
              window.dispatchEvent(new CustomEvent('app:nav', { detail: 'deals' }));
            }}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <I n="target" s={32} c="var(--t3)" />
            <div style={{ fontSize: 14, color: 'var(--t2)', fontWeight: 600 }}>Select a lead to view 360° intelligence</div>
            <div style={{ fontSize: 12, color: 'var(--t3)' }}>
              Inspect score breakdown, form answers, engagement history, and next best actions.
            </div>
          </div>
        )}
      </div>

      {creating && (
        <NewLeadModal onClose={() => setCreating(false)}
          onCreated={(lead) => { setCreating(false); load(); setActiveId(lead.id); }} />
      )}

      {showDistributionModal && (
        <LeadDistributionModal
          members={members}
          onClose={() => setShowDistributionModal(false)}
          onDistributed={load}
        />
      )}

      {bulkTaskModalOpen && (
        <BulkTaskModal
          leadIds={[...selectedIds]}
          onClose={() => setBulkTaskModalOpen(false)}
          onCreated={() => {
            setSelectedIds(new Set());
            load();
          }}
        />
      )}

      {confirmBulkDelete && (
        <DeleteConfirmModal
          count={selectedIds.size}
          onClose={() => {
            setConfirmBulkDelete(false);
            setSelectedIds(new Set());
          }}
          onConfirmed={handleBulkDelete}
          busy={bulkDeleting}
        />
      )}
    </div>
  );
}

function leadCategoryTone(cat) {
  if (cat === 'HOT') return '#f87171';
  if (cat === 'WARM') return '#fbbf24';
  return '#60a5fa';
}
