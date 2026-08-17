import { useState, useEffect, useCallback, useMemo } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { Modal } from '../components/Modal.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { FInput, FLabel, FSelect, FTextarea } from '../components/Form.jsx';
import { wFetch } from '../lib/api.js';

// Customer support queues.
//
// Two server rules shape this screen, and both are surfaced rather than left
// to fail on submit:
//
//   1. Status moves only through PATCH /:id/status, and only along the
//      transitions in ALLOWED_TRANSITIONS. Offering an illegal move would just
//      produce a 409, so only legal moves are offered.
//   2. Raising priority recomputes the deadline from when the ticket was
//      *filed*, not from now. On an old ticket that can make it overdue the
//      instant you change it — surprising enough to warn about first.

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const VIEWS = [
  { id: 'open', label: 'Open' },
  { id: 'mine', label: 'Mine' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'all', label: 'All' },
];

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const PRIORITY_TONE = { URGENT: 'red', HIGH: 'amber', NORMAL: 'blue', LOW: 'gray' };
const STATUS_TONE = { NEW: 'violet', OPEN: 'green', WAITING: 'amber', RESOLVED: 'blue', CLOSED: 'gray' };

// Mirrors ALLOWED_TRANSITIONS in backend/src/services/tickets.service.js. The
// server is still the authority — this only decides which buttons to draw.
const ALLOWED_TRANSITIONS = {
  NEW: ['OPEN', 'WAITING', 'RESOLVED', 'CLOSED'],
  OPEN: ['WAITING', 'RESOLVED', 'CLOSED'],
  WAITING: ['OPEN', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['OPEN', 'CLOSED'],
  CLOSED: ['OPEN'],
};

// Mirrors SLA_HOURS. Shown when picking a priority so the deadline is not a
// surprise after saving.
const SLA_HOURS = { URGENT: 2, HIGH: 8, NORMAL: 24, LOW: 72 };

const SETTLED = ['RESOLVED', 'CLOSED'];

const pretty = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

// "in 3h" / "5h ago", which is what a queue actually needs to read.
function relativeDue(dueAt) {
  if (!dueAt) return { text: '—', overdue: false };
  const diff = new Date(dueAt) - Date.now();
  const overdue = diff < 0;
  const mins = Math.round(Math.abs(diff) / 60000);
  const span = mins < 60 ? `${mins}m`
    : mins < 1440 ? `${Math.round(mins / 60)}h`
    : `${Math.round(mins / 1440)}d`;
  return { text: overdue ? `${span} overdue` : `due in ${span}`, overdue };
}

const ErrorBanner = ({ children, onDismiss }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 14px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)', color: '#f87171', fontSize: 12.5 }}>
    <span>{children}</span>
    {onDismiss && <button onClick={onDismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}><I n="x" s={14} c="#f87171" /></button>}
  </div>
);

const Note = ({ children }) => (
  <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '10px 13px', borderRadius: 8, background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.22)', fontSize: 12.5, color: '#fbbf24', lineHeight: 1.55 }}>
    <span style={{ flexShrink: 0, marginTop: 1 }}><I n="alertt" s={14} c="#fbbf24" /></span>
    <span>{children}</span>
  </div>
);

// ─── create ──────────────────────────────────────────────────────────────────

const NewTicket = ({ contacts, members, onClose, onCreated }) => {
  const [draft, setDraft] = useState({ subject: '', description: '', priority: 'NORMAL', category: '', contactId: '', ownerUserId: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await wFetch('/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: draft.subject.trim(),
          description: draft.description.trim() || null,
          priority: draft.priority,
          category: draft.category.trim() || null,
          contactId: draft.contactId || null,
          ownerUserId: draft.ownerUserId || null,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || b.message || `Could not create the ticket (${res.status}).`);
      }
      onCreated(await res.json());
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title="New ticket"
      onClose={onClose}
      width={560}
      footer={<>
        <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={save} disabled={saving || !draft.subject.trim()}>{saving ? 'Creating…' : 'Create ticket'}</Btn>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
        {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}

        <div>
          <FLabel required>Subject</FLabel>
          <FInput value={draft.subject} onChange={(e) => set({ subject: e.target.value })} placeholder="What is the problem?" disabled={saving} />
        </div>

        <div>
          <FLabel>Description</FLabel>
          <FTextarea value={draft.description} onChange={(e) => set({ description: e.target.value })} rows={4} disabled={saving} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <FLabel>Priority</FLabel>
            <FSelect value={draft.priority} onChange={(e) => set({ priority: e.target.value })} disabled={saving}
              options={PRIORITIES.map((p) => ({ value: p, label: `${pretty(p)} — respond within ${SLA_HOURS[p]}h` }))} />
          </div>
          <div>
            <FLabel>Category</FLabel>
            <FInput value={draft.category} onChange={(e) => set({ category: e.target.value })} placeholder="Billing, Delivery…" disabled={saving} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <FLabel>Contact</FLabel>
            <FSelect value={draft.contactId} onChange={(e) => set({ contactId: e.target.value })} placeholder="Nobody linked" disabled={saving}
              options={contacts.map((c) => ({ value: c.id, label: c.name || c.phoneNumber }))} />
          </div>
          <div>
            <FLabel>Assign to</FLabel>
            <FSelect value={draft.ownerUserId} onChange={(e) => set({ ownerUserId: e.target.value })} placeholder="Unassigned" disabled={saving}
              options={members.map((m) => ({ value: m.userId ?? m.id, label: m.user?.name || m.user?.email || m.name || m.email || 'Member' }))} />
          </div>
        </div>
      </div>
    </Modal>
  );
};

// ─── detail ──────────────────────────────────────────────────────────────────

const TicketDetail = ({ ticket, members, onClose, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [priority, setPriority] = useState(ticket.priority);
  const [ownerUserId, setOwnerUserId] = useState(ticket.ownerUserId ?? '');

  const due = relativeDue(ticket.dueAt);
  const settled = SETTLED.includes(ticket.status);
  const moves = ALLOWED_TRANSITIONS[ticket.status] ?? [];

  // The deadline is recomputed from createdAt, so raising priority on an old
  // ticket can breach it immediately. Worth saying before the click, not after.
  const raisedPriority = priority !== ticket.priority;
  const wouldBreach = raisedPriority && !settled
    && new Date(ticket.createdAt).getTime() + SLA_HOURS[priority] * 3600_000 < Date.now();

  const patch = async (body) => {
    setBusy(true);
    setError(null);
    try {
      const res = await wFetch(`/tickets/${ticket.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || b.message || `Could not update the ticket (${res.status}).`);
      }
      await onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const move = async (status) => {
    setBusy(true);
    setError(null);
    try {
      const res = await wFetch(`/tickets/${ticket.id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || b.message || `Could not change the status (${res.status}).`);
      }
      await onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  return (
    <Modal
      title={`${ticket.ticketNumber} · ${ticket.subject}`}
      onClose={onClose}
      width={680}
      footer={<Btn variant="ghost" size="sm" onClick={onClose}>Close</Btn>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <StatusBadge tone={STATUS_TONE[ticket.status] ?? 'gray'} label={pretty(ticket.status)} />
          <StatusBadge tone={PRIORITY_TONE[ticket.priority] ?? 'gray'} label={pretty(ticket.priority)} />
          {ticket.category && <StatusBadge tone="gray" label={ticket.category} />}
          {!settled && <StatusBadge tone={due.overdue ? 'red' : 'gray'} label={due.text} />}
        </div>

        {ticket.description && (
          <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: 0 }}>{ticket.description}</p>
        )}

        <div style={{ ...card, padding: '13px 15px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          {[
            ['Contact', ticket.contact?.name || ticket.contact?.phoneNumber || '—'],
            ['Owner', ticket.owner?.name || ticket.owner?.email || 'Unassigned'],
            ['Team', ticket.team?.name || '—'],
            ['Filed', fmtDateTime(ticket.createdAt)],
            ['Response due', fmtDateTime(ticket.dueAt)],
            ['First reply', fmtDateTime(ticket.firstRespondedAt)],
            ...(ticket.resolvedAt ? [['Resolved', fmtDateTime(ticket.resolvedAt)]] : []),
            ...(ticket.closedAt ? [['Closed', fmtDateTime(ticket.closedAt)]] : []),
          ].map(([label, value]) => (
            <div key={label}>
              <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--t3)', marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: 12.5, color: 'var(--t1)' }}>{value}</div>
            </div>
          ))}
        </div>

        <div>
          <FLabel>Move to</FLabel>
          {moves.length === 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--t3)', margin: 0 }}>No moves available from {pretty(ticket.status).toLowerCase()}.</p>
          ) : (
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {moves.map((s) => (
                <Btn key={s} size="sm" variant="ghost" onClick={() => move(s)} disabled={busy}>{pretty(s)}</Btn>
              ))}
            </div>
          )}
          <p style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 6 }}>
            Only the moves this ticket's lifecycle permits are shown.
            {ticket.status === 'CLOSED' && ' Reopening restarts the response clock.'}
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'end' }}>
          <div>
            <FLabel>Priority</FLabel>
            <FSelect value={priority} onChange={(e) => setPriority(e.target.value)} disabled={busy}
              options={PRIORITIES.map((p) => ({ value: p, label: `${pretty(p)} — ${SLA_HOURS[p]}h` }))} />
          </div>
          <div>
            <FLabel>Owner</FLabel>
            <FSelect value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)} placeholder="Unassigned" disabled={busy}
              options={members.map((m) => ({ value: m.userId ?? m.id, label: m.user?.name || m.user?.email || m.name || m.email || 'Member' }))} />
          </div>
        </div>

        {wouldBreach && (
          <Note>
            The response deadline is measured from when the ticket was filed, not from now.
            At {pretty(priority).toLowerCase()} priority ({SLA_HOURS[priority]}h) this ticket
            would already be overdue the moment you apply it.
          </Note>
        )}

        {(priority !== ticket.priority || ownerUserId !== (ticket.ownerUserId ?? '')) && (
          <Btn size="sm" disabled={busy}
            onClick={() => patch({ priority, ownerUserId: ownerUserId || null })}>
            Apply changes
          </Btn>
        )}
      </div>
    </Modal>
  );
};

// ─── list ────────────────────────────────────────────────────────────────────

export default function TicketsView() {
  const [view, setView] = useState('open');
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({});
  const [members, setMembers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async (which = view) => {
    try {
      const [listRes, countRes] = await Promise.all([
        wFetch(`/tickets?view=${which}`),
        wFetch('/tickets/counts'),
      ]);
      if (!listRes.ok) throw new Error(`Could not load tickets (${listRes.status}).`);
      const body = await listRes.json();
      setTickets(body.data ?? []);
      if (countRes.ok) setCounts(await countRes.json());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [view]);

  useEffect(() => { setLoading(true); load(view); }, [view, load]);

  useEffect(() => {
    wFetch('/members').then((r) => (r.ok ? r.json() : { data: [] })).then((b) => setMembers(b.data ?? b.members ?? [])).catch(() => setMembers([]));
    wFetch('/contacts?limit=200').then((r) => (r.ok ? r.json() : { data: [] })).then((b) => setContacts(b.data ?? [])).catch(() => setContacts([]));
  }, []);

  const openDetail = async (t) => {
    try {
      const res = await wFetch(`/tickets/${t.id}`);
      if (!res.ok) throw new Error(`Could not open the ticket (${res.status}).`);
      setDetail(await res.json());
    } catch (e) {
      setError(e.message);
    }
  };

  const refresh = async () => {
    await load(view);
    if (detail) {
      const res = await wFetch(`/tickets/${detail.id}`);
      if (res.ok) setDetail(await res.json());
    }
  };

  const overdueInView = useMemo(() => tickets.filter((t) => t.isOverdue).length, [tickets]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--t1)', marginBottom: 4 }}>Support tickets</h1>
          <p style={{ fontSize: 13, color: 'var(--t3)', maxWidth: 600, lineHeight: 1.55 }}>
            Customer issues with a response target by priority. The queue is sorted by urgency, then
            by whichever is closest to missing its deadline.
          </p>
        </div>
        <Btn size="sm" onClick={() => setCreating(true)}><I n="plus" s={14} /> New ticket</Btn>
      </div>

      {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {VIEWS.map((v) => {
          const active = v.id === view;
          const n = counts[v.id];
          return (
            <button key={v.id} onClick={() => setView(v.id)}
              style={{
                padding: '7px 13px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
                border: `1px solid ${active ? 'var(--gbd)' : 'var(--bd)'}`,
                background: active ? 'var(--gbg)' : 'transparent',
                color: active ? 'var(--green)' : 'var(--t2)',
                display: 'inline-flex', alignItems: 'center', gap: 7,
              }}>
              {v.label}
              {n !== undefined && (
                <span style={{ fontSize: 11, color: v.id === 'overdue' && n > 0 ? '#f87171' : 'var(--t3)' }}>{n}</span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div style={{ ...card, padding: 30, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>Loading…</div>
      ) : tickets.length === 0 ? (
        <div style={{ ...card, padding: '38px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--t1)', marginBottom: 6 }}>Nothing in this queue</p>
          <p style={{ fontSize: 13, color: 'var(--t3)' }}>
            {view === 'overdue' ? 'No ticket has missed its response target.'
              : view === 'unassigned' ? 'Every open ticket has an owner.'
              : view === 'mine' ? 'No tickets are assigned to you.'
              : 'No tickets yet.'}
          </p>
        </div>
      ) : (
        <>
          {view !== 'overdue' && overdueInView > 0 && (
            <Note>{overdueInView} ticket{overdueInView === 1 ? ' has' : 's have'} missed the response target in this queue.</Note>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tickets.map((t) => {
              const due = relativeDue(t.dueAt);
              const settled = SETTLED.includes(t.status);
              return (
                <button key={t.id} onClick={() => openDetail(t)} className="m-lift"
                  style={{ ...card, padding: '13px 16px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--t3)', flexShrink: 0 }}>{t.ticketNumber}</span>
                  <span style={{ flex: 1, minWidth: 180, fontSize: 13.5, color: 'var(--t1)', fontWeight: 500 }}>{t.subject}</span>
                  <StatusBadge tone={PRIORITY_TONE[t.priority] ?? 'gray'} label={pretty(t.priority)} />
                  <StatusBadge tone={STATUS_TONE[t.status] ?? 'gray'} label={pretty(t.status)} />
                  <span style={{ fontSize: 11.5, color: t.isOverdue ? '#f87171' : 'var(--t3)', minWidth: 92, textAlign: 'right' }}>
                    {settled ? '—' : due.text}
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--t3)', minWidth: 90, textAlign: 'right' }}>
                    {t.owner?.name || t.owner?.email || 'Unassigned'}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {creating && (
        <NewTicket
          contacts={contacts}
          members={members}
          onClose={() => setCreating(false)}
          onCreated={async () => { setCreating(false); await load(view); }}
        />
      )}

      {detail && (
        <TicketDetail
          ticket={detail}
          members={members}
          onClose={() => setDetail(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
