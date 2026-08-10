import { useState, useEffect, useCallback } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';

// Smart Website Widget management.
//
// The widget itself runs on the customer's own site (served by the backend at
// /widget/v1/loader.js); this is where it is configured. The editor keeps a
// live preview beside the form because almost every setting here is visual,
// and the alternative is publishing to a real website to see a colour change.

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const TYPES = [
  { id: 'AI_WHATSAPP', label: 'AI + WhatsApp', hint: 'Visitors ask the assistant, then continue on WhatsApp.', recommended: true },
  { id: 'AI',          label: 'AI Assistant',  hint: 'Answers questions from your website content.' },
  { id: 'WHATSAPP',    label: 'WhatsApp',      hint: 'A click-to-WhatsApp button, no assistant.' },
];

const inputBase = {
  width: '100%', padding: '9px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 13,
  fontFamily: "'Plus Jakarta Sans',sans-serif", outline: 'none', boxSizing: 'border-box',
};

const Label = ({ children, hint }) => (
  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--t2)', marginBottom: 6 }}>
    {children}
    {hint && <span style={{ fontWeight: 500, color: 'var(--t3)' }}> — {hint}</span>}
  </label>
);

const Field = ({ label, hint, children }) => (
  <div style={{ marginBottom: 14 }}>
    <Label hint={hint}>{label}</Label>
    {children}
  </div>
);

const Section = ({ title, children, right }) => (
  <div style={{ ...card, padding: 18, marginBottom: 16 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--t1)' }}>{title}</p>
      {right}
    </div>
    {children}
  </div>
);

// ─── live preview ────────────────────────────────────────────────────────────
//
// A static rendering of what the embedded widget looks like with the current
// settings. Deliberately a re-implementation of the loader's appearance rather
// than an iframe of the real thing: an iframe would need a saved, published
// widget and a reachable origin, so it could not preview an unsaved change —
// which is the entire point of a live preview.
const Preview = ({ form }) => {
  const c = form.config;
  const width = c.size === 'small' ? 300 : c.size === 'large' ? 360 : 330;
  const accent = c.primaryColor || '#1EBF5E';
  const showAi = form.type !== 'WHATSAPP';
  const showWa = form.type !== 'AI';

  return (
    <div style={{ ...card, padding: 16, position: 'sticky', top: 0 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>
        Live Preview
      </p>
      <div style={{
        background: '#eef1f5', borderRadius: 12, padding: 16, minHeight: 380,
        display: 'flex', flexDirection: 'column',
        alignItems: c.position === 'bottom-left' ? 'flex-start' : 'flex-end',
        justifyContent: 'flex-end', gap: 10,
      }}>
        <div style={{ width, maxWidth: '100%', background: '#fff', borderRadius: 14, overflow: 'hidden', boxShadow: '0 8px 28px rgba(0,0,0,.16)' }}>
          <div style={{ background: accent, color: '#fff', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 9 }}>
            {c.logoUrl
              ? <img src={c.logoUrl} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', background: 'rgba(255,255,255,.2)' }} />
              : <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,.25)' }} />}
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title || 'Chat with us'}</p>
              <p style={{ fontSize: 10.5, opacity: .85 }}>{c.businessName || 'Your business'}</p>
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 17, opacity: .9 }}>×</span>
          </div>

          <div style={{ background: '#f7f8fa', padding: 12, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 150 }}>
            <div style={{ alignSelf: 'flex-start', maxWidth: '88%', background: '#fff', border: '1px solid #e6e8ec', borderRadius: '14px 14px 14px 4px', padding: '9px 12px', fontSize: 12.5, color: '#111', lineHeight: 1.5 }}>
              {c.welcomeMessage || 'Hi! How can we help?'}
            </div>
            {showAi && (c.suggestedQuestions || []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {c.suggestedQuestions.map((q, i) => (
                  <span key={i} style={{ padding: '5px 10px', border: `1px solid ${accent}55`, background: '#fff', color: accent, borderRadius: 999, fontSize: 11.5 }}>{q}</span>
                ))}
              </div>
            )}
          </div>

          {showAi && (
            <div style={{ padding: 9, borderTop: '1px solid #e6e8ec', background: '#fff', display: 'flex', gap: 7 }}>
              <div style={{ flex: 1, padding: '8px 11px', border: '1px solid #dfe2e7', borderRadius: 9, fontSize: 12.5, color: '#9aa0a6' }}>Ask a question…</div>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>→</div>
            </div>
          )}
          {showWa && (
            <div style={{ padding: 9, borderTop: '1px solid #e6e8ec', background: '#fff' }}>
              <div style={{ padding: 10, borderRadius: 9, background: '#25D366', color: '#fff', fontSize: 12.5, fontWeight: 600, textAlign: 'center' }}>
                {c.whatsappButtonText || 'Talk to Us on WhatsApp'}
              </div>
            </div>
          )}
          <p style={{ textAlign: 'center', fontSize: 9.5, color: '#9aa0a6', padding: 5 }}>Powered by ChatFlow Pro</p>
        </div>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 16px', borderRadius: 999, background: accent, color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: '0 5px 18px rgba(0,0,0,.2)' }}>
          {c.buttonText || 'Chat with us'}
        </div>
      </div>
      <p style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 9, lineHeight: 1.5 }}>
        Shown {c.position === 'bottom-left' ? 'bottom-left' : 'bottom-right'} · {c.size} ·{' '}
        {c.showOnDesktop !== false && c.showOnMobile !== false ? 'desktop and mobile'
          : c.showOnDesktop !== false ? 'desktop only'
          : c.showOnMobile !== false ? 'mobile only' : 'hidden everywhere'}
      </p>
    </div>
  );
};

// ─── knowledge sources ───────────────────────────────────────────────────────

const KnowledgePanel = () => {
  const [sources, setSources] = useState([]);
  const [status, setStatus] = useState(null);
  const [url, setUrl] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [tab, setTab] = useState('url');

  const load = useCallback(() => {
    wFetch('/widgets/knowledge').then(r => r.ok && r.json()).then(d => { if (Array.isArray(d)) setSources(d); }).catch(() => {});
    wFetch('/widgets/knowledge/status').then(r => r.ok && r.json()).then(d => d && setStatus(d)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (payload) => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await wFetch('/widgets/knowledge', { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || `Error ${res.status}`); return; }
      if (data.status === 'ERROR') setErr(data.error || 'That page could not be read.');
      setUrl(''); setNoteTitle(''); setNoteBody('');
      load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const act = async (path, method = 'POST') => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await wFetch(path, { method });
      if (!res.ok && res.status !== 204) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || `Error ${res.status}`);
      }
      load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const reindex = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await wFetch('/widgets/knowledge/reindex', { method: 'POST', body: JSON.stringify({ refresh: true }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error || 'Re-index failed'); return; }
      setMsg(`Indexed ${d.chunks} passages from ${d.sources} sources${d.pendingEmbedding ? ` — ${d.pendingEmbedding} awaiting embedding` : ''}.`);
      load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Section title="Website Knowledge" right={
      <Btn size="sm" variant="outline" onClick={reindex} disabled={busy}>
        <I n="refresh" s={12} c="var(--t2)" /> Re-index
      </Btn>
    }>
      <p style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.55, marginBottom: 14 }}>
        What the assistant is allowed to answer from. Add the pages of your website you want it to know about, or paste
        information directly. It will only answer from this — anything else gets a polite "I don't know" instead of a guess.
      </p>

      {status && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: '10px 13px', borderRadius: 9, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)', marginBottom: 14 }}>
          {[['Sources', status.sources], ['Passages indexed', status.chunks], ['Semantic search', status.semantic ? 'On' : 'Off (keyword only)']].map(([k, v]) => (
            <div key={k}>
              <p style={{ fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>{k}</p>
              <p style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 600 }}>{v}</p>
            </div>
          ))}
          {!status.ready && (
            <p style={{ fontSize: 11.5, color: '#fbbf24', alignSelf: 'center' }}>
              Nothing indexed yet — the assistant cannot answer until you add a source and re-index.
            </p>
          )}
        </div>
      )}

      {err && <div style={{ padding: '9px 12px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 12, marginBottom: 12 }}>{err}</div>}
      {msg && <div style={{ padding: '9px 12px', borderRadius: 8, background: 'var(--gbg)', border: '1px solid var(--gbd)', color: 'var(--green)', fontSize: 12, marginBottom: 12 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[['url', 'Add a page'], ['text', 'Paste text']].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            style={{ padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: "'Plus Jakarta Sans',sans-serif",
                     border: `1px solid ${tab === id ? 'var(--gbd)' : 'var(--bd)'}`,
                     background: tab === id ? 'var(--gbg)' : 'rgba(255,255,255,0.04)',
                     color: tab === id ? 'var(--green)' : 'var(--t2)' }}>{label}</button>
        ))}
      </div>

      {tab === 'url' ? (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://yoursite.com/services"
            onKeyDown={e => e.key === 'Enter' && url.trim() && add({ kind: 'url', url: url.trim() })}
            style={{ ...inputBase, flex: 1 }} />
          <Btn size="sm" onClick={() => add({ kind: 'url', url: url.trim() })} disabled={busy || !url.trim()}>
            {busy ? 'Fetching…' : 'Fetch'}
          </Btn>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          <input value={noteTitle} onChange={e => setNoteTitle(e.target.value)} placeholder="Title, e.g. Refund policy" style={inputBase} />
          <textarea value={noteBody} onChange={e => setNoteBody(e.target.value)} rows={5}
            placeholder="Paste the information you want the assistant to know…"
            style={{ ...inputBase, resize: 'vertical', lineHeight: 1.55 }} />
          <Btn size="sm" onClick={() => add({ kind: 'text', title: noteTitle, content: noteBody })} disabled={busy || !noteBody.trim()}
            style={{ alignSelf: 'flex-start' }}>Add</Btn>
        </div>
      )}

      {sources.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--t3)' }}>No sources yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {sources.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--bd)', background: 'rgba(255,255,255,0.02)' }}>
              <I n={s.kind === 'url' ? 'globe' : 'note'} s={14} c="var(--t2)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 12.5, color: 'var(--t1)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</p>
                <p style={{ fontSize: 10.5, color: s.status === 'ERROR' ? '#f87171' : 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.status === 'ERROR' ? s.error : `${s.chars.toLocaleString()} characters${s.url ? ` · ${s.url}` : ''}`}
                </p>
              </div>
              {s.kind === 'url' && (
                <button onClick={() => act(`/widgets/knowledge/${s.id}/refresh`)} disabled={busy} title="Re-fetch"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)', display: 'flex', padding: 3 }}>
                  <I n="refresh" s={13} c="var(--t2)" />
                </button>
              )}
              <button onClick={() => act(`/widgets/knowledge/${s.id}`, 'DELETE')} disabled={busy} title="Remove"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', display: 'flex', padding: 3 }}>
                <I n="trash" s={13} c="#f87171" />
              </button>
            </div>
          ))}
          <p style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
            Changes take effect after a re-index.
          </p>
        </div>
      )}
    </Section>
  );
};

// ─── editor ──────────────────────────────────────────────────────────────────

const emptyForm = (numbers) => ({
  name: '',
  type: 'AI_WHATSAPP',
  enabled: true,
  waNumberId: numbers[0]?.id || '',
  allowedDomains: [],
  pagePaths: [],
  config: {
    businessName: '', logoUrl: '', title: 'Chat with us',
    welcomeMessage: 'Hi! Ask me anything about our services, or talk to our team on WhatsApp.',
    assistantName: 'Assistant', avatarUrl: '', primaryColor: '#1EBF5E',
    position: 'bottom-right', size: 'medium', buttonText: 'Chat with us',
    whatsappButtonText: 'Talk to Us on WhatsApp',
    suggestedQuestions: ['What services do you offer?', 'What are your pricing plans?', 'How can I get started?'],
    showOnDesktop: true, showOnMobile: true, launcherDelayMs: 800,
  },
  leadCapture: {
    enabled: false, trigger: 'after_answer',
    headline: 'Leave your details and we will get back to you',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'phone', label: 'Phone', type: 'phone', required: true },
      { key: 'email', label: 'Email', type: 'email', required: false },
    ],
  },
});

const WidgetEditor = ({ widget, numbers, onClose, onSaved }) => {
  const isEdit = !!widget;
  const [form, setForm] = useState(() => (widget
    ? {
        name: widget.name, type: widget.type, enabled: widget.enabled,
        waNumberId: widget.waNumberId || '',
        allowedDomains: widget.allowedDomains || [],
        pagePaths: widget.pagePaths || [],
        config: { ...emptyForm(numbers).config, ...(widget.config || {}) },
        leadCapture: { ...emptyForm(numbers).leadCapture, ...(widget.leadCapture || {}) },
      }
    : emptyForm(numbers)));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(false);

  const setConfig = (patch) => setForm(f => ({ ...f, config: { ...f.config, ...patch } }));
  const setLead = (patch) => setForm(f => ({ ...f, leadCapture: { ...f.leadCapture, ...patch } }));

  const save = async () => {
    if (!form.name.trim()) { setErr('Give the widget a name.'); return; }
    setSaving(true); setErr(null);
    try {
      const res = await wFetch(isEdit ? `/widgets/${widget.id}` : '/widgets', {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...form, waNumberId: form.waNumberId || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || `Error ${res.status}`); return; }
      onSaved(data);
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  const copyInstall = () => {
    navigator.clipboard?.writeText(widget.installSnippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ height: 58, borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 28px', gap: 12, flexShrink: 0, background: 'var(--surf)' }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)', display: 'flex' }}>
          <I n="arrow" s={16} c="var(--t2)" />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 16, color: 'var(--t1)' }}>
            {isEdit ? form.name || 'Edit widget' : 'New widget'}
          </h1>
          <p style={{ fontSize: 11.5, color: 'var(--t2)' }}>
            {isEdit ? 'Changes apply to your live website immediately — no reinstall needed.' : 'Configure it, then copy the install code.'}
          </p>
        </div>
        <Btn onClick={save} disabled={saving} style={{ boxShadow: 'var(--glow)' }}>
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Widget'}
        </Btn>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
        {err && (
          <div style={{ padding: '10px 13px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 12, marginBottom: 16 }}>{err}</div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 380px', gap: 20, alignItems: 'start' }}>
          <div>
            <Section title="Basics">
              <Field label="Widget Name" hint="only you see this">
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Sales Widget" style={inputBase} />
              </Field>

              <Field label="Widget Type">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                  {TYPES.map(t => (
                    <div key={t.id} onClick={() => setForm(f => ({ ...f, type: t.id }))}
                      style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                               border: `1.5px solid ${form.type === t.id ? 'var(--green)' : 'var(--bd)'}`,
                               background: form.type === t.id ? 'var(--gbg)' : 'rgba(255,255,255,0.02)' }}>
                      <p style={{ fontSize: 12.5, fontWeight: 600, color: form.type === t.id ? 'var(--green)' : 'var(--t1)', marginBottom: 3 }}>
                        {t.label}
                        {t.recommended && <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 800, color: 'var(--green)' }}>★</span>}
                      </p>
                      <p style={{ fontSize: 10.5, color: 'var(--t3)', lineHeight: 1.4 }}>{t.hint}</p>
                    </div>
                  ))}
                </div>
                {form.type === 'AI_WHATSAPP' && (
                  <p style={{ fontSize: 11, color: 'var(--green)', marginTop: 6 }}>Recommended — answers questions and still offers a human.</p>
                )}
              </Field>

              {form.type !== 'AI' && (
                <Field label="WhatsApp Number" hint="where handoffs go">
                  <select value={form.waNumberId} onChange={e => setForm(f => ({ ...f, waNumberId: e.target.value }))}
                    style={{ ...inputBase, appearance: 'auto', colorScheme: 'dark' }}>
                    <option value="">Use the workspace's first number</option>
                    {numbers.map(n => <option key={n.id} value={n.id}>{n.phoneNumber}{n.displayName ? ` · ${n.displayName}` : ''}</option>)}
                  </select>
                  {numbers.length === 0 && (
                    <p style={{ fontSize: 11, color: '#fbbf24', marginTop: 5 }}>No WhatsApp number is connected — the handoff button will not appear.</p>
                  )}
                </Field>
              )}
            </Section>

            <Section title="Appearance">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="Business Name"><input value={form.config.businessName} onChange={e => setConfig({ businessName: e.target.value })} placeholder="Acme Robotics" style={inputBase} /></Field>
                <Field label="Widget Title"><input value={form.config.title} onChange={e => setConfig({ title: e.target.value })} style={inputBase} /></Field>
                <Field label="Logo URL"><input value={form.config.logoUrl} onChange={e => setConfig({ logoUrl: e.target.value })} placeholder="https://…/logo.png" style={inputBase} /></Field>
                <Field label="Avatar URL"><input value={form.config.avatarUrl} onChange={e => setConfig({ avatarUrl: e.target.value })} placeholder="https://…/avatar.png" style={inputBase} /></Field>
                <Field label="AI Assistant Name"><input value={form.config.assistantName} onChange={e => setConfig({ assistantName: e.target.value })} style={inputBase} /></Field>
                <Field label="Button Text"><input value={form.config.buttonText} onChange={e => setConfig({ buttonText: e.target.value })} style={inputBase} /></Field>
                <Field label="WhatsApp Button Text"><input value={form.config.whatsappButtonText} onChange={e => setConfig({ whatsappButtonText: e.target.value })} style={inputBase} /></Field>
                <Field label="Primary Colour">
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="color" value={form.config.primaryColor} onChange={e => setConfig({ primaryColor: e.target.value })}
                      style={{ width: 44, height: 36, padding: 2, borderRadius: 8, background: 'transparent', border: '1px solid var(--bd)', cursor: 'pointer' }} />
                    <input value={form.config.primaryColor} onChange={e => setConfig({ primaryColor: e.target.value })} style={{ ...inputBase, flex: 1 }} />
                  </div>
                </Field>
              </div>

              <Field label="Welcome Message">
                <textarea value={form.config.welcomeMessage} onChange={e => setConfig({ welcomeMessage: e.target.value })} rows={2}
                  style={{ ...inputBase, resize: 'vertical', lineHeight: 1.5 }} />
              </Field>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="Position">
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[['bottom-right', 'Bottom Right'], ['bottom-left', 'Bottom Left']].map(([id, label]) => (
                      <button key={id} type="button" onClick={() => setConfig({ position: id })}
                        style={{ flex: 1, padding: '8px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: "'Plus Jakarta Sans',sans-serif",
                                 border: `1px solid ${form.config.position === id ? 'var(--gbd)' : 'var(--bd)'}`,
                                 background: form.config.position === id ? 'var(--gbg)' : 'rgba(255,255,255,0.04)',
                                 color: form.config.position === id ? 'var(--green)' : 'var(--t2)' }}>{label}</button>
                    ))}
                  </div>
                </Field>
                <Field label="Size">
                  <div style={{ display: 'flex', gap: 6 }}>
                    {['small', 'medium', 'large'].map(id => (
                      <button key={id} type="button" onClick={() => setConfig({ size: id })}
                        style={{ flex: 1, padding: '8px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, textTransform: 'capitalize', fontFamily: "'Plus Jakarta Sans',sans-serif",
                                 border: `1px solid ${form.config.size === id ? 'var(--gbd)' : 'var(--bd)'}`,
                                 background: form.config.size === id ? 'var(--gbg)' : 'rgba(255,255,255,0.04)',
                                 color: form.config.size === id ? 'var(--green)' : 'var(--t2)' }}>{id}</button>
                    ))}
                  </div>
                </Field>
              </div>

              <Field label="Show On">
                <div style={{ display: 'flex', gap: 16 }}>
                  {[['showOnDesktop', 'Desktop'], ['showOnMobile', 'Mobile']].map(([key, label]) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--t2)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={form.config[key] !== false} onChange={e => setConfig({ [key]: e.target.checked })} />
                      {label}
                    </label>
                  ))}
                </div>
              </Field>
            </Section>

            {form.type !== 'WHATSAPP' && (
              <Section title="Suggested Questions">
                <p style={{ fontSize: 11.5, color: 'var(--t3)', marginBottom: 10, lineHeight: 1.5 }}>
                  Shown when the widget opens. Up to six.
                </p>
                {form.config.suggestedQuestions.map((q, i) => (
                  <div key={i} style={{ display: 'flex', gap: 7, marginBottom: 7 }}>
                    <input value={q} onChange={e => setConfig({ suggestedQuestions: form.config.suggestedQuestions.map((x, j) => j === i ? e.target.value : x) })}
                      style={{ ...inputBase, flex: 1 }} />
                    <button onClick={() => setConfig({ suggestedQuestions: form.config.suggestedQuestions.filter((_, j) => j !== i) })}
                      style={{ padding: '0 10px', borderRadius: 7, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)', color: '#f87171', cursor: 'pointer', fontSize: 11 }}>Remove</button>
                  </div>
                ))}
                {form.config.suggestedQuestions.length < 6 && (
                  <Btn size="sm" variant="outline" onClick={() => setConfig({ suggestedQuestions: [...form.config.suggestedQuestions, ''] })}>
                    <I n="plus" s={12} c="var(--t2)" /> Add question
                  </Btn>
                )}
              </Section>
            )}

            <Section title="Lead Capture" right={
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--t2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.leadCapture.enabled} onChange={e => setLead({ enabled: e.target.checked })} />
                Enabled
              </label>
            }>
              <p style={{ fontSize: 11.5, color: 'var(--t3)', marginBottom: 12, lineHeight: 1.5 }}>
                Captured leads are saved straight into your Contacts, tagged <code style={{ color: 'var(--t2)' }}>website-widget</code>.
              </p>
              {form.leadCapture.enabled && (
                <>
                  <Field label="Headline">
                    <input value={form.leadCapture.headline} onChange={e => setLead({ headline: e.target.value })} style={inputBase} />
                  </Field>
                  <Field label="Ask">
                    <div style={{ display: 'flex', gap: 6 }}>
                      {[['after_answer', 'After the first answer'], ['before_chat', 'Before chatting']].map(([id, label]) => (
                        <button key={id} type="button" onClick={() => setLead({ trigger: id })}
                          style={{ flex: 1, padding: '8px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: "'Plus Jakarta Sans',sans-serif",
                                   border: `1px solid ${form.leadCapture.trigger === id ? 'var(--gbd)' : 'var(--bd)'}`,
                                   background: form.leadCapture.trigger === id ? 'var(--gbg)' : 'rgba(255,255,255,0.04)',
                                   color: form.leadCapture.trigger === id ? 'var(--green)' : 'var(--t2)' }}>{label}</button>
                      ))}
                    </div>
                  </Field>
                  <Label>Fields</Label>
                  {form.leadCapture.fields.map((f, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input value={f.label} placeholder="Label"
                        onChange={e => setLead({ fields: form.leadCapture.fields.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })}
                        style={{ ...inputBase, flex: 1, minWidth: 120 }} />
                      <input value={f.key} placeholder="key"
                        onChange={e => setLead({ fields: form.leadCapture.fields.map((x, j) => j === i ? { ...x, key: e.target.value } : x) })}
                        style={{ ...inputBase, width: 120, fontFamily: 'monospace' }} />
                      <select value={f.type} onChange={e => setLead({ fields: form.leadCapture.fields.map((x, j) => j === i ? { ...x, type: e.target.value } : x) })}
                        style={{ ...inputBase, width: 100, appearance: 'auto', colorScheme: 'dark' }}>
                        {['text', 'phone', 'email', 'number'].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--t2)' }}>
                        <input type="checkbox" checked={f.required}
                          onChange={e => setLead({ fields: form.leadCapture.fields.map((x, j) => j === i ? { ...x, required: e.target.checked } : x) })} />
                        req
                      </label>
                      <button onClick={() => setLead({ fields: form.leadCapture.fields.filter((_, j) => j !== i) })}
                        style={{ padding: '0 9px', height: 34, borderRadius: 7, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)', color: '#f87171', cursor: 'pointer', fontSize: 11 }}>×</button>
                    </div>
                  ))}
                  <Btn size="sm" variant="outline" onClick={() => setLead({ fields: [...form.leadCapture.fields, { key: '', label: '', type: 'text', required: false }] })}>
                    <I n="plus" s={12} c="var(--t2)" /> Add field
                  </Btn>
                  <p style={{ fontSize: 11, color: 'var(--t3)', marginTop: 8 }}>
                    A phone field is required — it is what makes the lead a contact you can message.
                  </p>
                </>
              )}
            </Section>

            <Section title="Where it runs">
              <Field label="Allowed Domains" hint="one per line">
                <textarea value={(form.allowedDomains || []).join('\n')}
                  onChange={e => setForm(f => ({ ...f, allowedDomains: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) }))}
                  rows={3} placeholder={'example.com\nwww.example.com'} style={{ ...inputBase, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }} />
                <p style={{ fontSize: 11, color: (form.allowedDomains || []).length ? 'var(--t3)' : '#fbbf24', marginTop: 5, lineHeight: 1.5 }}>
                  {(form.allowedDomains || []).length
                    ? 'Only these domains can load the widget. www. of a listed domain is allowed automatically.'
                    : 'Leave empty and any website can use this widget key — and spend your AI quota. Restrict it before going live.'}
                </p>
              </Field>
              <Field label="Page Paths" hint="one per line, blank means every page">
                <textarea value={(form.pagePaths || []).join('\n')}
                  onChange={e => setForm(f => ({ ...f, pagePaths: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) }))}
                  rows={2} placeholder={'/pricing/*\n/support/*'} style={{ ...inputBase, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }} />
              </Field>
            </Section>

            {isEdit && (
              <Section title="Installation">
                <p style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.55, marginBottom: 10 }}>
                  Paste this just before <code style={{ color: 'var(--t1)' }}>&lt;/body&gt;</code> on your website. It carries no keys or
                  credentials, and every setting above is loaded at runtime — change anything here and your site picks it up without reinstalling.
                </p>
                <div style={{ padding: '12px 14px', borderRadius: 9, background: 'rgba(0,0,0,0.35)', border: '1px solid var(--bd)', fontFamily: 'monospace', fontSize: 11.5, color: 'var(--t1)', wordBreak: 'break-all', marginBottom: 10 }}>
                  {widget.installSnippet}
                </div>
                <Btn size="sm" onClick={copyInstall}>
                  <I n="copy" s={12} c="#060A10" /> {copied ? 'Copied!' : 'Copy install code'}
                </Btn>
              </Section>
            )}
          </div>

          <Preview form={form} />
        </div>
      </div>
    </div>
  );
};

// ─── list + analytics ────────────────────────────────────────────────────────

export default function WidgetsView() {
  const [widgets, setWidgets] = useState([]);
  const [numbers, setNumbers] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [editing, setEditing] = useState(null); // widget | 'new' | null
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    wFetch('/widgets').then(r => r.ok && r.json()).then(d => { if (Array.isArray(d)) setWidgets(d); })
      .catch(() => {}).finally(() => setLoading(false));
    wFetch('/widgets/analytics').then(r => r.ok && r.json()).then(d => d && setAnalytics(d)).catch(() => {});
    wFetch('/widgets/sessions?limit=8').then(r => r.ok && r.json()).then(d => { if (Array.isArray(d)) setSessions(d); }).catch(() => {});
    wFetch('/whatsapp/numbers').then(r => r.ok && r.json()).then(d => { if (Array.isArray(d)) setNumbers(d); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (w) => {
    setErr(null);
    const res = await wFetch(`/widgets/${w.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !w.enabled }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error || 'Could not update'); return; }
    load();
  };

  const remove = async (w) => {
    if (!window.confirm(`Delete "${w.name}"? It will stop working on any site it is installed on.`)) return;
    const res = await wFetch(`/widgets/${w.id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) { const d = await res.json().catch(() => ({})); setErr(d.error || 'Could not delete'); return; }
    load();
  };

  const copy = (w) => navigator.clipboard?.writeText(w.installSnippet).catch(() => {});

  if (editing) {
    return (
      <WidgetEditor
        widget={editing === 'new' ? null : editing}
        numbers={numbers}
        onClose={() => setEditing(null)}
        onSaved={(saved) => { setEditing(saved.id ? saved : null); load(); if (!saved.id) setEditing(null); }}
      />
    );
  }

  const tiles = analytics ? [
    ['Impressions', analytics.impressions], ['Opens', analytics.opens],
    ['Questions', analytics.questions], ['AI Answers', analytics.answers],
    ['WhatsApp Clicks', analytics.whatsappClicks], ['Leads', analytics.leads],
    ['Handoffs', analytics.handoffs], ['Conversion', `${analytics.conversionRate}%`],
  ] : [];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ height: 58, borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 28px', gap: 12, flexShrink: 0, background: 'var(--surf)' }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 16, color: 'var(--t1)' }}>Website Widget</h1>
          <p style={{ fontSize: 11.5, color: 'var(--t2)' }}>An AI assistant, lead capture and WhatsApp handoff on your own website</p>
        </div>
        <Btn onClick={() => setEditing('new')} style={{ boxShadow: 'var(--glow)' }}>
          <I n="plus" s={14} c="#060A10" /> New Widget
        </Btn>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
        {err && <div style={{ padding: '10px 13px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 12, marginBottom: 16 }}>{err}</div>}

        {analytics && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 16 }}>
            {tiles.map(([label, value]) => (
              <div key={label} style={{ ...card, padding: '13px 15px' }}>
                <p style={{ fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, marginBottom: 4 }}>{label}</p>
                <p style={{ fontSize: 20, fontWeight: 800, color: 'var(--t1)', fontFamily: "'Syne',sans-serif" }}>
                  {typeof value === 'number' ? value.toLocaleString('en-IN') : value}
                </p>
              </div>
            ))}
          </div>
        )}
        {analytics && <p style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 20 }}>Last {analytics.days} days across all widgets.</p>}

        <KnowledgePanel />

        <Section title={`Widgets (${widgets.length})`}>
          {loading ? (
            <p style={{ fontSize: 12.5, color: 'var(--t2)' }}>Loading…</p>
          ) : widgets.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <p style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 12 }}>No widgets yet.</p>
              <Btn onClick={() => setEditing('new')} style={{ boxShadow: 'var(--glow)' }}>
                <I n="plus" s={13} c="#060A10" /> Create your first widget
              </Btn>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {widgets.map(w => (
                <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', borderRadius: 10, border: '1px solid var(--bd)', background: 'rgba(255,255,255,0.02)', flexWrap: 'wrap' }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: `${w.config?.primaryColor || '#1EBF5E'}18`, border: `1px solid ${w.config?.primaryColor || '#1EBF5E'}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <I n="msg" s={15} c={w.config?.primaryColor || '#1EBF5E'} />
                  </div>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      <p style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--t1)' }}>{w.name}</p>
                      <span style={{ padding: '1px 7px', borderRadius: 8, fontSize: 10, fontWeight: 700, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bd)', color: 'var(--t2)' }}>
                        {TYPES.find(t => t.id === w.type)?.label || w.type}
                      </span>
                      <span style={{ padding: '1px 7px', borderRadius: 8, fontSize: 10, fontWeight: 700,
                                     background: w.enabled ? 'var(--gbg)' : 'rgba(255,255,255,0.04)',
                                     border: `1px solid ${w.enabled ? 'var(--gbd)' : 'var(--bd)'}`,
                                     color: w.enabled ? 'var(--green)' : 'var(--t2)' }}>
                        {w.enabled ? 'Live' : 'Disabled'}
                      </span>
                      {(w.allowedDomains || []).length === 0 && (
                        <span title="Any website can use this widget key" style={{ padding: '1px 7px', borderRadius: 8, fontSize: 10, fontWeight: 700, background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.3)', color: '#fbbf24' }}>
                          Unrestricted
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
                      {(w.allowedDomains || []).join(', ') || 'No domain restriction'}
                      {(w.pagePaths || []).length ? ` · ${w.pagePaths.join(', ')}` : ''}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                    <Btn size="sm" variant="outline" onClick={() => copy(w)}><I n="copy" s={12} c="var(--t2)" /> Copy code</Btn>
                    <Btn size="sm" variant="outline" onClick={() => toggle(w)}>{w.enabled ? 'Disable' : 'Enable'}</Btn>
                    <Btn size="sm" variant="outline" onClick={() => setEditing(w)}><I n="pencil" s={12} c="var(--t2)" /> Edit</Btn>
                    <button onClick={() => remove(w)} title="Delete"
                      style={{ padding: '0 10px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)', color: '#f87171', cursor: 'pointer', fontSize: 12 }}>
                      <I n="trash" s={12} c="#f87171" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {sessions.length > 0 && (
          <Section title="Recent Visitors">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {sessions.map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--bd)', background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12.5, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.firstQuestion || <span style={{ color: 'var(--t3)' }}>Opened the widget without asking anything</span>}
                    </p>
                    <p style={{ fontSize: 10.5, color: 'var(--t3)' }}>
                      {s.widget?.name} · {s.questions} question{s.questions === 1 ? '' : 's'}
                      {s.contact ? ` · ${s.contact.name}` : ''}
                      {s.handedOff ? ' · handed off' : ''}
                    </p>
                  </div>
                  <span style={{ fontSize: 10.5, color: 'var(--t3)', flexShrink: 0 }}>
                    {new Date(s.lastActivityAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
