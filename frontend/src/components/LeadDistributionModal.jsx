import { useState, useEffect } from 'react';
import { Modal } from './Modal.jsx';
import { Btn } from './Btn.jsx';
import { I } from './Icons.jsx';
import { FInput, FLabel, FSelect } from './Form.jsx';
import { wFetch } from '../lib/api.js';

export function LeadDistributionModal({ onClose, members = [], onDistributed }) {
  const [enabled, setEnabled] = useState(true);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [distributing, setDistributing] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    wFetch('/lead-distribution/rules')
      .then((r) => (r.ok ? r.json() : { enabled: false, rules: [] }))
      .then((d) => {
        setEnabled(Boolean(d.enabled));
        setRules(d.rules || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await wFetch('/lead-distribution/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, rules }),
      });
      if (res.ok) {
        setMsg({ type: 'success', text: 'Distribution rules saved successfully.' });
        setTimeout(() => setMsg(null), 3500);
      }
    } catch (e) {
      setMsg({ type: 'error', text: 'Failed to save distribution rules.' });
    } finally {
      setSaving(false);
    }
  };

  const handleAutoDistribute = async () => {
    setDistributing(true);
    setMsg(null);
    try {
      const res = await wFetch('/lead-distribution/distribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const d = await res.json();
        setMsg({
          type: 'success',
          text: `Auto-distributed ${d.assignedCount} of ${d.totalEvaluated} unassigned lead(s).`,
        });
        if (onDistributed) onDistributed();
      }
    } catch (e) {
      setMsg({ type: 'error', text: 'Distribution execution failed.' });
    } finally {
      setDistributing(false);
    }
  };

  const addRule = () => {
    const newRule = {
      id: `rule_${Date.now()}`,
      name: `Rule ${rules.length + 1}`,
      enabled: true,
      conditions: {
        category: 'ANY',
        source: '',
        minScore: '',
      },
      assignment: {
        type: 'ROUND_ROBIN',
        userId: members[0]?.user?.id || '',
        poolUserIds: members.map((m) => m.user.id),
      },
    };
    setRules([...rules, newRule]);
  };

  const updateRule = (idx, patch) => {
    const next = [...rules];
    next[idx] = { ...next[idx], ...patch };
    setRules(next);
  };

  const deleteRule = (idx) => {
    setRules(rules.filter((_, i) => i !== idx));
  };

  return (
    <Modal title="Lead Distribution & Routing Rules" onClose={onClose} width={720}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)', borderRadius: 8 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>Automatic Inbound Routing</div>
            <div style={{ fontSize: 11.5, color: 'var(--t3)' }}>Route incoming leads to sales reps based on score, category, and source</div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--accent, #35e8f2)' }}
            />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: enabled ? 'var(--green)' : 'var(--t3)' }}>
              {enabled ? 'Active' : 'Paused'}
            </span>
          </label>
        </div>

        {msg && (
          <div style={{
            padding: '10px 14px',
            borderRadius: 6,
            fontSize: 12.5,
            background: msg.type === 'success' ? 'rgba(52, 211, 153, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${msg.type === 'success' ? 'rgba(52, 211, 153, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
            color: msg.type === 'success' ? '#34d399' : '#f87171',
          }}>
            {msg.text}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>Configured Rules ({rules.length})</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn size="sm" variant="sec" onClick={handleAutoDistribute} disabled={distributing}>
              <I n="zap" s={13} /> {distributing ? 'Distributing…' : 'Run on Unassigned Leads'}
            </Btn>
            <Btn size="sm" onClick={addRule}>
              <I n="plus" s={13} /> Add Rule
            </Btn>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--t3)' }}>Loading distribution rules...</div>
        ) : rules.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', border: '1px dashed var(--bd)', borderRadius: 8, color: 'var(--t3)', fontSize: 13 }}>
            No distribution rules configured yet. Click "Add Rule" to automate routing.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 380, overflowY: 'auto' }}>
            {rules.map((rule, idx) => (
              <div key={rule.id || idx} style={{ border: '1px solid var(--bd)', borderRadius: 8, padding: 14, background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <input
                    value={rule.name}
                    onChange={(e) => updateRule(idx, { name: e.target.value })}
                    placeholder="Rule name"
                    style={{ background: 'none', border: 'none', borderBottom: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 13, fontWeight: 700, padding: '2px 4px', outline: 'none' }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--t2)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) => updateRule(idx, { enabled: e.target.checked })}
                      />
                      Enabled
                    </label>
                    <button onClick={() => deleteRule(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                      <I n="trash" s={13} c="#f87171" />
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
                  <div>
                    <FLabel>Category Condition</FLabel>
                    <FSelect
                      value={rule.conditions?.category || 'ANY'}
                      onChange={(e) => updateRule(idx, { conditions: { ...rule.conditions, category: e.target.value } })}
                      options={[
                        { value: 'ANY', label: 'Any Category' },
                        { value: 'HOT', label: 'HOT 🔥' },
                        { value: 'WARM', label: 'WARM ⚡' },
                        { value: 'COLD', label: 'COLD ❄️' },
                      ]}
                    />
                  </div>

                  <div>
                    <FLabel>Source Channel</FLabel>
                    <FInput
                      value={rule.conditions?.source || ''}
                      onChange={(e) => updateRule(idx, { conditions: { ...rule.conditions, source: e.target.value } })}
                      placeholder="e.g. Website, WhatsApp"
                    />
                  </div>

                  <div>
                    <FLabel>Min Lead Score</FLabel>
                    <FInput
                      type="number"
                      value={rule.conditions?.minScore ?? ''}
                      onChange={(e) => updateRule(idx, { conditions: { ...rule.conditions, minScore: e.target.value } })}
                      placeholder="e.g. 70"
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <FLabel>Assignment Strategy</FLabel>
                    <FSelect
                      value={rule.assignment?.type || 'ROUND_ROBIN'}
                      onChange={(e) => updateRule(idx, { assignment: { ...rule.assignment, type: e.target.value } })}
                      options={[
                        { value: 'ROUND_ROBIN', label: 'Round-Robin (Fair Share Across Team)' },
                        { value: 'USER', label: 'Assign Specific Sales Rep' },
                      ]}
                    />
                  </div>

                  {rule.assignment?.type === 'USER' ? (
                    <div>
                      <FLabel>Target Sales Rep</FLabel>
                      <FSelect
                        value={rule.assignment?.userId || ''}
                        onChange={(e) => updateRule(idx, { assignment: { ...rule.assignment, userId: e.target.value } })}
                        options={members.map((m) => ({ value: m.user.id, label: m.user.name || m.user.email }))}
                      />
                    </div>
                  ) : (
                    <div>
                      <FLabel>Team Pool</FLabel>
                      <div style={{ fontSize: 11.5, color: 'var(--t3)', padding: '8px 0' }}>
                        Distributes equally among all {members.length} sales team members.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
          <Btn variant="ghost" onClick={onClose}>Close</Btn>
          <Btn onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Rules'}</Btn>
        </div>
      </div>
    </Modal>
  );
}
