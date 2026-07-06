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
      fontSize: 13, fontWeight: 600, fontFamily: "'Plus Jakarta Sans',sans-serif",
      backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      animation: 'fadeUp .3s ease both',
    }}>
      <I n={isSuccess ? 'check' : 'alertc'} s={15} c={isSuccess ? '#4ade80' : '#f87171'} />
      {message}
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', marginLeft: 4, display: 'flex', alignItems: 'center' }}>
        <I n="x" s={12} c={isSuccess ? '#4ade80' : '#f87171'} />
      </button>
    </div>
  );
};

const Skeleton = ({ w = '100%', h = 40 }) => (
  <div style={{
    width: w, height: h, borderRadius: 8,
    background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%)',
    backgroundSize: '200% 100%', animation: 'pulse 1.5s ease infinite',
  }} />
);

const FInput = ({ label, value, onChange, placeholder, error, type = 'text', disabled = false }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
    {label && <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>{label}</label>}
    <input
      value={value} onChange={onChange} placeholder={placeholder} type={type} disabled={disabled}
      style={{
        width: '100%', padding: '10px 13px', borderRadius: 8,
        background: disabled ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${error ? 'rgba(239,68,68,0.5)' : 'var(--bd)'}`,
        color: disabled ? 'var(--t3)' : 'var(--t1)', fontSize: 13,
        fontFamily: "'Plus Jakarta Sans',sans-serif",
        outline: 'none', boxSizing: 'border-box', transition: 'border-color .15s',
      }}
      onFocus={e => { if (!disabled) e.target.style.borderColor = error ? 'rgba(239,68,68,0.7)' : 'var(--gbd)'; }}
      onBlur={e => e.target.style.borderColor = error ? 'rgba(239,68,68,0.5)' : 'var(--bd)'}
    />
    {error && <span style={{ fontSize: 11, color: '#f87171', fontWeight: 500 }}>{error}</span>}
  </div>
);

const FSelect = ({ label, value, onChange, options }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
    {label && <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>{label}</label>}
    <select
      value={value} onChange={onChange}
      style={{
        width: '100%', padding: '10px 13px', borderRadius: 8,
        background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
        color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif",
        outline: 'none', boxSizing: 'border-box', cursor: 'pointer',
        appearance: 'none',
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2356688A' stroke-width='2'%3E%3Cpolyline points='6,9 12,15 18,9'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
        paddingRight: 36,
      }}
    >
      {options.map(o => <option key={o.value} value={o.value} style={{ background: '#0D1121', color: '#F0F2F8' }}>{o.label}</option>)}
    </select>
  </div>
);

const FTextarea = ({ label, value, onChange, placeholder, rows = 3 }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
    {label && <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>{label}</label>}
    <textarea
      value={value} onChange={onChange} placeholder={placeholder} rows={rows}
      style={{
        width: '100%', padding: '10px 13px', borderRadius: 8,
        background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
        color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif",
        outline: 'none', boxSizing: 'border-box', resize: 'vertical',
        transition: 'border-color .15s',
      }}
      onFocus={e => e.target.style.borderColor = 'var(--gbd)'}
      onBlur={e => e.target.style.borderColor = 'var(--bd)'}
    />
  </div>
);

const SectionCard = ({ icon, title, subtitle, children, color = 'var(--green)' }) => (
  <div style={{ ...card, overflow: 'hidden' }}>
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: `${color}12`, border: `1px solid ${color}25`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <I n={icon} s={17} c={color} />
      </div>
      <div>
        <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>{title}</span>
        {subtitle && <p style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>{subtitle}</p>}
      </div>
    </div>
    <div style={{ padding: 20 }}>{children}</div>
  </div>
);

const LogoPreview = ({ logoUrl, name }) => {
  const init = (name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['#1EBF5E', '#0EA5E9', '#A78BFA', '#F59E0B', '#F472B6'];
  const col = colors[init.charCodeAt(0) % colors.length];
  const [imgErr, setImgErr] = useState(false);

  useEffect(() => { setImgErr(false); }, [logoUrl]);

  return (
    <div style={{
      width: 72, height: 72, borderRadius: 16, overflow: 'hidden',
      border: `2px solid ${logoUrl && !imgErr ? 'var(--bd)' : col + '44'}`,
      background: logoUrl && !imgErr ? 'rgba(255,255,255,0.03)' : `${col}18`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      transition: 'all .2s',
    }}>
      {logoUrl && !imgErr ? (
        <img src={logoUrl} alt="Logo" onError={() => setImgErr(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <span style={{ fontSize: 22, fontWeight: 800, color: col, fontFamily: "'Syne',sans-serif" }}>{init}</span>
      )}
    </div>
  );
};

const LANGUAGES = [
  { value: 'en', label: 'English' }, { value: 'hi', label: 'Hindi' },
  { value: 'es', label: 'Spanish' }, { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' }, { value: 'pt', label: 'Portuguese' },
  { value: 'ar', label: 'Arabic' }, { value: 'id', label: 'Indonesian' },
  { value: 'mr', label: 'Marathi' }, { value: 'ja', label: 'Japanese' },
];

const TIMEZONES = [
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },
  { value: 'America/New_York', label: 'America/New_York (EST)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST)' },
  { value: 'Europe/London', label: 'Europe/London (GMT)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT)' },
  { value: 'UTC', label: 'UTC' },
];

const DATE_FORMATS = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' }, { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' }, { value: 'DD-MMM-YYYY', label: 'DD-MMM-YYYY' },
];

const TIME_FORMATS = [
  { value: '12h', label: '12-hour (AM/PM)' }, { value: '24h', label: '24-hour' },
];

const CURRENCIES = [
  { value: 'INR', label: '₹ INR — Indian Rupee' }, { value: 'USD', label: '$ USD — US Dollar' },
  { value: 'EUR', label: '€ EUR — Euro' }, { value: 'GBP', label: '£ GBP — British Pound' },
  { value: 'AED', label: 'د.إ AED — Dirham' }, { value: 'SGD', label: '$ SGD — Singapore Dollar' },
  { value: 'AUD', label: '$ AUD — Australian Dollar' }, { value: 'JPY', label: '¥ JPY — Japanese Yen' },
];

const CATEGORIES = [
  { value: '', label: 'Select category...' },
  { value: 'ecommerce', label: 'E-commerce & Retail' }, { value: 'saas', label: 'SaaS & Technology' },
  { value: 'education', label: 'Education' }, { value: 'healthcare', label: 'Healthcare' },
  { value: 'finance', label: 'Finance & Banking' }, { value: 'real-estate', label: 'Real Estate' },
  { value: 'hospitality', label: 'Hospitality & Travel' }, { value: 'food', label: 'Food & Beverage' },
  { value: 'media', label: 'Media & Entertainment' }, { value: 'nonprofit', label: 'Non-profit' },
  { value: 'other', label: 'Other' },
];

export default function GeneralSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Fields
  const [workspaceName, setWorkspaceName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [language, setLanguage] = useState('en');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [dateFormat, setDateFormat] = useState('DD/MM/YYYY');
  const [timeFormat, setTimeFormat] = useState('12h');
  const [currency, setCurrency] = useState('INR');
  const [businessCategory, setBusinessCategory] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');

  // Validation
  const [errors, setErrors] = useState({});

  useEffect(() => {
    wFetch('/settings')
      .then(r => r.ok && r.json())
      .then(d => {
        if (d) {
          setWorkspaceName(d.name || '');
          setBusinessName(d.businessName || '');
          setLogoUrl(d.logoUrl || '');
          setLanguage(d.language || 'en');
          setTimezone(d.timezone || 'Asia/Kolkata');
          setDateFormat(d.dateFormat || 'DD/MM/YYYY');
          setTimeFormat(d.timeFormat || '12h');
          setCurrency(d.currency || 'INR');
          setBusinessCategory(d.businessCategory || '');
          setBusinessEmail(d.businessEmail || '');
          setWebsite(d.website || '');
          setAddress(d.address || '');
          setDescription(d.description || '');
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const validate = () => {
    const errs = {};
    if (!workspaceName.trim()) errs.workspaceName = 'Workspace name is required';
    if (businessEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(businessEmail)) errs.businessEmail = 'Invalid email address';
    if (website && !/^https?:\/\/.+/.test(website) && website.trim()) errs.website = 'Must start with http:// or https://';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      setToast({ message: 'Please fix the errors below', type: 'error' });
      return;
    }

    setSaving(true);
    try {
      const res = await wFetch('/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          name: workspaceName.trim(),
          businessName: businessName.trim(),
          logoUrl: logoUrl.trim(),
          language, timezone, dateFormat, timeFormat, currency,
          businessCategory, businessEmail: businessEmail.trim(),
          website: website.trim(), address: address.trim(),
          description: description.trim(),
        }),
      });
      if (res.ok) {
        setToast({ message: 'Settings saved successfully!', type: 'success' });
        // Update localStorage workspace name
        try {
          const user = JSON.parse(localStorage.getItem('user') || '{}');
          if (user.workspaceName !== workspaceName) {
            user.workspaceName = workspaceName;
            localStorage.setItem('user', JSON.stringify(user));
          }
        } catch {}
      } else {
        const data = await res.json().catch(() => ({}));
        setToast({ message: data.error || 'Failed to save settings', type: 'error' });
      }
    } catch (err) {
      setToast({ message: err.message || 'Network error', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <DashHeader title="General Settings" subtitle="Workspace, business & localization preferences" />
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Skeleton h={200} /> <Skeleton h={180} /> <Skeleton h={160} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <DashHeader title="General Settings" subtitle="Workspace, business & localization preferences" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Workspace & Branding */}
          <SectionCard icon="home" title="Workspace & Branding" subtitle="Basic workspace identity and logo" color="#1EBF5E">
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 20 }}>
              <LogoPreview logoUrl={logoUrl} name={workspaceName || businessName} />
              <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <FInput label="Logo URL" value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://example.com/logo.png" />
                <p style={{ fontSize: 11, color: 'var(--t3)', marginTop: -4 }}>Enter an image URL for your company logo. Supported: PNG, JPG, SVG.</p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
              <FInput label="Workspace Name" value={workspaceName} onChange={e => setWorkspaceName(e.target.value)} placeholder="My Workspace" error={errors.workspaceName} />
              <FInput label="Business Name" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Acme Inc." />
            </div>
          </SectionCard>

          {/* Localization */}
          <SectionCard icon="globe" title="Localization" subtitle="Language, timezone and format preferences" color="#0EA5E9">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              <FSelect label="Language" value={language} onChange={e => setLanguage(e.target.value)} options={LANGUAGES} />
              <FSelect label="Timezone" value={timezone} onChange={e => setTimezone(e.target.value)} options={TIMEZONES} />
              <FSelect label="Date Format" value={dateFormat} onChange={e => setDateFormat(e.target.value)} options={DATE_FORMATS} />
              <FSelect label="Time Format" value={timeFormat} onChange={e => setTimeFormat(e.target.value)} options={TIME_FORMATS} />
              <FSelect label="Currency" value={currency} onChange={e => setCurrency(e.target.value)} options={CURRENCIES} />
              <FSelect label="Business Category" value={businessCategory} onChange={e => setBusinessCategory(e.target.value)} options={CATEGORIES} />
            </div>
          </SectionCard>

          {/* Contact Information */}
          <SectionCard icon="mail" title="Contact Information" subtitle="How customers can reach your business" color="#A78BFA">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
              <FInput label="Business Email" value={businessEmail} onChange={e => setBusinessEmail(e.target.value)} placeholder="hello@company.com" error={errors.businessEmail} />
              <FInput label="Website" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://company.com" error={errors.website} />
            </div>
            <div style={{ marginTop: 14 }}>
              <FInput label="Business Address" value={address} onChange={e => setAddress(e.target.value)} placeholder="123 Business St, Mumbai 400001, India" />
            </div>
            <div style={{ marginTop: 14 }}>
              <FTextarea label="Business Description" value={description} onChange={e => setDescription(e.target.value)} placeholder="Tell customers what your business does..." rows={3} />
            </div>
          </SectionCard>

          {/* Save */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, paddingBottom: 24 }}>
            <Btn variant="ghost" onClick={() => window.dispatchEvent(new CustomEvent('app:nav', { detail: 'settings' }))}>
              Cancel
            </Btn>
            <Btn onClick={handleSave} disabled={saving} style={{ boxShadow: 'var(--glow)' }}>
              <I n="check" s={14} c="#060A10" />
              {saving ? 'Saving…' : 'Save Changes'}
            </Btn>
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
