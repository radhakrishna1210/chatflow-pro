/**
 * The consent screen: "<App> wants access to your <Workspace> workspace."
 *
 * Reached only by being redirected here from GET /api/v1/oauth/authorize, which
 * has already validated the application and its redirect URI and packed the
 * request into a signed `req` blob. Everything shown below is re-derived from
 * that blob server-side — the browser is never trusted to say what it authorises.
 *
 * ── Two things this page has to survive ─────────────────────────────────────
 *
 * 1. A visitor with no account. They must be able to sign up, verify an emailed
 *    code, create a workspace and connect a number, and still come back here to
 *    the same pending request. The `req` blob is what survives that: it rides in
 *    the URL, and is parked in sessionStorage across the detour (see App.jsx,
 *    which brings them back).
 *
 * 2. Being opened in a popup. The calling application opens one when it hopes
 *    the user is already signed in. If they are not, a popup is the wrong place
 *    to be checking an inbox for a verification code — so we tell the opener to
 *    take over the whole window, and close.
 */
import { useEffect, useState } from 'react';
import { navigate } from '../App.jsx';
import { apiFetch } from '../lib/api.js';

/** Matches the 30-minute signed-blob window on the server. */
const PENDING_KEY = 'oauth.pendingRequest';
const PENDING_MAX_AGE_MS = 30 * 60_000;

export function stashPendingOAuthRequest(req) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ req, ts: Date.now() }));
  } catch { /* private mode; the URL copy is still the primary carrier */ }
}

/** @returns the blob, or null when absent or too old. Does not clear it. */
export function peekPendingOAuthRequest() {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const { req, ts } = JSON.parse(raw);
    if (!req || !ts || Date.now() - ts > PENDING_MAX_AGE_MS) {
      sessionStorage.removeItem(PENDING_KEY);
      return null;
    }
    return req;
  } catch { return null; }
}

export function clearPendingOAuthRequest() {
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* nothing to do */ }
}

const inPopup = () => {
  try { return !!window.opener && window.opener !== window; } catch { return false; }
};

/**
 * Hand the flow back to the window that opened us.
 *
 * Posted to '*' deliberately: the payload is the single word "escalate" and
 * carries nothing secret, we do not know the opener's origin before fetching the
 * request, and the receiver validates the origin itself. Nothing sensitive ever
 * goes through here — the credential is fetched server-to-server later.
 */
function escalateToOpener() {
  try {
    window.opener.postMessage({ source: 'spandan-oauth', status: 'escalate' }, '*');
    window.close();
    return true;
  } catch { return false; }
}

function isAuthed() {
  try { return !!localStorage.getItem('accessToken') && !!localStorage.getItem('user'); } catch { return false; }
}

export default function OAuthConsent({ search = '' }) {
  const req = new URLSearchParams(search || window.location.search).get('req') || '';

  const [state, setState] = useState('loading'); // loading | ready | error | deciding
  const [error, setError] = useState('');
  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (!req) { setError('This authorisation link is incomplete. Start again from the application that sent you.'); setState('error'); return; }

    // No session to consent with. In a popup that means signup, which cannot
    // happen in a popup — hand back to the opener. Otherwise park the request
    // and send them to sign in; App.jsx returns them here afterwards.
    if (!isAuthed()) {
      stashPendingOAuthRequest(req);
      if (inPopup() && escalateToOpener()) return;
      navigate(`/login?req=${encodeURIComponent(req)}`, { replace: true });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/v1/oauth/consent-info?req=${encodeURIComponent(req)}`);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (res.status === 409 || body.code === 'NO_WORKSPACE') {
          // Signed in, but nothing to grant access to yet. Same reasoning as
          // signup: creating a workspace and connecting a number is not popup work.
          stashPendingOAuthRequest(req);
          if (inPopup() && escalateToOpener()) return;
          navigate('/setup', { replace: true });
          return;
        }
        if (!res.ok) { setError(body.error || 'This authorisation request could not be read.'); setState('error'); return; }

        setInfo(body);
        setState('ready');
      } catch (err) {
        if (!cancelled) { setError(err.message || 'Could not load this request.'); setState('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [req]);

  const decide = async (decision) => {
    setState('deciding');
    setError('');
    try {
      const res = await apiFetch('/api/v1/oauth/consent/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ req, decision }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.redirectUrl) throw new Error(body.error || 'Could not complete the request.');

      clearPendingOAuthRequest();
      // Whether this is a popup or the whole window, the destination is the
      // application's own callback — it closes the popup itself once done.
      window.location.href = body.redirectUrl;
    } catch (err) {
      setError(err.message || 'Could not complete the request.');
      setState('ready');
    }
  };

  const shell = (children) => (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '32px' }}>
      <div style={{ width: '100%', maxWidth: '420px' }}>{children}</div>
    </div>
  );

  if (state === 'loading') {
    return shell(<p style={{ color: 'var(--t2)', fontSize: '14px', textAlign: 'center' }}>Checking this request…</p>);
  }

  if (state === 'error') {
    return shell(
      <div style={{ padding: '24px', borderRadius: '12px', background: 'var(--gbg)', border: '1px solid var(--bd)' }}>
        <h1 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 800, fontSize: '20px', color: 'var(--t1)', margin: '0 0 8px' }}>
          Authorisation failed
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--t2)', margin: 0, lineHeight: 1.6 }}>{error}</p>
      </div>,
    );
  }

  const busy = state === 'deciding';

  return shell(
    <div style={{ padding: '28px', borderRadius: '14px', background: 'var(--gbg)', border: '1px solid var(--bd)' }}>
      <h1 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 800, fontSize: '22px', color: 'var(--t1)', margin: '0 0 6px', lineHeight: 1.3 }}>
        {info.client.name} wants access
      </h1>
      <p style={{ fontSize: '14px', color: 'var(--t2)', margin: '0 0 22px', lineHeight: 1.6 }}>
        to your <strong style={{ color: 'var(--t1)' }}>{info.workspace.name}</strong> workspace.
      </p>

      <div style={{ fontSize: '12px', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: '10px' }}>
        It will be able to
      </div>
      <ul style={{ listStyle: 'none', margin: '0 0 24px', padding: 0, display: 'flex', flexDirection: 'column', gap: '9px' }}>
        {info.scopes.map((s) => (
          <li key={s.id} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '14px', color: 'var(--t1)' }}>
            <span style={{ color: 'var(--green)', lineHeight: 1.5 }}>✓</span>
            <span>{s.label}</span>
          </li>
        ))}
      </ul>

      <p style={{ fontSize: '12.5px', color: 'var(--t3)', margin: '0 0 20px', lineHeight: 1.6 }}>
        You can revoke this at any time from your API keys.
      </p>

      {error && (
        <div style={{ padding: '10px 13px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={() => decide('deny')}
          disabled={busy}
          style={{
            flex: '0 0 auto', padding: '11px 18px', borderRadius: '9px', cursor: busy ? 'default' : 'pointer',
            background: 'transparent', border: '1px solid var(--bd)', color: 'var(--t2)',
            fontFamily: "'Manrope',sans-serif", fontSize: '14px', fontWeight: 600, opacity: busy ? 0.6 : 1,
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => decide('approve')}
          disabled={busy}
          style={{
            flex: 1, padding: '11px 18px', borderRadius: '9px', cursor: busy ? 'default' : 'pointer',
            background: 'var(--green)', border: 'none', color: '#0a0b0e',
            fontFamily: "'Manrope',sans-serif", fontSize: '14px', fontWeight: 700, opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Connecting…' : `Allow ${info.client.name}`}
        </button>
      </div>
    </div>,
  );
}
