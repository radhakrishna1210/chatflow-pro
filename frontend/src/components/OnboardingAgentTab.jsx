import { useState, useEffect, useCallback, useRef } from 'react';
import { I } from './Icons.jsx';
import { Btn } from './Btn.jsx';
import { wJson } from '../lib/automationApi.js';

// Setup Assistant: describe what you want, review what the agent designed,
// change any part of it (by hand or by asking), then create it.
//
// Nothing on this screen touches the workspace until "Create" is pressed. Up
// to then the agent has only written a plan, which is what is shown here.

const TYPE_META = {
  form:       { label: 'WhatsApp form', icon: 'note',  color: '#38bdf8' },
  workflow:   { label: 'Workflow',      icon: 'wflow', color: 'var(--green)' },
  auto_reply: { label: 'Auto-reply',    icon: 'msg',   color: '#f59e0b' },
  template:   { label: 'Template',      icon: 'file',  color: '#c084fc' },
};

const EXAMPLES = [
  'I sell mushrooms. When someone says hi, greet them and offer "Place order" and "Talk to us". Place order should ask which mushrooms they want, the quantity of each, and their delivery address.',
  'I run a salon. Let customers book an appointment: ask for the service, preferred day and time, and their name. Also answer "PRICE" with my price list.',
  'Collect feedback after a purchase: ask for a rating from 1 to 5 and a comment, then thank them. If the rating is low, hand the chat to my team.',
];

const TRIGGERS = [
  ['keyword', 'Someone messages a keyword'], ['welcome', 'A new contact messages'],
  ['lead_created', 'CRM: lead created'], ['lead_status', 'CRM: lead status changes'],
  ['deal_stage', 'CRM: deal stage changes'], ['score_above', 'CRM: lead score reaches'],
];
const STEPS = [
  ['action:message', 'Send message'], ['action:buttons', 'Ask with buttons'],
  ['action:wait_reply', 'Wait for reply'], ['action:form', 'Start a form'],
  ['action:template', 'Send template'], ['action:delay', 'Wait'],
  ['action:tag', 'Tag contact'], ['action:agent', 'Hand to a person'],
  ['action:task', 'CRM: create task'], ['action:lead_status', 'CRM: set lead status'],
  ['action:owner', 'CRM: assign owner'], ['action:sequence', 'CRM: enrol in sequence'],
  ['condition:equals', 'If reply is exactly'], ['condition:contains', 'If reply contains'],
  ['condition:is_new_contact', 'If new contact'], ['condition:has_tag', 'If contact has tag'],
  ['condition:field_equals', 'If contact field equals'], ['condition:field_set', 'If contact field is set'],
];
const STEP_HINT = {
  message: 'Message text — {{name}} is the customer’s name',
  buttons: 'Question | Option A | Option B',
  wait_reply: 'Save reply as (optional)',
  delay: 'e.g. 2 hours',
  tag: 'Tag name',
  agent: 'Person’s name (optional)',
  equals: 'Exact reply', contains: 'Text to look for',
};
const FIELD_TYPES = [
  ['text', 'Text'], ['number', 'Number'], ['choice', 'Pick one'], ['multi', 'Pick several'],
  ['phone', 'Phone'], ['email', 'Email'],
];

const input = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)',
  fontFamily: "'Manrope',sans-serif", outline: 'none',
};
const label = { fontSize: 11, color: 'var(--t3)', marginBottom: 4, display: 'block' };
const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 12, padding: 16 };
const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)', padding: 4, display: 'inline-flex' };

const Banner = ({ tone, children }) => {
  const c = tone === 'error' ? '#f87171' : tone === 'warn' ? '#fbbf24' : 'var(--green)';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} style={{ padding: '9px 12px', borderRadius: 9, fontSize: 12.5, lineHeight: 1.5,
      color: c, background: 'rgba(255,255,255,0.03)', border: `1px solid ${c}`, marginBottom: 12 }}>
      {children}
    </div>
  );
};

const Field = ({ title, children, style }) => (
  <label style={{ display: 'block', marginBottom: 10, ...style }}>
    <span style={label}>{title}</span>
    {children}
  </label>
);

const csv = (list) => (list || []).join(', ');
const fromCsv = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);

// ── Editors: one per item type ───────────────────────────────────────────────

const AutoReplyEditor = ({ item, set }) => (
  <>
    <Field title="When someone messages">
      <input style={input} value={item.keyword} onChange={(e) => set({ keyword: e.target.value.toUpperCase() })} />
    </Field>
    <Field title="Reply with">
      <textarea style={{ ...input, minHeight: 80, resize: 'vertical' }} value={item.response} onChange={(e) => set({ response: e.target.value })} />
    </Field>
  </>
);

const FormEditor = ({ item, set }) => {
  const fields = item.fields || [];
  const setField = (i, patch) => set({ fields: fields.map((f, n) => (n === i ? { ...f, ...patch } : f)) });
  return (
    <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Field title="Form name" style={{ flex: '2 1 200px' }}>
          <input style={input} value={item.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field title="Keyword that starts it" style={{ flex: '1 1 140px' }}>
          <input style={input} value={item.keyword} placeholder="none — started by a workflow"
            onChange={(e) => set({ keyword: e.target.value.toUpperCase() })} />
        </Field>
      </div>
      <span style={label}>Questions, asked in this order</span>
      {fields.map((f, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--t3)', width: 16 }}>{i + 1}.</span>
          <input style={{ ...input, flex: '3 1 180px', width: 'auto' }} value={f.label} aria-label={`Question ${i + 1}`}
            onChange={(e) => setField(i, { label: e.target.value })} />
          <select style={{ ...input, flex: '0 0 120px', width: 'auto' }} value={f.type} aria-label={`Answer type for question ${i + 1}`}
            onChange={(e) => setField(i, { type: e.target.value })}>
            {FIELD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {(f.type === 'choice' || f.type === 'multi') && (
            <input style={{ ...input, flex: '2 1 160px', width: 'auto' }} value={csv(f.options)} placeholder="Options, comma separated"
              aria-label={`Options for question ${i + 1}`} onChange={(e) => setField(i, { options: fromCsv(e.target.value) })} />
          )}
          <button type="button" style={iconBtn} title="Remove question" aria-label={`Remove question ${i + 1}`}
            onClick={() => set({ fields: fields.filter((_, n) => n !== i) })}><I n="trash" s={14} /></button>
          {f.showIf && (
            <span style={{ flexBasis: '100%', fontSize: 11, color: 'var(--t3)', paddingLeft: 22 }}>
              Asked only if question {f.showIf.question} is answered “{f.showIf.option}”
            </span>
          )}
        </div>
      ))}
      <Btn size="sm" variant="ghost" onClick={() => set({ fields: [...fields, { label: '', type: 'text', required: true, options: [] }] })}>
        <I n="plus" s={12} /> Add question
      </Btn>
      <Field title="Message when the form is finished" style={{ marginTop: 12 }}>
        <textarea style={{ ...input, minHeight: 60, resize: 'vertical' }} value={item.completionMessage}
          onChange={(e) => set({ completionMessage: e.target.value })} />
      </Field>
    </>
  );
};

const WorkflowEditor = ({ item, set, others }) => {
  const nodes = item.nodes || [];
  const trigger = nodes.find((n) => n.type === 'trigger') || { type: 'trigger', subtype: 'keyword', value: '' };
  const steps = nodes.filter((n) => n.type !== 'trigger');
  const save = (t, s) => set({ nodes: [t, ...s] });
  const setStep = (i, patch) => save(trigger, steps.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  const move = (i, by) => {
    const next = [...steps];
    const [taken] = next.splice(i, 1);
    next.splice(i + by, 0, taken);
    save(trigger, next);
  };
  // A "start a form" or "send template" step can point at an item of this
  // setup ("@key") or name one that already exists in the workspace.
  const targets = (type) => others.filter((o) => o.type === type);

  return (
    <>
      <Field title="Workflow name">
        <input style={input} value={item.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <span style={label}>Starts when</span>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <select style={{ ...input, flex: '1 1 200px', width: 'auto' }} value={trigger.subtype} aria-label="What starts this workflow"
          onChange={(e) => save({ ...trigger, subtype: e.target.value }, steps)}>
          {TRIGGERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {trigger.subtype !== 'welcome' && trigger.subtype !== 'lead_created' && (
          <input style={{ ...input, flex: '1 1 160px', width: 'auto' }} value={trigger.value || ''} aria-label="Trigger value"
            placeholder={trigger.subtype === 'keyword' ? 'e.g. ORDER, BUY' : 'Value'}
            onChange={(e) => save({ ...trigger, value: trigger.subtype === 'keyword' ? e.target.value.toUpperCase() : e.target.value }, steps)} />
        )}
      </div>
      <span style={label}>Then, in order</span>
      {steps.map((s, i) => {
        const kind = `${s.type}:${s.subtype}`;
        const linkable = s.subtype === 'form' ? targets('form') : s.subtype === 'template' ? targets('template') : null;
        return (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--t3)', width: 16 }}>{i + 1}.</span>
            <select style={{ ...input, flex: '0 0 170px', width: 'auto' }} value={kind} aria-label={`Step ${i + 1} type`}
              onChange={(e) => {
                const [type, subtype] = e.target.value.split(':');
                setStep(i, { type, subtype, ...(type === 'condition' ? { skipIfFalse: s.skipIfFalse || 1 } : { skipIfFalse: undefined }) });
              }}>
              {!STEPS.some(([v]) => v === kind) && <option value={kind}>{s.subtype}</option>}
              {STEPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {linkable && linkable.length > 0 ? (
              <select style={{ ...input, flex: '2 1 200px', width: 'auto' }} value={s.value || ''} aria-label={`Step ${i + 1} target`}
                onChange={(e) => setStep(i, { value: e.target.value })}>
                {!linkable.some((o) => `@${o.key}` === s.value) && <option value={s.value || ''}>{s.value || 'Choose…'}</option>}
                {linkable.map((o) => <option key={o.key} value={`@${o.key}`}>{o.name}</option>)}
              </select>
            ) : s.subtype !== 'is_new_contact' && (
              <input style={{ ...input, flex: '2 1 200px', width: 'auto' }} value={s.value || ''} aria-label={`Step ${i + 1} value`}
                placeholder={STEP_HINT[s.subtype] || 'Value'} onChange={(e) => setStep(i, { value: e.target.value })} />
            )}
            {s.type === 'condition' && (
              <span style={{ fontSize: 11, color: 'var(--t3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                otherwise skip
                <input type="number" min="1" style={{ ...input, width: 52 }} value={s.skipIfFalse || 1} aria-label={`Steps to skip after step ${i + 1}`}
                  onChange={(e) => setStep(i, { skipIfFalse: Math.max(1, Number(e.target.value) || 1) })} />
              </span>
            )}
            <button type="button" style={iconBtn} disabled={i === 0} title="Move up" aria-label={`Move step ${i + 1} up`} onClick={() => move(i, -1)}>▲</button>
            <button type="button" style={iconBtn} disabled={i === steps.length - 1} title="Move down" aria-label={`Move step ${i + 1} down`} onClick={() => move(i, 1)}>▼</button>
            <button type="button" style={iconBtn} title="Remove step" aria-label={`Remove step ${i + 1}`}
              onClick={() => save(trigger, steps.filter((_, n) => n !== i))}><I n="trash" s={14} /></button>
          </div>
        );
      })}
      <Btn size="sm" variant="ghost" onClick={() => save(trigger, [...steps, { type: 'action', subtype: 'message', value: '' }])}>
        <I n="plus" s={12} /> Add step
      </Btn>
    </>
  );
};

const TemplateEditor = ({ item, set, locked }) => (
  <>
    {locked && <Banner tone="warn">This template has already been sent to Meta, so changes here will not reach it. Edit it from Templates.</Banner>}
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <Field title="Template name" style={{ flex: '2 1 200px' }}>
        <input style={input} value={item.name} onChange={(e) => set({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
      </Field>
      <Field title="Category" style={{ flex: '1 1 130px' }}>
        <select style={input} value={item.category} onChange={(e) => set({ category: e.target.value })}>
          <option value="MARKETING">Marketing</option><option value="UTILITY">Utility</option>
        </select>
      </Field>
    </div>
    <Field title="Header (optional)"><input style={input} value={item.header} onChange={(e) => set({ header: e.target.value })} /></Field>
    <Field title="Message — {{1}}, {{2}} are filled in per customer">
      <textarea style={{ ...input, minHeight: 80, resize: 'vertical' }} value={item.body} onChange={(e) => set({ body: e.target.value })} />
    </Field>
    <Field title="Sample values for {{1}}, {{2}}… (comma separated)">
      <input style={input} value={csv(item.examples)} onChange={(e) => set({ examples: fromCsv(e.target.value) })} />
    </Field>
    <Field title="Footer (optional)"><input style={input} value={item.footer} onChange={(e) => set({ footer: e.target.value })} /></Field>
    <Field title="Buttons (comma separated)">
      <input style={input} value={csv(item.buttons)} onChange={(e) => set({ buttons: fromCsv(e.target.value) })} />
    </Field>
  </>
);

const EDITORS = { form: FormEditor, workflow: WorkflowEditor, auto_reply: AutoReplyEditor, template: TemplateEditor };

// ── One item of the setup ────────────────────────────────────────────────────

const ItemCard = ({ item, others, focused, busy, onSave, onRemove, onAsk }) => {
  const meta = TYPE_META[item.type];
  const [draft, setDraft] = useState(null);   // non-null while editing
  const Editor = EDITORS[item.type];
  const errors = item.issues.filter((i) => i.level === 'error');
  const warnings = item.issues.filter((i) => i.level === 'warning');

  const save = async () => { if (await onSave(item.key, draft)) setDraft(null); };

  return (
    <div style={{ ...card, marginBottom: 12, borderColor: errors.length ? '#f87171' : focused ? 'var(--green)' : 'var(--bd)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0, background: 'rgba(255,255,255,0.05)' }}>
          <I n={meta.icon} s={15} c={meta.color} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', overflowWrap: 'anywhere' }}>{item.name || item.keyword}</span>
            <span style={{ fontSize: 10.5, color: meta.color, fontFamily: 'var(--mono)', letterSpacing: '.06em' }}>{meta.label.toUpperCase()}</span>
            {item.record && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, border: '1px solid var(--bd)', color: item.record.on ? 'var(--green)' : 'var(--t2)' }}>
                {item.record.state}{!item.record.upToDate ? ' · changes not created yet' : ''}
              </span>
            )}
          </div>
          {!draft && <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--t2)', overflowWrap: 'anywhere' }}>{item.description}</p>}
        </div>
        {!draft && (
          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
            <button type="button" style={iconBtn} title="Edit this yourself" aria-label={`Edit ${item.name || item.keyword}`} onClick={() => setDraft({ ...item })}><I n="note" s={15} /></button>
            <button type="button" style={{ ...iconBtn, color: focused ? 'var(--green)' : 'var(--t3)' }} title="Ask the assistant to change this"
              aria-label={`Ask the assistant about ${item.name || item.keyword}`} aria-pressed={focused} onClick={() => onAsk(item.key)}><I n="spark" s={15} /></button>
            <button type="button" style={iconBtn} title="Remove from this setup" aria-label={`Remove ${item.name || item.keyword}`} disabled={busy} onClick={() => onRemove(item)}><I n="trash" s={15} /></button>
          </div>
        )}
      </div>

      {errors.map((i, n) => <p key={`e${n}`} style={{ margin: '8px 0 0 40px', fontSize: 12.5, color: '#f87171', lineHeight: 1.5 }}>{i.message}</p>)}
      {warnings.map((i, n) => <p key={`w${n}`} style={{ margin: '8px 0 0 40px', fontSize: 12.5, color: '#fbbf24', lineHeight: 1.5 }}>{i.message}</p>)}
      {item.applyError && <p style={{ margin: '8px 0 0 40px', fontSize: 12.5, color: '#f87171', lineHeight: 1.5 }}>Could not be created: {item.applyError}</p>}
      {item.record?.note && <p style={{ margin: '8px 0 0 40px', fontSize: 12.5, color: '#fbbf24', lineHeight: 1.5 }}>{item.record.note}</p>}
      {item.record?.reason && <p style={{ margin: '8px 0 0 40px', fontSize: 12.5, color: '#f87171', lineHeight: 1.5 }}>Meta said: {item.record.reason}</p>}

      {draft && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--bd)' }}>
          <Editor item={draft} others={others} locked={item.type === 'template' && !!item.record}
            set={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Btn size="sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={busy}>Cancel</Btn>
          </div>
        </div>
      )}
    </div>
  );
};

// ── The tab ──────────────────────────────────────────────────────────────────

const Credits = ({ credits }) => {
  if (!credits) return null;
  const out = credits.available <= 0;
  return (
    <div style={{ ...card, padding: 12, fontSize: 12, color: 'var(--t2)', lineHeight: 1.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: out ? '#f87171' : 'var(--t1)', fontWeight: 700, fontSize: 13 }}>
        <I n="credit" s={14} /> {credits.remaining} of {credits.included} AI credits left
      </div>
      <div>Included with the {credits.plan} plan each billing period.</div>
      {credits.rate > 0
        ? <div>After that, ₹{credits.rate} per credit from your wallet (₹{Number(credits.walletBalance).toFixed(2)} available).</div>
        : <div>Upgrade your plan for more.</div>}
    </div>
  );
};

export default function OnboardingAgentTab() {
  const [list, setList] = useState(null);
  const [build, setBuild] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(null);       // 'ask' | 'save' | 'apply' | 'live' | 'open'
  const [prompt, setPrompt] = useState('');
  const [message, setMessage] = useState('');
  const [focus, setFocus] = useState(null);     // item key the next message is about
  const [waNumberId, setWaNumberId] = useState('');
  const threadRef = useRef(null);

  const credits = build?.credits || list?.credits || null;

  const loadList = useCallback(async () => {
    const r = await wJson('/onboarding-agent/builds');
    if (!r.ok) { setLoadError(r.error || 'Could not load the assistant.'); return; }
    setLoadError(null);
    setList(r.data);
  }, []);
  useEffect(() => { loadList(); }, [loadList]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [build?.messages?.length, busy]);

  // Every action answers with the whole setup, so the screen always shows
  // what the server holds rather than a local guess at it.
  const adopt = (data) => {
    setBuild((prev) => ({ ...data, credits: data.credits || prev?.credits }));
    loadList();
  };

  const fail = (r) => setBanner({ tone: 'error', text: r.error || 'Something went wrong. Please try again.' });

  const open = async (id) => {
    setBusy('open'); setBanner(null); setFocus(null);
    const r = await wJson(`/onboarding-agent/builds/${id}`);
    setBusy(null);
    if (!r.ok) { fail(r); return; }
    setBuild(r.data);
  };

  const start = async () => {
    if (!prompt.trim()) return;
    setBusy('ask'); setBanner(null);
    const r = await wJson('/onboarding-agent/builds', { method: 'POST', body: JSON.stringify({ prompt: prompt.trim() }) });
    setBusy(null);
    if (!r.ok) { fail(r); loadList(); return; }
    setPrompt(''); setFocus(null);
    adopt(r.data);
  };

  const send = async () => {
    if (!message.trim() || !build) return;
    setBusy('ask'); setBanner(null);
    const r = await wJson(`/onboarding-agent/builds/${build.id}/messages`, {
      method: 'POST', body: JSON.stringify({ message: message.trim(), ...(focus ? { itemKey: focus } : {}) }),
    });
    setBusy(null);
    if (!r.ok) { fail(r); loadList(); return; }
    setMessage(''); setFocus(null);
    adopt(r.data);
  };

  const saveItem = async (key, draft) => {
    setBusy('save'); setBanner(null);
    const { description, issues, record, applyError, key: _key, ...item } = draft;
    const r = await wJson(`/onboarding-agent/builds/${build.id}/items/${key}`, { method: 'PUT', body: JSON.stringify({ item }) });
    setBusy(null);
    if (!r.ok) { fail(r); return false; }
    adopt(r.data);
    return true;
  };

  const removeItem = async (item) => {
    const created = item.record ? ' What it already created will be switched off the next time you create this setup.' : '';
    if (!window.confirm(`Remove "${item.name || item.keyword}" from this setup?${created}`)) return;
    setBusy('save'); setBanner(null);
    const r = await wJson(`/onboarding-agent/builds/${build.id}/items/${item.key}`, { method: 'DELETE' });
    setBusy(null);
    if (!r.ok) { fail(r); return; }
    adopt(r.data);
  };

  const apply = async (activate) => {
    const templates = build.items.filter((i) => i.type === 'template' && !i.record);
    if (templates.length && !window.confirm(
      `This sends ${templates.length === 1 ? `the template "${templates[0].name}"` : `${templates.length} templates`} to Meta for approval. A submitted template cannot be edited from here afterwards. Continue?`,
    )) return;
    setBusy('apply'); setBanner(null);
    const r = await wJson(`/onboarding-agent/builds/${build.id}/apply`, {
      method: 'POST', body: JSON.stringify({ activate, ...(waNumberId ? { waNumberId } : {}) }),
    });
    setBusy(null);
    if (!r.ok) { fail(r); return; }
    adopt(r.data);
    setBanner(r.data.failed
      ? { tone: 'warn', text: `${r.data.failed} item${r.data.failed === 1 ? '' : 's'} could not be created — see the notes below. Everything else was created.` }
      : { tone: 'ok', text: activate ? 'Created and switched on. Send your keyword to your WhatsApp number to try it.' : 'Created, switched off. Switch it on when you are ready.' });
  };

  const setLive = async (on) => {
    setBusy('live'); setBanner(null);
    const r = await wJson(`/onboarding-agent/builds/${build.id}/live`, { method: 'POST', body: JSON.stringify({ on }) });
    setBusy(null);
    if (!r.ok) { fail(r); return; }
    adopt(r.data);
    setBanner(r.data.skipped?.length
      ? { tone: 'warn', text: `Not switched ${on ? 'on' : 'off'}: ${r.data.skipped.join(', ')}.${on ? ' A workflow waits until Meta approves its template.' : ''}` }
      : { tone: 'ok', text: on ? 'Everything is switched on.' : 'Everything is switched off. Nothing was deleted.' });
  };

  const removeBuild = async () => {
    if (!window.confirm(`Remove "${build.title}" from this list? Anything it created stays in your workspace as it is.`)) return;
    const r = await wJson(`/onboarding-agent/builds/${build.id}`, { method: 'DELETE' });
    if (!r.ok) { fail(r); return; }
    setBuild(null); loadList();
  };

  if (loadError) return <div style={{ padding: 32 }}><Banner tone="error">{loadError}</Banner></div>;
  if (!list) return <div style={{ padding: 32, color: 'var(--t3)', fontSize: 13 }}>Loading…</div>;

  const created = build?.items.filter((i) => i.record) || [];
  const anyOn = created.some((i) => i.type !== 'template' && i.record.on);
  const focusItem = build?.items.find((i) => i.key === focus);
  const thinking = busy === 'ask';

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* Left: setups and credits */}
      <aside style={{ flex: '0 0 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Btn onClick={() => { setBuild(null); setBanner(null); setFocus(null); }} style={{ justifyContent: 'center' }}>
          <I n="plus" s={14} /> New setup
        </Btn>
        <Credits credits={credits} />
        {list.builds.length > 0 && (
          <div style={{ ...card, padding: 8 }}>
            {list.builds.map((b) => (
              <button key={b.id} type="button" onClick={() => open(b.id)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 8, cursor: 'pointer', border: 'none',
                  background: build?.id === b.id ? 'rgba(255,255,255,0.06)' : 'transparent', color: 'var(--t1)', fontFamily: "'Manrope',sans-serif" }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</div>
                <div style={{ fontSize: 11, color: 'var(--t3)' }}>
                  {b.itemCount} item{b.itemCount === 1 ? '' : 's'} · {b.status === 'DRAFT' ? 'Not created yet' : b.status === 'APPLIED' ? 'Created' : 'Has changes'}
                </div>
              </button>
            ))}
          </div>
        )}
      </aside>

      <main style={{ flex: '1 1 520px', minWidth: 0 }}>
        {banner && <Banner tone={banner.tone}>{banner.text}</Banner>}
        {!list.llmAvailable && <Banner tone="warn">The assistant is not set up on this platform yet, so it cannot design anything. Ask your administrator to add an AI key.</Banner>}

        {!build ? (
          <div style={card}>
            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--t1)' }}>Tell the assistant what you want</h2>
            <p style={{ margin: '6px 0 14px', fontSize: 13, lineHeight: 1.6, color: 'var(--t2)' }}>
              Describe it the way you would to a colleague. The assistant designs the forms, workflows, auto-replies and
              templates and connects them. You review everything before anything is created.
            </p>
            <textarea style={{ ...input, minHeight: 130, resize: 'vertical', fontSize: 14, lineHeight: 1.55 }} value={prompt} maxLength={4000}
              aria-label="What do you want to set up?" placeholder="e.g. When a customer says hi, greet them and let them place an order…"
              onChange={(e) => setPrompt(e.target.value)} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
              <Btn onClick={start} disabled={thinking || !prompt.trim() || !list.llmAvailable}>
                <I n="spark" s={14} /> {thinking ? 'Designing… this can take a minute' : 'Design my setup'}
              </Btn>
              <span style={{ fontSize: 12, color: 'var(--t3)' }}>Uses AI credits. A typical setup uses a handful.</span>
            </div>
            <div style={{ marginTop: 20 }}>
              <span style={label}>Or start from an example</span>
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" onClick={() => setPrompt(ex)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: 6, borderRadius: 9, cursor: 'pointer',
                    background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)', color: 'var(--t2)', fontSize: 12.5, lineHeight: 1.5,
                    fontFamily: "'Manrope',sans-serif" }}>{ex}</button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <h2 style={{ margin: 0, fontSize: 18, color: 'var(--t1)', overflowWrap: 'anywhere' }}>{build.title}</h2>
                {build.summary && <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--t2)', lineHeight: 1.5 }}>{build.summary}</p>}
              </div>
              <button type="button" style={iconBtn} title="Remove this setup from the list" aria-label="Remove this setup from the list" onClick={removeBuild}><I n="trash" s={16} /></button>
            </div>

            {build.issues.map((i, n) => <Banner key={n} tone={i.level === 'error' ? 'error' : 'warn'}>{i.message}</Banner>)}

            {build.items.length === 0 && (
              <div style={{ ...card, color: 'var(--t2)', fontSize: 13 }}>Nothing designed yet. Answer the assistant below and it will draw up the setup.</div>
            )}
            {build.items.map((item) => (
              <ItemCard key={item.key} item={item} others={build.items.filter((o) => o.key !== item.key)} focused={focus === item.key}
                busy={busy === 'save'} onSave={saveItem} onRemove={removeItem}
                onAsk={(key) => setFocus((f) => (f === key ? null : key))} />
            ))}

            {/* Create / switch */}
            {build.items.length > 0 && (
              <div style={{ ...card, marginBottom: 16 }}>
                {build.numbers.length > 1 && build.items.some((i) => i.type === 'template' && !i.record) && (
                  <Field title="WhatsApp number for the template">
                    <select style={input} value={waNumberId} onChange={(e) => setWaNumberId(e.target.value)}>
                      <option value="">Choose a number…</option>
                      {build.numbers.map((n) => <option key={n.id} value={n.id}>{n.displayName ? `${n.displayName} · ` : ''}{n.phoneNumber}</option>)}
                    </select>
                  </Field>
                )}
                {build.hasUnappliedChanges ? (
                  <>
                    <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--t2)', lineHeight: 1.5 }}>
                      {build.canApply
                        ? (created.length ? 'You have changes that are not created yet.' : 'Happy with it? Create it in your workspace.')
                        : 'Fix the problems marked in red first — edit the item, or ask the assistant to fix them.'}
                    </p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Btn onClick={() => apply(true)} disabled={!build.canApply || !!busy}>
                        <I n="check" s={14} /> {busy === 'apply' ? 'Creating…' : 'Create and switch on'}
                      </Btn>
                      <Btn variant="ghost" onClick={() => apply(false)} disabled={!build.canApply || !!busy}>Create, keep switched off</Btn>
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ flex: 1, minWidth: 180, fontSize: 13, color: 'var(--t2)' }}>
                      Everything here exists in your workspace. You can also edit each part from its own tab.
                    </span>
                    <Btn size="sm" onClick={() => setLive(true)} disabled={!!busy}>Switch all on</Btn>
                    {anyOn && <Btn size="sm" variant="ghost" onClick={() => setLive(false)} disabled={!!busy}>Switch all off</Btn>}
                  </div>
                )}
              </div>
            )}

            {/* Conversation with the assistant */}
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)', marginBottom: 10 }}>Ask the assistant to change something</div>
              <div ref={threadRef} style={{ maxHeight: 280, overflowY: 'auto', marginBottom: 10 }}>
                {build.messages.map((m, n) => (
                  <div key={n} style={{ marginBottom: 8, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    <div style={{ maxWidth: '85%', padding: '8px 11px', borderRadius: 10, fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                      background: m.role === 'user' ? 'rgba(var(--accent-rgb),0.14)' : 'rgba(255,255,255,0.04)', color: 'var(--t1)', border: '1px solid var(--bd)' }}>
                      {m.text}
                      {m.role === 'agent' && m.credits > 0 && <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 4 }}>{m.credits} credit{m.credits === 1 ? '' : 's'}</div>}
                    </div>
                  </div>
                ))}
                {thinking && <div style={{ fontSize: 12.5, color: 'var(--t3)' }}>The assistant is working on it…</div>}
              </div>
              {focusItem && (
                <div style={{ fontSize: 12, color: 'var(--green)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  About: {focusItem.name || focusItem.keyword}
                  <button type="button" style={iconBtn} aria-label="Ask about the whole setup instead" onClick={() => setFocus(null)}><I n="x" s={12} /></button>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <textarea style={{ ...input, minHeight: 44, resize: 'vertical' }} value={message} maxLength={4000} aria-label="Message to the assistant"
                  placeholder={focusItem ? 'What should change here?' : 'e.g. Also ask for their phone number, and add a reply for "PRICE"'}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                <Btn onClick={send} disabled={thinking || !message.trim() || !list.llmAvailable}><I n="send" s={14} /> Send</Btn>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
