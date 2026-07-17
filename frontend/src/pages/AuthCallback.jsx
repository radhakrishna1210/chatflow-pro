import { useEffect, useState } from 'react';
import { navigate } from '../App.jsx';

// Google OAuth lands here with a one-time ?code=… (never raw tokens — those
// would leak via browser history / proxy logs). The code is exchanged over
// POST for the real session.
export default function AuthCallback() {
  const [error, setError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) { setError('Missing sign-in code.'); return; }

    (async () => {
      try {
        const res = await fetch('/api/v1/auth/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Sign-in failed');

        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        localStorage.setItem('user', JSON.stringify({
          id:            data.user.id,
          name:          data.user.name,
          email:         data.user.email,
          role:          data.user.role,
          superAdmin:    data.user.superAdmin === true,
          workspaceId:   data.workspace?.id ?? null,
          workspaceName: data.workspace?.name ?? null,
        }));
        // Users without a workspace go to setup to create or join one.
        navigate(data.workspace ? '/dashboard' : '/setup', { replace: true });
      } catch (err) {
        setError(err.message);
      }
    })();
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', flexDirection: 'column', gap: 14 }}>
      {error ? (
        <>
          <p style={{ color: '#f87171', fontSize: 14 }}>{error}</p>
          <button onClick={() => navigate('/login', { replace: true })}
            style={{ padding: '9px 18px', borderRadius: 8, background: '#1EBF5E', color: '#000', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
            Back to sign in
          </button>
        </>
      ) : (
        <>
          <div style={{ width: 28, height: 28, border: '2px solid var(--green)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <p style={{ color: 'var(--t2)', fontSize: 13 }}>Signing you in…</p>
        </>
      )}
    </div>
  );
}
