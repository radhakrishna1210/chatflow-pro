import { useState } from 'react';
import { Modal } from './Modal.jsx';
import { Btn } from './Btn.jsx';
import { FInput, FLabel, FSelect } from './Form.jsx';
import { wFetch } from '../lib/api.js';

export function BulkTaskModal({ leadIds = [], onClose, onCreated }) {
  const [title, setTitle] = useState('Follow-up with lead');
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10));
  const [priority, setPriority] = useState('NORMAL');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const handleSubmit = async () => {
    if (!title.trim()) { setErr('Task title is required'); return; }
    setSaving(true);
    setErr(null);
    try {
      const res = await wFetch('/leads/bulk-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: leadIds, title: title.trim(), dueDate, priority }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to create tasks');
      }
      if (onCreated) onCreated();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Assign Task to ${leadIds.length} Selected Lead(s)`} onClose={onClose} width={460}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {err && (
          <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', color: '#f87171', borderRadius: 6, fontSize: 12 }}>
            {err}
          </div>
        )}

        <div>
          <FLabel required>Task Title</FLabel>
          <FInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Call for qualification, Send contract" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <FLabel>Due Date</FLabel>
            <FInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div>
            <FLabel>Priority</FLabel>
            <FSelect
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              options={[
                { value: 'HIGH', label: '🔴 High Priority' },
                { value: 'NORMAL', label: '🟡 Normal' },
                { value: 'LOW', label: '⚪ Low' },
              ]}
            />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={handleSubmit} disabled={saving}>
            {saving ? 'Creating…' : `Create Tasks (${leadIds.length})`}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
