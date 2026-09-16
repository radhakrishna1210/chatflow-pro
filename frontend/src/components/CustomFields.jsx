import { useState, useEffect, useCallback } from 'react';
import { I } from './Icons.jsx';
import { Btn } from './Btn.jsx';
import { FInput, FLabel, FSelect, FTextarea } from './Form.jsx';
import { wFetch } from '../lib/api.js';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

export const FIELD_TYPES = [
  { value: 'TEXT', label: 'Text' },
  { value: 'TEXTAREA', label: 'Long text' },
  { value: 'NUMBER', label: 'Number' },
  { value: 'CURRENCY', label: 'Currency' },
  { value: 'DATE', label: 'Date' },
  { value: 'BOOLEAN', label: 'Yes / No' },
  { value: 'DROPDOWN', label: 'Dropdown' },
  { value: 'MULTISELECT', label: 'Multi-select' },
  { value: 'URL', label: 'URL' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'PHONE', label: 'Phone' },
  { value: 'USER', label: 'Team member' },
];

const CHOICE_TYPES = ['DROPDOWN', 'MULTISELECT'];

// Renders the workspace's custom fields for one record and reports edits back
// through onChange. Values are still validated server-side; the input types
// here are a convenience, not the enforcement.
export const CustomFieldInputs = ({ definitions, values = {}, members = [], onChange, disabled }) => {
  if (!definitions?.length) return null;
  const set = (key) => (v) => onChange({ ...values, [key]: v });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {definitions.map(d => {
        const value = values?.[d.key];
        const common = { disabled };
        return (
          <div key={d.id}>
            <FLabel required={d.required}>{d.label}</FLabel>

            {d.type === 'TEXTAREA' && (
              <FTextarea {...common} rows={3} value={value ?? ''} onChange={e => set(d.key)(e.target.value)} />
            )}
            {['TEXT', 'URL', 'EMAIL', 'PHONE'].includes(d.type) && (
              <FInput {...common} value={value ?? ''} onChange={e => set(d.key)(e.target.value)}
                type={d.type === 'EMAIL' ? 'email' : d.type === 'URL' ? 'url' : 'text'} />
            )}
            {['NUMBER', 'CURRENCY'].includes(d.type) && (
              <FInput {...common} type="number" value={value ?? ''} onChange={e => set(d.key)(e.target.value)} />
            )}
            {d.type === 'DATE' && (
              <FInput {...common} type="date" value={value ?? ''} onChange={e => set(d.key)(e.target.value)} />
            )}
            {d.type === 'BOOLEAN' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--t2)', cursor: disabled ? 'default' : 'pointer' }}>
                <input type="checkbox" disabled={disabled} checked={value === true}
                  onChange={e => set(d.key)(e.target.checked)} />
                Yes
              </label>
            )}
            {d.type === 'DROPDOWN' && (
              <FSelect {...common} value={value ?? ''} onChange={e => set(d.key)(e.target.value)}
                placeholder="Not set" options={(d.options ?? []).map(o => ({ value: o, label: o }))} />
            )}
            {d.type === 'USER' && (
              <FSelect {...common} value={value ?? ''} onChange={e => set(d.key)(e.target.value)}
                placeholder="Unassigned"
                options={members.map(m => ({ value: m.user.id, label: m.user.name || m.user.email }))} />
            )}
            {d.type === 'MULTISELECT' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(d.options ?? []).map(o => {
                  const selected = Array.isArray(value) && value.includes(o);
                  return (
                    <button key={o} type="button" disabled={disabled}
                      onClick={() => {
                        const current = Array.isArray(value) ? value : [];
                        set(d.key)(selected ? current.filter(v => v !== o) : [...current, o]);
                      }}
                      style={{
                        padding: '5px 10px', borderRadius: 999, fontSize: 11.5, cursor: disabled ? 'default' : 'pointer',
                        background: selected ? 'rgba(30,191,94,.12)' : 'rgba(255,255,255,.04)',
                        border: `1px solid ${selected ? 'var(--gbd)' : 'var(--bd)'}`,
                        color: selected ? 'var(--green)' : 'var(--t2)',
                      }}>
                      {o}
                    </button>
                  );
                })}
              </div>
            )}

            {d.helpText && <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>{d.helpText}</div>}
          </div>
        );
      })}
    </div>
  );
};

// Admin panel for defining the fields themselves.
export const CustomFieldAdmin = ({ entity, isAdmin }) => {
  const [defs, setDefs] = useState([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: '', type: 'TEXT', options: '', helpText: '', required: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    wFetch(`/custom-fields?entity=${entity}&includeInactive=true`)
      .then(r => (r.ok ? r.json() : { data: [] }))
      .then(d => setDefs(d.data ?? []))
      .catch(() => {});
  }, [entity]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = {
        entity, label: draft.label, type: draft.type,
        helpText: draft.helpText || null, required: draft.required,
        ...(CHOICE_TYPES.includes(draft.type)
          ? { options: draft.options.split(',').map(s => s.trim()).filter(Boolean) }
          : {}),
      };
      const res = await wFetch('/custom-fields', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Could not create this field');
      }
      setDraft({ label: '', type: 'TEXT', options: '', helpText: '', required: false });
      setAdding(false);
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (d) => {
    setErr(null);
    const res = await wFetch(`/custom-fields/${d.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error || 'Could not remove this field');
      return;
    }
    load();
  };

  return (
    <div style={{ ...card, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--t1)' }}>
          Custom fields
        </span>
        {isAdmin && !adding && <Btn size="sm" variant="outline" onClick={() => setAdding(true)}>Add field</Btn>}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--t3)', marginBottom: 14 }}>
        Extra fields shown on every {entity}. {isAdmin ? 'Removing a field hides it but keeps existing values.' : 'Only an admin can change these.'}
      </div>

      {err && (
        <div style={{ marginBottom: 12, padding: '9px 13px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)', color: '#f87171', fontSize: 12 }}>
          {err}
        </div>
      )}

      {adding && (
        <div style={{ ...card, padding: '13px 15px', marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <div><FLabel required>Label</FLabel><FInput value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} /></div>
            <div><FLabel>Type</FLabel><FSelect value={draft.type} onChange={e => setDraft(d => ({ ...d, type: e.target.value }))} options={FIELD_TYPES} /></div>
          </div>
          {CHOICE_TYPES.includes(draft.type) && (
            <div>
              <FLabel required>Options</FLabel>
              <FInput value={draft.options} onChange={e => setDraft(d => ({ ...d, options: e.target.value }))}
                placeholder="Comma separated, e.g. Small, Medium, Large" />
            </div>
          )}
          <div><FLabel>Help text</FLabel><FInput value={draft.helpText} onChange={e => setDraft(d => ({ ...d, helpText: e.target.value }))} /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--t2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={draft.required} onChange={e => setDraft(d => ({ ...d, required: e.target.checked }))} />
            Required
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn size="sm" onClick={create} disabled={busy || !draft.label.trim()}>{busy ? 'Saving…' : 'Create field'}</Btn>
            <Btn size="sm" variant="ghost" onClick={() => { setAdding(false); setErr(null); }}>Cancel</Btn>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {defs.length === 0 && <div style={{ fontSize: 12, color: 'var(--t3)' }}>No custom fields yet.</div>}
        {defs.map(d => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: d.isActive ? 1 : 0.5 }}>
            <span style={{ flex: 1, fontSize: 12.5, color: 'var(--t1)' }}>
              {d.label}
              {d.required && <span style={{ color: '#f87171', marginLeft: 4 }}>*</span>}
              {!d.isActive && <span style={{ fontSize: 10.5, color: 'var(--t3)', marginLeft: 8 }}>(hidden)</span>}
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--t3)', border: '1px solid var(--bd)', borderRadius: 4, padding: '1px 6px' }}>
              {FIELD_TYPES.find(t => t.value === d.type)?.label ?? d.type}
            </span>
            {isAdmin && d.isActive && (
              <button onClick={() => deactivate(d)} aria-label={`Remove ${d.label}`}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <I n="x" s={13} c="#f87171" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
