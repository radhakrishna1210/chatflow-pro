import { useState, useEffect, useMemo } from 'react';

// The page a visitor actually fills in, at /forms/:workspaceId/:slug.
//
// Nothing here is authenticated and nothing may assume a session: it is
// rendered for strangers, so it uses plain fetch rather than the app's authed
// helpers, and it never displays anything about the workspace beyond what the
// public endpoint chooses to return.
//
// The matching API is GET/POST /api/v1/forms/:workspaceId/:slug. An unknown
// slug and an inactive form are both 404 by design, so this page cannot be
// used to work out which forms exist.

// Kept in step with ATTRIBUTION_KEYS in backend/src/services/leadForms.service.js.
// Sending more is harmless — the server drops anything not on its own
// allow-list — but sending fewer loses attribution silently.
const ATTRIBUTION_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];

const wrap = {
  minHeight: '100vh',
  background: 'var(--bg, #0B0F17)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '48px 20px',
};

const panel = {
  width: '100%',
  maxWidth: 560,
  background: 'var(--surf, #111827)',
  border: '1px solid var(--bd, rgba(255,255,255,.08))',
  borderRadius: 14,
  padding: '28px 26px',
};

const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--t1, #E8EDF5)', marginBottom: 6 };
const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1px solid var(--bd, rgba(255,255,255,.08))',
  background: 'rgba(255,255,255,.03)', color: 'var(--t1, #E8EDF5)',
  fontSize: 14, fontFamily: 'inherit', outline: 'none',
};

export default function PublicForm({ workspaceId, slug }) {
  const [form, setForm] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | missing | error
  const [answers, setAnswers] = useState({});
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  // Captured on load: by the time someone submits, the URL may have been
  // rewritten and document.referrer is long gone.
  const attribution = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const out = {};
    for (const key of ATTRIBUTION_PARAMS) {
      const v = params.get(key);
      if (v) out[key] = v;
    }
    if (document.referrer) out.referrer = document.referrer;
    return Object.keys(out).length ? out : undefined;
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/forms/${encodeURIComponent(workspaceId)}/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) { setStatus('missing'); return; }
        if (!res.ok) { setStatus('error'); return; }
        setForm(await res.json());
        setStatus('ready');
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [workspaceId, slug]);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/forms/${encodeURIComponent(workspaceId)}/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers,
          consent: form.consentText ? consent : undefined,
          attribution,
          // The honeypot is always sent. A bot that fills every input trips it;
          // a human never sees it.
          _hp: honeypot || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || body.message || 'Something went wrong. Please try again.');
      setDone(body.message || 'Thanks — we have your details.');
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  if (status === 'loading') {
    return <div style={wrap}><div style={{ ...panel, color: 'var(--t3, #8A94A6)', fontSize: 14 }}>Loading…</div></div>;
  }

  // An unknown slug, an inactive form and a deleted form are deliberately
  // indistinguishable here, exactly as they are at the API.
  if (status === 'missing') {
    return (
      <div style={wrap}>
        <div style={panel}>
          <h1 style={{ fontSize: 19, color: 'var(--t1, #E8EDF5)', marginBottom: 8 }}>This form is not available</h1>
          <p style={{ fontSize: 14, color: 'var(--t3, #8A94A6)', lineHeight: 1.6, margin: 0 }}>
            The link may be wrong, or the form may no longer be accepting responses.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={wrap}>
        <div style={panel}>
          <h1 style={{ fontSize: 19, color: 'var(--t1, #E8EDF5)', marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: 'var(--t3, #8A94A6)', lineHeight: 1.6, margin: 0 }}>
            We could not load this form. Please refresh and try again.
          </p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={wrap}>
        <div style={panel}>
          <h1 style={{ fontSize: 19, color: 'var(--t1, #E8EDF5)', marginBottom: 8 }}>Thank you</h1>
          <p style={{ fontSize: 14, color: 'var(--t2, #B6C0D0)', lineHeight: 1.6, margin: 0 }}>{done}</p>
        </div>
      </div>
    );
  }

  const fields = Array.isArray(form.fields) ? form.fields : [];
  const setAnswer = (key, value) => setAnswers((a) => ({ ...a, [key]: value }));

  return (
    <div style={wrap}>
      <form style={panel} onSubmit={submit} noValidate>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--t1, #E8EDF5)', marginBottom: form.description ? 8 : 20 }}>
          {form.name}
        </h1>
        {form.description && (
          <p style={{ fontSize: 14, color: 'var(--t3, #8A94A6)', lineHeight: 1.6, marginBottom: 22 }}>{form.description}</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {fields.map((f) => {
            const id = `field-${f.key}`;
            const common = {
              id,
              value: answers[f.key] ?? '',
              required: !!f.required,
              disabled: submitting,
              onChange: (e) => setAnswer(f.key, e.target.value),
              style: inputStyle,
            };
            return (
              <div key={f.key}>
                <label htmlFor={id} style={labelStyle}>
                  {f.label}
                  {f.required && <span style={{ color: '#f87171' }}> *</span>}
                </label>
                {f.type === 'textarea' ? (
                  <textarea {...common} rows={4} style={{ ...inputStyle, resize: 'vertical' }} />
                ) : f.type === 'select' ? (
                  <select {...common}>
                    <option value="">Choose…</option>
                    {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    {...common}
                    type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text'}
                    autoComplete={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'on'}
                  />
                )}
              </div>
            );
          })}

          {/* Honeypot. Hidden from sight and from screen readers, and excluded
              from tab order, so no real visitor can reach it by any route. */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
            <label htmlFor="company-website">Leave this field empty</label>
            <input id="company-website" name="company-website" type="text" tabIndex={-1} autoComplete="off"
              value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
          </div>

          {form.consentText && (
            <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 13, color: 'var(--t2, #B6C0D0)', lineHeight: 1.55, cursor: 'pointer' }}>
              <input type="checkbox" checked={consent} disabled={submitting}
                onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 2 }} />
              <span>{form.consentText}</span>
            </label>
          )}

          {error && (
            <div role="alert" style={{ padding: '10px 13px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)', color: '#f87171', fontSize: 13 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || (!!form.consentText && !consent)}
            style={{
              padding: '12px 22px', borderRadius: 9, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer',
              background: 'var(--green, #1EBF5E)', color: '#060A10', fontWeight: 600, fontSize: 14.5,
              fontFamily: 'inherit', opacity: submitting || (!!form.consentText && !consent) ? .55 : 1,
            }}
          >
            {submitting ? 'Sending…' : 'Submit'}
          </button>
        </div>
      </form>
    </div>
  );
}
