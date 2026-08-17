import AgentTab from '../components/AgentTab.jsx';
import { useState, useEffect, useCallback } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { Modal } from '../components/Modal.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { FInput, FLabel, FSelect } from '../components/Form.jsx';
import { wFetch } from '../lib/api.js';
import { SavedViews } from '../components/SavedViews.jsx';
import { ImportExport } from '../components/ImportExport.jsx';

const STAGES = ['QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];

const STAGE_TONE = {
  QUALIFICATION: 'blue', NEEDS_ANALYSIS: 'violet', PROPOSAL: 'amber',
  NEGOTIATION: 'amber', CLOSED_WON: 'green', CLOSED_LOST: 'red',
};

const pretty = s => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const fmtMoney = v => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN')}`);
const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const toDateInput = d => (d ? new Date(d).toISOString().slice(0, 10) : '');

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const ErrorBanner = ({ children, onDismiss }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 14px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)', color: '#f87171', fontSize: 12.5 }}>
    <span>{children}</span>
    {onDismiss && (
      <button onClick={onDismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
        <I n="x" s={14} c="#f87171" />
      </button>
    )}
  </div>
);

const ColHead = ({ children, width }) => (
  <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.08em', whiteSpace: 'nowrap', width }}>
    {children}
  </th>
);

const HEALTH_TONE = {
  HEALTHY: { color: '#22c55e', label: 'Healthy' },
  AT_RISK: { color: '#f59e0b', label: 'At risk' },
  CRITICAL: { color: '#f87171', label: 'Critical' },
};

// A dot alone would be colour-only information, which fails WCAG 1.4.1, so the
// band is also carried in the accessible name and the numeric score.
const HealthDot = ({ health, showScore = false }) => {
  if (!health || health.band === 'CLOSED' || health.score == null) return null;
  const tone = HEALTH_TONE[health.band] ?? HEALTH_TONE.AT_RISK;
  const top = health.risks?.[0]?.message;
  return (
    <span
      title={top ? `${tone.label} — ${top}` : `${tone.label} (${health.score}/100)`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
    >
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: tone.color, flexShrink: 0 }} />
      <span className="sr-only">{`Health ${tone.label}, ${health.score} out of 100${top ? `. ${top}` : ''}`}</span>
      {showScore && (
        <span aria-hidden="true" style={{ fontSize: 10.5, fontWeight: 700, color: tone.color }}>{health.score}</span>
      )}
    </span>
  );
};

const DealCard = ({ deal, onDragStart, onClick, dragging, onMoveStage }) => (
  <div
    draggable
    onDragStart={onDragStart}
    onClick={onClick}
    // The board is otherwise drag-only, which leaves it unusable by keyboard.
    // Enter opens the deal; Alt+Arrow moves it a stage without a mouse.
    role="button"
    tabIndex={0}
    aria-label={`${deal.title}, ${fmtMoney(deal.value)}${deal.health?.band ? `, health ${deal.health.band.toLowerCase().replace('_', ' ')}` : ''}. Press Enter to open, Alt plus arrow keys to change stage.`}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
      if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        onMoveStage?.(deal, e.key === 'ArrowRight' ? 1 : -1);
      }
    }}
    className="m-lift m-press"
    style={{ ...card, padding: '11px 13px', marginBottom: 8, cursor: 'grab', opacity: dragging ? .4 : 1, transition: 'opacity var(--dur-fast) var(--ease-standard)' }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', lineHeight: 1.35 }}>{deal.title}</div>
      <HealthDot health={deal.health} />
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
      <Avatar name={deal.contact?.name} size={20} />
      <span style={{ fontSize: 11.5, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {deal.contact?.name || 'No contact'}
      </span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>{fmtMoney(deal.value)}</span>
      {deal.expectedCloseDate && (
        <span style={{ fontSize: 10.5, color: 'var(--t3)' }}>{fmtDate(deal.expectedCloseDate)}</span>
      )}
    </div>
    {deal.owner && (
      <div style={{ marginTop: 7, paddingTop: 7, borderTop: '1px solid var(--bd)', fontSize: 10.5, color: 'var(--t3)' }}>
        {deal.owner.name || deal.owner.email}
      </div>
    )}
  </div>
);

// Health is only useful if the reasons are visible — a bare number tells a rep
// nothing about what to do next, so every factor and risk is shown in full.
const HealthPanel = ({ health }) => {
  if (!health) return null;
  if (health.band === 'CLOSED') {
    return (
      <div style={{ ...card, padding: '11px 13px', marginBottom: 16, fontSize: 12, color: 'var(--t3)' }}>
        {health.factors?.[0]?.detail || 'This deal is closed.'}
      </div>
    );
  }
  const tone = HEALTH_TONE[health.band] ?? HEALTH_TONE.AT_RISK;
  return (
    <div style={{ ...card, padding: '13px 14px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
          Deal health
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: tone.color }} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: tone.color }}>{tone.label}</span>
          <span style={{ fontSize: 12, color: 'var(--t3)' }}>{health.score}/{health.maxScore}</span>
        </span>
      </div>

      {health.risks?.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '0 0 12px', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {health.risks.map(r => (
            <li key={r.key} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 11.5, color: r.severity === 'critical' ? '#f87171' : '#f59e0b' }}>
              <I n={r.severity === 'critical' ? 'alertc' : 'clock'} s={12} c={r.severity === 'critical' ? '#f87171' : '#f59e0b'} />
              <span style={{ lineHeight: 1.4 }}>{r.message}</span>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {health.factors.map(f => (
          <div key={f.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
              <span style={{ color: 'var(--t2)' }}>{f.label}</span>
              <span style={{ color: 'var(--t3)' }}>{f.points}/{f.maxPoints}</span>
            </div>
            <div style={{ height: 3, borderRadius: 2, background: 'var(--bd)', overflow: 'hidden' }}>
              <div style={{ width: `${f.maxPoints ? (f.points / f.maxPoints) * 100 : 0}%`, height: '100%', background: tone.color }} />
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 3 }}>{f.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const DealDetailModal = ({ dealId, members, onClose, onSaved, onDeleted }) => {
  const [deal, setDeal] = useState(null);
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [ownerUserId, setOwner] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [activities, setActivities] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [postingNote, setPostingNote] = useState(false);

  useEffect(() => {
    wFetch(`/deals/${dealId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load deal'))))
      .then(d => {
        setDeal(d);
        setTitle(d.title);
        setValue(d.value == null ? '' : String(d.value));
        setCloseDate(toDateInput(d.expectedCloseDate));
        setOwner(d.ownerUserId || '');
      })
      .catch(e => setErr(e.message));

    wFetch(`/activities?dealId=${dealId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && d.data) setActivities(d.data); })
      .catch(() => {});
  }, [dealId]);

  const save = async () => {
    if (!title.trim()) { setErr('Title is required'); return; }
    setErr(null); setSaving(true);
    try {
      const res = await wFetch(`/deals/${dealId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          value: value === '' ? null : Number(value),
          expectedCloseDate: closeDate || null,
          ownerUserId: ownerUserId || null,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Update failed'); }
      onSaved(await res.json());
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  const remove = async () => {
    setErr(null); setSaving(true);
    try {
      const res = await wFetch(`/deals/${dealId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Delete failed'); }
      onDeleted(dealId);
    } catch (e) { setErr(e.message); setSaving(false); }
  };

  const postNote = async () => {
    if (!newNote.trim()) return;
    setPostingNote(true);
    try {
      const res = await wFetch(`/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId, type: 'NOTE', content: newNote.trim() })
      });
      if (res.ok) {
        const d = await res.json();
        setActivities([{ ...d, feedType: 'ACTIVITY' }, ...activities]);
        setNewNote('');
      }
    } finally { setPostingNote(false); }
  };

  return (
    <Modal title={deal ? deal.title : 'Deal'} onClose={onClose} width={560}
      footer={<>
        <Btn variant="outline" size="sm" onClick={remove} disabled={saving || !deal}>Delete</Btn>
        <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={save} disabled={saving || !deal}>{saving ? 'Saving…' : 'Save'}</Btn>
      </>}>
      {err && <div style={{ marginBottom: 12 }}><ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner></div>}
      {!deal ? (
        <div style={{ fontSize: 12.5, color: 'var(--t3)' }}>Loading…</div>
      ) : (
        <>
          <HealthPanel health={deal.health} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 22 }}>
            <div><FLabel required>Title</FLabel><FInput value={title} onChange={e => setTitle(e.target.value)} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><FLabel>Value (INR)</FLabel><FInput type="number" value={value} onChange={e => setValue(e.target.value)} /></div>
              <div><FLabel>Expected close</FLabel><FInput type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} /></div>
            </div>
            <div>
              <FLabel>Owner</FLabel>
              <FSelect value={ownerUserId} onChange={e => setOwner(e.target.value)} placeholder="Unassigned"
                options={members.map(m => ({ value: m.user.id, label: m.user.name || m.user.email }))} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--t3)' }}>
              <span>Current stage</span>
              <StatusBadge label={pretty(deal.stage)} tone={STAGE_TONE[deal.stage]} />
              {deal.lostReason && <span>· {deal.lostReason}</span>}
            </div>
          </div>

          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--t1)', marginBottom: 10 }}>Activity</div>
          <div style={{ marginBottom: 16 }}>
            <FTextarea rows={2} placeholder="Add a note..." value={newNote} onChange={e => setNewNote(e.target.value)} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <Btn size="xs" onClick={postNote} disabled={!newNote.trim() || postingNote}>Post Note</Btn>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, maxHeight: 300, overflowY: 'auto' }}>
            {activities.length === 0 ? <div style={{ fontSize: 12, color: 'var(--t3)' }}>No activity yet.</div> : null}
            {activities.map((a, i) => (
              <div key={a.id} style={{ display: 'flex', gap: 12, paddingBottom: 14, position: 'relative' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: a.feedType === 'STAGE_CHANGE' ? 'var(--green)' : '#0ea5e9', marginTop: 5 }} />
                  {i < activities.length - 1 && <div style={{ width: 1, flex: 1, background: 'var(--bd)', marginTop: 3 }} />}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--t1)', fontWeight: 600 }}>
                    {a.feedType === 'STAGE_CHANGE' 
                      ? (a.fromStage ? `${pretty(a.fromStage)} → ${pretty(a.toStage)}` : `Created in ${pretty(a.toStage)}`)
                      : 'Note added'}
                  </div>
                  {a.feedType === 'ACTIVITY' && (
                    <div style={{ fontSize: 12.5, color: 'var(--t1)', marginTop: 4, background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)' }}>
                      {a.content}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
                    {new Date(a.createdAt).toLocaleString('en-IN')}
                    {a.createdByUser?.name ? ` · ${a.createdByUser.name}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* The agent changes this deal on its own schedule; this is where
              those changes and its held-back suggestions surface. */}
          <div style={{ marginTop: 18 }}>
            <AgentTab targetType="deal" targetId={dealId} />
          </div>
        </>
      )}
    </Modal>
  );
};

const NewDealModal = ({ members, onClose, onCreated }) => {
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState([]);
  const [contactId, setContactId] = useState(null);
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [stage, setStage] = useState('QUALIFICATION');
  const [ownerUserId, setOwner] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    wFetch(`/contacts?search=${encodeURIComponent(search)}&limit=20`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setContacts(Array.isArray(d) ? d : d.data ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [search]);

  const submit = async () => {
    if (!contactId) { setErr('Select a contact'); return; }
    if (!title.trim()) { setErr('Title is required'); return; }
    setErr(null); setSaving(true);
    try {
      const res = await wFetch('/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId, title: title.trim(), stage,
          value: value === '' ? null : Number(value),
          ownerUserId: ownerUserId || null,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Could not create deal'); }
      onCreated(await res.json());
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  return (
    <Modal title="New Deal" onClose={onClose} width={520}
      footer={<>
        <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create Deal'}</Btn>
      </>}>
      {err && <div style={{ marginBottom: 12 }}><ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner></div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><FLabel required>Title</FLabel><FInput value={title} onChange={e => setTitle(e.target.value)} placeholder="Annual subscription — Acme" /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><FLabel>Value (INR)</FLabel><FInput type="number" value={value} onChange={e => setValue(e.target.value)} /></div>
          <div>
            <FLabel>Stage</FLabel>
            <FSelect value={stage} onChange={e => setStage(e.target.value)} options={STAGES.map(s => ({ value: s, label: pretty(s) }))} />
          </div>
        </div>
        <div>
          <FLabel>Owner</FLabel>
          <FSelect value={ownerUserId} onChange={e => setOwner(e.target.value)} placeholder="Unassigned"
            options={members.map(m => ({ value: m.user.id, label: m.user.name || m.user.email }))} />
        </div>
        <div>
          <FLabel required>Contact</FLabel>
          <FInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contacts" />
          <div style={{ marginTop: 8, maxHeight: 190, overflowY: 'auto', border: '1px solid var(--bd)', borderRadius: 8 }}>
            {contacts.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: 'var(--t3)' }}>No contacts found.</div>}
            {contacts.map(c => (
              <button key={c.id} onClick={() => setContactId(c.id)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', textAlign: 'left',
                  background: contactId === c.id ? 'var(--gbg)' : 'transparent', border: 'none', borderBottom: '1px solid var(--bd)' }}>
                <Avatar name={c.name} size={26} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t1)' }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--t3)' }}>{c.phoneNumber}</div>
                </div>
                {contactId === c.id && <span style={{ marginLeft: 'auto' }}><I n="check" s={14} c="var(--green)" /></span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default function DealsView({ initialTab }) {
  const [tab, setTab] = useState(initialTab === 'table' ? 'table' : 'board');
  const [deals, setDeals] = useState([]);
  const [members, setMembers] = useState([]);
  const [owner, setOwner] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverStage, setDragOverStage] = useState(null);
  const [openDealId, setOpenDealId] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (owner) qs.set('ownerUserId', owner);
    wFetch(`/deals?${qs}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load deals'))))
      .then(d => setDeals(d.data ?? []))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [owner]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    wFetch('/members').then(r => r.ok && r.json()).then(d => { if (Array.isArray(d)) setMembers(d); }).catch(() => {});
  }, []);

  const switchTab = (next) => {
    setTab(next);
    const url = next === 'table' ? '/dashboard/deals?tab=table' : '/dashboard/deals';
    window.history.replaceState({}, '', url);
  };

  // Optimistic move: the card jumps immediately, then the API call decides
  // whether it stays. A rejected move is rolled back to the exact prior list
  // so a failed drag can never silently look like a successful one.
  const moveTo = async (dealId, stage) => {
    const snapshot = deals;
    const target = deals.find(d => d.id === dealId);
    if (!target || target.stage === stage) return;

    setErr(null);
    setDeals(prev => prev.map(d => (d.id === dealId ? { ...d, stage } : d)));

    try {
      const res = await wFetch(`/deals/${dealId}/stage`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Could not move deal'); }
      const updated = await res.json();
      setDeals(prev => prev.map(d => (d.id === dealId ? { ...d, ...updated } : d)));
    } catch (e) {
      setDeals(snapshot);
      setErr(`${e.message} — "${target.title}" was moved back.`);
    }
  };

  // Keyboard equivalent of dragging a card: shift it one column along the
  // pipeline. Same optimistic path and rollback as the drop handler.
  const nudgeStage = (deal, direction) => {
    const from = STAGES.indexOf(deal.stage);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= STAGES.length) return;
    moveTo(deal.id, STAGES[to]);
  };

  const byStage = stage => deals.filter(d => d.stage === stage);
  const stageTotal = stage => byStage(stage).reduce((sum, d) => sum + Number(d.value ?? 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ height: 58, borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', flexShrink: 0, background: 'var(--surf)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, color: 'var(--t1)' }}>Deals</span>
          <span style={{ fontSize: 12.5, color: 'var(--t3)' }}>{deals.length}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 170 }}>
            <FSelect value={owner} onChange={e => setOwner(e.target.value)} placeholder="All owners"
              options={members.map(m => ({ value: m.user.id, label: m.user.name || m.user.email }))} />
          </div>
          <ImportExport entity="deals" />
          <SavedViews
            entity="deals"
            current={{ ownerUserId: owner, tab }}
            onApply={(f) => {
              setOwner(f.ownerUserId ?? '');
              if (f.tab) switchTab(f.tab);
            }}
          />
          <div style={{ display: 'flex', gap: 4 }}>
            {[['board', 'Board'], ['table', 'Table']].map(([id, label]) => (
              <Btn key={id} size="sm" variant={tab === id ? 'primary' : 'ghost'} onClick={() => switchTab(id)}>{label}</Btn>
            ))}
          </div>
          <Btn size="sm" onClick={() => setCreating(true)}><I n="plus" s={14} c="#060A10" /> New Deal</Btn>
        </div>
      </div>

      {err && <div style={{ padding: '12px 28px 0' }}><ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner></div>}

      {loading && deals.length === 0 ? (
        <div style={{ padding: 28, fontSize: 12.5, color: 'var(--t3)' }}>Loading deals…</div>
      ) : tab === 'board' ? (
        <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', padding: '18px 28px' }}>
          <div style={{ display: 'flex', gap: 14, height: '100%', minWidth: 'min-content' }}>
            {STAGES.map(stage => {
              const items = byStage(stage);
              const isOver = dragOverStage === stage;
              return (
                <div key={stage}
                  onDragOver={e => { e.preventDefault(); setDragOverStage(stage); }}
                  onDragLeave={() => setDragOverStage(s => (s === stage ? null : s))}
                  onDrop={e => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData('text/plain');
                    setDragOverStage(null); setDraggingId(null);
                    if (id) moveTo(id, stage);
                  }}
                  style={{ width: 268, flexShrink: 0, display: 'flex', flexDirection: 'column',
                    borderRadius: 'var(--rl)', padding: 10,
                    background: isOver ? 'rgba(30,191,94,0.06)' : 'rgba(255,255,255,0.015)',
                    border: `1px solid ${isOver ? 'var(--gbd)' : 'var(--bd)'}`,
                    transition: 'background .15s ease, border-color .15s ease' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '2px 3px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <StatusBadge label={pretty(stage)} tone={STAGE_TONE[stage]} />
                      <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600 }}>{items.length}</span>
                    </div>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--t2)' }}>
                      {stageTotal(stage) > 0 ? fmtMoney(stageTotal(stage)) : ''}
                    </span>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', minHeight: 60 }}>
                    {items.map(d => (
                      <DealCard key={d.id} deal={d} dragging={draggingId === d.id}
                        onDragStart={e => { e.dataTransfer.setData('text/plain', d.id); e.dataTransfer.effectAllowed = 'move'; setDraggingId(d.id); }}
                        onClick={() => setOpenDealId(d.id)}
                        onMoveStage={nudgeStage} />
                    ))}
                    {items.length === 0 && (
                      <div style={{ padding: '18px 8px', textAlign: 'center', fontSize: 11.5, color: 'var(--t3)' }}>
                        Drop a deal here
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 28px' }}>
          <div style={{ ...card, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bd)', background: 'rgba(255,255,255,0.02)' }}>
                  <ColHead>Deal</ColHead>
                  <ColHead>Contact</ColHead>
                  <ColHead>Stage</ColHead>
                  <ColHead>Value</ColHead>
                  <ColHead>Owner</ColHead>
                  <ColHead>Expected close</ColHead>
                </tr>
              </thead>
              <tbody>
                {deals.map(d => (
                  <tr key={d.id} onClick={() => setOpenDealId(d.id)}
                    style={{ borderBottom: '1px solid var(--bd)', cursor: 'pointer' }}>
                    <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{d.title}</td>
                    <td style={{ padding: '11px 16px', fontSize: 12.5, color: 'var(--t2)' }}>{d.contact?.name || '—'}</td>
                    <td style={{ padding: '11px 16px' }}><StatusBadge label={pretty(d.stage)} tone={STAGE_TONE[d.stage]} /></td>
                    <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>{fmtMoney(d.value)}</td>
                    <td style={{ padding: '11px 16px', fontSize: 12.5, color: 'var(--t2)' }}>{d.owner?.name || '—'}</td>
                    <td style={{ padding: '11px 16px', fontSize: 12.5, color: 'var(--t2)' }}>{fmtDate(d.expectedCloseDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {deals.length === 0 && (
              <div style={{ padding: '38px 20px', textAlign: 'center' }}>
                <I n="briefcase" s={26} c="var(--t3)" />
                <div style={{ marginTop: 10, fontSize: 13, color: 'var(--t2)', fontWeight: 600 }}>No deals yet</div>
                <div style={{ marginTop: 4, fontSize: 12, color: 'var(--t3)' }}>Convert a lead or create a deal directly.</div>
              </div>
            )}
          </div>
        </div>
      )}

      {openDealId && (
        <DealDetailModal dealId={openDealId} members={members}
          onClose={() => setOpenDealId(null)}
          onSaved={(updated) => {
            setDeals(prev => prev.map(d => (d.id === updated.id ? { ...d, ...updated } : d)));
            setOpenDealId(null);
          }}
          onDeleted={(id) => { setDeals(prev => prev.filter(d => d.id !== id)); setOpenDealId(null); }} />
      )}

      {creating && (
        <NewDealModal members={members} onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); load(); }} />
      )}
    </div>
  );
}
