import { useState, useEffect } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

// ─── Reusable form input (matches SettingsView FInput) ───────────
const FInput = ({ label, value, onChange, placeholder, error, type = 'text', style: ex = {} }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
    {label && <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>{label}</label>}
    <input
      value={value} onChange={onChange} placeholder={placeholder} type={type}
      style={{
        width: '100%', padding: '10px 13px', borderRadius: 8,
        background: 'rgba(255,255,255,0.04)', border: `1px solid ${error ? 'rgba(239,68,68,0.5)' : 'var(--bd)'}`,
        color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif",
        outline: 'none', boxSizing: 'border-box', transition: 'border-color .15s', ...ex,
      }}
      onFocus={e => e.target.style.borderColor = error ? 'rgba(239,68,68,0.7)' : 'var(--gbd)'}
      onBlur={e => e.target.style.borderColor = error ? 'rgba(239,68,68,0.5)' : 'var(--bd)'}
    />
    {error && <span style={{ fontSize: 11, color: '#f87171', fontWeight: 500 }}>{error}</span>}
  </div>
);

// ─── Logo / Avatar ───────────────────────────────────────────────
const LogoAvatar = ({ logoUrl, name, size = 80 }) => {
  const init = (name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['#1EBF5E', '#0EA5E9', '#A78BFA', '#F59E0B', '#F472B6'];
  const col = colors[init.charCodeAt(0) % colors.length];
  const [imgErr, setImgErr] = useState(false);

  useEffect(() => { setImgErr(false); }, [logoUrl]);

  if (logoUrl && !imgErr) {
    return (
      <div style={{
        width: size, height: size, borderRadius: 16, overflow: 'hidden',
        border: '2px solid var(--bd)', flexShrink: 0,
        background: 'rgba(255,255,255,0.03)',
      }}>
        <img src={logoUrl} alt="Logo" onError={() => setImgErr(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
    );
  }

  return (
    <div style={{
      width: size, height: size, borderRadius: 16,
      background: `${col}18`, border: `2px solid ${col}44`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.3, fontWeight: 800, color: col, flexShrink: 0,
      fontFamily: "'Syne',sans-serif",
    }}>
      {init}
    </div>
  );
};

// ─── Skeleton shimmer ────────────────────────────────────────────
const Skeleton = ({ w = '100%', h = 40 }) => (
  <div style={{
    width: w, height: h, borderRadius: 8,
    background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%)',
    backgroundSize: '200% 100%', animation: 'shimmer 1.5s ease infinite',
  }} />
);

// ─── Toast notification ──────────────────────────────────────────
const Toast = ({ message, type = 'success', onClose }) => {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);

  const isSuccess = type === 'success';
  return (
    <div style={{
      position: 'fixed', bottom: 28, right: 28, zIndex: 9000,
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '13px 20px', borderRadius: 11,
      background: isSuccess ? 'rgba(30,191,94,0.12)' : 'rgba(239,68,68,0.12)',
      border: `1px solid ${isSuccess ? 'rgba(30,191,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
      color: isSuccess ? '#4ade80' : '#f87171',
      fontSize: 13, fontWeight: 600,
      fontFamily: "'Plus Jakarta Sans',sans-serif",
      backdropFilter: 'blur(12px)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      animation: 'fadeUp .3s ease both',
    }}>
      <I n={isSuccess ? 'check' : 'alertc'} s={15} c={isSuccess ? '#4ade80' : '#f87171'} />
      {message}
      <button onClick={onClose} style={{
        background: 'none', border: 'none', cursor: 'pointer', padding: '2px', marginLeft: 4,
        display: 'flex', alignItems: 'center',
      }}>
        <I n="x" s={12} c={isSuccess ? '#4ade80' : '#f87171'} />
      </button>
    </div>
  );
};

// ─── Preview Card ────────────────────────────────────────────────
const PreviewCard = ({ form }) => (
  <div style={{ ...card, overflow: 'hidden', position: 'sticky', top: 24 }}>
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <I n="eye" s={16} c="var(--green)" />
      <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>Profile Preview</span>
    </div>

    {/* Header gradient */}
    <div style={{
      height: 72, background: 'linear-gradient(135deg, rgba(30,191,94,0.12) 0%, rgba(14,165,233,0.08) 100%)',
      borderBottom: '1px solid var(--bd)', position: 'relative',
    }}>
      <div style={{ position: 'absolute', bottom: -32, left: 20 }}>
        <LogoAvatar logoUrl={form.logoUrl} name={form.name} size={64} />
      </div>
    </div>

    <div style={{ padding: '40px 20px 20px' }}>
      <h3 style={{
        fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 17,
        color: 'var(--t1)', letterSpacing: '-.02em', marginBottom: 2,
      }}>
        {form.name || 'Your Business'}
      </h3>
      {form.description && (
        <p style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.5, marginBottom: 14, marginTop: 6 }}>
          {form.description.length > 120 ? form.description.slice(0, 120) + '…' : form.description}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
        {form.businessEmail && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <I n="mail" s={13} c="var(--t3)" />
            <span style={{ fontSize: 12, color: 'var(--t2)' }}>{form.businessEmail}</span>
          </div>
        )}
        {form.phone && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <I n="phone" s={13} c="var(--t3)" />
            <span style={{ fontSize: 12, color: 'var(--t2)' }}>{form.phone}</span>
          </div>
        )}
        {form.website && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <I n="globe" s={13} c="var(--t3)" />
            <span style={{ fontSize: 12, color: 'var(--t2)' }}>{form.website}</span>
          </div>
        )}
        {form.address && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <I n="home" s={13} c="var(--t3)" />
            <span style={{ fontSize: 12, color: 'var(--t2)' }}>{form.address}</span>
          </div>
        )}
      </div>
    </div>
  </div>
);

// ─── Validation helpers ──────────────────────────────────────────
const validate = (form) => {
  const errs = {};
  if (!form.name.trim()) errs.name = 'Business name is required';
  if (form.businessEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.businessEmail))
    errs.businessEmail = 'Enter a valid email address';
  if (form.phone && !/^[+\d\s\-()]{6,20}$/.test(form.phone))
    errs.phone = 'Enter a valid phone number';
  if (form.website && !/^https?:\/\/.+/.test(form.website))
    errs.website = 'Must start with http:// or https://';
  if (form.description && form.description.length > 500)
    errs.description = `${form.description.length}/500 characters — please shorten`;
  return errs;
};

// ─── Social Links Card ───────────────────────────────────────
const SocialLinksCard = () => {
  const [links, setLinks] = useState(() => {
    try { return JSON.parse(localStorage.getItem('chatflow_social_links') || '{}'); } catch { return {}; }
  });
  const [saved, setSaved] = useState(false);

  const updateLink = (key) => (e) => {
    const updated = { ...links, [key]: e.target.value };
    setLinks(updated);
    setSaved(false);
  };

  const handleSave = () => {
    localStorage.setItem('chatflow_social_links', JSON.stringify(links));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const socials = [
    { key: 'twitter', label: 'Twitter / X', placeholder: 'https://x.com/yourcompany', icon: 'globe' },
    { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/company/yourcompany', icon: 'link2' },
    { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/yourcompany', icon: 'insta' },
    { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/yourcompany', icon: 'globe' },
  ];

  return (
    <div style={{ ...card, overflow: 'hidden', marginTop: 20 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <I n="link2" s={16} c="#A78BFA" />
        <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>Social Links</span>
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {socials.map(s => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <I n={s.icon} s={14} c="var(--t3)" />
            <input
              value={links[s.key] || ''} onChange={updateLink(s.key)} placeholder={s.placeholder}
              style={{
                flex: 1, padding: '8px 10px', borderRadius: 6,
                background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
                color: 'var(--t1)', fontSize: 12, fontFamily: "'Plus Jakarta Sans',sans-serif",
                outline: 'none', boxSizing: 'border-box',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--gbd)'}
              onBlur={e => e.target.style.borderColor = 'var(--bd)'}
            />
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={handleSave} style={{
            padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: saved ? 'var(--gbg)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${saved ? 'var(--gbd)' : 'var(--bd)'}`,
            color: saved ? 'var(--green)' : 'var(--t2)', cursor: 'pointer',
            fontFamily: "'Plus Jakarta Sans',sans-serif", transition: 'all .15s',
          }}>{saved ? '✓ Saved' : 'Save Links'}</button>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// ProfileView — main export
// ═══════════════════════════════════════════════════════════════════
export default function ProfileView() {
  const [form, setForm] = useState({
    name: '', businessEmail: '', phone: '', website: '',
    address: '', description: '', logoUrl: '',
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [narrow, setNarrow] = useState(window.innerWidth < 900);

  // ── Responsive listener ──
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Load profile ──
  useEffect(() => {
    wFetch('/settings')
      .then(r => r.ok ? r.json() : Promise.reject('Failed'))
      .then(d => {
        if (d) {
          setForm({
            name: d.name || '',
            businessEmail: d.businessEmail || '',
            phone: d.phone || '',
            website: d.website || '',
            address: d.address || '',
            description: d.description || '',
            logoUrl: d.logoUrl || '',
          });
        }
      })
      .catch(() => setToast({ message: 'Failed to load profile', type: 'error' }))
      .finally(() => setLoading(false));
  }, []);

  // ── Field updater ──
  const set = (field) => (e) => {
    const val = e.target.value;
    setForm(prev => ({ ...prev, [field]: val }));
    // Clear field error on edit
    if (errors[field]) setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  };

  // ── Save handler ──
  const handleSave = async () => {
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    try {
      const res = await wFetch('/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name,
          businessEmail: form.businessEmail,
          phone: form.phone,
          website: form.website,
          address: form.address,
          description: form.description,
          logoUrl: form.logoUrl,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      setToast({ message: 'Profile updated successfully', type: 'success' });
    } catch {
      setToast({ message: 'Failed to save profile. Please try again.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // ── Skeleton state ──
  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ height: 58, borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 28px', flexShrink: 0, background: 'var(--surf)' }}>
          <Skeleton w={180} h={20} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 340px', gap: 24, maxWidth: 1100 }}>
            <div style={{ ...card, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Skeleton w={80} h={80} />
              <Skeleton h={42} /><Skeleton h={42} /><Skeleton h={42} />
              <Skeleton h={42} /><Skeleton h={42} /><Skeleton h={90} />
              <Skeleton h={42} /><Skeleton w={140} h={40} />
            </div>
            <div style={{ ...card, padding: 20 }}>
              <Skeleton h={72} /><Skeleton w={64} h={64} />
              <Skeleton h={18} /><Skeleton h={14} /><Skeleton h={14} />
            </div>
          </div>
        </div>

        {/* Shimmer keyframes */}
        <style>{`@keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`}</style>
      </div>
    );
  }

  const descLen = form.description.length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Page header ── */}
      <div style={{ height: 58, borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 28px', gap: 16, flexShrink: 0, background: 'var(--surf)' }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 16, color: 'var(--t1)', letterSpacing: '-.02em' }}>Business Profile</h1>
          <p style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 1 }}>Manage your company information</p>
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'minmax(0, 1fr) 340px', gap: 24, maxWidth: 1100 }}>

          {/* ═══ Form Card ═══ */}
          <div style={{ ...card, overflow: 'hidden' }} className="fu0">
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <I n="users" s={16} c="var(--green)" />
              <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>Company Details</span>
            </div>

            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>

              {/* Logo section */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px', borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--bd)' }}>
                <LogoAvatar logoUrl={form.logoUrl} name={form.name} size={72} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginBottom: 4 }}>Company Logo</p>
                  <p style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.4 }}>Enter a URL for your logo image. Square images (1:1) work best.</p>
                </div>
              </div>

              <FInput
                label="Logo URL"
                value={form.logoUrl} onChange={set('logoUrl')}
                placeholder="https://example.com/logo.png"
                error={errors.logoUrl}
              />

              <div style={{ height: 1, background: 'var(--bd)', margin: '2px 0' }} />

              <FInput
                label="Business Name *"
                value={form.name} onChange={set('name')}
                placeholder="Your company name"
                error={errors.name}
              />

              <FInput
                label="Business Email"
                value={form.businessEmail} onChange={set('businessEmail')}
                placeholder="hello@company.com"
                error={errors.businessEmail}
                type="email"
              />

              <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 1fr', gap: 14 }}>
                <FInput
                  label="Phone"
                  value={form.phone} onChange={set('phone')}
                  placeholder="+91 98001 12345"
                  error={errors.phone}
                  type="tel"
                />
                <FInput
                  label="Website"
                  value={form.website} onChange={set('website')}
                  placeholder="https://company.com"
                  error={errors.website}
                />
              </div>

              <FInput
                label="Address"
                value={form.address} onChange={set('address')}
                placeholder="123 Main St, Mumbai, India"
                error={errors.address}
              />

              {/* Description textarea */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>Description</label>
                  <span style={{ fontSize: 11, color: descLen > 500 ? '#f87171' : 'var(--t3)', fontWeight: 500 }}>
                    {descLen}/500
                  </span>
                </div>
                <textarea
                  value={form.description} onChange={set('description')}
                  placeholder="Tell your customers about your business…"
                  rows={4}
                  style={{
                    width: '100%', padding: '10px 13px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.04)',
                    border: `1px solid ${errors.description ? 'rgba(239,68,68,0.5)' : 'var(--bd)'}`,
                    color: 'var(--t1)', fontSize: 13,
                    fontFamily: "'Plus Jakarta Sans',sans-serif",
                    outline: 'none', resize: 'vertical', lineHeight: 1.5,
                    boxSizing: 'border-box', transition: 'border-color .15s',
                  }}
                  onFocus={e => e.target.style.borderColor = errors.description ? 'rgba(239,68,68,0.7)' : 'var(--gbd)'}
                  onBlur={e => e.target.style.borderColor = errors.description ? 'rgba(239,68,68,0.5)' : 'var(--bd)'}
                />
                {errors.description && <span style={{ fontSize: 11, color: '#f87171', fontWeight: 500 }}>{errors.description}</span>}
              </div>

              {/* Save button */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
                <Btn onClick={handleSave} disabled={saving} style={{ boxShadow: 'var(--glow)', minWidth: 150 }}>
                  {saving ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#060A10" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin .7s linear infinite' }}>
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                      Saving…
                    </>
                  ) : (
                    <>
                      <I n="check" s={14} c="#060A10" />
                      Save Changes
                    </>
                  )}
                </Btn>
              </div>
            </div>
          </div>

          {/* ═══ Preview Card ═══ */}
          <div className="fu1">
            <PreviewCard form={form} />

            {/* ═══ Workspace Details ═══ */}
            <div style={{ ...card, overflow: 'hidden', marginTop: 20 }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <I n="grid" s={16} c="#0EA5E9" />
                <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>Workspace Details</span>
              </div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { label: 'Workspace ID', value: (() => { try { return JSON.parse(localStorage.getItem('user') || '{}').workspaceId || 'N/A'; } catch { return 'N/A'; } })() },
                  { label: 'Created', value: 'June 2, 2026' },
                  { label: 'Plan', value: 'Growth' },
                ].map(d => (
                  <div key={d.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.02)' }}>
                    <span style={{ fontSize: 12, color: 'var(--t2)' }}>{d.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)', fontFamily: 'monospace', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ═══ Social Links ═══ */}
            <SocialLinksCard />
          </div>

        </div>
      </div>

      {/* ── Toast ── */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Responsive overrides + shimmer keyframes ── */}
      <style>{`
        @keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }
        @media (max-width: 900px) {
          /* Stack form + preview vertically on tablets / phones */
        }
      `}</style>
    </div>
  );
}
