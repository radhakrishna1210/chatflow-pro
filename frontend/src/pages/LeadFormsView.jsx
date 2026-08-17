import { useState, useEffect, useCallback, useMemo } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { Modal } from '../components/Modal.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { FInput, FLabel, FSelect, FTextarea } from '../components/Form.jsx';
import { wFetch } from '../lib/api.js';
import { fmtDate } from '../lib/format.js';

// Builder for public lead-capture forms.
//
// The server is the authority on every rule enforced here — this file only
// surfaces those rules early, so a mistake shows up while you are building the
// form rather than as a 400 on save or, worse, as silence after publishing.
// Where a check is duplicated from the backend it is marked, because the two
// must be changed together.

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const FIELD_TYPES = [
  { value: 'text', label: 'Short text' },
  { value: 'email', label: 'Email address' },
  { value: 'phone', label: 'Phone number' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select', label: 'Choice list' },
];

const OUTCOME_TONE = { CREATED: 'green', DUPLICATE: 'blue', OPTED_OUT: 'amber', REJECTED: 'red' };
const OUTCOME_LABEL = {
  CREATED: 'Lead created',
  DUPLICATE: 'Already a lead',
  OPTED_OUT: 'Opted out',
  REJECTED: 'Rejected',
};

// Mirrors slugify() in backend/src/services/leadForms.service.js. Duplicated
// only to preview the key a label will produce; the server still derives the
// real one, so a drift here shows a wrong preview, never a wrong stored key.
const slugify = (s) => String(s || '')
  .trim().toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60);

const fieldKey = (f) => slugify(f.key || f.label).replace(/-/g, '_');

const ErrorBanner = ({ children, onDismiss }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 14px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)', color: '#f87171', fontSize: 12.5 }}>
    <span>{children}</span>
    {onDismiss && <button onClick={onDismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}><I n="x" s={14} c="#f87171" /></button>}
  </div>
);

const Note = ({ tone = 'amber', icon = 'alertt', children }) => {
  const c = tone === 'amber' ? '#fbbf24' : tone === 'red' ? '#f87171' : 'var(--t2)';
  const bg = tone === 'amber' ? 'rgba(245,158,11,.08)' : tone === 'red' ? 'rgba(239,68,68,.08)' : 'rgba(255,255,255,.03)';
  const bd = tone === 'amber' ? 'rgba(245,158,11,.22)' : tone === 'red' ? 'rgba(239,68,68,.22)' : 'var(--bd)';
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '10px 13px', borderRadius: 8, background: bg, border: `1px solid ${bd}`, fontSize: 12.5, color: c, lineHeight: 1.55 }}>
      <span style={{ flexShrink: 0, marginTop: 1 }}><I n={icon} s={14} c={c} /></span>
      <span>{children}</span>
    </div>
  );
};

/**
 * Everything wrong with the current draft, as sentences rather than codes.
 *
 * Two of these are the server's own rules (a form needs a contactable field; a
 * choice list needs options) and are hard blocks. The email-without-phone case
 * is not a server error at all — it saves and publishes happily, then records
 * every submission as REJECTED because a contact needs a phone number. That is
 * the single most expensive way to misconfigure this feature, so it is called
 * out loudly even though nothing rejects it.
 */
function diagnose(fields) {
  const blocking = [];
  const warnings = [];

  if (fields.length === 0) blocking.push('Add at least one field.');

  const seen = new Map();
  fields.forEach((f, i) => {
    const at = `Field ${i + 1}`;
    if (!String(f.label || '').trim()) {
      blocking.push(`${at} needs a label.`);
      return;
    }
    const key = fieldKey(f);
    if (!key) {
      blocking.push(`${at}: "${f.label}" does not produce a usable field key — use some letters or numbers.`);
      return;
    }
    if (seen.has(key)) blocking.push(`${at} produces the same field key ("${key}") as field ${seen.get(key) + 1}. Rename one of them.`);
    else seen.set(key, i);

    if (f.type === 'select') {
      const options = (f.options ?? []).map((o) => String(o).trim()).filter(Boolean);
      if (options.length === 0) blocking.push(`${at} is a choice list with no options.`);
      else if (new Set(options).size !== options.length) warnings.push(`${at} has duplicate options — the repeats will be dropped.`);
    }
  });

  const hasPhone = fields.some((f) => f.type === 'phone');
  const hasEmail = fields.some((f) => f.type === 'email');

  if (!hasPhone && !hasEmail) {
    blocking.push('Add a phone or email field — without one, a submission cannot identify anyone and no lead can be created.');
  } else if (!hasPhone) {
    warnings.push(
      'This form collects an email but no phone number. A contact in ChatFlow is identified by phone, '
      + 'so submissions will be stored and shown below as "Rejected", and no leads will be created. '
      + 'Add a phone field if you want this form to produce leads.',
    );
  }

  return { blocking, warnings };
}

// ─── field editor ────────────────────────────────────────────────────────────

const FieldRow = ({ field, index, total, onChange, onRemove, onMove, disabled }) => {
  const key = fieldKey(field);
  const options = field.options ?? [];

  const setOption = (i, value) => onChange({ options: options.map((o, idx) => (idx === i ? value : o)) });
  const addOption = () => onChange({ options: [...options, ''] });
  const removeOption = (i) => onChange({ options: options.filter((_, idx) => idx !== i) });

  return (
    <div style={{ ...card, padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', minWidth: 18 }}>{index + 1}</span>
        <div style={{ flex: 1 }}>
          <FInput
            value={field.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Question label, e.g. Work email"
            disabled={disabled}
          />
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => onMove(-1)} disabled={disabled || index === 0} aria-label={`Move field ${index + 1} up`}
            style={{ background: 'none', border: '1px solid var(--bd)', borderRadius: 6, width: 26, height: 26, cursor: index === 0 ? 'not-allowed' : 'pointer', color: 'var(--t2)', opacity: index === 0 ? .4 : 1 }}>↑</button>
          <button onClick={() => onMove(1)} disabled={disabled || index === total - 1} aria-label={`Move field ${index + 1} down`}
            style={{ background: 'none', border: '1px solid var(--bd)', borderRadius: 6, width: 26, height: 26, cursor: index === total - 1 ? 'not-allowed' : 'pointer', color: 'var(--t2)', opacity: index === total - 1 ? .4 : 1 }}>↓</button>
          <button onClick={onRemove} disabled={disabled} aria-label={`Remove field ${index + 1}`}
            style={{ background: 'none', border: '1px solid var(--bd)', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <I n="trash" s={12} c="#f87171" />
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 150 }}>
          <FSelect
            value={field.type}
            onChange={(e) => {
              const type = e.target.value;
              // Options only mean something on a choice list; drop them
              // otherwise so a stale array is not sent to the server.
              onChange(type === 'select' ? { type, options: options.length ? options : [''] } : { type, options: undefined });
            }}
            options={FIELD_TYPES}
            disabled={disabled}
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--t2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!field.required} disabled={disabled}
            onChange={(e) => onChange({ required: e.target.checked })} />
          Required
        </label>
        {key && (
          <span style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--mono)' }}>
            key: {key}
          </span>
        )}
      </div>

      {field.type === 'select' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 26 }}>
          {options.map((opt, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <FInput value={opt} onChange={(e) => setOption(i, e.target.value)} placeholder={`Option ${i + 1}`} disabled={disabled} />
              </div>
              <button onClick={() => removeOption(i)} disabled={disabled} aria-label={`Remove option ${i + 1}`}
                style={{ background: 'none', border: '1px solid var(--bd)', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <I n="x" s={11} c="var(--t3)" />
              </button>
            </div>
          ))}
          <button onClick={addOption} disabled={disabled}
            style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: 'var(--green)', fontSize: 12, cursor: 'pointer', padding: '2px 0', fontFamily: 'inherit' }}>
            + Add option
          </button>
        </div>
      )}
    </div>
  );
};

// ─── editor modal ────────────────────────────────────────────────────────────

const blankField = () => ({ label: '', type: 'text', required: false });

const EMPTY = {
  name: '', slug: '', description: '', fields: [
    { label: 'Full name', type: 'text', required: true },
    { label: 'Phone number', type: 'phone', required: true },
  ],
  successMessage: '', consentText: '', source: '', ownerUserId: '', isActive: false,
};

const FormEditor = ({ form, members, onClose, onSaved }) => {
  const isNew = !form;
  const [draft, setDraft] = useState(() => (form ? {
    name: form.name ?? '',
    slug: form.slug ?? '',
    description: form.description ?? '',
    fields: Array.isArray(form.fields) ? form.fields.map((f) => ({ ...f })) : [],
    successMessage: form.successMessage ?? '',
    consentText: form.consentText ?? '',
    source: form.source ?? '',
    ownerUserId: form.ownerUserId ?? '',
    isActive: !!form.isActive,
  } : EMPTY));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setField = (i, patch) => set({ fields: draft.fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) });
  const moveField = (i, dir) => {
    const to = i + dir;
    if (to < 0 || to >= draft.fields.length) return;
    const next = [...draft.fields];
    [next[i], next[to]] = [next[to], next[i]];
    set({ fields: next });
  };

  const { blocking, warnings } = useMemo(() => diagnose(draft.fields), [draft.fields]);
  const nameMissing = !draft.name.trim();
  const canSave = !saving && !nameMissing && blocking.length === 0;

  // Shown live on create so the URL is not a surprise after saving.
  const previewSlug = slugify(draft.slug || draft.name);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const fields = draft.fields.map((f) => {
        const out = { key: fieldKey(f), label: f.label.trim(), type: f.type, required: !!f.required };
        if (f.type === 'select') out.options = (f.options ?? []).map((o) => String(o).trim()).filter(Boolean);
        return out;
      });

      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        fields,
        consentText: draft.consentText.trim() || null,
        source: draft.source.trim() || null,
        ownerUserId: draft.ownerUserId || null,
        isActive: draft.isActive,
      };
      // successMessage has a server default; sending '' would fail min(1).
      if (draft.successMessage.trim()) payload.successMessage = draft.successMessage.trim();
      // The slug is immutable after creation, and update is .strict() — sending
      // it on a PATCH is a 400, not a silent no-op.
      if (isNew && draft.slug.trim()) payload.slug = draft.slug.trim();

      const res = await wFetch(isNew ? '/lead-forms' : `/lead-forms/${form.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.message || `Could not save the form (${res.status}).`);
      }
      onSaved(await res.json());
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isNew ? 'New lead form' : `Edit “${form.name}”`}
      onClose={onClose}
      width={720}
      footer={<>
        <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={save} disabled={!canSave}>{saving ? 'Saving…' : isNew ? 'Create form' : 'Save changes'}</Btn>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}

        <div>
          <FLabel required>Form name</FLabel>
          <FInput value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Website enquiry" disabled={saving} />
        </div>

        {isNew ? (
          <div>
            <FLabel>URL slug</FLabel>
            <FInput value={draft.slug} onChange={(e) => set({ slug: e.target.value })} placeholder="Leave blank to derive from the name" disabled={saving} />
            <p style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 5 }}>
              {previewSlug
                ? <>Will publish at <code style={{ fontFamily: 'var(--mono)', color: 'var(--t2)' }}>/forms/{previewSlug}</code>. This cannot be changed later.</>
                : 'Enter a name to see the URL.'}
            </p>
          </div>
        ) : (
          <div>
            <FLabel>URL slug</FLabel>
            <div style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid var(--bd)', background: 'rgba(255,255,255,.02)', fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--t2)' }}>
              /forms/{form.slug}
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 5 }}>
              Fixed after creation — the link may already be published, and a live form that starts 404ing is worse than an awkward URL.
            </p>
          </div>
        )}

        <div>
          <FLabel>Description</FLabel>
          <FTextarea value={draft.description} onChange={(e) => set({ description: e.target.value })} rows={2}
            placeholder="Shown above the form. Optional." disabled={saving} />
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <FLabel required>Fields</FLabel>
            <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>{draft.fields.length} of 25</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {draft.fields.map((f, i) => (
              <FieldRow
                key={i}
                field={f}
                index={i}
                total={draft.fields.length}
                onChange={(patch) => setField(i, patch)}
                onRemove={() => set({ fields: draft.fields.filter((_, idx) => idx !== i) })}
                onMove={(dir) => moveField(i, dir)}
                disabled={saving}
              />
            ))}
          </div>
          {draft.fields.length < 25 && (
            <Btn variant="ghost" size="sm" onClick={() => set({ fields: [...draft.fields, blankField()] })} style={{ marginTop: 9 }} disabled={saving}>
              <I n="plus" s={13} /> Add field
            </Btn>
          )}
        </div>

        {blocking.length > 0 && (
          <Note tone="red" icon="alertc">
            <strong>Fix before saving</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
              {blocking.map((b) => <li key={b} style={{ marginBottom: 3 }}>{b}</li>)}
            </ul>
          </Note>
        )}
        {warnings.map((w) => <Note key={w}>{w}</Note>)}

        <div>
          <FLabel>Success message</FLabel>
          <FInput value={draft.successMessage} onChange={(e) => set({ successMessage: e.target.value })}
            placeholder="Thanks — we'll be in touch shortly." disabled={saving} />
        </div>

        <div>
          <FLabel>Consent text</FLabel>
          <FTextarea value={draft.consentText} onChange={(e) => set({ consentText: e.target.value })} rows={2}
            placeholder="e.g. I agree to be contacted about my enquiry. Leave blank for no consent checkbox." disabled={saving} />
          <p style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 5 }}>
            When set, the visitor must tick a box to submit, and the exact wording is stored with each
            submission. Editing it later does not rewrite what earlier visitors agreed to.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <FLabel>Lead source</FLabel>
            <FInput value={draft.source} onChange={(e) => set({ source: e.target.value })}
              placeholder={`Form: ${draft.name || 'form name'}`} disabled={saving} />
          </div>
          <div>
            <FLabel>Assign leads to</FLabel>
            <FSelect
              value={draft.ownerUserId}
              onChange={(e) => set({ ownerUserId: e.target.value })}
              placeholder="Nobody (unassigned)"
              options={members.map((m) => ({ value: m.userId ?? m.id, label: m.user?.name || m.user?.email || m.name || m.email || 'Member' }))}
              disabled={saving}
            />
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--t1)', cursor: 'pointer' }}>
          <input type="checkbox" checked={draft.isActive} onChange={(e) => set({ isActive: e.target.checked })} disabled={saving} />
          Live — accepting submissions
        </label>
      </div>
    </Modal>
  );
};

// ─── submissions ─────────────────────────────────────────────────────────────

const SubmissionsPanel = ({ form }) => {
  const submissions = form.submissions ?? [];
  const total = form._count?.submissions ?? submissions.length;

  const counts = useMemo(() => submissions.reduce((acc, s) => {
    acc[s.outcome] = (acc[s.outcome] ?? 0) + 1;
    return acc;
  }, {}), [submissions]);

  if (total === 0) {
    return (
      <div style={{ padding: '26px 20px', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
        No submissions yet.
        {!form.isActive && <> This form is not live, so it is not accepting any.</>}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {Object.entries(counts).map(([outcome, n]) => (
          <StatusBadge key={outcome} tone={OUTCOME_TONE[outcome] ?? 'gray'} label={`${OUTCOME_LABEL[outcome] ?? outcome}: ${n}`} />
        ))}
      </div>

      {counts.REJECTED > 0 && (
        <Note>
          Rejected submissions were received but produced no lead. The reason is shown on each row —
          most often a missing phone number, since a contact is identified by phone.
        </Note>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {submissions.map((s) => (
          <div key={s.id} style={{ ...card, padding: '11px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
              <StatusBadge tone={OUTCOME_TONE[s.outcome] ?? 'gray'} label={OUTCOME_LABEL[s.outcome] ?? s.outcome} />
              <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>{fmtDate(s.createdAt)}</span>
            </div>
            {s.reason && <p style={{ fontSize: 12, color: 'var(--t3)', margin: '0 0 6px' }}>{s.reason}</p>}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {Object.entries(s.answers ?? {}).map(([k, v]) => (
                <span key={k} style={{ fontSize: 12, color: 'var(--t2)' }}>
                  <span style={{ color: 'var(--t3)', fontFamily: 'var(--mono)', fontSize: 11 }}>{k}</span>{' '}{String(v)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {total > submissions.length && (
        <p style={{ fontSize: 11.5, color: 'var(--t3)', textAlign: 'center' }}>
          Showing the {submissions.length} most recent of {total}.
        </p>
      )}
    </div>
  );
};

// ─── detail ──────────────────────────────────────────────────────────────────

const publicUrl = (slug) => {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  return `${window.location.origin}/forms/${user.workspaceId}/${slug}`;
};

const FormDetail = ({ form, onClose, onEdit, onChanged }) => {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const url = publicUrl(form.slug);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Could not copy — select the URL and copy it manually.');
    }
  };

  const toggleLive = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await wFetch(`/lead-forms/${form.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !form.isActive }),
      });
      if (!res.ok) throw new Error(`Could not update the form (${res.status}).`);
      await onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  return (
    <Modal
      title={form.name}
      onClose={onClose}
      width={760}
      footer={<>
        <Btn variant="ghost" size="sm" onClick={onClose}>Close</Btn>
        <Btn variant="ghost" size="sm" onClick={toggleLive} disabled={busy}>
          {form.isActive ? 'Take offline' : 'Take live'}
        </Btn>
        <Btn size="sm" onClick={onEdit}><I n="pencil" s={13} /> Edit</Btn>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <StatusBadge tone={form.isActive ? 'green' : 'gray'} label={form.isActive ? 'Live' : 'Not live'} />
          <span style={{ fontSize: 12.5, color: 'var(--t3)' }}>
            {(form.fields ?? []).length} field{(form.fields ?? []).length === 1 ? '' : 's'} · created {fmtDate(form.createdAt)}
          </span>
        </div>

        {!form.isActive && (
          <Note>
            This form is not live. The public URL returns “not found” — deliberately, so the URL cannot
            be used to discover which forms exist.
          </Note>
        )}

        <div>
          <FLabel>Public URL</FLabel>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
            <div style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--bd)', background: 'rgba(255,255,255,.02)', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--t2)', overflowX: 'auto', whiteSpace: 'nowrap' }}>
              {url}
            </div>
            <Btn variant="ghost" size="sm" onClick={copy}>
              <I n="copy" s={13} /> {copied ? 'Copied' : 'Copy'}
            </Btn>
          </div>
        </div>

        <div>
          <FLabel>Submissions</FLabel>
          <SubmissionsPanel form={form} />
        </div>
      </div>
    </Modal>
  );
};

// ─── list ────────────────────────────────────────────────────────────────────

export default function LeadFormsView() {
  const [forms, setForms] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);   // form object, or 'new'
  const [detail, setDetail] = useState(null);     // full form with submissions

  const load = useCallback(async () => {
    try {
      const res = await wFetch('/lead-forms');
      if (!res.ok) throw new Error(`Could not load forms (${res.status}).`);
      const body = await res.json();
      setForms(body.data ?? []);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    wFetch('/members')
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => setMembers(b.data ?? b.members ?? []))
      .catch(() => setMembers([]));
  }, []);

  const open = async (form) => {
    try {
      const res = await wFetch(`/lead-forms/${form.id}`);
      if (!res.ok) throw new Error(`Could not open the form (${res.status}).`);
      setDetail(await res.json());
    } catch (e) {
      setError(e.message);
    }
  };

  const refreshDetail = async () => {
    await load();
    if (detail) {
      const res = await wFetch(`/lead-forms/${detail.id}`);
      if (res.ok) setDetail(await res.json());
    }
  };

  const remove = async (form) => {
    // Submissions cascade with the form, so this destroys the record of who
    // filled it in — worth spelling out rather than a generic "are you sure".
    const n = form._count?.submissions ?? 0;
    const msg = n > 0
      ? `Delete “${form.name}”? Its ${n} submission${n === 1 ? '' : 's'} will be deleted too. Leads already created stay.`
      : `Delete “${form.name}”?`;
    if (!window.confirm(msg)) return;
    try {
      const res = await wFetch(`/lead-forms/${form.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error(`Could not delete the form (${res.status}).`);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--t1)', marginBottom: 4 }}>Lead forms</h1>
          <p style={{ fontSize: 13, color: 'var(--t3)', maxWidth: 620, lineHeight: 1.55 }}>
            Public forms that create leads. Submissions are recorded whether or not a lead results, so
            “it is live but nothing is arriving” is answerable.
          </p>
        </div>
        <Btn size="sm" onClick={() => setEditing('new')}><I n="plus" s={14} /> New form</Btn>
      </div>

      {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}

      {loading ? (
        <div style={{ ...card, padding: 30, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>Loading…</div>
      ) : forms.length === 0 ? (
        <div style={{ ...card, padding: '40px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--t1)', marginBottom: 6 }}>No lead forms yet</p>
          <p style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 16, maxWidth: 420, marginInline: 'auto', lineHeight: 1.55 }}>
            A form collects a name and phone number from a public page and turns each submission into a
            scored lead.
          </p>
          <Btn size="sm" onClick={() => setEditing('new')}><I n="plus" s={14} /> Create your first form</Btn>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {forms.map((f) => (
            <div key={f.id} className="m-lift" style={{ ...card, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <button onClick={() => open(f)}
                  style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 600, color: 'var(--t1)' }}>
                  {f.name}
                </button>
                <StatusBadge tone={f.isActive ? 'green' : 'gray'} label={f.isActive ? 'Live' : 'Draft'} />
              </div>

              <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--t3)' }}>/forms/{f.slug}</div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 12.5, color: 'var(--t2)' }}>
                  {f._count?.submissions ?? 0} submission{(f._count?.submissions ?? 0) === 1 ? '' : 's'}
                  <span style={{ color: 'var(--t3)' }}> · {(f.fields ?? []).length} fields</span>
                </span>
                <div style={{ display: 'flex', gap: 5 }}>
                  <button onClick={() => setEditing(f)} aria-label={`Edit ${f.name}`}
                    style={{ background: 'none', border: '1px solid var(--bd)', borderRadius: 6, width: 27, height: 27, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <I n="pencil" s={12} c="var(--t2)" />
                  </button>
                  <button onClick={() => remove(f)} aria-label={`Delete ${f.name}`}
                    style={{ background: 'none', border: '1px solid var(--bd)', borderRadius: 6, width: 27, height: 27, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <I n="trash" s={12} c="#f87171" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <FormEditor
          form={editing === 'new' ? null : editing}
          members={members}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await refreshDetail(); }}
        />
      )}

      {detail && !editing && (
        <FormDetail
          form={detail}
          onClose={() => setDetail(null)}
          onEdit={() => setEditing(detail)}
          onChanged={refreshDetail}
        />
      )}
    </div>
  );
}
