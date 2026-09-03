import { useState, useEffect, useCallback } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { FInput, FLabel, FSelect, FTextarea } from '../components/Form.jsx';
import { Modal } from '../components/Modal.jsx';
import { wFetch } from '../lib/api.js';

const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const NewTaskModal = ({ onClose, onCreated }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await wFetch('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        }),
      });
      if (res.ok) {
        onCreated(await res.json());
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} title="New Task" w={440}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <FLabel>Title</FLabel>
          <FInput autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="E.g. Follow up on proposal" />
        </div>
        <div>
          <FLabel>Description (Optional)</FLabel>
          <FTextarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Details..." />
        </div>
        <div>
          <FLabel>Due Date (Optional)</FLabel>
          <FInput type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
          <Btn outline onClick={onClose} disabled={saving}>Cancel</Btn>
          <Btn onClick={submit} disabled={!title.trim() || saving}>Create Task</Btn>
        </div>
      </div>
    </Modal>
  );
};

export default function TasksView() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState('PENDING'); // PENDING, COMPLETED, OVERDUE

  const load = useCallback(() => {
    setLoading(true);
    let url = `/tasks`;
    if (filter === 'OVERDUE') {
      url += `?isOverdue=true`;
    } else {
      url += `?status=${filter}`;
    }
    wFetch(url)
      .then(r => r.json())
      .then(d => {
        setTasks(d.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const toggleComplete = async (task) => {
    const newStatus = task.status === 'COMPLETED' ? 'PENDING' : 'COMPLETED';
    
    // Optimistic
    setTasks(prev => prev.filter(t => t.id !== task.id)); // since we filter by status usually, removing it from current view is best

    await wFetch(`/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    // Let's just reload to be safe and accurate
    load();
  };

  const isTaskOverdue = (task) => {
    if (task.status === 'COMPLETED' || !task.dueDate) return false;
    return new Date(task.dueDate) < new Date();
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 40px', flex: 1, overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: 'var(--t1)' }}>Tasks</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--t2)', fontSize: 13.5 }}>Manage follow-ups, calls, and action items.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 2, border: '1px solid rgba(255,255,255,0.08)' }}>
            {['PENDING', 'OVERDUE', 'COMPLETED'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  background: filter === f ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: filter === f ? 'var(--t1)' : 'var(--t3)',
                  border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all .2s'
                }}
              >
                {f}
              </button>
            ))}
          </div>
          <Btn onClick={() => setShowNew(true)}>
            <I n="plus" s={14} /> New Task
          </Btn>
        </div>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13.5 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <th style={{ padding: '12px 16px', color: 'var(--t3)', fontWeight: 600, width: 40 }}></th>
              <th style={{ padding: '12px 16px', color: 'var(--t3)', fontWeight: 600 }}>Task</th>
              <th style={{ padding: '12px 16px', color: 'var(--t3)', fontWeight: 600 }}>Due Date</th>
              <th style={{ padding: '12px 16px', color: 'var(--t3)', fontWeight: 600 }}>Assigned To</th>
              <th style={{ padding: '12px 16px', color: 'var(--t3)', fontWeight: 600 }}>Related To</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: 'var(--t3)' }}>Loading...</td></tr>
            ) : tasks.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 48, textAlign: 'center', color: 'var(--t3)' }}>
                  <I n="check-circle" s={32} c="rgba(255,255,255,0.2)" />
                  <div style={{ marginTop: 12, fontSize: 14 }}>No tasks found in this view.</div>
                </td>
              </tr>
            ) : (
              tasks.map(t => {
                const overdue = isTaskOverdue(t);
                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background .2s' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <button 
                        onClick={() => toggleComplete(t)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}
                        title={t.status === 'COMPLETED' ? 'Mark Pending' : 'Mark Completed'}
                      >
                        <I n={t.status === 'COMPLETED' ? 'check-circle-fill' : 'circle'} s={18} c={t.status === 'COMPLETED' ? 'var(--green)' : 'var(--t3)'} />
                      </button>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600, color: t.status === 'COMPLETED' ? 'var(--t3)' : 'var(--t1)', textDecoration: t.status === 'COMPLETED' ? 'line-through' : 'none' }}>
                        {t.title}
                      </div>
                      {t.description && <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>{t.description}</div>}
                    </td>
                    <td style={{ padding: '12px 16px', color: overdue ? '#f87171' : 'var(--t2)', fontWeight: overdue ? 600 : 400 }}>
                      {fmtDate(t.dueDate)}
                      {overdue && <span style={{ marginLeft: 6, fontSize: 11, background: 'rgba(239,68,68,0.1)', color: '#f87171', padding: '2px 6px', borderRadius: 4 }}>Overdue</span>}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {t.assignedTo ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Avatar name={t.assignedTo.name} url={t.assignedTo.avatarUrl} size={24} />
                          <span style={{ fontSize: 13 }}>{t.assignedTo.name}</span>
                        </div>
                      ) : <span style={{ color: 'var(--t3)' }}>Unassigned</span>}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12.5, color: 'var(--t2)' }}>
                      {t.deal ? <div>Deal: {t.deal.title}</div> : null}
                      {t.lead ? <div>Lead</div> : null}
                      {t.contact && !t.deal && !t.lead ? <div>Contact: {t.contact.name}</div> : null}
                      {!t.deal && !t.lead && !t.contact && <span style={{ color: 'var(--t3)' }}>—</span>}
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
          onCreated={(t) => {
            setShowNew(false);
            if (filter === 'PENDING') setTasks([t, ...tasks]);
            else load();
          }}
        />
      )}
    </div>
  );
}
