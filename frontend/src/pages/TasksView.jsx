import { useState, useEffect, useCallback, useRef } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { FInput, FLabel, FTextarea } from '../components/Form.jsx';
import { Modal } from '../components/Modal.jsx';
import { wFetch } from '../lib/api.js';

// Due dates carry a time (the picker is datetime-local), so they are shown in
// the viewer's own zone with the time — a date alone made a task due at 9am
// look "not overdue" all morning.
const fmtDue = d => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

const FILTERS = [
  { id: 'PENDING', label: 'Pending' },
  { id: 'OVERDUE', label: 'Overdue' },
  { id: 'COMPLETED', label: 'Completed' },
];

const ErrorBanner = ({ children, onDismiss }) => (
  <div role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 14px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)', color: '#f87171', fontSize: 12.5, marginBottom: 14 }}>
    <span>{children}</span>
    {onDismiss && <button onClick={onDismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}><I n="x" s={14} c="#f87171" /></button>}
  </div>
);

const readError = async (res, fallback) => {
  const d = await res.json().catch(() => ({}));
  return d.error || d.message || `${fallback} (${res.status})`;
};

// The checkbox used to be <I n="circle"> / <I n="check-circle-fill">, neither
// of which exists in the icon set, so it rendered as an empty 18px box and the
// only way to complete a task was to find an invisible button.
const DoneToggle = ({ done, onClick, disabled, label }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    aria-pressed={done}
    title={label}
    style={{
      width: 20, height: 20, borderRadius: '50%', padding: 0, flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      cursor: disabled ? 'not-allowed' : 'pointer',
      border: `1.5px solid ${done ? 'var(--green)' : 'var(--t3)'}`,
      background: done ? 'var(--green)' : 'transparent',
      opacity: disabled ? 0.5 : 1,
    }}
  >
    {done && <I n="check" s={12} c="#060A10" w={2.5} />}
  </button>
);

const NewTaskModal = ({ onClose, onCreated }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await wFetch('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          // datetime-local is wall-clock time with no zone; new Date() reads
          // it as local, so the ISO string carries the right instant.
          dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        }),
      });
      if (!res.ok) throw new Error(await readError(res, 'Could not create the task'));
      onCreated(await res.json());
    } catch (e) {
      setErr(e.message);
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} title="New Task" width={440}
      footer={<>
        <Btn variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Btn>
        <Btn size="sm" onClick={submit} disabled={!title.trim() || saving}>{saving ? 'Creating…' : 'Create Task'}</Btn>
      </>}>
      {err && <ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <FLabel required>Title</FLabel>
          <FInput autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="E.g. Follow up on proposal" maxLength={200}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
        </div>
        <div>
          <FLabel>Description (Optional)</FLabel>
          <FTextarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Details..." maxLength={2000} />
        </div>
        <div>
          <FLabel>Due Date (Optional)</FLabel>
          <FInput type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
};

export default function TasksView() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState('PENDING'); // PENDING, COMPLETED, OVERDUE
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [selected, setSelected] = useState(() => new Set());
  const reqSeq = useRef(0);

  const load = useCallback(() => {
    const seq = ++reqSeq.current;
    setLoading(true);
    const url = filter === 'OVERDUE' ? '/tasks?isOverdue=true' : `/tasks?status=${filter}`;
    wFetch(url)
      .then(async r => {
        if (!r.ok) throw new Error(await readError(r, 'Could not load tasks'));
        return r.json();
      })
      .then(d => {
        if (seq !== reqSeq.current) return;
        setTasks(d.data || []);
        setErr(null);
      })
      .catch(e => { if (seq === reqSeq.current) { setTasks([]); setErr(e.message); } })
      .finally(() => { if (seq === reqSeq.current) setLoading(false); });
  }, [filter]);

  useEffect(() => { load(); setSelected(new Set()); }, [load]);

  const markBusy = (ids, on) => setBusyIds(prev => {
    const next = new Set(prev);
    ids.forEach(id => (on ? next.add(id) : next.delete(id)));
    return next;
  });

  const setStatus = async (ids, status) => {
    markBusy(ids, true);
    setErr(null);
    const results = await Promise.all(ids.map(id => wFetch(`/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).then(r => r.ok).catch(() => false)));
    markBusy(ids, false);
    const failed = results.filter(ok => !ok).length;
    if (failed) setErr(`${failed} of ${ids.length} task${ids.length === 1 ? '' : 's'} could not be updated.`);
    setSelected(new Set());
    load();
  };

  const remove = async (task) => {
    if (!window.confirm(`Delete the task "${task.title}"?`)) return;
    markBusy([task.id], true);
    setErr(null);
    try {
      const res = await wFetch(`/tasks/${task.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error(await readError(res, 'Could not delete the task'));
      setTasks(prev => prev.filter(t => t.id !== task.id));
    } catch (e) {
      setErr(e.message);
    } finally {
      markBusy([task.id], false);
    }
  };

  const toggleSelected = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const isTaskOverdue = (task) => {
    if (task.status === 'COMPLETED' || !task.dueDate) return false;
    return new Date(task.dueDate) < new Date();
  };

  const allSelected = tasks.length > 0 && selected.size === tasks.length;
  const bulkTarget = filter === 'COMPLETED' ? 'PENDING' : 'COMPLETED';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {/* Top Header */}
      <div className="dash-page-head" style={{ minHeight: 58, borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', flexShrink: 0, background: 'var(--surf)', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, color: 'var(--t1)' }}>Tasks</span>
          <span style={{ fontSize: 12.5, color: 'var(--t3)' }}>{tasks.length} task{tasks.length === 1 ? '' : 's'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div role="tablist" aria-label="Task filter" style={{ display: 'flex', background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 2, border: '1px solid rgba(255,255,255,0.08)' }}>
            {FILTERS.map(f => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                style={{
                  background: filter === f.id ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: filter === f.id ? 'var(--t1)' : 'var(--t3)',
                  border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all .2s'
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <Btn size="sm" onClick={() => setShowNew(true)}>
            <I n="plus" s={14} c="#060A10" /> New Task
          </Btn>
        </div>
      </div>

      <div className="dash-page" style={{ padding: '24px', flex: 1 }}>
        {err && <ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner>}

        {selected.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(var(--accent-rgb),0.08)', border: '1px solid rgba(var(--accent-rgb),0.25)', fontSize: 12.5, color: 'var(--t1)' }}>
            <span style={{ fontWeight: 700 }}>{selected.size} selected</span>
            <Btn size="sm" variant="outline" onClick={() => setStatus([...selected], bulkTarget)} disabled={busyIds.size > 0}>
              {bulkTarget === 'COMPLETED' ? 'Mark complete' : 'Reopen'}
            </Btn>
            <button onClick={() => setSelected(new Set())} style={{ background: 'none', border: 'none', color: 'var(--t3)', fontSize: 12, textDecoration: 'underline', cursor: 'pointer' }}>Clear</button>
          </div>
        )}

        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13.5, minWidth: 720 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <th style={{ padding: '12px 8px 12px 16px', width: 28 }}>
                  <input type="checkbox" aria-label="Select all tasks" checked={allSelected} disabled={tasks.length === 0}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(tasks.map(t => t.id)))} />
                </th>
                <th style={{ padding: '12px 8px', color: 'var(--t3)', fontWeight: 600, width: 36 }}><span className="sr-only">Done</span></th>
                <th style={{ padding: '12px 16px', color: 'var(--t3)', fontWeight: 600 }}>Task</th>
                <th style={{ padding: '12px 16px', color: 'var(--t3)', fontWeight: 600 }}>Due</th>
                <th style={{ padding: '12px 16px', color: 'var(--t3)', fontWeight: 600 }}>Assigned To</th>
                <th style={{ padding: '12px 16px', color: 'var(--t3)', fontWeight: 600 }}>Related To</th>
                <th style={{ padding: '12px 16px', width: 40 }}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: 'var(--t3)' }}>Loading...</td></tr>
              ) : tasks.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 48, textAlign: 'center', color: 'var(--t3)' }}>
                    <I n="checkc" s={32} c="rgba(255,255,255,0.2)" />
                    <div style={{ marginTop: 12, fontSize: 14 }}>
                      {filter === 'OVERDUE' ? 'Nothing overdue.' : filter === 'COMPLETED' ? 'No completed tasks yet.' : 'No pending tasks.'}
                    </div>
                  </td>
                </tr>
              ) : (
                tasks.map(t => {
                  const overdue = isTaskOverdue(t);
                  const done = t.status === 'COMPLETED';
                  const busy = busyIds.has(t.id);
                  return (
                    <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background .2s', opacity: busy ? 0.6 : 1 }}>
                      <td style={{ padding: '12px 8px 12px 16px' }}>
                        <input type="checkbox" aria-label={`Select ${t.title}`} checked={selected.has(t.id)} onChange={() => toggleSelected(t.id)} />
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <DoneToggle done={done} disabled={busy}
                          label={done ? `Reopen “${t.title}”` : `Mark “${t.title}” complete`}
                          onClick={() => setStatus([t.id], done ? 'PENDING' : 'COMPLETED')} />
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 600, color: done ? 'var(--t3)' : 'var(--t1)', textDecoration: done ? 'line-through' : 'none' }}>
                          {t.title}
                        </div>
                        {t.description && <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>{t.description}</div>}
                      </td>
                      <td style={{ padding: '12px 16px', color: overdue ? '#f87171' : 'var(--t2)', fontWeight: overdue ? 600 : 400, whiteSpace: 'nowrap' }}>
                        {fmtDue(t.dueDate)}
                        {overdue && <span style={{ marginLeft: 6, fontSize: 11, background: 'rgba(239,68,68,0.1)', color: '#f87171', padding: '2px 6px', borderRadius: 4 }}>Overdue</span>}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {t.assignedTo ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Avatar name={t.assignedTo.name || t.assignedTo.email} url={t.assignedTo.avatarUrl} size={24} />
                            <span style={{ fontSize: 13 }}>{t.assignedTo.name || t.assignedTo.email}</span>
                          </div>
                        ) : <span style={{ color: 'var(--t3)' }}>Unassigned</span>}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 12.5, color: 'var(--t2)' }}>
                        {t.deal ? <div>Deal: {t.deal.title}</div> : null}
                        {t.lead ? <div>Lead{t.contact?.name ? `: ${t.contact.name}` : ''}</div> : null}
                        {t.contact && !t.deal && !t.lead ? <div>Contact: {t.contact.name}</div> : null}
                        {!t.deal && !t.lead && !t.contact && <span style={{ color: 'var(--t3)' }}>—</span>}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <button onClick={() => remove(t)} disabled={busy} aria-label={`Delete ${t.title}`} title="Delete"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'inline-flex' }}>
                          <I n="trash" s={14} c="#f87171" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {showNew && (
          <NewTaskModal
            onClose={() => setShowNew(false)}
            onCreated={() => {
              setShowNew(false);
              // Reload rather than prepend: the list is sorted by due date and a
              // task created with a past due date belongs under Overdue too.
              load();
            }}
          />
        )}
      </div>
    </div>
  );
}
