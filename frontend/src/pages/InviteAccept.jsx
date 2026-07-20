import { useEffect, useState } from 'react';
import { navigate } from '../App.jsx';
import { apiFetch } from '../lib/api.js';
import { I } from '../components/Icons.jsx';

function isAuthed() {
  return !!(localStorage.getItem('accessToken') && localStorage.getItem('user'));
}
function getStoredUser() {
  try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
}

const STATUS_MESSAGES = {
  EXPIRED: 'This invite has expired.',
  ACCEPTED: 'This invite has already been accepted.',
  REVOKED: 'This invite has been revoked.',
};

// Reachable both logged-in and logged-out (see App.jsx — deliberately not
// covered by the /dashboard,/setup,/login,/register route guard) since it
// branches internally on session state.
export default function InviteAccept() {
  const token = new URLSearchParams(window.location.search).get('token');
  const [state, setState] = useState('loading'); // loading | invalid | ready | accepting | mismatch | logged-out
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState(null);
  const [otherWorkspaces, setOtherWorkspaces] = useState(null);

  useEffect(() => {
    if (!token) { setState('invalid'); setError('Missing invite link.'); return; }
    fetch(`/api/v1/invitations/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) { setState('invalid'); setError(data.error || 'This invite could not be found.'); return; }
        if (data.status !== 'PENDING') {
          setState('invalid');
          setError(STATUS_MESSAGES[data.status] || 'This invite is no longer valid.');
          return;
        }
        setInvite(data);
        const user = getStoredUser();
        if (isAuthed() && user) {
          setState(user.email?.toLowerCase() === data.email.toLowerCase() ? 'ready' : 'mismatch');
        } else {
          setState('logged-out');
        }
      })
      .catch(() => { setState('invalid'); setError('Could not load this invite. Check your connection and try again.'); });
  }, [token]);

  // Let a signed-in acceptor know up front that joining this workspace won't
  // touch any workspace(s) they already belong to (e.g. one they admin) —
  // accepting only ever adds a membership, it never replaces one.
  useEffect(() => {
    if (state !== 'ready') return;
    apiFetch('/api/v1/workspaces/mine')
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setOtherWorkspaces(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [state]);

  const accept = async () => {
    setState('accepting');
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not accept this invite.'); setState('ready'); return; }
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify({
        id: data.user.id, name: data.user.name, email: data.user.email, role: data.user.role,
        superAdmin: data.user.superAdmin === true,
        workspaceId: data.workspace?.id ?? null, workspaceName: data.workspace?.name ?? null,
      }));
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setError(e.message);
      setState('ready');
    }
  };

  const signOutAndContinue = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    setState('logged-out');
  };

  const shell = (children) => (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420, background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 14, padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
        {children}
      </div>
    </div>
  );

  const btnStyle = (primary) => ({
    width: '100%', padding: '11px', borderRadius: 9, border: primary ? 'none' : '1px solid var(--bd)',
    cursor: 'pointer', fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 14, fontWeight: 700,
    color: primary ? '#07090F' : 'var(--t1)', background: primary ? 'var(--green)' : 'rgba(255,255,255,0.035)',
    boxShadow: primary ? 'var(--glow)' : 'none',
  });

  if (state === 'loading') {
    return shell(
      <>
        <div style={{ width: 28, height: 28, border: '2px solid var(--green)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <p style={{ color: 'var(--t2)', fontSize: 13 }}>Loading invite…</p>
      </>
    );
  }

  if (state === 'invalid') {
    return shell(
      <>
        <I n="alertt" s={28} c="#f87171" />
        <p style={{ color: '#f87171', fontSize: 14, fontWeight: 600 }}>{error}</p>
        <button onClick={() => navigate('/login', { replace: true })} style={btnStyle(true)}>Back to sign in</button>
      </>
    );
  }

  const inviteSummary = invite && (
    <div style={{ width: '100%', padding: '14px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)', textAlign: 'left' }}>
      <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--t1)' }}>{invite.inviterName}</strong> invited <strong style={{ color: 'var(--t1)' }}>{invite.email}</strong> to join{' '}
        <strong style={{ color: 'var(--t1)' }}>{invite.workspaceName}</strong> as {invite.role === 'ADMIN' ? 'an Admin' : 'a Member'}.
      </p>
    </div>
  );

  if (state === 'mismatch') {
    return shell(
      <>
        <I n="alertc" s={28} c="#fbbf24" />
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--t1)' }}>Wrong account</p>
        <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.6 }}>
          This invite was sent to <strong style={{ color: 'var(--t1)' }}>{invite?.email}</strong>, but you're signed in as{' '}
          <strong style={{ color: 'var(--t1)' }}>{getStoredUser()?.email}</strong>.
        </p>
        <button onClick={signOutAndContinue} style={btnStyle(true)}>Sign out and continue</button>
        <button onClick={() => navigate('/dashboard', { replace: true })} style={btnStyle(false)}>Cancel</button>
      </>
    );
  }

  if (state === 'logged-out') {
    const hasAccount = invite?.hasAccount === true;
    return shell(
      <>
        <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 20, color: 'var(--t1)' }}>You're invited!</p>
        {inviteSummary}
        <p style={{ fontSize: 12.5, color: 'var(--t3)', lineHeight: 1.5 }}>
          {hasAccount
            ? <>An account already exists for <strong style={{ color: 'var(--t2)' }}>{invite.email}</strong> — log in to accept.</>
            : <>No account exists for <strong style={{ color: 'var(--t2)' }}>{invite.email}</strong> yet — create one to accept.</>}
        </p>
        {hasAccount ? (
          <>
            <button onClick={() => navigate(`/login?invite=${encodeURIComponent(token)}`)} style={btnStyle(true)}>Log in to accept</button>
            <button onClick={() => navigate(`/register?invite=${encodeURIComponent(token)}`)} style={btnStyle(false)}>Use a different account instead</button>
          </>
        ) : (
          <>
            <button onClick={() => navigate(`/register?invite=${encodeURIComponent(token)}`)} style={btnStyle(true)}>Create account to accept</button>
            <button onClick={() => navigate(`/login?invite=${encodeURIComponent(token)}`)} style={btnStyle(false)}>I already have an account</button>
          </>
        )}
      </>
    );
  }

  // ready | accepting
  const otherAdminWorkspaces = (otherWorkspaces || []).filter((w) => w.role === 'ADMIN');
  return shell(
    <>
      <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 20, color: 'var(--t1)' }}>Join {invite?.workspaceName}</p>
      {inviteSummary}
      {otherWorkspaces && otherWorkspaces.length > 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--t3)', lineHeight: 1.5 }}>
          {otherAdminWorkspaces.length > 0
            ? <>You're already an Admin of {otherAdminWorkspaces.length === 1 ? otherAdminWorkspaces[0].name : `${otherAdminWorkspaces.length} other workspaces`}. </>
            : <>You already belong to {otherWorkspaces.length === 1 ? otherWorkspaces[0].name : `${otherWorkspaces.length} other workspaces`}. </>}
          Accepting this invite only adds a new membership — it won't change your existing access, and you can switch between workspaces anytime.
        </p>
      )}
      {error && (
        <div style={{ width: '100%', padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: 13, color: '#f87171' }}>
          {error}
        </div>
      )}
      <button onClick={accept} disabled={state === 'accepting'} style={{ ...btnStyle(true), opacity: state === 'accepting' ? 0.7 : 1 }}>
        {state === 'accepting' ? 'Joining…' : 'Accept Invitation'}
      </button>
    </>
  );
}
