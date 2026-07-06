import { useState, useEffect } from 'react';
import { I } from '../components/Icons.jsx';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const DashHeader = ({ title, subtitle }) => (
  <div style={{ height: '58px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 28px', gap: '16px', flexShrink: 0, background: 'var(--surf)' }}>
    <div style={{ flex: 1 }}>
      <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: '16px', color: 'var(--t1)', letterSpacing: '-.02em' }}>{title}</h1>
      {subtitle && <p style={{ fontSize: '11.5px', color: 'var(--t2)', marginTop: '1px' }}>{subtitle}</p>}
    </div>
  </div>
);

const InfoRow = ({ icon, label, value, color }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    transition: 'background .12s',
  }}
    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.015)'}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
  >
    <div style={{
      width: 36, height: 36, borderRadius: 9,
      background: `${color || 'var(--green)'}12`,
      border: `1px solid ${color || 'var(--green)'}25`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <I n={icon} s={16} c={color || 'var(--green)'} />
    </div>
    <div style={{ flex: 1 }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</p>
      <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', marginTop: 2 }}>{value}</p>
    </div>
  </div>
);

export default function AccountDetailsPage() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; }
  });

  const details = [
    { icon: 'user', label: 'Account Owner', value: user?.name || 'N/A', color: '#1EBF5E' },
    { icon: 'mail', label: 'Email Address', value: user?.email || 'N/A', color: '#0EA5E9' },
    { icon: 'hash', label: 'Workspace ID', value: user?.workspaceId || 'N/A', color: '#A78BFA' },
    { icon: 'home', label: 'Workspace Name', value: user?.workspaceName || 'N/A', color: '#F59E0B' },
    { icon: 'shield', label: 'Role', value: user?.role === 'ADMIN' ? 'Administrator' : 'Member', color: '#1EBF5E' },
    { icon: 'clock', label: 'Created Date', value: 'June 2, 2026', color: '#0EA5E9' },
    { icon: 'clock', label: 'Last Login', value: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }), color: '#F472B6' },
    { icon: 'globe', label: 'Timezone', value: Intl.DateTimeFormat().resolvedOptions().timeZone, color: '#A78BFA' },
    { icon: 'globe', label: 'Language', value: 'English (US)', color: '#F59E0B' },
    { icon: 'globe', label: 'Country', value: 'India', color: '#1EBF5E' },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <DashHeader title="Account Details" subtitle="Workspace and account information" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        <div style={{ maxWidth: 680 }}>
          {/* Account info card */}
          <div style={{ ...card, overflow: 'hidden', marginBottom: 24 }}>
            <div style={{
              padding: '20px 20px 16px',
              background: 'linear-gradient(135deg, rgba(30,191,94,0.06), rgba(14,165,233,0.03))',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: 'var(--gbg)', border: '1px solid var(--gbd)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <I n="grid" s={20} c="var(--green)" />
              </div>
              <div>
                <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>Account Information</p>
                <p style={{ fontSize: 12, color: 'var(--t2)' }}>Overview of your workspace and account details</p>
              </div>
            </div>

            {details.map((d, i) => (
              <InfoRow key={i} icon={d.icon} label={d.label} value={d.value} color={d.color} />
            ))}
          </div>

          {/* Data export info */}
          <div style={{
            ...card, padding: '16px 20px',
            display: 'flex', alignItems: 'center', gap: 12,
            background: 'rgba(14,165,233,0.04)', border: '1px solid rgba(14,165,233,0.12)',
          }}>
            <I n="download" s={16} c="#0EA5E9" />
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#7dd3fc' }}>Need to export your data?</p>
              <p style={{ fontSize: 12, color: 'var(--t2)' }}>Contact support for a full data export of your workspace.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
