import { useState, useEffect, useCallback, useMemo } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { Modal } from '../components/Modal.jsx';
import { FInput, FLabel, FSelect, FTextarea } from '../components/Form.jsx';
import { wFetch } from '../lib/api.js';

// Pre-defined palette presets for tags and stages
const COLOR_PALETTE = [
  '#3b82f6', '#06b6d4', '#10b981', '#84cc16', '#f59e0b',
  '#ef4444', '#ec4899', '#8b5cf6', '#6366f1', '#64748b',
];

const TABS = [
  { id: 'lead_lifecycle', label: 'Lead Lifecycle', icon: 'target', desc: 'Define status progression for leads' },
  { id: 'prospecting_criteria', label: 'Prospecting Criteria', icon: 'filter', desc: 'B2B/B2C lead qualification checklist & rules' },
  { id: 'deal_mode', label: 'Deal Mode', icon: 'zap', desc: 'Flexible vs. Automatic task-driven execution' },
  { id: 'lead_tags', label: 'Lead Tags', icon: 'spark', desc: 'Categorized priority and segment tags' },
  { id: 'lead_sources', label: 'Lead Sources', icon: 'globe', desc: 'Channels and attribution sources' },
  { id: 'call_outcomes', label: 'Call Outcomes', icon: 'phone', desc: 'Call dispositions & sentiment scoring' },
  { id: 'visit_outcomes', label: 'Visit Outcomes', icon: 'users', desc: 'Field meeting dispositions & follow-ups' },
  { id: 'deal_setup', label: 'Deal Setup', icon: 'briefcase', desc: 'Stages, win probabilities & SLA days' },
  { id: 'ticket_customization', label: 'Tickets Customization', icon: 'alertc', desc: 'Ticket stages & category SLAs' },
  { id: 'document_categories', label: 'Document Categories', icon: 'file', desc: 'Organization of legal, sales & KYC files' },
];

export default function CustomizeBusinessView({ user, initialTab }) {
  const [activeTab, setActiveTab] = useState(() => {
    if (initialTab && TABS.some((t) => t.id === initialTab)) return initialTab;
    return 'lead_lifecycle';
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState({});
  const [originalData, setOriginalData] = useState({});
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  // Modal states
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [editModal, setEditModal] = useState(null); // { type, item, index }
  const [deleteWarning, setDeleteWarning] = useState(null); // { message, onConfirm }

  // Subtab for ticket customization (stages vs categories)
  const [ticketSubTab, setTicketSubTab] = useState('categories');

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 4000);
  };

  // Load all customizations
  const loadCustomizations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await wFetch('/crm-customization');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load customizations');
      setData(json.data || {});
      setOriginalData(JSON.parse(JSON.stringify(json.data || {})));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCustomizations();
  }, [loadCustomizations]);

  const hasUnsavedChanges = useMemo(() => {
    if (!data[activeTab] || !originalData[activeTab]) return false;
    return JSON.stringify(data[activeTab]) !== JSON.stringify(originalData[activeTab]);
  }, [data, originalData, activeTab]);

  // Save current active tab
  const handleSaveActiveTab = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await wFetch(`/crm-customization/${activeTab}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data[activeTab]),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save changes');

      setData((prev) => ({ ...prev, [activeTab]: json.data }));
      setOriginalData((prev) => ({ ...prev, [activeTab]: JSON.parse(JSON.stringify(json.data)) }));
      showToast('Settings saved successfully!');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setSaving(false);
    }
  };

  // Reset current active tab
  const handleResetActiveTab = async () => {
    setSaving(true);
    try {
      const res = await wFetch(`/crm-customization/${activeTab}/reset`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to reset settings');

      setData((prev) => ({ ...prev, [activeTab]: json.data }));
      setOriginalData((prev) => ({ ...prev, [activeTab]: JSON.parse(JSON.stringify(json.data)) }));
      setResetModalOpen(false);
      showToast('Reset to default settings!');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setSaving(false);
    }
  };

  // Helper to update current tab data
  const updateActiveData = (updater) => {
    setData((prev) => {
      const current = prev[activeTab];
      const updated = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [activeTab]: updated };
    });
  };

  // Safe delete check
  const requestDelete = async (keyOrId, executeDelete) => {
    try {
      const res = await wFetch(`/crm-customization/${activeTab}/check-delete?key=${encodeURIComponent(keyOrId)}`);
      const check = await res.json();
      if (!check.safe) {
        setDeleteWarning({
          message: check.reason,
          canForce: false,
          onConfirm: () => setDeleteWarning(null),
        });
        return;
      }
      executeDelete();
    } catch (err) {
      executeDelete();
    }
  };

  const activeMeta = TABS.find((t) => t.id === activeTab) || TABS[0];

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto', color: 'var(--t1)' }}>
      {/* Toast alert */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 9999,
            padding: '12px 20px',
            borderRadius: 8,
            background: toast.isError ? 'var(--red, #ef4444)' : 'var(--accent, #3b82f6)',
            color: '#fff',
            boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          <I n={toast.isError ? 'alertc' : 'check'} s={16} c="#fff" />
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: 'rgba(59, 130, 246, 0.15)',
                color: 'var(--accent, #3b82f6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <I n="sliders" s={20} />
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
              Customize Your Business
            </h1>
          </div>
          <p style={{ margin: '6px 0 0 46px', fontSize: 13, color: 'var(--t3)' }}>
            Configure CRM pipeline lifecycle, qualification rules, deal automation modes, tags, outcome dispositions, and SLAs.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {hasUnsavedChanges && (
            <span
              style={{
                fontSize: 12,
                color: 'var(--amber, #f59e0b)',
                background: 'rgba(245, 158, 11, 0.1)',
                padding: '4px 10px',
                borderRadius: 6,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b' }} />
              Unsaved changes
            </span>
          )}

          <Btn
            variant="ghost"
            onClick={() => setResetModalOpen(true)}
            disabled={loading || saving}
            style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <I n="rotate" s={14} />
            Reset to Defaults
          </Btn>

          <Btn
            variant="primary"
            onClick={handleSaveActiveTab}
            disabled={loading || saving || !hasUnsavedChanges}
            style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <I n="check" s={14} />
            {saving ? 'Saving...' : 'Save Changes'}
          </Btn>
        </div>
      </div>

      {/* Tab Navigation Pill Bar */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          paddingBottom: 8,
          marginBottom: 24,
          borderBottom: '1px solid var(--border)',
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: 'none',
                background: isActive ? 'var(--accent, #3b82f6)' : 'transparent',
                color: isActive ? '#fff' : 'var(--t2)',
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                transition: 'all 0.15s ease',
              }}
            >
              <I n={tab.icon} s={14} c={isActive ? '#fff' : 'currentColor'} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Main Tab Content */}
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 24,
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        {/* Section title & description */}
        <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 4px 0' }}>{activeMeta.label}</h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--t3)' }}>{activeMeta.desc}</p>
        </div>

        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--t3)' }}>Loading customization settings...</div>
        ) : error ? (
          <div style={{ padding: 24, color: 'var(--red, #ef4444)', background: 'rgba(239, 68, 68, 0.08)', borderRadius: 8 }}>
            {error}
          </div>
        ) : (
          <>
            {activeTab === 'lead_lifecycle' && (
              <LeadLifecycleTab
                config={data.lead_lifecycle}
                onChange={updateActiveData}
                onRequestDelete={requestDelete}
                palette={COLOR_PALETTE}
              />
            )}

            {activeTab === 'prospecting_criteria' && (
              <ProspectingCriteriaTab
                config={data.prospecting_criteria}
                onChange={updateActiveData}
              />
            )}

            {activeTab === 'deal_mode' && (
              <DealModeTab
                config={data.deal_mode}
                onChange={updateActiveData}
              />
            )}

            {activeTab === 'lead_tags' && (
              <LeadTagsTab
                config={data.lead_tags}
                onChange={updateActiveData}
                palette={COLOR_PALETTE}
              />
            )}

            {activeTab === 'lead_sources' && (
              <LeadSourcesTab
                config={data.lead_sources}
                onChange={updateActiveData}
                onRequestDelete={requestDelete}
              />
            )}

            {activeTab === 'call_outcomes' && (
              <CallOutcomesTab
                config={data.call_outcomes}
                onChange={updateActiveData}
              />
            )}

            {activeTab === 'visit_outcomes' && (
              <VisitOutcomesTab
                config={data.visit_outcomes}
                onChange={updateActiveData}
              />
            )}

            {activeTab === 'deal_setup' && (
              <DealSetupTab
                config={data.deal_setup}
                onChange={updateActiveData}
                onRequestDelete={requestDelete}
                palette={COLOR_PALETTE}
              />
            )}

            {activeTab === 'ticket_customization' && (
              <TicketCustomizationTab
                config={data.ticket_customization}
                onChange={updateActiveData}
                subTab={ticketSubTab}
                setSubTab={setTicketSubTab}
                palette={COLOR_PALETTE}
              />
            )}

            {activeTab === 'document_categories' && (
              <DocumentCategoriesTab
                config={data.document_categories}
                onChange={updateActiveData}
                palette={COLOR_PALETTE}
              />
            )}
          </>
        )}
      </div>

      {/* Reset confirmation modal */}
      {resetModalOpen && (
        <Modal
          title={`Reset ${activeMeta.label}?`}
          onClose={() => setResetModalOpen(false)}
        >
          <div style={{ padding: '8px 0 16px 0', fontSize: 14, color: 'var(--t2)', lineHeight: 1.5 }}>
            Are you sure you want to reset <strong>{activeMeta.label}</strong> back to default system settings?
            Any custom changes in this section will be overwritten.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <Btn variant="ghost" onClick={() => setResetModalOpen(false)}>Cancel</Btn>
            <Btn variant="danger" onClick={handleResetActiveTab} disabled={saving}>
              {saving ? 'Resetting...' : 'Yes, Reset to Defaults'}
            </Btn>
          </div>
        </Modal>
      )}

      {/* Safe deletion warning modal */}
      {deleteWarning && (
        <Modal
          title="Cannot Delete Item"
          onClose={() => setDeleteWarning(null)}
        >
          <div style={{ padding: '8px 0 16px 0', fontSize: 14, color: 'var(--t1)', lineHeight: 1.5 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ color: 'var(--amber, #f59e0b)', marginTop: 2 }}>
                <I n="alertt" s={22} />
              </div>
              <div>{deleteWarning.message}</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <Btn variant="primary" onClick={() => setDeleteWarning(null)}>Understood</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* =========================================================================
   TAB 1: LEAD LIFECYCLE
   ========================================================================= */
function LeadLifecycleTab({ config, onChange, onRequestDelete, palette }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [formData, setFormData] = useState({ key: '', label: '', color: palette[0], description: '', isDefault: false });

  const stages = config?.stages || [];

  const handleOpenAdd = () => {
    setEditingIndex(null);
    setFormData({ key: '', label: '', color: palette[0], description: '', isDefault: false });
    setModalOpen(true);
  };

  const handleOpenEdit = (idx) => {
    setEditingIndex(idx);
    setFormData({ ...stages[idx] });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!formData.label.trim()) return;
    const stageKey = formData.key.trim()
      ? formData.key.trim().toUpperCase().replace(/\s+/g, '_')
      : formData.label.trim().toUpperCase().replace(/\s+/g, '_');

    let updatedStages = [...stages];
    if (editingIndex !== null) {
      updatedStages[editingIndex] = { ...formData, key: stageKey };
    } else {
      updatedStages.push({
        ...formData,
        key: stageKey,
        sortOrder: updatedStages.length,
        isProtected: false,
      });
    }

    // If marked as default, unset others
    if (formData.isDefault) {
      updatedStages = updatedStages.map((s, idx) => ({
        ...s,
        isDefault: editingIndex !== null ? idx === editingIndex : idx === updatedStages.length - 1,
      }));
    }

    onChange({ ...config, stages: updatedStages });
    setModalOpen(false);
  };

  const handleMove = (idx, direction) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= stages.length) return;
    const nextStages = [...stages];
    const temp = nextStages[idx];
    nextStages[idx] = nextStages[targetIdx];
    nextStages[targetIdx] = temp;
    nextStages.forEach((s, i) => { s.sortOrder = i; });
    onChange({ ...config, stages: nextStages });
  };

  const handleDelete = (idx) => {
    const target = stages[idx];
    onRequestDelete(target.key, () => {
      const nextStages = stages.filter((_, i) => i !== idx);
      nextStages.forEach((s, i) => { s.sortOrder = i; });
      onChange({ ...config, stages: nextStages });
    });
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t2)' }}>
            Pipeline Stages ({stages.length})
          </span>
          <p style={{ fontSize: 12, color: 'var(--t3)', margin: '2px 0 0 0' }}>
            Stages represent the status of prospective customers from initial capture to conversion.
          </p>
        </div>
        <Btn variant="primary" onClick={handleOpenAdd} style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <I n="plus" s={14} /> Add Stage
        </Btn>
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', color: 'var(--t3)', textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.04em' }}>
              <th style={{ padding: '10px 16px', width: 40 }}>Order</th>
              <th style={{ padding: '10px 16px' }}>Stage Name</th>
              <th style={{ padding: '10px 16px' }}>Key</th>
              <th style={{ padding: '10px 16px' }}>Color</th>
              <th style={{ padding: '10px 16px' }}>Description</th>
              <th style={{ padding: '10px 16px' }}>Default</th>
              <th style={{ padding: '10px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((stage, idx) => (
              <tr key={stage.key || idx} style={{ borderBottom: idx < stages.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <td style={{ padding: '12px 16px', color: 'var(--t3)' }}>{idx + 1}</td>
                <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: stage.color || '#3b82f6', flexShrink: 0 }} />
                    {stage.label}
                  </div>
                </td>
                <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12, color: 'var(--t2)' }}>
                  {stage.key}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 18, height: 18, borderRadius: 4, background: stage.color || '#3b82f6', border: '1px solid rgba(0,0,0,0.1)' }} />
                    <span style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'monospace' }}>{stage.color}</span>
                  </div>
                </td>
                <td style={{ padding: '12px 16px', color: 'var(--t2)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {stage.description || '—'}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  {stage.isDefault ? (
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(59, 130, 246, 0.15)', color: 'var(--accent, #3b82f6)', fontWeight: 600 }}>
                      DEFAULT
                    </span>
                  ) : (
                    <span style={{ color: 'var(--t3)' }}>—</span>
                  )}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <button
                      onClick={() => handleMove(idx, -1)}
                      disabled={idx === 0}
                      title="Move Up"
                      style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.3 : 1, padding: 4, color: 'var(--t2)' }}
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => handleMove(idx, 1)}
                      disabled={idx === stages.length - 1}
                      title="Move Down"
                      style={{ background: 'none', border: 'none', cursor: idx === stages.length - 1 ? 'default' : 'pointer', opacity: idx === stages.length - 1 ? 0.3 : 1, padding: 4, color: 'var(--t2)' }}
                    >
                      ▼
                    </button>
                    <button
                      onClick={() => handleOpenEdit(idx)}
                      title="Edit Stage"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--t2)' }}
                    >
                      <I n="pencil" s={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(idx)}
                      disabled={stage.isProtected}
                      title={stage.isProtected ? 'Protected stage cannot be removed' : 'Delete Stage'}
                      style={{ background: 'none', border: 'none', cursor: stage.isProtected ? 'not-allowed' : 'pointer', opacity: stage.isProtected ? 0.25 : 1, padding: 4, color: 'var(--red, #ef4444)' }}
                    >
                      <I n="trash" s={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <Modal
          title={editingIndex !== null ? 'Edit Lead Stage' : 'Add Lead Stage'}
          onClose={() => setModalOpen(false)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <FLabel>Stage Label *</FLabel>
              <FInput
                value={formData.label}
                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                placeholder="e.g. Demonstration Scheduled"
              />
            </div>

            <div>
              <FLabel>Stage Key (Unique Code)</FLabel>
              <FInput
                value={formData.key}
                onChange={(e) => setFormData({ ...formData, key: e.target.value.toUpperCase().replace(/\s+/g, '_') })}
                placeholder="e.g. DEMO_SCHEDULED (Auto-generated if empty)"
              />
            </div>

            <div>
              <FLabel>Badge Color</FLabel>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                {palette.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFormData({ ...formData, color: c })}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: c,
                      border: formData.color === c ? '2px solid #fff' : '2px solid transparent',
                      boxShadow: formData.color === c ? '0 0 0 2px var(--accent)' : 'none',
                      cursor: 'pointer',
                    }}
                  />
                ))}
                <input
                  type="color"
                  value={formData.color || '#3b82f6'}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  style={{ width: 28, height: 28, border: 'none', background: 'none', cursor: 'pointer' }}
                />
              </div>
            </div>

            <div>
              <FLabel>Description</FLabel>
              <FInput
                value={formData.description || ''}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Short description of what this stage entails"
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginTop: 4 }}>
              <input
                type="checkbox"
                checked={Boolean(formData.isDefault)}
                onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
              />
              <span>Set as default stage for newly imported or captured leads</span>
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <Btn variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={handleSave} disabled={!formData.label.trim()}>
              Save Stage
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* =========================================================================
   TAB 2: PROSPECTING CRITERIA
   ========================================================================= */
function ProspectingCriteriaTab({ config = {}, onChange }) {
  const [newIndustry, setNewIndustry] = useState('');
  const [newQuestion, setNewQuestion] = useState('');

  const targetIndustries = config.targetIndustries || [];
  const checklist = config.checklist || [];

  const handleToggleIndustry = (ind) => {
    let next;
    if (targetIndustries.includes(ind)) {
      next = targetIndustries.filter((x) => x !== ind);
    } else {
      next = [...targetIndustries, ind];
    }
    onChange({ ...config, targetIndustries: next });
  };

  const handleAddIndustry = (e) => {
    e.preventDefault();
    if (!newIndustry.trim() || targetIndustries.includes(newIndustry.trim())) return;
    onChange({ ...config, targetIndustries: [...targetIndustries, newIndustry.trim()] });
    setNewIndustry('');
  };

  const handleAddQuestion = (e) => {
    e.preventDefault();
    if (!newQuestion.trim()) return;
    const item = {
      id: `crit_${Date.now()}`,
      question: newQuestion.trim(),
      required: true,
      weight: 20,
    };
    onChange({ ...config, checklist: [...checklist, item] });
    setNewQuestion('');
  };

  const handleRemoveQuestion = (id) => {
    onChange({ ...config, checklist: checklist.filter((c) => c.id !== id) });
  };

  const handleUpdateQuestion = (id, field, value) => {
    const next = checklist.map((c) => (c.id === id ? { ...c, [field]: value } : c));
    onChange({ ...config, checklist: next });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Basic Qualification Thresholds */}
      <div style={{ background: 'var(--bg-subtle)', padding: 20, borderRadius: 8, border: '1px solid var(--border)' }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 14px 0' }}>Qualification Thresholds</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          <div>
            <FLabel>Minimum Budget</FLabel>
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                value={config.currency || 'USD'}
                onChange={(e) => onChange({ ...config, currency: e.target.value })}
                style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--t1)' }}
              >
                <option value="USD">USD ($)</option>
                <option value="INR">INR (₹)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
              </select>
              <FInput
                type="number"
                value={config.minBudget ?? 1000}
                onChange={(e) => onChange({ ...config, minBudget: Number(e.target.value) })}
              />
            </div>
          </div>

          <div>
            <FLabel>Minimum Company Size (Employees)</FLabel>
            <FInput
              type="number"
              value={config.companySizeMin ?? 5}
              onChange={(e) => onChange({ ...config, companySizeMin: Number(e.target.value) })}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(config.requirePhone)}
              onChange={(e) => onChange({ ...config, requirePhone: e.target.checked })}
            />
            <span>Require Valid Phone Number</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(config.requireEmail)}
              onChange={(e) => onChange({ ...config, requireEmail: e.target.checked })}
            />
            <span>Require Business Email</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(config.requireCompany)}
              onChange={(e) => onChange({ ...config, requireCompany: e.target.checked })}
            />
            <span>Require Registered Company Name</span>
          </label>
        </div>
      </div>

      {/* Target Industries */}
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 6px 0' }}>Target Industries</h3>
        <p style={{ fontSize: 12, color: 'var(--t3)', margin: '0 0 12px 0' }}>
          Select or add the key vertical markets that align with your ideal customer profile (ICP).
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {targetIndustries.map((ind) => (
            <span
              key={ind}
              onClick={() => handleToggleIndustry(ind)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 500,
                background: 'rgba(59, 130, 246, 0.12)',
                color: 'var(--accent, #3b82f6)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
                cursor: 'pointer',
              }}
            >
              {ind}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleToggleIndustry(ind); }}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <form onSubmit={handleAddIndustry} style={{ display: 'flex', gap: 8, maxWidth: 380 }}>
          <FInput
            value={newIndustry}
            onChange={(e) => setNewIndustry(e.target.value)}
            placeholder="Add industry (e.g. Logistics & Supply)"
            style={{ fontSize: 13 }}
          />
          <Btn variant="primary" type="submit" disabled={!newIndustry.trim()}>
            Add
          </Btn>
        </form>
      </div>

      {/* Qualification Checklist */}
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 6px 0' }}>Qualification Checklist (BANT/MEDDIC)</h3>
        <p style={{ fontSize: 12, color: 'var(--t3)', margin: '0 0 12px 0' }}>
          Questions sales reps must verify before qualifying or converting a lead into a deal.
        </p>

        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
          {checklist.map((item, idx) => (
            <div
              key={item.id || idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderBottom: idx < checklist.length - 1 ? '1px solid var(--border)' : 'none',
                background: 'var(--bg-surface)',
                gap: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                <span style={{ fontSize: 12, color: 'var(--t3)', width: 20 }}>{idx + 1}.</span>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{item.question}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(item.required)}
                    onChange={(e) => handleUpdateQuestion(item.id, 'required', e.target.checked)}
                  />
                  <span>Mandatory</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span style={{ color: 'var(--t3)' }}>Weight:</span>
                  <input
                    type="number"
                    value={item.weight ?? 20}
                    onChange={(e) => handleUpdateQuestion(item.id, 'weight', Number(e.target.value))}
                    style={{ width: 50, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-subtle)', color: 'var(--t1)', fontSize: 12 }}
                  />
                  <span>%</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveQuestion(item.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--red, #ef4444)', cursor: 'pointer', padding: 4 }}
                >
                  <I n="trash" s={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={handleAddQuestion} style={{ display: 'flex', gap: 8 }}>
          <FInput
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            placeholder="Add qualification question (e.g. Has the client confirmed explicit timeline for go-live?)"
            style={{ fontSize: 13 }}
          />
          <Btn variant="primary" type="submit" disabled={!newQuestion.trim()}>
            Add Question
          </Btn>
        </form>
      </div>
    </div>
  );
}

/* =========================================================================
   TAB 3: DEAL MODE
   ========================================================================= */
function DealModeTab({ config = {}, onChange }) {
  const mode = config.mode || 'FLEXIBLE';
  const autoTaskConfig = config.autoTaskConfig || {};

  const handleSelectMode = (newMode) => {
    onChange({
      ...config,
      mode: newMode,
      autoTaskConfig: config.autoTaskConfig || {
        followUpDueDays: 2,
        defaultPriority: 'HIGH',
        notifyOwner: true,
        stageTaskTemplates: {
          QUALIFICATION: 'Conduct initial discovery call & verify qualification criteria',
          NEEDS_ANALYSIS: 'Prepare in-depth needs analysis and scope document',
          PROPOSAL: 'Present commercial proposal and confirm decision timeframe',
          NEGOTIATION: 'Finalize negotiation terms and redlines with stakeholders',
          CLOSED_WON: 'Execute contract handover and kick off customer onboarding',
          CLOSED_LOST: 'Log lost reason details and schedule 90-day re-engagement review',
        },
      },
    });
  };

  const updateAutoTaskConfig = (field, val) => {
    onChange({
      ...config,
      autoTaskConfig: {
        ...autoTaskConfig,
        [field]: val,
      },
    });
  };

  const updateStageTemplate = (stageKey, templateText) => {
    const templates = { ...(autoTaskConfig.stageTaskTemplates || {}) };
    templates[stageKey] = templateText;
    updateAutoTaskConfig('stageTaskTemplates', templates);
  };

  const stagesList = [
    { key: 'QUALIFICATION', label: 'Qualification' },
    { key: 'NEEDS_ANALYSIS', label: 'Needs Analysis' },
    { key: 'PROPOSAL', label: 'Proposal' },
    { key: 'NEGOTIATION', label: 'Negotiation' },
    { key: 'CLOSED_WON', label: 'Closed Won' },
    { key: 'CLOSED_LOST', label: 'Closed Lost' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 6px 0' }}>Pipeline Execution Mode</h3>
        <p style={{ fontSize: 13, color: 'var(--t3)', margin: '0 0 16px 0' }}>
          Choose how sales opportunities are moved through the deal pipeline stages by your team.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          {/* Card 1: Flexible Mode */}
          <div
            onClick={() => handleSelectMode('FLEXIBLE')}
            style={{
              padding: 20,
              borderRadius: 10,
              border: mode === 'FLEXIBLE' ? '2px solid var(--accent, #3b82f6)' : '1px solid var(--border)',
              background: mode === 'FLEXIBLE' ? 'rgba(59, 130, 246, 0.04)' : 'var(--bg-surface)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 6, background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <I n="layout" s={18} />
                </div>
                <strong style={{ fontSize: 15 }}>Flexible Mode</strong>
              </div>
              <input type="radio" checked={mode === 'FLEXIBLE'} onChange={() => handleSelectMode('FLEXIBLE')} />
            </div>
            <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.5, margin: 0 }}>
              Reps can freely drag and drop deals across pipeline stages. Tasks and activities are logged manually at their discretion. Ideal for agile, consultative or unstructured sales cycles.
            </p>
          </div>

          {/* Card 2: Automatic Task-driven Mode */}
          <div
            onClick={() => handleSelectMode('AUTOMATIC')}
            style={{
              padding: 20,
              borderRadius: 10,
              border: mode === 'AUTOMATIC' ? '2px solid var(--accent, #3b82f6)' : '1px solid var(--border)',
              background: mode === 'AUTOMATIC' ? 'rgba(59, 130, 246, 0.04)' : 'var(--bg-surface)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 6, background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <I n="zap" s={18} />
                </div>
                <strong style={{ fontSize: 15 }}>Automatic Task-driven Mode</strong>
              </div>
              <input type="radio" checked={mode === 'AUTOMATIC'} onChange={() => handleSelectMode('AUTOMATIC')} />
            </div>
            <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.5, margin: 0 }}>
              Every time a deal advances or changes stage, the CRM automatically generates a mandatory follow-up task assigned to the deal owner with preset due dates, keeping deals active and enforcing process rigor.
            </p>
          </div>
        </div>
      </div>

      {/* When Automatic Mode is selected: Task Configuration */}
      {mode === 'AUTOMATIC' && (
        <div style={{ background: 'var(--bg-subtle)', padding: 20, borderRadius: 8, border: '1px solid var(--border)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 14px 0' }}>Automatic Task Generation Rules</h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
            <div>
              <FLabel>Follow-up Due Within (Days)</FLabel>
              <FInput
                type="number"
                value={autoTaskConfig.followUpDueDays ?? 2}
                onChange={(e) => updateAutoTaskConfig('followUpDueDays', Number(e.target.value))}
              />
            </div>
            <div>
              <FLabel>Default Task Priority</FLabel>
              <FSelect
                value={autoTaskConfig.defaultPriority || 'HIGH'}
                onChange={(e) => updateAutoTaskConfig('defaultPriority', e.target.value)}
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </FSelect>
            </div>
          </div>

          <h4 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 10px 0', color: 'var(--t2)' }}>
            Stage-specific Follow-up Task Templates
          </h4>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {stagesList.map((stg) => (
              <div key={stg.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 140, fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{stg.label}</span>
                <FInput
                  value={autoTaskConfig.stageTaskTemplates?.[stg.key] || ''}
                  onChange={(e) => updateStageTemplate(stg.key, e.target.value)}
                  placeholder={`Action required when entering ${stg.label}`}
                  style={{ flex: 1, fontSize: 13 }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   TAB 4: LEAD TAGS
   ========================================================================= */
function LeadTagsTab({ config, onChange, palette }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [formData, setFormData] = useState({ name: '', color: palette[0], category: 'Priority' });
  const [filterCategory, setFilterCategory] = useState('ALL');

  const tags = config?.tags || [];

  const categories = ['Priority', 'Segment', 'Engagement', 'Source', 'Persona', 'General'];

  const filteredTags = filterCategory === 'ALL'
    ? tags
    : tags.filter((t) => (t.category || 'General').toLowerCase() === filterCategory.toLowerCase());

  const handleOpenAdd = () => {
    setEditingIndex(null);
    setFormData({ name: '', color: palette[0], category: 'Priority' });
    setModalOpen(true);
  };

  const handleOpenEdit = (idx) => {
    setEditingIndex(idx);
    setFormData({ ...tags[idx] });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!formData.name.trim()) return;
    const nextTags = [...tags];
    if (editingIndex !== null) {
      nextTags[editingIndex] = { ...formData };
    } else {
      nextTags.push({
        id: `ltag_${Date.now()}`,
        ...formData,
      });
    }
    onChange({ ...config, tags: nextTags });
    setModalOpen(false);
  };

  const handleDelete = (idx) => {
    onChange({ ...config, tags: tags.filter((_, i) => i !== idx) });
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['ALL', ...categories].map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: filterCategory === cat ? 'var(--accent, #3b82f6)' : 'var(--bg-subtle)',
                color: filterCategory === cat ? '#fff' : 'var(--t2)',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        <Btn variant="primary" onClick={handleOpenAdd} style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <I n="plus" s={14} /> Add Tag
        </Btn>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {filteredTags.map((tag, idx) => (
          <div
            key={tag.id || idx}
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-surface)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: tag.color || '#3b82f6', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{tag.name}</div>
                <div style={{ fontSize: 11, color: 'var(--t3)' }}>{tag.category || 'General'}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => handleOpenEdit(tags.indexOf(tag))}
                style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', padding: 4 }}
              >
                <I n="pencil" s={13} />
              </button>
              <button
                onClick={() => handleDelete(tags.indexOf(tag))}
                style={{ background: 'none', border: 'none', color: 'var(--red, #ef4444)', cursor: 'pointer', padding: 4 }}
              >
                <I n="trash" s={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {modalOpen && (
        <Modal
          title={editingIndex !== null ? 'Edit Lead Tag' : 'Add Lead Tag'}
          onClose={() => setModalOpen(false)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <FLabel>Tag Name *</FLabel>
              <FInput
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. VIP Enterprise"
              />
            </div>

            <div>
              <FLabel>Category</FLabel>
              <FSelect
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </FSelect>
            </div>

            <div>
              <FLabel>Color</FLabel>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                {palette.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFormData({ ...formData, color: c })}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: c,
                      border: formData.color === c ? '2px solid #fff' : '2px solid transparent',
                      boxShadow: formData.color === c ? '0 0 0 2px var(--accent)' : 'none',
                      cursor: 'pointer',
                    }}
                  />
                ))}
                <input
                  type="color"
                  value={formData.color || '#3b82f6'}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  style={{ width: 28, height: 28, border: 'none', background: 'none', cursor: 'pointer' }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <Btn variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={handleSave} disabled={!formData.name.trim()}>
              Save Tag
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* =========================================================================
   TAB 5: LEAD SOURCES
   ========================================================================= */
function LeadSourcesTab({ config, onChange, onRequestDelete }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [formData, setFormData] = useState({ name: '', key: '', category: 'Inbound', isActive: true, utmSource: '' });

  const sources = config?.sources || [];

  const handleOpenAdd = () => {
    setEditingIndex(null);
    setFormData({ name: '', key: '', category: 'Inbound', isActive: true, utmSource: '' });
    setModalOpen(true);
  };

  const handleOpenEdit = (idx) => {
    setEditingIndex(idx);
    setFormData({ ...sources[idx] });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!formData.name.trim()) return;
    const sourceKey = formData.key.trim()
      ? formData.key.trim().toUpperCase().replace(/\s+/g, '_')
      : formData.name.trim().toUpperCase().replace(/\s+/g, '_');

    const nextSources = [...sources];
    if (editingIndex !== null) {
      nextSources[editingIndex] = { ...formData, key: sourceKey };
    } else {
      nextSources.push({
        id: `src_${Date.now()}`,
        ...formData,
        key: sourceKey,
      });
    }

    onChange({ ...config, sources: nextSources });
    setModalOpen(false);
  };

  const handleDelete = (idx) => {
    const target = sources[idx];
    onRequestDelete(target.key, () => {
      onChange({ ...config, sources: sources.filter((_, i) => i !== idx) });
    });
  };

  const handleToggleActive = (idx) => {
    const nextSources = [...sources];
    nextSources[idx].isActive = !nextSources[idx].isActive;
    onChange({ ...config, sources: nextSources });
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t2)' }}>
            Configured Inbound & Outbound Channels ({sources.length})
          </span>
          <p style={{ fontSize: 12, color: 'var(--t3)', margin: '2px 0 0 0' }}>
            Sources track where your leads originate from for acquisition attribution and ROI reporting.
          </p>
        </div>
        <Btn variant="primary" onClick={handleOpenAdd} style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <I n="plus" s={14} /> Add Source
        </Btn>
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', color: 'var(--t3)', textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.04em' }}>
              <th style={{ padding: '10px 16px' }}>Source Name</th>
              <th style={{ padding: '10px 16px' }}>Identifier Key</th>
              <th style={{ padding: '10px 16px' }}>Category</th>
              <th style={{ padding: '10px 16px' }}>UTM Attribution</th>
              <th style={{ padding: '10px 16px' }}>Status</th>
              <th style={{ padding: '10px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((src, idx) => (
              <tr key={src.id || idx} style={{ borderBottom: idx < sources.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <td style={{ padding: '12px 16px', fontWeight: 600 }}>{src.name}</td>
                <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12, color: 'var(--t2)' }}>{src.key}</td>
                <td style={{ padding: '12px 16px', color: 'var(--t2)' }}>
                  <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--bg-subtle)', border: '1px solid var(--border)', fontSize: 11 }}>
                    {src.category || 'General'}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', color: 'var(--t3)', fontFamily: 'monospace', fontSize: 12 }}>
                  {src.utmSource ? `utm_source=${src.utmSource}` : '—'}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <button
                    onClick={() => handleToggleActive(idx)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 12,
                      border: 'none',
                      background: src.isActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(100, 116, 139, 0.15)',
                      color: src.isActive ? '#10b981' : 'var(--t3)',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {src.isActive ? 'ACTIVE' : 'INACTIVE'}
                  </button>
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: 4 }}>
                    <button
                      onClick={() => handleOpenEdit(idx)}
                      style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', padding: 4 }}
                    >
                      <I n="pencil" s={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(idx)}
                      style={{ background: 'none', border: 'none', color: 'var(--red, #ef4444)', cursor: 'pointer', padding: 4 }}
                    >
                      <I n="trash" s={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <Modal
          title={editingIndex !== null ? 'Edit Lead Source' : 'Add Lead Source'}
          onClose={() => setModalOpen(false)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <FLabel>Source Name *</FLabel>
              <FInput
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. YouTube Ad Campaign"
              />
            </div>

            <div>
              <FLabel>Identifier Key (Uppercase)</FLabel>
              <FInput
                value={formData.key}
                onChange={(e) => setFormData({ ...formData, key: e.target.value.toUpperCase().replace(/\s+/g, '_') })}
                placeholder="e.g. YOUTUBE_ADS"
              />
            </div>

            <div>
              <FLabel>Category</FLabel>
              <FSelect
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              >
                <option value="Inbound">Inbound</option>
                <option value="Social">Social</option>
                <option value="Paid Search">Paid Search</option>
                <option value="Word of Mouth">Word of Mouth</option>
                <option value="Outbound">Outbound</option>
                <option value="Offline">Offline</option>
                <option value="General">General</option>
              </FSelect>
            </div>

            <div>
              <FLabel>Default UTM Source (Optional)</FLabel>
              <FInput
                value={formData.utmSource || ''}
                onChange={(e) => setFormData({ ...formData, utmSource: e.target.value })}
                placeholder="e.g. youtube"
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(formData.isActive)}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
              />
              <span>Enable this source for new leads</span>
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <Btn variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={handleSave} disabled={!formData.name.trim()}>
              Save Source
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* =========================================================================
   TAB 6: CALL OUTCOMES
   ========================================================================= */
function CallOutcomesTab({ config, onChange }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [formData, setFormData] = useState({ name: '', sentiment: 'POSITIVE', triggersFollowUp: true });

  const outcomes = config?.outcomes || [];

  const handleOpenAdd = () => {
    setEditingIndex(null);
    setFormData({ name: '', sentiment: 'POSITIVE', triggersFollowUp: true });
    setModalOpen(true);
  };

  const handleOpenEdit = (idx) => {
    setEditingIndex(idx);
    setFormData({ ...outcomes[idx] });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!formData.name.trim()) return;
    const nextOutcomes = [...outcomes];
    if (editingIndex !== null) {
      nextOutcomes[editingIndex] = { ...formData };
    } else {
      nextOutcomes.push({
        id: `call_${Date.now()}`,
        ...formData,
        sortOrder: nextOutcomes.length,
      });
    }
    onChange({ ...config, outcomes: nextOutcomes });
    setModalOpen(false);
  };

  const handleDelete = (idx) => {
    onChange({ ...config, outcomes: outcomes.filter((_, i) => i !== idx) });
  };

  const getSentimentBadge = (sentiment) => {
    const s = String(sentiment).toUpperCase();
    if (s === 'POSITIVE') {
      return <span style={{ padding: '3px 8px', borderRadius: 4, background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', fontSize: 11, fontWeight: 600 }}>POSITIVE</span>;
    }
    if (s === 'NEGATIVE') {
      return <span style={{ padding: '3px 8px', borderRadius: 4, background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', fontSize: 11, fontWeight: 600 }}>NEGATIVE</span>;
    }
    return <span style={{ padding: '3px 8px', borderRadius: 4, background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', fontSize: 11, fontWeight: 600 }}>NEUTRAL</span>;
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t2)' }}>
            Call Dispositions & Outcomes ({outcomes.length})
          </span>
          <p style={{ fontSize: 12, color: 'var(--t3)', margin: '2px 0 0 0' }}>
            Logged by sales reps following outreach calls, feeding call analytics and automated follow-ups.
          </p>
        </div>
        <Btn variant="primary" onClick={handleOpenAdd} style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <I n="plus" s={14} /> Add Outcome
        </Btn>
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', color: 'var(--t3)', textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.04em' }}>
              <th style={{ padding: '10px 16px' }}>Outcome Name</th>
              <th style={{ padding: '10px 16px' }}>Sentiment</th>
              <th style={{ padding: '10px 16px' }}>Action Trigger</th>
              <th style={{ padding: '10px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {outcomes.map((out, idx) => (
              <tr key={out.id || idx} style={{ borderBottom: idx < outcomes.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <td style={{ padding: '12px 16px', fontWeight: 600 }}>{out.name}</td>
                <td style={{ padding: '12px 16px' }}>{getSentimentBadge(out.sentiment)}</td>
                <td style={{ padding: '12px 16px', color: 'var(--t2)', fontSize: 12 }}>
                  {out.triggersFollowUp ? (
                    <span style={{ color: 'var(--accent, #3b82f6)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <I n="zap" s={13} /> Triggers Task / Follow-up
                    </span>
                  ) : (
                    <span style={{ color: 'var(--t3)' }}>No Automated Task</span>
                  )}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: 4 }}>
                    <button
                      onClick={() => handleOpenEdit(idx)}
                      style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', padding: 4 }}
                    >
                      <I n="pencil" s={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(idx)}
                      style={{ background: 'none', border: 'none', color: 'var(--red, #ef4444)', cursor: 'pointer', padding: 4 }}
                    >
                      <I n="trash" s={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <Modal
          title={editingIndex !== null ? 'Edit Call Outcome' : 'Add Call Outcome'}
          onClose={() => setModalOpen(false)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <FLabel>Outcome Name *</FLabel>
              <FInput
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Connected - Rescheduled for Next Week"
              />
            </div>

            <div>
              <FLabel>Sentiment</FLabel>
              <FSelect
                value={formData.sentiment}
                onChange={(e) => setFormData({ ...formData, sentiment: e.target.value })}
              >
                <option value="POSITIVE">Positive (Lead is interested / progressed)</option>
                <option value="NEUTRAL">Neutral (Callback requested / Voicemail)</option>
                <option value="NEGATIVE">Negative (Disqualified / Invalid / Wrong number)</option>
              </FSelect>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(formData.triggersFollowUp)}
                onChange={(e) => setFormData({ ...formData, triggersFollowUp: e.target.checked })}
              />
              <span>Prompt follow-up task on selection</span>
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <Btn variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={handleSave} disabled={!formData.name.trim()}>
              Save Outcome
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* =========================================================================
   TAB 7: VISIT OUTCOMES
   ========================================================================= */
function VisitOutcomesTab({ config, onChange }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [formData, setFormData] = useState({ name: '', sentiment: 'POSITIVE', triggersFollowUp: true });

  const outcomes = config?.outcomes || [];

  const handleOpenAdd = () => {
    setEditingIndex(null);
    setFormData({ name: '', sentiment: 'POSITIVE', triggersFollowUp: true });
    setModalOpen(true);
  };

  const handleOpenEdit = (idx) => {
    setEditingIndex(idx);
    setFormData({ ...outcomes[idx] });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!formData.name.trim()) return;
    const nextOutcomes = [...outcomes];
    if (editingIndex !== null) {
      nextOutcomes[editingIndex] = { ...formData };
    } else {
      nextOutcomes.push({
        id: `vis_${Date.now()}`,
        ...formData,
        sortOrder: nextOutcomes.length,
      });
    }
    onChange({ ...config, outcomes: nextOutcomes });
    setModalOpen(false);
  };

  const handleDelete = (idx) => {
    onChange({ ...config, outcomes: outcomes.filter((_, i) => i !== idx) });
  };

  const getSentimentBadge = (sentiment) => {
    const s = String(sentiment).toUpperCase();
    if (s === 'POSITIVE') {
      return <span style={{ padding: '3px 8px', borderRadius: 4, background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', fontSize: 11, fontWeight: 600 }}>POSITIVE</span>;
    }
    if (s === 'NEGATIVE') {
      return <span style={{ padding: '3px 8px', borderRadius: 4, background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', fontSize: 11, fontWeight: 600 }}>NEGATIVE</span>;
    }
    return <span style={{ padding: '3px 8px', borderRadius: 4, background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', fontSize: 11, fontWeight: 600 }}>NEUTRAL</span>;
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t2)' }}>
            Field Visit & Meeting Outcomes ({outcomes.length})
          </span>
          <p style={{ fontSize: 12, color: 'var(--t3)', margin: '2px 0 0 0' }}>
            Dispositions for on-site client meetings, presentations, and demo visits.
          </p>
        </div>
        <Btn variant="primary" onClick={handleOpenAdd} style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <I n="plus" s={14} /> Add Outcome
        </Btn>
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', color: 'var(--t3)', textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.04em' }}>
              <th style={{ padding: '10px 16px' }}>Outcome Name</th>
              <th style={{ padding: '10px 16px' }}>Sentiment</th>
              <th style={{ padding: '10px 16px' }}>Action Trigger</th>
              <th style={{ padding: '10px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {outcomes.map((out, idx) => (
              <tr key={out.id || idx} style={{ borderBottom: idx < outcomes.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <td style={{ padding: '12px 16px', fontWeight: 600 }}>{out.name}</td>
                <td style={{ padding: '12px 16px' }}>{getSentimentBadge(out.sentiment)}</td>
                <td style={{ padding: '12px 16px', color: 'var(--t2)', fontSize: 12 }}>
                  {out.triggersFollowUp ? (
                    <span style={{ color: 'var(--accent, #3b82f6)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <I n="zap" s={13} /> Triggers Next Step
                    </span>
                  ) : (
                    <span style={{ color: 'var(--t3)' }}>No Automated Task</span>
                  )}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: 4 }}>
                    <button
                      onClick={() => handleOpenEdit(idx)}
                      style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', padding: 4 }}
                    >
                      <I n="pencil" s={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(idx)}
                      style={{ background: 'none', border: 'none', color: 'var(--red, #ef4444)', cursor: 'pointer', padding: 4 }}
                    >
                      <I n="trash" s={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <Modal
          title={editingIndex !== null ? 'Edit Visit Outcome' : 'Add Visit Outcome'}
          onClose={() => setModalOpen(false)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <FLabel>Outcome Name *</FLabel>
              <FInput
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. In-person Demo Conducted - Proposal Requested"
              />
            </div>

            <div>
              <FLabel>Sentiment</FLabel>
              <FSelect
                value={formData.sentiment}
                onChange={(e) => setFormData({ ...formData, sentiment: e.target.value })}
              >
                <option value="POSITIVE">Positive</option>
                <option value="NEUTRAL">Neutral</option>
                <option value="NEGATIVE">Negative</option>
              </FSelect>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(formData.triggersFollowUp)}
                onChange={(e) => setFormData({ ...formData, triggersFollowUp: e.target.checked })}
              />
              <span>Trigger mandatory follow-up action</span>
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <Btn variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={handleSave} disabled={!formData.name.trim()}>
              Save Outcome
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* =========================================================================
   TAB 8: DEAL SETUP
   ========================================================================= */
function DealSetupTab({ config, onChange, onRequestDelete, palette }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [formData, setFormData] = useState({ label: '', key: '', probability: 50, color: palette[0], slaDays: 7, isActive: true });

  const stages = config?.stages || [];

  const handleOpenAdd = () => {
    setEditingIndex(null);
    setFormData({ label: '', key: '', probability: 50, color: palette[0], slaDays: 7, isActive: true });
    setModalOpen(true);
  };

  const handleOpenEdit = (idx) => {
    setEditingIndex(idx);
    setFormData({ ...stages[idx] });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!formData.label.trim()) return;
    const stageKey = formData.key.trim()
      ? formData.key.trim().toUpperCase().replace(/\s+/g, '_')
      : formData.label.trim().toUpperCase().replace(/\s+/g, '_');

    let nextStages = [...stages];
    if (editingIndex !== null) {
      nextStages[editingIndex] = { ...formData, key: stageKey };
    } else {
      // Insert before terminal stages (Closed Won / Closed Lost) if present
      const closedWonIndex = nextStages.findIndex((s) => s.key === 'CLOSED_WON');
      const insertAt = closedWonIndex >= 0 ? closedWonIndex : nextStages.length;
      nextStages.splice(insertAt, 0, {
        ...formData,
        key: stageKey,
        sortOrder: insertAt,
      });
      nextStages.forEach((s, idx) => { s.sortOrder = idx; });
    }
    onChange({ ...config, stages: nextStages });
    setModalOpen(false);
  };

  const handleDelete = (idx) => {
    const target = stages[idx];
    if (target.key === 'CLOSED_WON' || target.key === 'CLOSED_LOST') return;
    onRequestDelete(target.key, () => {
      const nextStages = stages.filter((_, i) => i !== idx);
      nextStages.forEach((s, i) => { s.sortOrder = i; });
      onChange({ ...config, stages: nextStages });
    });
  };

  const handleMove = (idx, direction) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= stages.length) return;
    const nextStages = [...stages];
    const temp = nextStages[idx];
    nextStages[idx] = nextStages[targetIdx];
    nextStages[targetIdx] = temp;
    nextStages.forEach((s, i) => { s.sortOrder = i; });
    onChange({ ...config, stages: nextStages });
  };

  return (
    <div>
      <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: 14, borderRadius: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <I n="layout" s={18} c="var(--accent, #3b82f6)" />
          <div style={{ fontSize: 13, color: 'var(--t1)', lineHeight: 1.5 }}>
            <strong>Synchronized Pipeline Stages:</strong> Add custom stages, delete unused stages, or change sequence. Adjusting labels, win probabilities, and SLAs directly updates your Deal Kanban Board and Forecast calculations in real time.
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t2)' }}>
            Pipeline Stages ({stages.length})
          </span>
          <p style={{ fontSize: 12, color: 'var(--t3)', margin: '2px 0 0 0' }}>
            Stages represent the active phases of your sales pipeline. Terminal stages (Closed Won/Lost) are protected.
          </p>
        </div>
        <Btn variant="primary" onClick={handleOpenAdd} style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <I n="plus" s={14} /> Add Stage
        </Btn>
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', color: 'var(--t3)', textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.04em' }}>
              <th style={{ padding: '10px 16px', width: 40 }}>Order</th>
              <th style={{ padding: '10px 16px' }}>Deal Stage</th>
              <th style={{ padding: '10px 16px' }}>Key</th>
              <th style={{ padding: '10px 16px' }}>Win Probability (%)</th>
              <th style={{ padding: '10px 16px' }}>SLA Target (Days)</th>
              <th style={{ padding: '10px 16px' }}>Color</th>
              <th style={{ padding: '10px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((stage, idx) => {
              const isClosed = stage.key === 'CLOSED_WON' || stage.key === 'CLOSED_LOST';
              return (
                <tr key={stage.key || idx} style={{ borderBottom: idx < stages.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '12px 16px', color: 'var(--t3)' }}>{idx + 1}</td>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: stage.color || '#3b82f6' }} />
                      {stage.label}
                      {isClosed && (
                        <span style={{ fontSize: 10, background: 'var(--bg-subtle)', padding: '2px 6px', borderRadius: 4, color: 'var(--t3)' }}>
                          TERMINAL
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12, color: 'var(--t2)' }}>
                    {stage.key}
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                    {stage.probability}%
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--t2)' }}>
                    {stage.slaDays ? `${stage.slaDays} days` : '—'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ width: 20, height: 20, borderRadius: 4, background: stage.color || '#3b82f6' }} />
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      <button
                        onClick={() => handleMove(idx, -1)}
                        disabled={idx === 0}
                        title="Move Left / Earlier"
                        style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.3 : 1, padding: 4 }}
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => handleMove(idx, 1)}
                        disabled={idx === stages.length - 1}
                        title="Move Right / Later"
                        style={{ background: 'none', border: 'none', cursor: idx === stages.length - 1 ? 'default' : 'pointer', opacity: idx === stages.length - 1 ? 0.3 : 1, padding: 4 }}
                      >
                        ▼
                      </button>
                      <button
                        onClick={() => handleOpenEdit(idx)}
                        title="Edit Stage"
                        style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', padding: 4 }}
                      >
                        <I n="pencil" s={14} />
                      </button>
                      {!isClosed && (
                        <button
                          onClick={() => handleDelete(idx)}
                          title="Delete Stage"
                          style={{ background: 'none', border: 'none', color: 'var(--red, #ef4444)', cursor: 'pointer', padding: 4 }}
                        >
                          <I n="trash" s={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <Modal
          title={editingIndex !== null ? `Edit Stage: ${formData.label}` : 'Add Pipeline Stage'}
          onClose={() => setModalOpen(false)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <FLabel>Stage Display Label *</FLabel>
              <FInput
                value={formData.label}
                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                placeholder="e.g. Discovery Call or Security Review"
              />
            </div>

            <div>
              <FLabel>Stage Key (Unique Code)</FLabel>
              <FInput
                value={formData.key}
                disabled={editingIndex !== null && (formData.key === 'CLOSED_WON' || formData.key === 'CLOSED_LOST')}
                onChange={(e) => setFormData({ ...formData, key: e.target.value.toUpperCase().replace(/\s+/g, '_') })}
                placeholder="e.g. DISCOVERY_CALL (Auto-generated if empty)"
              />
            </div>

            <div>
              <FLabel>Win Probability (%)</FLabel>
              <FInput
                type="number"
                min="0"
                max="100"
                value={formData.probability ?? 50}
                disabled={formData.key === 'CLOSED_WON' || formData.key === 'CLOSED_LOST'}
                onChange={(e) => setFormData({ ...formData, probability: Number(e.target.value) })}
              />
              {(formData.key === 'CLOSED_WON' || formData.key === 'CLOSED_LOST') && (
                <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
                  Terminal closed stages have fixed 100% or 0% probability.
                </div>
              )}
            </div>

            <div>
              <FLabel>Target SLA (Days in Stage)</FLabel>
              <FInput
                type="number"
                min="1"
                value={formData.slaDays || ''}
                onChange={(e) => setFormData({ ...formData, slaDays: e.target.value ? Number(e.target.value) : null })}
                placeholder="e.g. 7"
              />
            </div>

            <div>
              <FLabel>Stage Color</FLabel>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                {palette.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFormData({ ...formData, color: c })}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: c,
                      border: formData.color === c ? '2px solid #fff' : '2px solid transparent',
                      boxShadow: formData.color === c ? '0 0 0 2px var(--accent)' : 'none',
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <Btn variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={handleSave}>
              Update Stage
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* =========================================================================
   TAB 9: TICKETS CUSTOMIZATION
   ========================================================================= */
function TicketCustomizationTab({ config, onChange, subTab, setSubTab, palette }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [modalType, setModalType] = useState('category'); // 'category' | 'stage'
  const [categoryForm, setCategoryForm] = useState({ name: '', slaHours: 24, priority: 'MEDIUM', color: palette[0], description: '' });
  const [stageForm, setStageForm] = useState({ label: '', key: '', color: palette[0], isDefault: false });

  const categories = config?.categories || [];
  const stages = config?.stages || [];

  const handleOpenAdd = () => {
    setEditingIndex(null);
    if (subTab === 'categories') {
      setModalType('category');
      setCategoryForm({ name: '', slaHours: 24, priority: 'MEDIUM', color: palette[0], description: '' });
    } else {
      setModalType('stage');
      setStageForm({ label: '', key: '', color: palette[0], isDefault: false });
    }
    setModalOpen(true);
  };

  const handleOpenEdit = (idx) => {
    setEditingIndex(idx);
    if (subTab === 'categories') {
      setModalType('category');
      setCategoryForm({ ...categories[idx] });
    } else {
      setModalType('stage');
      setStageForm({ ...stages[idx] });
    }
    setModalOpen(true);
  };

  const handleSave = () => {
    if (modalType === 'category') {
      if (!categoryForm.name.trim()) return;
      const nextCats = [...categories];
      if (editingIndex !== null) {
        nextCats[editingIndex] = { ...categoryForm };
      } else {
        nextCats.push({ id: `tcat_${Date.now()}`, ...categoryForm });
      }
      onChange({ ...config, categories: nextCats });
    } else {
      if (!stageForm.label.trim()) return;
      const nextStages = [...stages];
      const key = stageForm.key.trim()
        ? stageForm.key.trim().toUpperCase().replace(/\s+/g, '_')
        : stageForm.label.trim().toUpperCase().replace(/\s+/g, '_');

      if (editingIndex !== null) {
        nextStages[editingIndex] = { ...stageForm, key };
      } else {
        nextStages.push({ id: `tstg_${Date.now()}`, ...stageForm, key, sortOrder: nextStages.length });
      }
      onChange({ ...config, stages: nextStages });
    }
    setModalOpen(false);
  };

  const handleDelete = (idx) => {
    if (subTab === 'categories') {
      onChange({ ...config, categories: categories.filter((_, i) => i !== idx) });
    } else {
      onChange({ ...config, stages: stages.filter((_, i) => i !== idx) });
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setSubTab('categories')}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: subTab === 'categories' ? 'var(--accent, #3b82f6)' : 'var(--bg-subtle)',
              color: subTab === 'categories' ? '#fff' : 'var(--t2)',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Ticket Categories & SLAs ({categories.length})
          </button>
          <button
            onClick={() => setSubTab('stages')}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: subTab === 'stages' ? 'var(--accent, #3b82f6)' : 'var(--bg-subtle)',
              color: subTab === 'stages' ? '#fff' : 'var(--t2)',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Ticket Stages ({stages.length})
          </button>
        </div>

        <Btn variant="primary" onClick={handleOpenAdd} style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <I n="plus" s={14} /> {subTab === 'categories' ? 'Add Category' : 'Add Stage'}
        </Btn>
      </div>

      {subTab === 'categories' ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', color: 'var(--t3)', textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.04em' }}>
                <th style={{ padding: '10px 16px' }}>Category Name</th>
                <th style={{ padding: '10px 16px' }}>SLA Target (Hours)</th>
                <th style={{ padding: '10px 16px' }}>Default Priority</th>
                <th style={{ padding: '10px 16px' }}>Description</th>
                <th style={{ padding: '10px 16px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat, idx) => (
                <tr key={cat.id || idx} style={{ borderBottom: idx < categories.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: cat.color || '#3b82f6' }} />
                      {cat.name}
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 4, background: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent, #3b82f6)' }}>
                      {cat.slaHours} hours
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--bg-subtle)', border: '1px solid var(--border)', fontWeight: 600 }}>
                      {cat.priority}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--t3)' }}>{cat.description || '—'}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      <button onClick={() => handleOpenEdit(idx)} style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', padding: 4 }}>
                        <I n="pencil" s={14} />
                      </button>
                      <button onClick={() => handleDelete(idx)} style={{ background: 'none', border: 'none', color: 'var(--red, #ef4444)', cursor: 'pointer', padding: 4 }}>
                        <I n="trash" s={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', color: 'var(--t3)', textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.04em' }}>
                <th style={{ padding: '10px 16px' }}>Stage Name</th>
                <th style={{ padding: '10px 16px' }}>Key</th>
                <th style={{ padding: '10px 16px' }}>Color</th>
                <th style={{ padding: '10px 16px' }}>Default</th>
                <th style={{ padding: '10px 16px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((stg, idx) => (
                <tr key={stg.id || idx} style={{ borderBottom: idx < stages.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: stg.color || '#3b82f6' }} />
                      {stg.label}
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12, color: 'var(--t2)' }}>{stg.key}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ width: 18, height: 18, borderRadius: 4, background: stg.color || '#3b82f6' }} />
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {stg.isDefault ? (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(59, 130, 246, 0.15)', color: 'var(--accent, #3b82f6)', fontWeight: 600 }}>
                        DEFAULT
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      <button onClick={() => handleOpenEdit(idx)} style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', padding: 4 }}>
                        <I n="pencil" s={14} />
                      </button>
                      <button onClick={() => handleDelete(idx)} style={{ background: 'none', border: 'none', color: 'var(--red, #ef4444)', cursor: 'pointer', padding: 4 }}>
                        <I n="trash" s={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <Modal
          title={modalType === 'category' ? (editingIndex !== null ? 'Edit Category' : 'Add Category') : (editingIndex !== null ? 'Edit Stage' : 'Add Stage')}
          onClose={() => setModalOpen(false)}
        >
          {modalType === 'category' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <FLabel>Category Name *</FLabel>
                <FInput
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  placeholder="e.g. Account Security & 2FA"
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <FLabel>SLA Target (Hours)</FLabel>
                  <FInput
                    type="number"
                    min="1"
                    value={categoryForm.slaHours}
                    onChange={(e) => setCategoryForm({ ...categoryForm, slaHours: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <FLabel>Default Priority</FLabel>
                  <FSelect
                    value={categoryForm.priority}
                    onChange={(e) => setCategoryForm({ ...categoryForm, priority: e.target.value })}
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </FSelect>
                </div>
              </div>
              <div>
                <FLabel>Color</FLabel>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                  {palette.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategoryForm({ ...categoryForm, color: c })}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: c,
                        border: categoryForm.color === c ? '2px solid #fff' : '2px solid transparent',
                        boxShadow: categoryForm.color === c ? '0 0 0 2px var(--accent)' : 'none',
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                </div>
              </div>
              <div>
                <FLabel>Description</FLabel>
                <FInput
                  value={categoryForm.description || ''}
                  onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                  placeholder="Scope or type of tickets that fall into this category"
                />
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <FLabel>Stage Label *</FLabel>
                <FInput
                  value={stageForm.label}
                  onChange={(e) => setStageForm({ ...stageForm, label: e.target.value })}
                  placeholder="e.g. Under Investigation"
                />
              </div>
              <div>
                <FLabel>Stage Key</FLabel>
                <FInput
                  value={stageForm.key}
                  onChange={(e) => setStageForm({ ...stageForm, key: e.target.value.toUpperCase().replace(/\s+/g, '_') })}
                  placeholder="e.g. UNDER_INVESTIGATION"
                />
              </div>
              <div>
                <FLabel>Color</FLabel>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                  {palette.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setStageForm({ ...stageForm, color: c })}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: c,
                        border: stageForm.color === c ? '2px solid #fff' : '2px solid transparent',
                        boxShadow: stageForm.color === c ? '0 0 0 2px var(--accent)' : 'none',
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(stageForm.isDefault)}
                  onChange={(e) => setStageForm({ ...stageForm, isDefault: e.target.checked })}
                />
                <span>Set as default stage for newly created tickets</span>
              </label>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <Btn variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={handleSave}>
              Save
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* =========================================================================
   TAB 10: DOCUMENT CATEGORIES
   ========================================================================= */
function DocumentCategoriesTab({ config, onChange, palette }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [categoryName, setCategoryName] = useState('');
  const [categoryColor, setCategoryColor] = useState(palette[0]);

  // Inline subcategory input state per category
  const [subInputs, setSubInputs] = useState({});

  const categories = config?.categories || [];

  const handleOpenAdd = () => {
    setEditingIndex(null);
    setCategoryName('');
    setCategoryColor(palette[0]);
    setModalOpen(true);
  };

  const handleOpenEdit = (idx) => {
    setEditingIndex(idx);
    setCategoryName(categories[idx].name);
    setCategoryColor(categories[idx].color || palette[0]);
    setModalOpen(true);
  };

  const handleSaveCategory = () => {
    if (!categoryName.trim()) return;
    const next = [...categories];
    if (editingIndex !== null) {
      next[editingIndex] = { ...next[editingIndex], name: categoryName.trim(), color: categoryColor };
    } else {
      next.push({
        id: `doc_${Date.now()}`,
        name: categoryName.trim(),
        color: categoryColor,
        subcategories: [],
      });
    }
    onChange({ ...config, categories: next });
    setModalOpen(false);
  };

  const handleDeleteCategory = (idx) => {
    onChange({ ...config, categories: categories.filter((_, i) => i !== idx) });
  };

  const handleAddSubcategory = (catIdx) => {
    const text = (subInputs[catIdx] || '').trim();
    if (!text) return;
    const next = [...categories];
    const subcats = [...(next[catIdx].subcategories || [])];
    if (!subcats.includes(text)) {
      subcats.push(text);
      next[catIdx].subcategories = subcats;
      onChange({ ...config, categories: next });
    }
    setSubInputs({ ...subInputs, [catIdx]: '' });
  };

  const handleRemoveSubcategory = (catIdx, subIdx) => {
    const next = [...categories];
    next[catIdx].subcategories = next[catIdx].subcategories.filter((_, i) => i !== subIdx);
    onChange({ ...config, categories: next });
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t2)' }}>
            Document Folders & Classification ({categories.length})
          </span>
          <p style={{ fontSize: 12, color: 'var(--t3)', margin: '2px 0 0 0' }}>
            Structured document categories and sub-types for contracts, quotes, invoices, compliance and customer files.
          </p>
        </div>
        <Btn variant="primary" onClick={handleOpenAdd} style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <I n="plus" s={14} /> Add Category
        </Btn>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {categories.map((cat, catIdx) => (
          <div
            key={cat.id || catIdx}
            style={{
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: cat.color || '#3b82f6' }} />
                <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{cat.name}</h4>
                <span style={{ fontSize: 11, color: 'var(--t3)', background: 'var(--bg-surface)', padding: '2px 8px', borderRadius: 10, border: '1px solid var(--border)' }}>
                  {cat.subcategories?.length || 0} subcategories
                </span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={() => handleOpenEdit(catIdx)} style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', padding: 4 }}>
                  <I n="pencil" s={14} />
                </button>
                <button onClick={() => handleDeleteCategory(catIdx)} style={{ background: 'none', border: 'none', color: 'var(--red, #ef4444)', cursor: 'pointer', padding: 4 }}>
                  <I n="trash" s={14} />
                </button>
              </div>
            </div>

            {/* Subcategories chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {(cat.subcategories || []).map((sub, subIdx) => (
                <span
                  key={subIdx}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: 12,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    color: 'var(--t1)',
                  }}
                >
                  {sub}
                  <button
                    type="button"
                    onClick={() => handleRemoveSubcategory(catIdx, subIdx)}
                    style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', padding: 0 }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            {/* Add subcategory input */}
            <div style={{ display: 'flex', gap: 8, maxWidth: 360 }}>
              <input
                type="text"
                value={subInputs[catIdx] || ''}
                onChange={(e) => setSubInputs({ ...subInputs, [catIdx]: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddSubcategory(catIdx); } }}
                placeholder="Add subcategory (e.g. Master Services Agreement)..."
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-surface)',
                  color: 'var(--t1)',
                  fontSize: 12,
                }}
              />
              <Btn variant="ghost" onClick={() => handleAddSubcategory(catIdx)} disabled={!(subInputs[catIdx] || '').trim()} style={{ fontSize: 12, padding: '4px 10px' }}>
                Add
              </Btn>
            </div>
          </div>
        ))}
      </div>

      {modalOpen && (
        <Modal
          title={editingIndex !== null ? 'Edit Document Category' : 'Add Document Category'}
          onClose={() => setModalOpen(false)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <FLabel>Category Name *</FLabel>
              <FInput
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="e.g. Technical & Security Compliance"
              />
            </div>

            <div>
              <FLabel>Color</FLabel>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                {palette.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategoryColor(c)}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: c,
                      border: categoryColor === c ? '2px solid #fff' : '2px solid transparent',
                      boxShadow: categoryColor === c ? '0 0 0 2px var(--accent)' : 'none',
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <Btn variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={handleSaveCategory} disabled={!categoryName.trim()}>
              Save Category
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
