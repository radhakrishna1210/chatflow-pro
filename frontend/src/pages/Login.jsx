import { useState } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { navigate } from '../App.jsx';

const OAUTH_ERROR_MESSAGES = {
  denied: 'Google sign-in was cancelled.',
  invalid_state: 'Sign-in session expired — please try again.',
  session_store_failed: 'Could not complete sign-in. Please try again.',
};

export default function Login({ onNav, mode = 'login' }) {
  const isRegister = mode === 'register';
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const initialOauthError = (() => {
    const err = new URLSearchParams(window.location.search).get('oauth_error');
    return err ? (OAUTH_ERROR_MESSAGES[err] || `Google sign-in failed (${err}).`) : '';
  })();
  const [showPass, setShowPass] = useState(false);
  const [status, setStatus] = useState(initialOauthError ? 'error' : 'idle');
  const [errMsg, setErrMsg] = useState(initialOauthError);
  const [focusName, setFocusName] = useState(false);
  const [focusEmail, setFocusEmail] = useState(false);
  const [focusPass, setFocusPass] = useState(false);
  const [inviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite') || null);

  const change = e => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async e => {
    e.preventDefault();
    if (!form.email || !form.password || (isRegister && !form.name)) { setErrMsg('Please fill in all fields.'); setStatus('error'); return; }
    if (isRegister && form.password.length < 8) { setErrMsg('Password must be at least 8 characters.'); setStatus('error'); return; }
    setStatus('loading');
    try {
      const endpoint = isRegister ? '/api/v1/auth/register' : '/api/v1/auth/login';
      const payload = isRegister ? form : { email: form.email, password: form.password };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || (isRegister ? 'Registration failed' : 'Login failed'));
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify({
        id:             data.user.id,
        name:           data.user.name,
        email:          data.user.email,
        role:           data.user.role,
        superAdmin:     data.user.superAdmin === true,
        workspaceId:    data.workspace?.id ?? null,
        workspaceName:  data.workspace?.name ?? null,
      }));
      setStatus('success');
      if (inviteToken) {
        // Let the accept-invite page perform the actual accept call now
        // that a session exists (it also handles an email mismatch).
        setTimeout(() => navigate(`/invite/accept?token=${encodeURIComponent(inviteToken)}`, { replace: true }), 700);
      } else {
        // Users without a workspace go to setup to create or join one.
        setTimeout(() => onNav(data.workspace ? 'dashboard' : 'setup'), 700);
      }
    } catch (err) {
      setErrMsg(err.message);
      setStatus('error');
    }
  };

  const inp = (focused) => ({
    width: '100%', padding: '11px 14px', borderRadius: '9px', outline: 'none',
    background: 'rgba(255,255,255,0.035)', fontFamily: "'Plus Jakarta Sans',sans-serif",
    fontSize: '14px', color: 'var(--t1)', transition: 'border .18s',
    border: focused ? '1px solid var(--gbd)' : '1px solid var(--bd)',
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--bg)' }}>
      <style>{`
        @media (max-width: 860px) {
          .auth-brand-panel { display: none !important; }
          .auth-form-panel { padding: 28px 20px !important; }
        }
      `}</style>
      {/* Left panel */}
      <div className="auth-brand-panel" style={{ width: '44%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '44px 52px', position: 'relative', overflow: 'hidden', background: 'linear-gradient(160deg,#07090F 0%,#0a0f1e 60%,#07090F 100%)', borderRight: '1px solid var(--bd)' }}>
        <div style={{ position: 'absolute', top: '-80px', left: '-80px', width: '380px', height: '380px', background: 'radial-gradient(circle,rgba(32,201,103,0.07) 0%,transparent 65%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '-60px', right: '-40px', width: '320px', height: '320px', background: 'radial-gradient(circle,rgba(14,165,233,0.05) 0%,transparent 65%)', pointerEvents: 'none' }} />

        <div onClick={() => onNav('landing')} style={{ display: 'flex', alignItems: 'center', gap: '9px', cursor: 'pointer', position: 'relative', zIndex: 1 }}>
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

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '5px 12px', borderRadius: '100px', background: 'var(--gbg)', border: '1px solid var(--gbd)', marginBottom: '22px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--green)', animation: 'pulse 2s ease infinite' }} />
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--green)', letterSpacing: '.03em' }}>Meta Verified Business Partner</span>
          </div>
          <h2 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: '36px', color: 'var(--t1)', marginBottom: '14px', lineHeight: 1.1 }}>Welcome back</h2>
          <p style={{ fontSize: '15px', color: 'var(--t2)', lineHeight: 1.65, marginBottom: '36px', maxWidth: '340px' }}>
            Sign in to manage your WhatsApp campaigns, monitor conversations, and grow your audience.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {[
              { icon: 'send', label: 'Launch campaigns in minutes', color: 'var(--green)' },
              { icon: 'bot', label: 'AI-powered smart replies', color: '#0EA5E9' },
              { icon: 'chart', label: 'Real-time delivery analytics', color: '#A78BFA' },
              { icon: 'zap', label: 'Automate with visual flow builder', color: '#F59E0B' },
            ].map(f => (
              <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <I n={f.icon} s={15} c={f.color} />
                </div>
                <span style={{ fontSize: '13px', color: 'var(--t2)' }}>{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative', zIndex: 1, borderTop: '1px solid var(--bd)', paddingTop: '24px' }}>
          <p style={{ fontSize: '11px', color: 'var(--t3)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Trusted by 2,000+ businesses</p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {['Shopify', 'WooCommerce', 'Razorpay', 'HubSpot', 'Zapier'].map(b => (
              <span key={b} style={{ fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '6px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t3)' }}>{b}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="auth-form-panel" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 28px' }}>
        <div style={{ width: '100%', maxWidth: '400px' }}>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: '26px', color: 'var(--t1)', marginBottom: '6px' }}>
            {isRegister ? 'Create your account' : 'Sign in to your account'}
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--t2)', marginBottom: '32px' }}>
            {isRegister ? 'Already have an account? ' : "Don't have an account? "}
            <span onClick={() => onNav(isRegister ? 'login' : 'register')} style={{ color: 'var(--green)', fontWeight: 600, cursor: 'pointer' }}>
              {isRegister ? 'Sign in' : 'Create one free'}
            </span>
          </p>

          <button
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '11px 16px', borderRadius: '9px', background: 'rgba(255,255,255,0.035)', border: '1px solid var(--bd)', color: 'var(--t1)', fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: '14px', fontWeight: 600, cursor: 'pointer', transition: 'background .18s, border .18s', marginBottom: '22px' }}
            onMouseOver={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'var(--bdm)'; }}
            onMouseOut={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.035)'; e.currentTarget.style.borderColor = 'var(--bd)'; }}
            onClick={() => window.location.href = inviteToken ? `/api/v1/auth/google?invite=${encodeURIComponent(inviteToken)}` : '/api/v1/auth/google'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '22px' }}>
            <div style={{ flex: 1, height: '1px', background: 'var(--bd)' }} />
            <span style={{ fontSize: '12px', color: 'var(--t3)', fontWeight: 500 }}>{isRegister ? 'or sign up with email' : 'or sign in with email'}</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--bd)' }} />
          </div>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {errMsg && status === 'error' && (
              <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: '13px', color: '#f87171' }}>
                {errMsg}
              </div>
            )}
            {status === 'success' && (
              <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'var(--gbg)', border: '1px solid var(--gbd)', fontSize: '13px', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <I n="check" s={14} c="var(--green)" w={2} /> {isRegister ? 'Account created — redirecting…' : 'Login successful — redirecting…'}
              </div>
            )}

            {isRegister && (
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--t1)', marginBottom: '7px' }}>Full name</label>
                <input type="text" name="name" placeholder="Jane Doe" value={form.name} onChange={change}
                  style={inp(focusName)} onFocus={() => setFocusName(true)} onBlur={() => setFocusName(false)} required />
              </div>
            )}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--t1)', marginBottom: '7px' }}>Email address</label>
              <input type="email" name="email" placeholder="you@company.com" value={form.email} onChange={change}
                style={inp(focusEmail)} onFocus={() => setFocusEmail(true)} onBlur={() => setFocusEmail(false)} required />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '7px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--t1)' }}>Password</label>
                <a href="#" style={{ fontSize: '12px', color: 'var(--green)', textDecoration: 'none', fontWeight: 500 }}>Forgot password?</a>
              </div>
              <div style={{ position: 'relative' }}>
                <input type={showPass ? 'text' : 'password'} name="password" placeholder="Enter your password" value={form.password} onChange={change}
                  style={{ ...inp(focusPass), paddingRight: '44px' }}
                  onFocus={() => setFocusPass(true)} onBlur={() => setFocusPass(false)} required />
                <button type="button" onClick={() => setShowPass(!showPass)}
                  style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)', display: 'flex', padding: '4px' }}>
                  <I n={showPass ? 'eyeoff' : 'eye'} s={15} c="var(--t2)" />
                </button>
              </div>
            </div>

            <button type="submit" disabled={status === 'loading' || status === 'success'}
              style={{ width: '100%', padding: '13px', borderRadius: '9px', border: 'none', cursor: 'pointer', fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: '14px', fontWeight: 700, color: status === 'success' ? 'var(--t1)' : '#07090F', background: status === 'success' ? 'var(--gbg)' : 'var(--green)', boxShadow: status === 'success' ? 'none' : 'var(--glow)', transition: 'all .18s', opacity: status === 'loading' ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              {(status === 'idle' || status === 'error') && <><I n="arrow" s={14} c="#07090F" /> {isRegister ? 'Create Account' : 'Sign In'}</>}
              {status === 'loading' && <><svg width="14" height="14" viewBox="0 0 14 14" style={{ animation: 'spin 1s linear infinite' }}><circle cx="7" cy="7" r="5" fill="none" stroke="#07090F" strokeWidth="2" strokeDasharray="20" strokeDashoffset="5" /></svg> {isRegister ? 'Creating account…' : 'Signing in…'}</>}
              {status === 'success' && <><I n="check" s={14} c="var(--green)" w={2} /> <span style={{ color: 'var(--green)' }}>Done!</span></>}
            </button>
          </form>

          <p style={{ marginTop: '24px', fontSize: '12px', color: 'var(--t3)', textAlign: 'center' }}>
            By signing in you agree to our{' '}
            <a href="#" style={{ color: 'var(--t2)', textDecoration: 'none' }}>Terms of Service</a> and{' '}
            <a href="#" style={{ color: 'var(--t2)', textDecoration: 'none' }}>Privacy Policy</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
