import { useState, useEffect, useRef } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { apiFetch } from '../lib/api.js';
import QuickLinksGrid from '../components/QuickLinksGrid.jsx';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const TIMEZONES = [
  'UTC', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo',
  'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Moscow',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo',
  'Africa/Johannesburg', 'Africa/Lagos', 'Australia/Sydney', 'Pacific/Auckland',
];
const ALL_TIMEZONES = (() => {
  try {
    const supported = Intl.supportedValuesOf('timeZone');
    return Array.isArray(supported) && supported.length ? supported : TIMEZONES;
  } catch { return TIMEZONES; }
})();

const LANGUAGES = [
  ['en', 'English'], ['hi', 'Hindi'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'],
  ['pt', 'Portuguese'], ['ar', 'Arabic'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ru', 'Russian'],
  ['it', 'Italian'], ['id', 'Indonesian'], ['bn', 'Bengali'], ['mr', 'Marathi'], ['ta', 'Tamil'],
];

const PHONE_RE = /^[0-9+\-\s()]{6,20}$/;
const NAME_MAX = 100;

// Returns a { field: message } map — empty object means the form is valid.
function validateProfileForm(form) {
  const errors = {};
  const first = form.firstName.trim();
  const last = form.lastName.trim();
  const phone = form.phone.trim();
  const jobTitle = form.jobTitle.trim();
  const company = form.company.trim();

  if (!first) errors.firstName = 'First name is required';
  else if (first.length > NAME_MAX) errors.firstName = `First name must be ${NAME_MAX} characters or fewer`;

  if (last.length > NAME_MAX) errors.lastName = `Last name must be ${NAME_MAX} characters or fewer`;

  if (phone && !PHONE_RE.test(phone)) errors.phone = 'Enter a valid phone number (digits, spaces, +, -, ( ) only)';

  if (jobTitle.length > NAME_MAX) errors.jobTitle = `Job title must be ${NAME_MAX} characters or fewer`;
  if (company.length > NAME_MAX) errors.company = `Company must be ${NAME_MAX} characters or fewer`;

  return errors;
}

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const Avatar = ({ name = '?', size = 34, showRing = false }) => {
  const init = name.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';
  const colors = ['#1EBF5E', '#0EA5E9', '#A78BFA', '#F59E0B', '#F472B6'];
  const col = colors[init.charCodeAt(0) % colors.length];
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: `${col}18`, border: `1.5px solid ${showRing ? col : col + '44'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * .36 + 'px', fontWeight: 700, color: col, flexShrink: 0 }}>
      {init}
    </div>
  );
};

const Badge = ({ label, tone = 'green' }) => {
  const tones = {
    green:  { bg: 'var(--gbg)', bd: 'var(--gbd)', c: 'var(--green)' },
    purple: { bg: 'rgba(167,139,250,.1)', bd: 'rgba(167,139,250,.25)', c: '#c4b5fd' },
    red:    { bg: 'rgba(239,68,68,.08)', bd: 'rgba(239,68,68,.22)', c: '#f87171' },
    gray:   { bg: 'rgba(255,255,255,0.04)', bd: 'var(--bd)', c: 'var(--t2)' },
  };
  const v = tones[tone] || tones.gray;
  return (
    <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 700, background: v.bg, border: `1px solid ${v.bd}`, color: v.c, display: 'inline-block' }}>
      {label}
    </span>
  );
};

const SectionCard = ({ icon, title, action, children }) => (
  <div style={{ ...card, overflow: 'hidden' }}>
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <I n={icon} s={16} c="var(--green)" />
      <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)', flex: 1 }}>{title}</span>
      {action}
    </div>
    <div style={{ padding: 20 }}>{children}</div>
  </div>
);

const Field = ({ label, error, children }) => (
  <div>
    <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--t2)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</label>
    {children}
    {error && <p style={{ fontSize: 11, color: '#f87171', marginTop: 5 }}>{error}</p>}
  </div>
);

const FInput = ({ value, onChange, placeholder, disabled = false, type = 'text', error = false, style: ex = {} }) => (
  <input type={type} value={value ?? ''} onChange={onChange} placeholder={placeholder} disabled={disabled}
    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: `1px solid ${error ? '#f87171' : 'var(--bd)'}`, color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif", outline: 'none', boxSizing: 'border-box', opacity: disabled ? 0.6 : 1, cursor: disabled ? 'not-allowed' : 'text', ...ex }}
    onFocus={e => e.target.style.borderColor = error ? '#f87171' : 'var(--gbd)'}
    onBlur={e => e.target.style.borderColor = error ? '#f87171' : 'var(--bd)'} />
);

const FSelect = ({ value, onChange, children, disabled = false }) => (
  <select value={value ?? ''} onChange={onChange} disabled={disabled}
    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif", outline: 'none', boxSizing: 'border-box', colorScheme: 'dark', opacity: disabled ? 0.6 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
    {children}
  </select>
);

const StaticField = ({ label, value }) => (
  <div>
    <p style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{label}</p>
    <p style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={typeof value === 'string' ? value : undefined}>{value ?? '—'}</p>
  </div>
);

// ─── Skeleton ─────────────────────────────────────────────────────────────
const Skel = ({ w = '100%', h = 14, r = 6, style: ex = {} }) => (
  <div style={{ width: w, height: h, borderRadius: r, background: 'rgba(255,255,255,0.06)', animation: 'pulse 1.5s ease-in-out infinite', ...ex }} />
);

const ProfileSkeleton = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
    <div style={{ ...card, padding: 24, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
      <Skel w={76} h={76} r={38} />
      <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Skel w="35%" h={18} />
        <Skel w="25%" h={12} />
        <Skel w="45%" h={12} />
      </div>
    </div>
    <div className="cf-profile-grid">
      <SectionCard icon="user" title="Personal Information">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {Array.from({ length: 8 }).map((_, i) => <Skel key={i} h={36} />)}
        </div>
      </SectionCard>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <SectionCard icon="shield" title="Security Summary"><Skel h={90} /></SectionCard>
        <SectionCard icon="idcard" title="Account Information"><Skel h={90} /></SectionCard>
      </div>
    </div>
  </div>
);

// ─── Toasts ───────────────────────────────────────────────────────────────
let toastSeq = 0;
const ToastStack = ({ toasts }) => (
  <div style={{ position: 'fixed', bottom: 22, right: 22, display: 'flex', flexDirection: 'column', gap: 10, zIndex: 400 }}>
    {toasts.map(t => (
      <div key={t.id} style={{
        minWidth: 260, maxWidth: 360, padding: '12px 16px', borderRadius: 10,
        background: t.type === 'error' ? 'rgba(30,10,10,0.96)' : 'rgba(8,20,14,0.96)',
        border: `1px solid ${t.type === 'error' ? 'rgba(239,68,68,.35)' : 'var(--gbd)'}`,
        boxShadow: '0 16px 40px rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', gap: 10,
        animation: 'cfToastIn .18s ease-out', fontSize: 13, color: 'var(--t1)',
      }}>
        <I n={t.type === 'error' ? 'alertc' : 'checkc'} s={15} c={t.type === 'error' ? '#f87171' : 'var(--green)'} />
        <span style={{ flex: 1 }}>{t.text}</span>
      </div>
    ))}
  </div>
);

// ─── Change Password modal ──────────────────────────────────────────────────
const ChangePasswordModal = ({ onClose, onSuccess }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onEsc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const submit = async () => {
    setErr(null);
    if (!current) return setErr('Enter your current password');
    if (next.length < 8) return setErr('New password must be at least 8 characters');
    if (next.length > 128) return setErr('New password must be 128 characters or fewer');
    if (!/[a-zA-Z]/.test(next) || !/[0-9]/.test(next)) return setErr('New password must include at least one letter and one number');
    if (next === current) return setErr('New password must be different from your current password');
    if (next !== confirm) return setErr('New password and confirmation do not match');
    setSaving(true);
    try {
      const res = await apiFetch('/api/v1/users/me/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || 'Could not change password'); return; }
      onSuccess();
    } catch (e) {
      setErr(e.message || 'Could not change password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(3,5,12,0.78)', backdropFilter: 'blur(4px)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>Change Password</p>
          <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <I n="x" s={11} c="var(--t2)" />
          </button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Current Password"><FInput type="password" value={current} onChange={e => setCurrent(e.target.value)} placeholder="••••••••" /></Field>
          <Field label="New Password"><FInput type="password" value={next} onChange={e => setNext(e.target.value)} placeholder="At least 8 characters" /></Field>
          <Field label="Confirm New Password"><FInput type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Re-enter new password" /></Field>
          {err && <p style={{ fontSize: 12, color: '#f87171' }}>{err}</p>}
        </div>
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--bd)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Btn>
          <Btn size="sm" onClick={submit} disabled={saving}>{saving ? 'Updating…' : 'Update Password'}</Btn>
        </div>
      </div>
    </div>
  );
};

// ─── Manage Sessions modal ──────────────────────────────────────────────────
const ManageSessionsModal = ({ onClose, onChanged }) => {
  const [sessions, setSessions] = useState(null);
  const [err, setErr] = useState(null);
  const [revoking, setRevoking] = useState(false);

  const load = async () => {
    try {
      const currentToken = localStorage.getItem('refreshToken') || '';
      const res = await apiFetch(`/api/v1/users/me/sessions?currentToken=${encodeURIComponent(currentToken)}`);
      const data = await res.json().catch(() => []);
      if (!res.ok) { setErr(data.error || 'Could not load sessions'); return; }
      setSessions(Array.isArray(data) ? data : []);
    } catch (e) { setErr(e.message); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  useEffect(() => {
    const onEsc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const revokeOthers = async () => {
    setRevoking(true);
    try {
      const keepToken = localStorage.getItem('refreshToken') || '';
      const res = await apiFetch('/api/v1/users/me/sessions/revoke-others', {
        method: 'POST',
        body: JSON.stringify({ keepToken }),
      });
      if (!res.ok) { const data = await res.json().catch(() => ({})); setErr(data.error || 'Could not sign out other sessions'); return; }
      await load();
      onChanged?.();
    } catch (e) { setErr(e.message); }
    finally { setRevoking(false); }
  };

  const others = (sessions || []).filter(s => !s.isCurrent).length;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(3,5,12,0.78)', backdropFilter: 'blur(4px)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>Active Sessions</p>
          <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <I n="x" s={11} c="var(--t2)" />
          </button>
        </div>
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {err && <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 12, marginBottom: 12 }}>{err}</div>}
          {!sessions ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--t2)', fontSize: 13 }}>Loading sessions…</div>
          ) : sessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--t2)', fontSize: 13 }}>No active sessions.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sessions.map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', borderRadius: 9, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--bd)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <I n="monitor" s={15} c="var(--t2)" />
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t1)' }}>Signed in {fmtDateTime(s.createdAt)}</p>
                      <p style={{ fontSize: 11, color: 'var(--t3)' }}>Expires {fmtDate(s.expiresAt)}</p>
                    </div>
                  </div>
                  {s.isCurrent && <Badge label="This session" tone="green" />}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--bd)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Btn variant="ghost" size="sm" onClick={onClose}>Close</Btn>
          <Btn size="sm" variant="outline" onClick={revokeOthers} disabled={revoking || others === 0}
            style={{ borderColor: 'rgba(239,68,68,.35)', color: '#f87171' }}>
            {revoking ? 'Signing out…' : `Sign out of ${others || 'other'} other session${others === 1 ? '' : 's'}`}
          </Btn>
        </div>
      </div>
    </div>
  );
};

// ─── Main page ──────────────────────────────────────────────────────────────
export default function ProfileView() {
  const localUser = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
  const isAdmin = localUser?.role === 'ADMIN';
  const isSuperAdmin = localUser?.superAdmin === true;

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showSessionsModal, setShowSessionsModal] = useState(false);
  const [toasts, setToasts] = useState([]);

  const personalCardRef = useRef(null);

  const pushToast = (type, text) => {
    const id = ++toastSeq;
    setToasts(t => [...t, { id, type, text }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  };

  const load = async () => {
    setLoadError(null);
    try {
      const res = await apiFetch('/api/v1/users/me');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setLoadError(data.error || 'Could not load profile'); return; }
      setProfile(data);
    } catch (e) {
      setLoadError(e.message || 'Could not load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const startEdit = () => {
    const [firstName, ...rest] = (profile?.name || '').split(' ');
    setForm({
      firstName: firstName || '',
      lastName: rest.join(' '),
      phone: profile?.phone || '',
      jobTitle: profile?.jobTitle || '',
      company: profile?.company || '',
      timezone: profile?.timezone || '',
      language: profile?.language || '',
    });
    setSaveError(null);
    setFieldErrors({});
    setEditing(true);
    setTimeout(() => personalCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };

  const cancelEdit = () => { setEditing(false); setForm(null); setSaveError(null); setFieldErrors({}); };

  const updateField = (key, value) => {
    setForm(f => ({ ...f, [key]: value }));
    setFieldErrors(e => (e[key] ? { ...e, [key]: undefined } : e));
  };

  const save = async () => {
    const errors = validateProfileForm(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) { setSaveError('Please fix the highlighted fields'); return; }
    setSaving(true);
    setSaveError(null);
    const name = `${form.firstName.trim()} ${form.lastName.trim()}`.trim();
    try {
      const res = await apiFetch('/api/v1/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name, phone: form.phone.trim(), jobTitle: form.jobTitle.trim(),
          company: form.company.trim(), timezone: form.timezone, language: form.language,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const firstDetail = data.details && Object.values(data.details).flat().find(Boolean);
        setSaveError(firstDetail || data.error || 'Could not update profile');
        return;
      }
      setProfile(p => ({ ...p, ...data }));
      try {
        const u = JSON.parse(localStorage.getItem('user') || '{}');
        localStorage.setItem('user', JSON.stringify({ ...u, name: data.name }));
      } catch { /* ignore */ }
      setEditing(false);
      setForm(null);
      pushToast('success', 'Profile updated successfully');
    } catch (e) {
      setSaveError(e.message || 'Could not update profile');
    } finally {
      setSaving(false);
    }
  };

  const roleLabel = isSuperAdmin ? 'Super Admin' : isAdmin ? 'Admin' : 'Member';
  const roleTone = (isAdmin || isSuperAdmin) ? 'green' : 'purple';
  const statusLabel = profile?.workspaceSuspended ? 'Inactive' : 'Active';
  const statusTone = profile?.workspaceSuspended ? 'red' : 'green';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <style>{`
        @keyframes cfToastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .cf-profile-grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: 18px; align-items: start; }
        @media (max-width: 1080px) {
          .cf-profile-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 640px) {
          .cf-profile-header { flex-direction: column; align-items: flex-start !important; text-align: left; }
          .cf-profile-header-actions { width: 100%; }
          .cf-profile-header-actions button { flex: 1; }
          .cf-personal-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div style={{ height: 58, borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 28px', flexShrink: 0, background: 'var(--surf)' }}>
        <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 16, color: 'var(--t1)', letterSpacing: '-.02em' }}>Profile</h1>
        <p style={{ fontSize: 11.5, color: 'var(--t2)', marginLeft: 10 }}>Your personal account</p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', maxWidth: 1080, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {loading && <ProfileSkeleton />}

        {!loading && loadError && (
          <div style={{ padding: '14px 18px', borderRadius: 10, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 13 }}>
            {loadError}
          </div>
        )}

        {!loading && !loadError && profile && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* ── Profile Header ── */}
            <div className="cf-profile-header" style={{ ...card, padding: 24, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
              <Avatar name={profile.name} size={76} showRing />
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                  <h2 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 20, color: 'var(--t1)' }}>{profile.name}</h2>
                  <Badge label={roleLabel} tone={roleTone} />
                  <Badge label={statusLabel} tone={statusTone} />
                </div>
                <p style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 8 }}>{profile.email}</p>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--t3)' }}>
                  {profile.workspaceName && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <I n="building" s={12} c="var(--t3)" /> {profile.workspaceName}
                    </span>
                  )}
                  <span>Member since {fmtDate(profile.memberSince || profile.createdAt)}</span>
                </div>
              </div>
              <div className="cf-profile-header-actions" style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                <Btn size="sm" onClick={startEdit}><I n="pencil" s={13} c="#060A10" /> Edit Profile</Btn>
                <Btn size="sm" variant="ghost" onClick={() => setShowPasswordModal(true)}><I n="lock" s={13} c="var(--t1)" /> Change Password</Btn>
              </div>
            </div>

            <SectionCard icon="columns" title="Quick Links">
              <QuickLinksGrid currentPage="profile" />
            </SectionCard>

            <div className="cf-profile-grid">
              {/* ── Personal Information ── */}
              <div ref={personalCardRef}>
                <SectionCard icon="user" title="Personal Information"
                  action={!editing && <button onClick={startEdit} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}><I n="pencil" s={12} c="var(--green)" /> Edit</button>}>
                  {!editing ? (
                    <div className="cf-personal-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 20px' }}>
                      <StaticField label="First Name" value={profile.name?.split(' ')[0]} />
                      <StaticField label="Last Name" value={profile.name?.split(' ').slice(1).join(' ') || '—'} />
                      <StaticField label="Email" value={profile.email} />
                      <StaticField label="Phone Number" value={profile.phone} />
                      <StaticField label="Job Title" value={profile.jobTitle} />
                      <StaticField label="Company" value={profile.company} />
                      <StaticField label="Time Zone" value={profile.timezone} />
                      <StaticField label="Language" value={LANGUAGES.find(l => l[0] === profile.language)?.[1] || profile.language} />
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      <div className="cf-personal-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 20px' }}>
                        <Field label="First Name" error={fieldErrors.firstName}>
                          <FInput value={form.firstName} onChange={e => updateField('firstName', e.target.value)} placeholder="First name" error={!!fieldErrors.firstName} />
                        </Field>
                        <Field label="Last Name" error={fieldErrors.lastName}>
                          <FInput value={form.lastName} onChange={e => updateField('lastName', e.target.value)} placeholder="Last name" error={!!fieldErrors.lastName} />
                        </Field>
                        <Field label="Email"><FInput value={profile.email} onChange={() => {}} disabled /></Field>
                        <Field label="Phone Number" error={fieldErrors.phone}>
                          <FInput value={form.phone} onChange={e => updateField('phone', e.target.value)} placeholder="+91 98765 43210" error={!!fieldErrors.phone} />
                        </Field>
                        <Field label="Job Title" error={fieldErrors.jobTitle}>
                          <FInput value={form.jobTitle} onChange={e => updateField('jobTitle', e.target.value)} placeholder="e.g. Marketing Lead" error={!!fieldErrors.jobTitle} />
                        </Field>
                        <Field label="Company" error={fieldErrors.company}>
                          <FInput value={form.company} onChange={e => updateField('company', e.target.value)} placeholder="Company name" error={!!fieldErrors.company} />
                        </Field>
                        <Field label="Time Zone">
                          <FSelect value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}>
                            <option value="" style={{ background: '#07090F' }}>Select time zone</option>
                            {ALL_TIMEZONES.map(tz => <option key={tz} value={tz} style={{ background: '#07090F' }}>{tz}</option>)}
                          </FSelect>
                        </Field>
                        <Field label="Language">
                          <FSelect value={form.language} onChange={e => setForm(f => ({ ...f, language: e.target.value }))}>
                            <option value="" style={{ background: '#07090F' }}>Select language</option>
                            {LANGUAGES.map(([code, label]) => <option key={code} value={code} style={{ background: '#07090F' }}>{label}</option>)}
                          </FSelect>
                        </Field>
                      </div>
                      {saveError && <p style={{ fontSize: 12, color: '#f87171' }}>{saveError}</p>}
                      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                        <Btn variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>Cancel</Btn>
                        <Btn size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Btn>
                      </div>
                    </div>
                  )}
                </SectionCard>
              </div>

              {/* ── Right column: Security + Account ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <SectionCard icon="shield" title="Security Summary">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12.5, color: 'var(--t2)' }}>Password</span>
                      <Badge tone={profile.hasPassword ? 'green' : 'gray'} label={profile.hasPassword ? 'Protected' : 'Google sign-in'} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12.5, color: 'var(--t2)' }}>Two-Factor Auth</span>
                      <Badge tone="gray" label="Not enabled" />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12.5, color: 'var(--t2)' }}>Active Sessions</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>{profile.sessionsCount}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12.5, color: 'var(--t2)' }}>Last Login</span>
                      <span style={{ fontSize: 12.5, color: 'var(--t1)' }}>{profile.lastLoginAt ? fmtDateTime(profile.lastLoginAt) : 'This session'}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Btn size="sm" variant="outline" onClick={() => setShowPasswordModal(true)}>Change Password</Btn>
                    <Btn size="sm" variant="outline" onClick={() => setShowSessionsModal(true)}>Manage Sessions</Btn>
                  </div>
                </SectionCard>

                <SectionCard icon="idcard" title="Account Information">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <StaticField label="User ID" value={profile.id} />
                    <StaticField label="Account Created" value={fmtDate(profile.createdAt)} />
                    <StaticField label="Last Updated" value={fmtDate(profile.updatedAt)} />
                    <StaticField label="Workspace" value={profile.workspaceName || 'Platform Admin'} />
                    <StaticField label="Plan" value={profile.workspacePlan} />
                  </div>
                </SectionCard>
              </div>
            </div>
          </div>
        )}
      </div>

      {showPasswordModal && (
        <ChangePasswordModal
          onClose={() => setShowPasswordModal(false)}
          onSuccess={() => { setShowPasswordModal(false); pushToast('success', 'Password updated successfully'); }}
        />
      )}
      {showSessionsModal && (
        <ManageSessionsModal
          onClose={() => setShowSessionsModal(false)}
          onChanged={() => { load(); pushToast('success', 'Signed out of other sessions'); }}
        />
      )}

      <ToastStack toasts={toasts} />
    </div>
  );
}
