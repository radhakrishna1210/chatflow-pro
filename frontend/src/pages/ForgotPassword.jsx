import { useState, useRef, useEffect } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { navigate } from '../App.jsx';

// Two-step, OTP-verified password reset — mirrors Register.jsx's signup flow.
// Step 1 emails a 6-digit code; step 2 verifies it and sets the new password.
export default function ForgotPassword() {
  const [step, setStep] = useState('email'); // 'email' | 'reset'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState('idle');
  const [errMsg, setErrMsg] = useState('');
  const [focus, setFocus] = useState('');
  const [resendIn, setResendIn] = useState(0);

  const timerRef = useRef(null);
  useEffect(() => () => clearInterval(timerRef.current), []);

  const startResendTimer = () => {
    setResendIn(60);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setResendIn((s) => { if (s <= 1) { clearInterval(timerRef.current); return 0; } return s - 1; });
    }, 1000);
  };

  const inp = (name) => ({
    width: '100%', padding: '11px 14px', borderRadius: '9px', outline: 'none',
    background: 'rgba(255,255,255,0.035)', fontFamily: "'Plus Jakarta Sans',sans-serif",
    fontSize: '14px', color: 'var(--t1)', transition: 'border .18s',
    border: focus === name ? '1px solid var(--gbd)' : '1px solid var(--bd)',
  });

  const submitEmail = async (e) => {
    e.preventDefault();
    if (!email.trim()) { setErrMsg('Enter your email address.'); setStatus('error'); return; }
    setStatus('loading'); setErrMsg('');
    try {
      const res = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send reset code');
      setStep('reset'); setStatus('idle'); startResendTimer();
    } catch (err) { setErrMsg(err.message); setStatus('error'); }
  };

  const resend = async () => {
    if (resendIn > 0) return;
    setErrMsg('');
    try {
      const res = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not resend');
      startResendTimer();
    } catch (err) { setErrMsg(err.message); setStatus('error'); }
  };

  const submitReset = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) { setErrMsg('Enter the 6-digit code.'); setStatus('error'); return; }
    if (newPassword.length < 8) { setErrMsg('Password must be at least 8 characters.'); setStatus('error'); return; }
    if (newPassword !== confirmPassword) { setErrMsg('Passwords do not match.'); setStatus('error'); return; }
    setStatus('loading'); setErrMsg('');
    try {
      const res = await fetch('/api/v1/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not reset password');
      setStatus('success');
      setTimeout(() => navigate('/login', { replace: true }), 1200);
    } catch (err) { setErrMsg(err.message); setStatus('error'); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '40px' }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <div onClick={() => navigate('/login')} style={{ display: 'flex', alignItems: 'center', gap: '9px', cursor: 'pointer', marginBottom: '28px' }}>
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

        {step === 'email' ? (
          <>
            <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: '26px', color: 'var(--t1)', marginBottom: '6px' }}>Forgot password?</h1>
            <p style={{ fontSize: '14px', color: 'var(--t2)', marginBottom: '28px' }}>
              Enter your account email and we'll send you a reset code.
            </p>
            {errMsg && <div style={{ padding: '10px 13px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 13, marginBottom: 16 }}>{errMsg}</div>}
            <form onSubmit={submitEmail} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--t1)', marginBottom: '7px' }}>Email address</label>
                <input type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)}
                  style={inp('email')} onFocus={() => setFocus('email')} onBlur={() => setFocus('')} required />
              </div>
              <Btn type="submit" disabled={status === 'loading'} style={{ justifyContent: 'center', boxShadow: status === 'loading' ? 'none' : 'var(--glow)' }}>
                {status === 'loading' ? 'Sending code…' : <>Send reset code <I n="arrow" s={14} c="#07090F" /></>}
              </Btn>
            </form>
            <p style={{ fontSize: '14px', color: 'var(--t2)', marginTop: 20, textAlign: 'center' }}>
              <span onClick={() => navigate('/login')} style={{ color: 'var(--green)', fontWeight: 600, cursor: 'pointer' }}>Back to sign in</span>
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: '26px', color: 'var(--t1)', marginBottom: '6px' }}>Reset your password</h1>
            <p style={{ fontSize: '14px', color: 'var(--t2)', marginBottom: '28px' }}>
              We sent a 6-digit code to <strong style={{ color: 'var(--t1)' }}>{email}</strong>.
            </p>

            {status === 'success' ? (
              <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--gbg)', border: '1px solid var(--gbd)', color: 'var(--green)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <I n="check" s={15} c="var(--green)" w={2} /> Password updated — redirecting to sign in…
              </div>
            ) : (
              <>
                {errMsg && <div style={{ padding: '10px 13px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 13, marginBottom: 16 }}>{errMsg}</div>}
                <form onSubmit={submitReset} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <input
                    inputMode="numeric" maxLength={6} placeholder="000000"
                    value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    onFocus={() => setFocus('code')} onBlur={() => setFocus('')}
                    style={{ ...inp('code'), textAlign: 'center', fontSize: '26px', letterSpacing: '10px', fontWeight: 700 }}
                    autoFocus required
                  />
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--t1)', marginBottom: '7px' }}>New password</label>
                    <input type="password" placeholder="At least 8 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                      style={inp('newPassword')} onFocus={() => setFocus('newPassword')} onBlur={() => setFocus('')} required />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--t1)', marginBottom: '7px' }}>Confirm new password</label>
                    <input type="password" placeholder="Re-enter password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                      style={inp('confirmPassword')} onFocus={() => setFocus('confirmPassword')} onBlur={() => setFocus('')} required />
                  </div>
                  <Btn type="submit" disabled={status === 'loading'} style={{ justifyContent: 'center', boxShadow: status === 'loading' ? 'none' : 'var(--glow)' }}>
                    {status === 'loading' ? 'Resetting…' : 'Reset password'}
                  </Btn>
                </form>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, fontSize: 13 }}>
                  <span onClick={() => { setStep('email'); setStatus('idle'); setErrMsg(''); }} style={{ color: 'var(--t2)', cursor: 'pointer' }}>← Change email</span>
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
  );
}
