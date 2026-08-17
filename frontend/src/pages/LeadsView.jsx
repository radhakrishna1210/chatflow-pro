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

const STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED', 'LOST'];
const STAGES = ['QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];

const STATUS_TONE = {
  NEW: 'blue', CONTACTED: 'violet', QUALIFIED: 'green',
  UNQUALIFIED: 'gray', CONVERTED: 'green', LOST: 'red',
};

const pretty = s => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const scoreTone = n => (n >= 70 ? 'green' : n >= 40 ? 'amber' : 'gray');
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

// Renders the server's scoreFactors breakdown. Each factor states its own
// points and reason, so a rep can see why a lead ranks where it does.
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
  const [closeDate, setCloseDate] = useState('');
  const [ownerUserId, setOwner] = useState(lead.ownerUserId || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    if (!title.trim()) { setErr('Deal title is required'); return; }
    setErr(null); setSaving(true);
    try {
      const res = await wFetch(`/leads/${lead.id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          value: value === '' ? null : Number(value),
          stage,
          expectedCloseDate: closeDate || null,
          ownerUserId: ownerUserId || null,
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
    <Modal title="Convert to Deal" onClose={onClose} width={500}
      footer={<>
        <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={submit} disabled={saving}>{saving ? 'Converting…' : 'Convert'}</Btn>
      </>}>
      {err && <ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><FLabel required>Deal title</FLabel><FInput value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div><FLabel>Value (INR)</FLabel><FInput type="number" value={value} onChange={e => setValue(e.target.value)} placeholder="50000" /></div>
        <div>
          <FLabel>Starting stage</FLabel>
          <FSelect value={stage} onChange={e => setStage(e.target.value)}
            options={STAGES.map(s => ({ value: s, label: pretty(s) }))} />
        </div>
        <div><FLabel>Expected close date</FLabel><FInput type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} /></div>
        <div>
          <FLabel>Owner</FLabel>
          <FSelect value={ownerUserId} onChange={e => setOwner(e.target.value)} placeholder="Unassigned"
            options={members.map(m => ({ value: m.user.id, label: m.user.name || m.user.email }))} />
        </div>
      </div>
    </Modal>
  );
};

const LeadDetail = ({ lead, members, onChanged, onConverted }) => {
  const [notes, setNotes] = useState(lead.notes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [converting, setConverting] = useState(false);
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

  const c = lead.contact || {};
  const isConverted = lead.status === 'CONVERTED' || Boolean(lead.convertedDealId);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '22px 28px' }}>
      {err && <ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
        <Avatar name={c.name} size={52} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 19, color: 'var(--t1)' }}>{c.name || 'Unnamed'}</span>
            <StatusBadge label={pretty(lead.status)} tone={STATUS_TONE[lead.status]} />
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--t3)' }}>
            {c.phoneNumber}{c.email ? ` · ${c.email}` : ''}{lead.source ? ` · via ${lead.source}` : ''}
          </div>
        </div>
        <Btn size="sm" onClick={() => setConverting(true)} disabled={isConverted || busy}>
          {isConverted ? 'Converted' : 'Convert to Deal'}
        </Btn>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 16, marginBottom: 22 }}>
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

      <div style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', padding: '18px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>Lead score</span>
            <span style={{ fontSize: 26, fontWeight: 800, color: scoreColor(lead.score), fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
              {lead.score}
            </span>
            <span style={{ fontSize: 12, color: 'var(--t3)' }}>/ 100</span>
          </div>
          <Btn variant="ghost" size="sm" onClick={recalc} disabled={busy}>
            <I n="refresh" s={13} c="var(--t2)" /> Recalculate
          </Btn>
        </div>
        <ScoreBreakdown factors={lead.scoreFactors} />
        {lead.scoreComputedAt && (
          <div style={{ marginTop: 14, fontSize: 11, color: 'var(--t3)' }}>
            Last calculated {new Date(lead.scoreComputedAt).toLocaleString('en-IN')}
          </div>
        )}
      </div>

      {/* Sits under the score deliberately: the score says how promising this
          lead looks, the relationship says how the conversation is actually
          going. They answer different questions and can disagree. */}
      {lead.contact?.id && (
        <div style={{ marginBottom: 20 }}>
          <RelationshipCard contactId={lead.contact.id} contactName={lead.contact.name} />
        </div>
      )}

      {customDefs.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--t1)', marginBottom: 10 }}>
            Details
          </div>
          <CustomFieldInputs
            definitions={customDefs}
            values={customValues}
            members={members}
            onChange={setCustomValues}
            disabled={busy}
          />
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
            <Btn variant="ghost" size="sm" onClick={saveCustomFields} disabled={busy || !customDirty}>
              Save details
            </Btn>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <FLabel>Notes</FLabel>
        <FTextarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} placeholder="Context, next steps, objections…" />
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
          <Btn variant="ghost" size="sm" onClick={saveNotes} disabled={savingNotes || notes === (lead.notes || '')}>
            {savingNotes ? 'Saving…' : 'Save notes'}
          </Btn>
        </div>
      </div>

      {lead.deals?.length > 0 && (
        <div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--t1)', marginBottom: 10 }}>Deals</div>
          {lead.deals.map(d => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', border: '1px solid var(--bd)', borderRadius: 8, marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{d.title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--t3)' }}>Closes {fmtDate(d.expectedCloseDate)}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {d.value != null && <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>₹{Number(d.value).toLocaleString('en-IN')}</span>}
                <StatusBadge label={pretty(d.stage)} tone={d.stage === 'CLOSED_WON' ? 'green' : d.stage === 'CLOSED_LOST' ? 'red' : 'blue'} />
              </div>
            </div>
          ))}
        </div>
      )}

      {converting && (
        <ConvertModal lead={lead} members={members}
          onClose={() => setConverting(false)}
          onConverted={(deal) => { setConverting(false); onConverted(deal); }} />
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
  const [status, setStatus] = useState('');
  const [owner, setOwner] = useState('');
  const [sort, setSort] = useState('score');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    if (status) qs.set('status', status);
    if (owner) qs.set('ownerUserId', owner);
    qs.set('sort', sort);
    wFetch(`/leads?${qs}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load leads'))))
      .then(d => setLeads(d.data ?? []))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [search, status, owner, sort]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    wFetch('/members').then(r => r.ok && r.json()).then(d => { if (Array.isArray(d)) setMembers(d); }).catch(() => {});
  }, []);

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
      <div style={{ height: 58, borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', flexShrink: 0, background: 'var(--surf)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, color: 'var(--t1)' }}>Leads</span>
          <span style={{ fontSize: 12.5, color: 'var(--t3)' }}>{leads.length}</span>
        </div>
        <ImportExport entity="leads" canImport onImported={load} />
        <Btn size="sm" onClick={() => setCreating(true)}><I n="plus" s={14} c="#060A10" /> New Lead</Btn>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ width: 340, borderRight: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', flexShrink: 0, background: 'var(--surf)' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)' }}>
              <I n="search" s={14} c="var(--t3)" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search leads"
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif" }} />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <FSelect value={status} onChange={e => setStatus(e.target.value)} placeholder="All statuses"
                options={STATUSES.map(s => ({ value: s, label: pretty(s) }))} />
              <FSelect value={sort} onChange={e => setSort(e.target.value)}
                options={[{ value: 'score', label: 'Top score' }, { value: 'newest', label: 'Newest' }]} />
            </div>
            <FSelect value={owner} onChange={e => setOwner(e.target.value)} placeholder="All owners"
              options={members.map(m => ({ value: m.user.id, label: m.user.name || m.user.email }))} />
            <SavedViews
              entity="leads"
              current={{ search, status, ownerUserId: owner, sort }}
              onApply={(f) => {
                setSearch(f.search ?? '');
                setStatus(f.status ?? '');
                setOwner(f.ownerUserId ?? '');
                setSort(f.sort ?? 'score');
              }}
            />
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading && <div style={{ padding: 18, fontSize: 12.5, color: 'var(--t3)' }}>Loading…</div>}
            {!loading && leads.length === 0 && (
              <div style={{ padding: '32px 20px', textAlign: 'center' }}>
                <I n="target" s={26} c="var(--t3)" />
                <div style={{ marginTop: 10, fontSize: 13, color: 'var(--t2)', fontWeight: 600 }}>No leads yet</div>
                <div style={{ marginTop: 4, fontSize: 12, color: 'var(--t3)' }}>Create one from an existing contact to start tracking.</div>
              </div>
            )}
            {leads.map(l => (
              <button key={l.id} onClick={() => setActiveId(l.id)}
                style={{ width: '100%', display: 'flex', gap: 10, padding: '11px 14px', cursor: 'pointer', textAlign: 'left',
                  background: activeId === l.id ? 'rgba(255,255,255,0.05)' : 'transparent',
                  border: 'none', borderBottom: '1px solid var(--bd)',
                  borderLeft: `2px solid ${activeId === l.id ? 'var(--green)' : 'transparent'}` }}>
                <Avatar name={l.contact?.name} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.contact?.name || 'Unnamed'}
                    </span>
                    <ScoreChip score={l.score} />
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--t3)', marginBottom: 5 }}>{l.contact?.phoneNumber}</div>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <StatusBadge label={pretty(l.status)} tone={STATUS_TONE[l.status]} />
                    {l.owner && <span style={{ fontSize: 10.5, color: 'var(--t3)' }}>{l.owner.name}</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {detail ? (
          <LeadDetail lead={detail} members={members}
            onChanged={applyUpdate}
            onConverted={() => {
              load();
              wFetch(`/leads/${activeId}`).then(r => r.ok && r.json()).then(d => d && setDetail(d)).catch(() => {});
              window.dispatchEvent(new CustomEvent('app:nav', { detail: 'deals' }));
            }} />
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <I n="target" s={30} c="var(--t3)" />
            <div style={{ fontSize: 13.5, color: 'var(--t2)', fontWeight: 600 }}>Select a lead</div>
            <div style={{ fontSize: 12, color: 'var(--t3)' }}>Its score breakdown and actions appear here.</div>
            {err && <div style={{ marginTop: 8 }}><ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner></div>}
          </div>
        )}
      </div>

      {creating && (
        <NewLeadModal onClose={() => setCreating(false)}
          onCreated={(lead) => { setCreating(false); load(); setActiveId(lead.id); }} />
      )}
    </div>
  );
}
