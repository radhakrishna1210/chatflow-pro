import { useState, useEffect } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const DashHeader = ({ title, subtitle }) => (
  <div style={{ height: '58px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 28px', gap: '16px', flexShrink: 0, background: 'var(--surf)' }}>
    <div style={{ flex: 1 }}>
      <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: '16px', color: 'var(--t1)', letterSpacing: '-.02em' }}>{title}</h1>
      {subtitle && <p style={{ fontSize: '11.5px', color: 'var(--t2)', marginTop: '1px' }}>{subtitle}</p>}
    </div>
  </div>
);

const Toggle = ({ on, onToggle }) => (
  <div onClick={onToggle} style={{
    width: 42, height: 23, borderRadius: 20,
    background: on ? 'var(--green)' : 'rgba(255,255,255,0.1)',
    cursor: 'pointer', transition: 'background .2s', position: 'relative',
    border: `1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`, flexShrink: 0,
  }}>
    <div style={{
      position: 'absolute', top: 2.5, left: on ? 21 : 2.5,
      width: 16, height: 16, borderRadius: '50%', background: 'white',
      transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
    }} />
  </div>
);

const SectionCard = ({ icon, title, children, color = 'var(--green)' }) => (
  <div style={{ ...card, overflow: 'hidden' }}>
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <I n={icon} s={16} c={color} />
      <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>{title}</span>
    </div>
    <div style={{ padding: 20 }}>{children}</div>
  </div>
);

export default function SecurityPage() {
  const [twoFA, setTwoFA] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState(''); // 'saving', 'success', 'error'
  const [passwordError, setPasswordError] = useState('');
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchSecurityData = async () => {
    try {
      const [sessRes, twoFaRes] = await Promise.all([
        wFetch('/security/sessions').then(r => r.ok ? r.json() : []),
        wFetch('/security/2fa').then(r => r.ok ? r.json() : { twoFactorEnabled: false })
      ]);
      setSessions(sessRes);
      setTwoFA(twoFaRes.twoFactorEnabled);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetchSecurityData();
  }, []);

  const handleToggle2FA = async () => {
    const nextVal = !twoFA;
    setTwoFA(nextVal);
    try {
      await wFetch('/security/2fa', {
        method: 'POST',
        body: JSON.stringify({ enabled: nextVal })
      });
    } catch {
      setTwoFA(!nextVal);
    }
  };

  const handleRevokeSession = async (id) => {
    try {
      await wFetch(`/security/sessions/${id}`, { method: 'DELETE' });
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) {
      setPasswordError('Please fill all password fields');
      setPasswordStatus('error');
      return;
    }
    setPasswordStatus('saving');
    setPasswordError('');
    try {
      const res = await wFetch('/security/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to change password');
      }
      setPasswordStatus('success');
      setCurrentPassword('');
      setNewPassword('');
      setTimeout(() => {
        setPasswordStatus('');
        setShowPasswordForm(false);
      }, 2500);
    } catch (err) {
      setPasswordError(err.message || 'Error updating password');
      setPasswordStatus('error');
    }
  };

  const loginHistory = [
    { date: 'Jul 3, 2026 — 1:44 PM', ip: '103.21.XX.XX', location: 'Mumbai', device: 'Chrome / Windows', status: 'Success' },
    { date: 'Jul 2, 2026 — 9:12 AM', ip: '103.21.XX.XX', location: 'Mumbai', device: 'Chrome / Windows', status: 'Success' },
    { date: 'Jul 1, 2026 — 6:30 PM', ip: '49.36.XX.XX', location: 'Pune', device: 'Safari / iPhone', status: 'Success' },
    { date: 'Jun 30, 2026 — 11:00 AM', ip: '182.73.XX.XX', location: 'Unknown', device: 'Firefox / macOS', status: 'Failed' }
  ];

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <DashHeader title="Security" subtitle="Password, authentication & session management" />
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--t2)', fontSize: 13 }}>
          <div style={{ width: 24, height: 24, border: '2px solid var(--green)', borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto 10px', animation: 'spin 1s linear infinite' }} />
          Loading security settings…
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <DashHeader title="Security" subtitle="Password, authentication & session management" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Password */}
          <SectionCard icon="lock" title="Password" color="#EF4444">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <p style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 600, marginBottom: 4 }}>Account Password</p>
                  <p style={{ fontSize: 12, color: 'var(--t2)' }}>Last changed recently. We recommend updating every 90 days.</p>
                </div>
                {!showPasswordForm && (
                  <Btn variant="outline" size="sm" onClick={() => setShowPasswordForm(true)}>
                    <I n="lock" s={12} c="var(--t2)" /> Change Password
                  </Btn>
                )}
              </div>

              {showPasswordForm && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid var(--bd)', paddingTop: 16, animation: 'fadeUp .2s ease-out' }}>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label style={{ fontSize: 12, color: 'var(--t2)', fontWeight: 600 }}>Current Password</label>
                      <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
                        style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)', color: 'var(--t1)', outline: 'none' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label style={{ fontSize: 12, color: 'var(--t2)', fontWeight: 600 }}>New Password</label>
                      <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                        style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)', color: 'var(--t1)', outline: 'none' }} />
                    </div>
                  </div>
                  {passwordStatus === 'error' && <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>⚠️ {passwordError}</p>}
                  {passwordStatus === 'success' && <p style={{ fontSize: 12, color: 'var(--green)', margin: 0 }}>✓ Password updated successfully!</p>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn size="sm" onClick={handleChangePassword} disabled={passwordStatus === 'saving'}>
                      {passwordStatus === 'saving' ? 'Saving...' : 'Save Password'}
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setShowPasswordForm(false)}>Cancel</Btn>
                  </div>
                </div>
              )}
            </div>
          </SectionCard>

          {/* Google Login */}
          <SectionCard icon="globe" title="Google Login" color="#0EA5E9">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                </div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>Google Account Connected</p>
                  <p style={{ fontSize: 12, color: 'var(--t2)' }}>Sign in with your Google account</p>
                </div>
              </div>
              <span style={{
                padding: '4px 12px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                background: 'rgba(30,191,94,0.08)', border: '1px solid rgba(30,191,94,0.2)',
                color: 'var(--green)',
              }}>Connected</span>
            </div>
          </SectionCard>

          {/* 2FA */}
          <SectionCard icon="shield" title="Two-Factor Authentication" color="#A78BFA">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginBottom: 4 }}>
                  {twoFA ? 'Two-factor authentication is enabled' : 'Protect your account with 2FA'}
                </p>
                <p style={{ fontSize: 12, color: 'var(--t2)' }}>
                  Add an extra layer of security using authenticator app or SMS.
                </p>
              </div>
              <Toggle on={twoFA} onToggle={handleToggle2FA} />
            </div>
          </SectionCard>

          {/* Active Sessions */}
          <SectionCard icon="user" title="Active Sessions" color="#F59E0B">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sessions.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--t2)', fontStyle: 'italic' }}>No active sessions found.</div>
              ) : (
                sessions.map((s, i) => (
                  <div key={s.id} style={{
                    display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px',
                    borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)',
                  }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: 'var(--green)',
                      boxShadow: '0 0 8px rgba(30,191,94,0.5)',
                      flexShrink: 0,
                    }} />
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>
                        {s.device} {i === 0 && <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700 }}>· Current</span>}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--t2)' }}>{s.location} · Created {new Date(s.time).toLocaleDateString()}</p>
                    </div>
                    {i > 0 && (
                      <Btn variant="ghost" size="sm" onClick={() => handleRevokeSession(s.id)}>Revoke</Btn>
                    )}
                  </div>
                ))
              )}
            </div>
          </SectionCard>

          {/* Login History */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <I n="clock" s={16} c="#F472B6" />
              <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>Login History</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bd)' }}>
                  {['Date', 'IP Address', 'Location', 'Device', 'Status'].map(h => (
                    <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loginHistory.map((h, i) => (
                  <tr key={i}
                    style={{ borderBottom: i < loginHistory.length - 1 ? '1px solid var(--bd)' : 'none', transition: 'background .12s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.015)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t1)' }}>{h.date}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)', fontFamily: 'monospace' }}>{h.ip}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{h.location}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{h.device}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        padding: '3px 9px', borderRadius: 10, fontSize: 10.5, fontWeight: 600,
                        background: h.status === 'Success' ? 'rgba(30,191,94,0.08)' : 'rgba(239,68,68,0.08)',
                        border: `1px solid ${h.status === 'Success' ? 'rgba(30,191,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                        color: h.status === 'Success' ? 'var(--green)' : '#f87171',
                      }}>{h.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
