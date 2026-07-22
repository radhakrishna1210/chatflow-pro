import { useState, useEffect, useRef } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { validateMeaningfulText } from '../lib/validation.js';

// Two-step, OTP-verified email signup. Step 1 collects name/email/password and
// asks the backend to email a 6-digit code (no account is created yet). Step 2
// verifies the code; only then does the backend create the User and return a
// session. The user then creates a workspace (becoming its admin) or waits to
// be invited to one.
export default function Register({ onNav }) {
  const [step, setStep] = useState('details'); // 'details' | 'otp'
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('idle');
  const [errMsg, setErrMsg] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [focus, setFocus] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [inviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite') || null);
  const [inviteInfo, setInviteInfo] = useState(null);
  const [inviteWarning, setInviteWarning] = useState('');

  const timerRef = useRef(null);
  useEffect(() => () => clearInterval(timerRef.current), []);

  const INVITE_STATUS_MESSAGES = {
    EXPIRED: 'This invite link has expired — you can still create an account, but you\'ll need a new invite to join that workspace.',
    ACCEPTED: 'This invite has already been used — you can still create an account, but you\'ll need a new invite to join that workspace.',
    REVOKED: 'This invite has been revoked — you can still create an account, but you\'ll need a new invite to join that workspace.',
  };

  // Signing up via an invite link: prefill + lock the email to the invited
  // address so the account created here actually matches the invite. If the
  // link is no longer valid, say so up front instead of silently falling
  // back to a plain signup with no explanation for why no workspace shows up.
  useEffect(() => {
    if (!inviteToken) return;
    fetch(`/api/v1/invitations/${encodeURIComponent(inviteToken)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) { setInviteWarning('This invite link could not be found — you can still create an account.'); return; }
        if (data.status === 'PENDING') {
          setInviteInfo(data);
          setForm((f) => ({ ...f, email: data.email }));
        } else {
          setInviteWarning(INVITE_STATUS_MESSAGES[data.status] || 'This invite link is no longer valid.');
        }
      })
      .catch(() => { setInviteWarning('Could not verify this invite link — you can still create an account.'); });
  }, [inviteToken]);

  const startResendTimer = () => {
    setResendIn(60);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setResendIn((s) => { if (s <= 1) { clearInterval(timerRef.current); return 0; } return s - 1; });
    }, 1000);
  };

  const change = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const inp = (name) => ({
    width: '100%', padding: '11px 14px', borderRadius: '9px', outline: 'none',
    background: 'rgba(255,255,255,0.035)', fontFamily: "'Plus Jakarta Sans',sans-serif",
    fontSize: '14px', color: 'var(--t1)', transition: 'border .18s',
    border: focus === name ? '1px solid var(--gbd)' : '1px solid var(--bd)',
  });

  const submitDetails = async (e) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.password || !form.confirmPassword) { setErrMsg('Please fill in all fields.'); setStatus('error'); return; }
    const nameError = validateMeaningfulText(form.name, 'Full name');
    if (nameError) { setErrMsg(nameError); setStatus('error'); return; }
    if (form.password.length < 8) { setErrMsg('Password must be at least 8 characters.'); setStatus('error'); return; }
    if (form.password !== form.confirmPassword) { setErrMsg('Passwords do not match.'); setStatus('error'); return; }
    setStatus('loading'); setErrMsg('');
    try {
      const { confirmPassword, ...payload } = form;
      const res = await fetch('/api/v1/auth/register/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start signup');
      setStep('otp'); setStatus('idle'); startResendTimer();
    } catch (err) { setErrMsg(err.message); setStatus('error'); }
  };

  const submitOtp = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) { setErrMsg('Enter the 6-digit code.'); setStatus('error'); return; }
    setStatus('loading'); setErrMsg('');
    try {
      const res = await fetch('/api/v1/auth/register/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, code, ...(inviteToken ? { inviteToken } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify({
        id: data.user.id, name: data.user.name, email: data.user.email, role: data.user.role,
        superAdmin: data.user.superAdmin === true, workspaceId: data.workspace?.id ?? null, workspaceName: data.workspace?.name ?? null,
      }));
      setStatus('success');
      // Fresh accounts have no workspace yet — they create one (becoming its
      // admin) or get invited to an existing one.
      setTimeout(() => onNav(data.workspace ? 'dashboard' : 'setup'), 700);
    } catch (err) { setErrMsg(err.message); setStatus('error'); }
  };

  const resend = async () => {
    if (resendIn > 0) return;
    setErrMsg('');
    try {
      const res = await fetch('/api/v1/auth/register/resend', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not resend');
      startResendTimer();
    } catch (err) { setErrMsg(err.message); setStatus('error'); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--bg)' }}>
      <style>{`
        @media (max-width: 860px) {
          .auth-brand-panel { display: none !important; }
          .auth-form-panel { padding: 28px 20px !important; }
        }
      `}</style>
      {/* Left brand panel */}
      <div className="auth-brand-panel" style={{ width: '44%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '44px 52px', position: 'relative', overflow: 'hidden', background: 'linear-gradient(160deg,#07090F 0%,#0a0f1e 60%,#07090F 100%)', borderRight: '1px solid var(--bd)' }}>
        <div style={{ position: 'absolute', top: '-80px', left: '-80px', width: '380px', height: '380px', background: 'radial-gradient(circle,rgba(32,201,103,0.07) 0%,transparent 65%)', pointerEvents: 'none' }} />
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
          <h2 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: '30px', color: 'var(--t1)', lineHeight: 1.2, marginBottom: '14px' }}>
            Start automating<br />WhatsApp in minutes.
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--t2)', lineHeight: 1.6, maxWidth: '340px' }}>
            Create your free account, connect a number, and launch your first campaign today.
          </p>
        </div>
        <div style={{ position: 'relative', zIndex: 1, fontSize: '12px', color: 'var(--t3)' }}>© {new Date().getFullYear()} ChatFlow Pro</div>
      </div>

      {/* Right form panel */}
      <div className="auth-form-panel" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
        <div style={{ width: '100%', maxWidth: '380px' }}>
          {step === 'details' ? (
            <>
              <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: '26px', color: 'var(--t1)', marginBottom: '6px' }}>Create your account</h1>
              <p style={{ fontSize: '14px', color: 'var(--t2)', marginBottom: '28px' }}>
                Already have an account?{' '}
                <span onClick={() => onNav('login')} style={{ color: 'var(--green)', fontWeight: 600, cursor: 'pointer' }}>Sign in</span>
              </p>

              {inviteInfo && (
                <div style={{ padding: '10px 13px', borderRadius: 8, background: 'var(--gbg)', border: '1px solid var(--gbd)', color: 'var(--green)', fontSize: 13, marginBottom: 16 }}>
                  You're joining <strong>{inviteInfo.workspaceName}</strong> as {inviteInfo.role === 'ADMIN' ? 'an Admin' : 'a Member'}.
                </div>
              )}
              {inviteWarning && (
                <div style={{ padding: '10px 13px', borderRadius: 8, background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.25)', color: '#fbbf24', fontSize: 13, marginBottom: 16 }}>
                  {inviteWarning}
                </div>
              )}
              {errMsg && <div style={{ padding: '10px 13px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 13, marginBottom: 16 }}>{errMsg}</div>}

              <form onSubmit={submitDetails} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--t1)', marginBottom: '7px' }}>Full name</label>
                  <input type="text" name="name" placeholder="Jane Doe" value={form.name} onChange={change} style={inp('name')} onFocus={() => setFocus('name')} onBlur={() => setFocus('')} required />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--t1)', marginBottom: '7px' }}>Email address</label>
                  <input type="email" name="email" placeholder="you@company.com" value={form.email} onChange={change} style={{ ...inp('email'), ...(inviteInfo ? { opacity: 0.6, cursor: 'not-allowed' } : {}) }} onFocus={() => setFocus('email')} onBlur={() => setFocus('')} readOnly={!!inviteInfo} required />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--t1)', marginBottom: '7px' }}>Password</label>
                  <div style={{ position: 'relative' }}>
                    <input type={showPass ? 'text' : 'password'} name="password" placeholder="At least 8 characters" value={form.password} onChange={change} style={inp('password')} onFocus={() => setFocus('password')} onBlur={() => setFocus('')} required />
                    <span onClick={() => setShowPass(!showPass)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer' }}>
                      <I n="eye" s={15} c="var(--t3)" />
                    </span>
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--t1)', marginBottom: '7px' }}>Confirm password</label>
                  <input type={showPass ? 'text' : 'password'} name="confirmPassword" placeholder="Re-enter your password" value={form.confirmPassword} onChange={change} style={inp('confirmPassword')} onFocus={() => setFocus('confirmPassword')} onBlur={() => setFocus('')} required />
                </div>
                <Btn type="submit" disabled={status === 'loading'} style={{ justifyContent: 'center', boxShadow: status === 'loading' ? 'none' : 'var(--glow)' }}>
                  {status === 'loading' ? 'Sending code…' : <>Continue <I n="arrow" s={14} c="#07090F" /></>}
                </Btn>
              </form>
            </>
          ) : (
            <>
              <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: '26px', color: 'var(--t1)', marginBottom: '6px' }}>Check your email</h1>
              <p style={{ fontSize: '14px', color: 'var(--t2)', marginBottom: '28px' }}>
                We sent a 6-digit code to <strong style={{ color: 'var(--t1)' }}>{form.email}</strong>.
              </p>

              {status === 'success' ? (
                <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--gbg)', border: '1px solid var(--gbd)', color: 'var(--green)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <I n="check" s={15} c="var(--green)" w={2} /> Verified — setting up your account…
                </div>
              ) : (
                <>
                  {errMsg && <div style={{ padding: '10px 13px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 13, marginBottom: 16 }}>{errMsg}</div>}
                  <form onSubmit={submitOtp} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <input
                      inputMode="numeric" maxLength={6} placeholder="000000"
                      value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      onFocus={() => setFocus('code')} onBlur={() => setFocus('')}
                      style={{ ...inp('code'), textAlign: 'center', fontSize: '26px', letterSpacing: '10px', fontWeight: 700 }}
                      autoFocus required
                    />
                    <Btn type="submit" disabled={status === 'loading'} style={{ justifyContent: 'center', boxShadow: status === 'loading' ? 'none' : 'var(--glow)' }}>
                      {status === 'loading' ? 'Verifying…' : 'Verify & create account'}
                    </Btn>
                  </form>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, fontSize: 13 }}>
                    <span onClick={() => { setStep('details'); setStatus('idle'); setErrMsg(''); }} style={{ color: 'var(--t2)', cursor: 'pointer' }}>← Change details</span>
                    <span onClick={resend} style={{ color: resendIn > 0 ? 'var(--t3)' : 'var(--green)', cursor: resendIn > 0 ? 'default' : 'pointer', fontWeight: 600 }}>
                      {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                    </span>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
