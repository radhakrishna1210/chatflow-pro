import { useState, useEffect } from 'react';
import { Btn } from '../components/Btn.jsx';
import { adminFetch } from '../lib/api.js';

// ── API Management (Super Admin) ─────────────────────────────────────────────
//
// Platform credentials live in the database, encrypted, and take precedence
// over the server's environment variables — so rotating a key here applies on
// the next call instead of costing a redeploy.
//
// The server never returns a secret in full: each arrives masked. Only fields
// the admin actually edited are sent back, so saving the form cannot overwrite
// a working key with its own preview.

const SETTING_SECTIONS = [
  {
    title: 'AI language & image generation',
    fields: [
      ['GEMINI_API_KEY', 'Gemini API key', 'Powers the AI agent, intent matching and template copy'],
      ['OPENAI_API_KEY', 'OpenAI API key', 'Used for template header image generation'],
    ],
  },
  {
    title: 'Meta / WhatsApp Cloud API',
    fields: [
      ['META_SYSTEM_USER_TOKEN', 'System user access token', 'Long-lived token for template sync and delivery'],
      ['META_APP_ID', 'App ID', ''],
      ['META_APP_SECRET', 'App secret', ''],
      ['META_BUSINESS_ID', 'Business account ID', ''],
      ['META_WABA_ID', 'WABA ID', ''],
    ],
  },
  {
    title: 'SMS fallback (Twilio)',
    fields: [
      ['TWILIO_ACCOUNT_SID', 'Account SID', ''],
      ['TWILIO_AUTH_TOKEN', 'Auth token', ''],
    ],
  },
  {
    title: 'Razorpay',
    fields: [
      ['RAZORPAY_KEY_ID', 'Key ID', ''],
      ['RAZORPAY_KEY_SECRET', 'Key secret', ''],
    ],
  },
  {
    title: 'Email (SMTP)',
    fields: [
      ['SMTP_HOST', 'Host', 'e.g. smtp.gmail.com'],
      ['SMTP_PORT', 'Port', '587'],
      ['SMTP_USER', 'Username', ''],
      ['SMTP_PASSWORD', 'Password', ''],
      ['EMAIL_FROM_NAME', 'Sender name', ''],
      ['EMAIL_FROM', 'Sender address', ''],
    ],
  },
];

const isSecretKey = (key) => /KEY|TOKEN|SECRET|PASSWORD/.test(key);

// Where the value actually in use comes from, so "did my change land?" is
// answerable without reading server logs.
const SOURCE_TONE = {
  database:    { label: 'Database', fg: 'var(--green)', bg: 'var(--gbg)', bd: 'var(--gbd)' },
  environment: { label: 'Env',      fg: '#38bdf8', bg: 'rgba(56,189,248,.08)', bd: 'rgba(56,189,248,.25)' },
  unset:       { label: 'Not set',  fg: 'var(--t3)', bg: 'rgba(255,255,255,.03)', bd: 'var(--bd)' },
};

export default function ApiManagementTab() {
  const [settings, setSettings] = useState({});
  const [sources, setSources] = useState({});
  const [edits, setEdits] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const load = async () => {
    setErr(null);
    try {
      const res = await adminFetch('/platform/settings');
      if (!res.ok) throw new Error('Could not load platform credentials');
      const data = await res.json();
      const { _sources, ...values } = data;
      setSettings(values);
      setSources(_sources || {});
      setEdits({});
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Only edited fields are sent. Untouched ones are left out of the request
  // entirely, so the server has nothing it could misread as a change.
  const save = async (e) => {
    e?.preventDefault();
    const changed = Object.keys(edits);
    if (changed.length === 0) { setMsg('Nothing to save — no field was changed.'); return; }

    setSaving(true); setMsg(null); setErr(null);
    try {
      const res = await adminFetch('/platform/settings', { method: 'POST', body: JSON.stringify(edits) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save platform credentials');

      const updated = data.updated?.length ?? 0;
      const cleared = data.cleared?.length ?? 0;
      setMsg(
        'Saved. ' + updated + ' credential' + (updated === 1 ? '' : 's') + ' updated'
        + (cleared ? ', ' + cleared + ' cleared back to the environment' : '')
        + '. Applies on the next call — no redeploy needed.',
      );
      await load();
    } catch (saveError) {
      setErr(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ color: 'var(--t2)', fontSize: 13, textAlign: 'center', padding: 40 }}>Loading credentials…</div>;
  }

  const dirty = Object.keys(edits).length;

  const renderField = ([key, label, hint]) => {
    const secret = isSecretKey(key);
    const stored = settings[key] || '';
    const edited = edits[key] !== undefined;
    const tone = SOURCE_TONE[sources[key]] || SOURCE_TONE.unset;

    return (
      <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label htmlFor={'set-' + key} style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            {label}
          </label>
          <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 20, letterSpacing: '.06em', textTransform: 'uppercase', color: tone.fg, background: tone.bg, border: '1px solid ' + tone.bd }}>
            {tone.label}
          </span>
          {edited && <span style={{ fontSize: 10, fontWeight: 600, color: '#fbbf24' }}>edited</span>}
        </div>
        <input
          id={'set-' + key}
          type={secret && edited ? 'password' : 'text'}
          value={edited ? edits[key] : stored}
          placeholder={hint || (secret ? 'Not configured' : '')}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setEdits((prev) => ({ ...prev, [key]: e.target.value }))}
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 8,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid ' + (edited ? 'var(--gbd)' : 'var(--bd)'),
            color: edited || !secret ? 'var(--t1)' : 'var(--t2)',
            fontSize: 13, outline: 'none', boxSizing: 'border-box',
            fontFamily: secret ? 'var(--mono)' : "'Plus Jakarta Sans',sans-serif",
          }}
        />
        {hint && <p style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.45 }}>{hint}</p>}
      </div>
    );
  };

  return (
    <form onSubmit={save} style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 40 }}>
      <div>
        <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 800, color: 'var(--t1)', marginBottom: 6 }}>
          Platform credentials
        </h3>
        <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.6 }}>
          Stored encrypted and used in place of the server&apos;s environment variables, so a rotated key applies on the
          next call instead of waiting out a redeploy. Secrets are shown masked and are never sent back to this screen
          in full. Clear a field to fall back to the environment variable.
        </p>
      </div>

      {msg && (
        <div style={{ padding: '11px 15px', borderRadius: 8, background: 'var(--gbg)', border: '1px solid var(--gbd)', color: 'var(--green)', fontSize: 12.5, lineHeight: 1.5 }}>
          {msg}
        </div>
      )}
      {err && (
        <div style={{ padding: '11px 15px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 12.5 }}>
          {err}
        </div>
      )}

      {SETTING_SECTIONS.map((section) => (
        <div key={section.title} className="glass" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h4 style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.07em', margin: 0 }}>
            {section.title}
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: section.fields.length > 2 ? 'repeat(auto-fit,minmax(250px,1fr))' : '1fr', gap: 16 }}>
            {section.fields.map(renderField)}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {dirty > 0 && (
          <>
            <span style={{ fontSize: 12, color: 'var(--t2)' }}>
              {dirty} field{dirty === 1 ? '' : 's'} changed
            </span>
            <Btn variant="ghost" type="button" onClick={() => { setEdits({}); setMsg(null); }}>Discard</Btn>
          </>
        )}
        <Btn type="submit" disabled={saving || dirty === 0}>{saving ? 'Saving…' : 'Save credentials'}</Btn>
      </div>
    </form>
  );
}
