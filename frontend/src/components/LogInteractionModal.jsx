import { useState, useEffect } from 'react';
import { Modal } from './Modal.jsx';
import { Btn } from './Btn.jsx';
import { FInput, FLabel, FSelect, FTextarea } from './Form.jsx';
import { wFetch } from '../lib/api.js';

const TYPES = [
  { value: 'CALL', label: '📞 Phone Call' },
  { value: 'MEETING', label: '📅 Meeting / Demo' },
  { value: 'EMAIL', label: '✉️ Email Sent' },
  { value: 'NOTE', label: '📝 Internal Note' },
];

const OUTCOMES = [
  'Connected — Spoke with decision maker',
  'No Answer — Left voicemail',
  'Busy — Callback requested',
  'Demo scheduled',
  'Wrong number / Gatekeeper',
  'Not interested',
];

const SENTIMENTS = [
  { value: 'POSITIVE', label: '🟢 Positive Intent' },
  { value: 'NEUTRAL', label: '⚪ Neutral / Exploring' },
  { value: 'NEGATIVE', label: '🔴 Skeptical / Objections' },
];

export function LogInteractionModal({ lead, onClose, onLogged }) {
  const [type, setType] = useState('CALL');
  const [duration, setDuration] = useState('02:30');
  const [outcome, setOutcome] = useState(OUTCOMES[0]);
  const [sentiment, setSentiment] = useState('POSITIVE');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const [callOutcomes, setCallOutcomes] = useState([]);
  const [visitOutcomes, setVisitOutcomes] = useState([]);

  useEffect(() => {
    wFetch('/crm-customization/call_outcomes')
      .then(r => r.ok && r.json())
      .then(d => { if (d?.data?.outcomes) setCallOutcomes(d.data.outcomes); })
      .catch(() => {});

    wFetch('/crm-customization/visit_outcomes')
      .then(r => r.ok && r.json())
      .then(d => { if (d?.data?.outcomes) setVisitOutcomes(d.data.outcomes); })
      .catch(() => {});
  }, []);

  const activeOutcomeOptions = type === 'CALL' && callOutcomes.length > 0
    ? callOutcomes.map(o => ({ value: o.name, label: o.name, sentiment: o.sentiment }))
    : type === 'MEETING' && visitOutcomes.length > 0
      ? visitOutcomes.map(o => ({ value: o.name, label: o.name, sentiment: o.sentiment }))
      : OUTCOMES.map(o => ({ value: o, label: o, sentiment: 'NEUTRAL' }));

  const handleOutcomeChange = (newOutcomeName) => {
    setOutcome(newOutcomeName);
    const matched = activeOutcomeOptions.find(o => o.value === newOutcomeName);
    if (matched?.sentiment) {
      setSentiment(matched.sentiment);
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    setErr(null);
    try {
      const content = [
        `[${type}] Outcome: ${outcome}`,
        type === 'CALL' || type === 'MEETING' ? `Duration: ${duration}` : '',
        `Sentiment: ${sentiment}`,
        notes.trim() ? `Notes: ${notes.trim()}` : '',
      ].filter(Boolean).join(' | ');

      const res = await wFetch('/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          leadId: lead.id,
          contactId: lead.contactId,
          content,
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to log interaction');
      }

      if (onLogged) onLogged();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Log Touchpoint — ${lead.contact?.name || 'Lead'}`} onClose={onClose} width={500}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {err && (
          <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', color: '#f87171', borderRadius: 6, fontSize: 12 }}>
            {err}
          </div>
        )}

        <div>
          <FLabel>Touchpoint Type</FLabel>
          <FSelect value={type} onChange={(e) => setType(e.target.value)} options={TYPES} />
        </div>

        {(type === 'CALL' || type === 'MEETING') && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <FLabel>Call / Meeting Duration</FLabel>
              <FInput value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="MM:SS (e.g. 03:45)" />
            </div>
            <div>
              <FLabel>Sentiment</FLabel>
              <FSelect value={sentiment} onChange={(e) => setSentiment(e.target.value)} options={SENTIMENTS} />
            </div>
          </div>
        )}

        <div>
          <FLabel>Outcome</FLabel>
          <FSelect value={outcome} onChange={(e) => handleOutcomeChange(e.target.value)} options={activeOutcomeOptions} />
        </div>

        <div>
          <FLabel>Conversation Summary / Next Steps</FLabel>
          <FTextarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Discussed pricing, customer requested enterprise quotation..."
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={handleSubmit} disabled={saving}>
            {saving ? 'Logging…' : 'Log Touchpoint'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
