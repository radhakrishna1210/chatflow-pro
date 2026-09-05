import { useState, useEffect, useCallback } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { Modal } from '../components/Modal.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { FInput, FLabel, FSelect, FTextarea } from '../components/Form.jsx';
import { wFetch } from '../lib/api.js';
import { pretty } from '../lib/format.js';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const STATUS_TONE = { DRAFT: 'gray', PUBLISHED: 'green', PAUSED: 'amber' };
const ENROLMENT_TONE = { ACTIVE: 'green', WAITING: 'blue', COMPLETED: 'gray', EXITED: 'amber', FAILED: 'red' };

const STEP_META = {
  MESSAGE: { icon: 'msg', label: 'Send message', tone: '#22c55e' },
  WAIT: { icon: 'clock', label: 'Wait', tone: '#3b82f6' },
  TASK: { icon: 'check-square', label: 'Create task', tone: '#a78bfa' },
  UPDATE_FIELD: { icon: 'pencil', label: 'Update lead status', tone: '#f59e0b' },
  EXIT: { icon: 'x', label: 'Exit sequence', tone: '#f87171' },
};

const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'LOST'];

const ErrorBanner = ({ children, onDismiss }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 14px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)', color: '#f87171', fontSize: 12.5 }}>
    <span>{children}</span>
    {onDismiss && <button onClick={onDismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}><I n="x" s={14} c="#f87171" /></button>}
  </div>
);

const describeStep = (step) => {
  switch (step.kind) {
    case 'MESSAGE': return step.body?.slice(0, 90) || 'No message text';
    case 'WAIT': {
      const m = Number(step.minutes) || 0;
      if (m % 1440 === 0) return `${m / 1440} day${m / 1440 === 1 ? '' : 's'}`;
      if (m % 60 === 0) return `${m / 60} hour${m / 60 === 1 ? '' : 's'}`;
      return `${m} minute${m === 1 ? '' : 's'}`;
    }
    case 'TASK': return `${step.title}${step.dueInDays ? ` · due in ${step.dueInDays}d` : ''}`;
    case 'UPDATE_FIELD': return `Set status to ${pretty(step.status || '')}`;
    default: return step.reason || 'Ends the sequence';
  }
};

// The vertical connected builder from the spec's sequence screen: each step is
// a card, joined by a line, so the cadence reads top to bottom.
const StepEditor = ({ steps, onChange, disabled }) => {
  const update = (i, patch) => onChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const remove = (i) => onChange(steps.filter((_, idx) => idx !== i));
  const move = (i, dir) => {
    const to = i + dir;
    if (to < 0 || to >= steps.length) return;
    const next = [...steps];
    [next[i], next[to]] = [next[to], next[i]];
    onChange(next);
  };
  const add = (kind) => {
    const blank = {
      MESSAGE: { kind: 'MESSAGE', body: '' },
      WAIT: { kind: 'WAIT', minutes: 1440 },
      TASK: { kind: 'TASK', title: '', dueInDays: 1 },
      UPDATE_FIELD: { kind: 'UPDATE_FIELD', status: 'CONTACTED' },
      EXIT: { kind: 'EXIT', reason: 'Sequence complete' },
    }[kind];
    onChange([...steps, blank]);
  };

  return (
    <div style={{ padding: '32px 40px', flex: 1, overflowY: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {steps.map((step, i) => {
          const meta = STEP_META[step.kind] ?? STEP_META.MESSAGE;
          return (
            <div key={i}>
              <div style={{ ...card, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${meta.tone}1f`, border: `1px solid ${meta.tone}44` }}>
                  <I n={meta.icon} s={13} c={meta.tone} />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)' }}>
                      {i + 1}. {meta.label}
                    </span>
                    {!disabled && (
                      <div style={{ display: 'flex', gap: 2 }}>
                        <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move step up"
                          style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? .3 : 1, padding: 3, color: 'var(--t3)' }}>↑</button>
                        <button onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label="Move step down"
                          style={{ background: 'none', border: 'none', cursor: i === steps.length - 1 ? 'default' : 'pointer', opacity: i === steps.length - 1 ? .3 : 1, padding: 3, color: 'var(--t3)' }}>↓</button>
                        <button onClick={() => remove(i)} aria-label="Remove step"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3 }}>
                          <I n="x" s={12} c="#f87171" />
                        </button>
                      </div>
                    )}
                  </div>

                  {step.kind === 'MESSAGE' && (
                    <FTextarea rows={2} disabled={disabled} value={step.body ?? ''}
                      placeholder="What should this message say?"
                      onChange={e => update(i, { body: e.target.value })} />
                  )}
                  {step.kind === 'WAIT' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 100 }}>
                        <FInput type="number" disabled={disabled} value={step.minutes ?? ''}
                          onChange={e => update(i, { minutes: Number(e.target.value) })} />
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--t3)' }}>minutes ({describeStep(step)})</span>
                    </div>
                  )}
                  {step.kind === 'TASK' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
                      <FInput disabled={disabled} value={step.title ?? ''} placeholder="Task title"
                        onChange={e => update(i, { title: e.target.value })} />
                      <FInput type="number" disabled={disabled} value={step.dueInDays ?? 0}
                        onChange={e => update(i, { dueInDays: Number(e.target.value) })} />
                    </div>
                  )}
                  {step.kind === 'UPDATE_FIELD' && (
                    <FSelect disabled={disabled} value={step.status ?? 'CONTACTED'}
                      onChange={e => update(i, { status: e.target.value })}
                      options={LEAD_STATUSES.map(s => ({ value: s, label: pretty(s) }))} />
                  )}
                  {step.kind === 'EXIT' && (
                    <FInput disabled={disabled} value={step.reason ?? ''} placeholder="Why it ends here"
                      onChange={e => update(i, { reason: e.target.value })} />
                  )}
                </div>
              </div>

              {i < steps.length - 1 && (
                <div aria-hidden="true" style={{ width: 1, height: 14, background: 'var(--bd)', marginLeft: 27 }} />
              )}
            </div>
          );
        })}
      </div>

      {!disabled && (
        <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
          {Object.entries(STEP_META).map(([kind, meta]) => (
            <Btn key={kind} size="sm" variant="outline" onClick={() => add(kind)}>
              <I n={meta.icon} s={11} c="currentColor" /> {meta.label}
            </Btn>
          ))}
        </div>
      )}
    </div>
  );
};

const SequenceModal = ({ sequence, onClose, onSaved }) => {
  const [name, setName] = useState(sequence?.name ?? '');
  const [description, setDescription] = useState(sequence?.description ?? '');
  const [steps, setSteps] = useState(sequence?.steps ?? [{ kind: 'MESSAGE', body: '' }]);
  const [respectBusinessHours, setRespect] = useState(sequence?.respectBusinessHours ?? true);
  const [exitOnReply, setExitOnReply] = useState(sequence?.exitOnReply ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const body = { name, description: description || null, steps, respectBusinessHours, exitOnReply };
      const res = await wFetch(sequence ? `/sequences/${sequence.id}` : '/sequences', {
        method: sequence ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || d.message || 'Could not save this sequence');
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={sequence ? sequence.name : 'New sequence'} onClose={onClose} width={620}
      footer={<>
        <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={save} disabled={saving || !name.trim() || steps.length === 0}>
          {saving ? 'Saving…' : 'Save'}
        </Btn>
      </>}>
      {err && <div style={{ marginBottom: 12 }}><ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner></div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
        <div><FLabel required>Name</FLabel><FInput value={name} onChange={e => setName(e.target.value)} /></div>
        <div><FLabel>Description</FLabel><FInput value={description} onChange={e => setDescription(e.target.value)} /></div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: 'var(--t2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={exitOnReply} onChange={e => setExitOnReply(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            Stop when the contact replies
            <span style={{ display: 'block', fontSize: 11, color: 'var(--t3)' }}>
              Recommended. Leave this on so a human takes over the moment someone answers.
            </span>
          </span>
        </label>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: 'var(--t2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={respectBusinessHours} onChange={e => setRespect(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            Only send during business hours
            <span style={{ display: 'block', fontSize: 11, color: 'var(--t3)' }}>
              Messages outside the window wait for the next opening rather than being skipped.
            </span>
          </span>
        </label>
      </div>

      <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--t1)', marginBottom: 10 }}>
        Steps
      </div>
      <StepEditor steps={steps} onChange={setSteps} />
    </Modal>
  );
};

const EnrollModal = ({ sequenceId, onClose, onEnrolled }) => {
  const [contacts, setContacts] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => {
      wFetch(`/contacts?search=${encodeURIComponent(search)}&limit=25`)
        .then(r => (r.ok ? r.json() : { data: [] }))
        .then(d => setContacts(d.data ?? []))
        .catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [search]);

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const enroll = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await wFetch(`/sequences/${sequenceId}/enroll`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds: [...selected] }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Could not enrol those contacts');
      }
      setResult(await res.json());
      setSelected(new Set());
      onEnrolled();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Enrol contacts" onClose={onClose} width={520}
      footer={<>
        <Btn variant="ghost" size="sm" onClick={onClose}>Close</Btn>
        {!result && <Btn size="sm" onClick={enroll} disabled={busy || selected.size === 0}>
          {busy ? 'Enrolling…' : `Enrol ${selected.size}`}
        </Btn>}
      </>}>
      {err && <div style={{ marginBottom: 12 }}><ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner></div>}

      {result ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12, color: 'var(--green)', fontSize: 13, fontWeight: 600 }}>
            <I n="checkc" s={16} c="var(--green)" /> Enrolled {result.enrolled} contact{result.enrolled === 1 ? '' : 's'}.
          </div>
          {result.skipped?.length > 0 && (
            <div style={{ ...card, padding: '10px 13px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--t2)', marginBottom: 6, fontWeight: 600 }}>
                {result.skipped.length} skipped
              </div>
              {result.skipped.map((s, i) => (
                <div key={i} style={{ fontSize: 11.5, color: 'var(--t3)' }}>
                  {s.name || s.contactId}: {s.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <FInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contacts" />
          <div style={{ marginTop: 10, maxHeight: 300, overflowY: 'auto', ...card }}>
            {contacts.map(c => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid var(--bd)', cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                <Avatar name={c.name} size={22} />
                <span style={{ flex: 1, fontSize: 12.5, color: 'var(--t1)' }}>{c.name}</span>
                <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>{c.phoneNumber}</span>
                {c.optedOut && <StatusBadge label="Opted out" tone="red" />}
              </label>
            ))}
            {contacts.length === 0 && (
              <div style={{ padding: 18, fontSize: 12.5, color: 'var(--t3)', textAlign: 'center' }}>No contacts found.</div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
};

const SequenceDetail = ({ sequenceId, onClose, onChanged }) => {
  const [sequence, setSequence] = useState(null);
  const [enrolling, setEnrolling] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    wFetch(`/sequences/${sequenceId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load this sequence'))))
      .then(setSequence)
      .catch(e => setErr(e.message));
  }, [sequenceId]);

  useEffect(() => { load(); }, [load]);

  const unenroll = async (enrollmentId) => {
    const res = await wFetch(`/sequences/${sequenceId}/enrollments/${enrollmentId}`, { method: 'DELETE' });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || 'Could not unenrol');
      return;
    }
    load();
    onChanged();
  };

  return (
    <Modal title={sequence?.name ?? 'Sequence'} onClose={onClose} width={680}
      footer={<>
        <Btn variant="ghost" size="sm" onClick={onClose}>Close</Btn>
        {sequence?.status === 'PUBLISHED' && (
          <Btn size="sm" onClick={() => setEnrolling(true)}>Enrol contacts</Btn>
        )}
      </>}>
      {err && <div style={{ marginBottom: 12 }}><ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner></div>}
      {!sequence ? <div style={{ fontSize: 12.5, color: 'var(--t3)' }}>Loading…</div> : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <StatusBadge label={pretty(sequence.status)} tone={STATUS_TONE[sequence.status]} />
            <span style={{ fontSize: 12, color: 'var(--t3)' }}>{sequence.steps.length} step{sequence.steps.length === 1 ? '' : 's'}</span>
            {sequence.exitOnReply && <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>· stops on reply</span>}
            {sequence.respectBusinessHours && <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>· business hours only</span>}
          </div>

          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 13, color: 'var(--t1)', marginBottom: 10 }}>
            Enrolled contacts
          </div>

          <div style={{ ...card, overflow: 'hidden', maxHeight: 340, overflowY: 'auto' }}>
            {(sequence.enrollments ?? []).map(e => (
              <div key={e.id} style={{ padding: '11px 14px', borderBottom: '1px solid var(--bd)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar name={e.contact?.name} size={22} />
                  <span style={{ flex: 1, fontSize: 12.5, color: 'var(--t1)' }}>{e.contact?.name}</span>
                  <StatusBadge label={pretty(e.status)} tone={ENROLMENT_TONE[e.status]} />
                  <span style={{ fontSize: 11, color: 'var(--t3)' }}>step {e.cursor}/{sequence.steps.length}</span>
                  {['ACTIVE', 'WAITING'].includes(e.status) && (
                    <button onClick={() => unenroll(e.id)} aria-label={`Unenrol ${e.contact?.name}`}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3 }}>
                      <I n="x" s={12} c="#f87171" />
                    </button>
                  )}
                </div>
                {e.exitReason && (
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4, marginLeft: 32 }}>{e.exitReason}</div>
                )}
                {e.stepRuns?.length > 0 && (
                  <div style={{ marginTop: 6, marginLeft: 32, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {e.stepRuns.map(r => (
                      <span key={r.id} title={r.detail || ''}
                        style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, border: '1px solid var(--bd)',
                          color: r.outcome === 'FAILED' ? '#f87171' : r.outcome === 'SKIPPED' ? 'var(--t3)' : 'var(--green)' }}>
                        {STEP_META[r.kind]?.label ?? r.kind}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {(sequence.enrollments ?? []).length === 0 && (
              <div style={{ padding: '24px 14px', textAlign: 'center', fontSize: 12.5, color: 'var(--t3)' }}>
                Nobody is in this sequence yet.
              </div>
            )}
          </div>
        </>
      )}

      {enrolling && (
        <EnrollModal sequenceId={sequenceId} onClose={() => setEnrolling(false)}
          onEnrolled={() => { load(); onChanged(); }} />
      )}
    </Modal>
  );
};

export const SequencesView = () => {
  const [sequences, setSequences] = useState([]);
  const [editing, setEditing] = useState(undefined);
  const [openId, setOpenId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    wFetch('/sequences')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load sequences'))))
      .then(d => setSequences(d.data ?? []))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const changeStatus = async (sequence, status) => {
    setErr(null);
    const res = await wFetch(`/sequences/${sequence.id}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || 'Could not change the status');
      return;
    }
    load();
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, color: 'var(--t1)' }}>Sequences</div>
          <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>
            Multi-step follow-ups that stop automatically when someone replies or opts out.
          </div>
        </div>
        <Btn size="sm" onClick={() => setEditing(null)}><I n="plus" s={14} c="#060A10" /> New sequence</Btn>
      </div>

      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {err && <ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner>}
        {loading && <div style={{ fontSize: 12.5, color: 'var(--t3)' }}>Loading…</div>}

        {!loading && sequences.length === 0 && (
          <div style={{ ...card, padding: '36px 20px', textAlign: 'center' }}>
            <I n="wflow" s={26} c="var(--t3)" />
            <div style={{ marginTop: 10, fontSize: 13.5, color: 'var(--t2)', fontWeight: 600 }}>No sequences yet</div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--t3)' }}>
              Build a cadence of messages, waits and follow-up tasks.
            </div>
          </div>
        )}

        {sequences.map(s => (
          <div key={s.id} style={{ ...card, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button onClick={() => setOpenId(s.id)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--t1)' }}>{s.name}</div>
                {s.description && <div style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 2 }}>{s.description}</div>}
              </button>

              <StatusBadge label={pretty(s.status)} tone={STATUS_TONE[s.status]} />

              <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: 'var(--t3)' }}>
                <span>{s.steps?.length ?? 0} steps</span>
                <span>{s.stats?.ACTIVE ?? 0} active</span>
                <span>{s.stats?.COMPLETED ?? 0} completed</span>
                <span>{s.stats?.EXITED ?? 0} exited</span>
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                {s.status === 'DRAFT' && <>
                  <Btn size="sm" variant="ghost" onClick={() => setEditing(s)}>Edit</Btn>
                  <Btn size="sm" onClick={() => changeStatus(s, 'PUBLISHED')}>Publish</Btn>
                </>}
                {s.status === 'PUBLISHED' && (
                  <Btn size="sm" variant="outline" onClick={() => changeStatus(s, 'PAUSED')}>Pause</Btn>
                )}
                {s.status === 'PAUSED' && (
                  <Btn size="sm" onClick={() => changeStatus(s, 'PUBLISHED')}>Resume</Btn>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 5, marginTop: 11, flexWrap: 'wrap' }}>
              {(s.steps ?? []).map((step, i) => {
                const meta = STEP_META[step.kind] ?? STEP_META.MESSAGE;
                return (
                  <span key={i} title={describeStep(step)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, padding: '2px 7px', borderRadius: 999, border: '1px solid var(--bd)', color: 'var(--t3)' }}>
                    <I n={meta.icon} s={10} c={meta.tone} />
                    {meta.label}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {editing !== undefined && (
        <SequenceModal sequence={editing} onClose={() => setEditing(undefined)} onSaved={load} />
      )}
      {openId && (
        <SequenceDetail sequenceId={openId} onClose={() => setOpenId(null)} onChanged={load} />
      )}
    </div>
  );
};

export default SequencesView;
