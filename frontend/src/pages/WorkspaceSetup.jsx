import { useState } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { apiFetch } from '../lib/api.js';

// Post-signup onboarding for users who don't belong to a workspace yet.
// Creating one here is the only way to become a workspace ADMIN; users who
// were invited by an admin join as members and skip this screen entirely.
export default function WorkspaceSetup({ onNav }) {
  const stored = (() => { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; } })();
  const [name, setName] = useState(stored?.name ? `${stored.name}'s Workspace` : '');
  const [status, setStatus] = useState('idle');
  const [errMsg, setErrMsg] = useState('');
  const [focus, setFocus] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setErrMsg('Please enter a workspace name.'); setStatus('error'); return; }
    setStatus('loading'); setErrMsg('');
    try {
      const res = await apiFetch('/api/v1/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create workspace');
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify({
        id: data.user.id, name: data.user.name, email: data.user.email, role: data.user.role,
        superAdmin: data.user.superAdmin === true, workspaceId: data.workspace.id, workspaceName: data.workspace.name,
      }));
      setStatus('success');
      setTimeout(() => onNav('dashboard'), 500);
    } catch (err) { setErrMsg(err.message); setStatus('error'); }
  };

  const signOut = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    onNav('login');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '40px' }}>
      <div style={{ width: '100%', maxWidth: '420px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '30px' }}>
          <div style={{ width: '34px', height: '34px', borderRadius: '9px', background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1C4.13 1 1 4.13 1 8c0 1.29.35 2.5.96 3.54L1 15l3.46-.96A7 7 0 1 0 8 1z" fill="#07090F" />
              <path d="M5.5 7.5h5M5.5 10h3" stroke="#20C967" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </div>
          <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: '17px', color: 'var(--t1)' }}>
            ChatFlow<span style={{ color: 'var(--green)' }}>Pro</span>
          </span>
        </div>

        <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: '26px', color: 'var(--t1)', marginBottom: '6px' }}>Set up your workspace</h1>
        <p style={{ fontSize: '14px', color: 'var(--t2)', marginBottom: '28px', lineHeight: 1.6 }}>
          Create a workspace to get started — you'll be its admin.
        </p>

        {errMsg && <div style={{ padding: '10px 13px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 13, marginBottom: 16 }}>{errMsg}</div>}

        {status === 'success' ? (
          <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--gbg)', border: '1px solid var(--gbd)', color: 'var(--green)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <I n="check" s={15} c="var(--green)" w={2} /> Workspace created — taking you to the dashboard…
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--t1)', marginBottom: '7px' }}>Workspace name</label>
              <input
                type="text" placeholder="Acme Inc." value={name} onChange={(e) => setName(e.target.value)}
                onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} autoFocus required
                style={{
                  width: '100%', padding: '11px 14px', borderRadius: '9px', outline: 'none',
                  background: 'rgba(255,255,255,0.035)', fontFamily: "'Plus Jakarta Sans',sans-serif",
                  fontSize: '14px', color: 'var(--t1)', transition: 'border .18s',
                  border: focus ? '1px solid var(--gbd)' : '1px solid var(--bd)',
                }}
              />
            </div>
            <Btn type="submit" disabled={status === 'loading'} style={{ justifyContent: 'center', boxShadow: status === 'loading' ? 'none' : 'var(--glow)' }}>
              {status === 'loading' ? 'Creating…' : <>Create workspace <I n="arrow" s={14} c="#07090F" /></>}
            </Btn>
          </form>
        )}

        <p style={{ fontSize: '13px', color: 'var(--t3)', marginTop: 24, lineHeight: 1.6 }}>
          Joining a team instead? Ask your workspace admin to invite <strong style={{ color: 'var(--t2)' }}>{stored?.email || 'your email'}</strong>, then{' '}
          <span onClick={signOut} style={{ color: 'var(--green)', fontWeight: 600, cursor: 'pointer' }}>sign in again</span>.
        </p>
      </div>
    </div>
  );
}
