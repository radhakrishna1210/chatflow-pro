import { useState } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const DashHeader = ({ title, subtitle }) => (
  <div style={{ height: '58px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 28px', gap: '16px', flexShrink: 0, background: 'var(--surf)' }}>
    <div style={{ flex: 1 }}>
      <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: '16px', color: 'var(--t1)', letterSpacing: '-.02em' }}>{title}</h1>
      {subtitle && <p style={{ fontSize: '11.5px', color: 'var(--t2)', marginTop: '1px' }}>{subtitle}</p>}
    </div>
  </div>
);

const ROLES = [
  {
    name: 'Admin',
    desc: 'Full access to all workspace features and settings',
    color: '#1EBF5E',
    members: 1,
    permissions: {
      'Manage Team': true, 'Billing & Subscription': true, 'API Keys': true,
      'Campaigns': true, 'Templates': true, 'Contacts': true, 'Automation': true,
      'Analytics': true, 'Integrations': true, 'Settings': true,
    },
  },
  {
    name: 'Member',
    desc: 'Standard access to day-to-day operations',
    color: '#A78BFA',
    members: 3,
    permissions: {
      'Manage Team': false, 'Billing & Subscription': false, 'API Keys': false,
      'Campaigns': true, 'Templates': true, 'Contacts': true, 'Automation': true,
      'Analytics': true, 'Integrations': false, 'Settings': false,
    },
  },
  {
    name: 'Viewer',
    desc: 'Read-only access to analytics and reports',
    color: '#0EA5E9',
    members: 0,
    permissions: {
      'Manage Team': false, 'Billing & Subscription': false, 'API Keys': false,
      'Campaigns': false, 'Templates': false, 'Contacts': false, 'Automation': false,
      'Analytics': true, 'Integrations': false, 'Settings': false,
    },
  },
];

export default function RolesPage() {
  const [selected, setSelected] = useState(0);
  const role = ROLES[selected];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <DashHeader title="Role Permissions" subtitle="Define access levels for your team" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        <div style={{ maxWidth: 860, display: 'flex', gap: 20, flexWrap: 'wrap' }}>

          {/* Role cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 220, flex: '0 0 240px' }}>
            {ROLES.map((r, i) => (
              <div key={r.name}
                onClick={() => setSelected(i)}
                style={{
                  ...card, padding: '16px 18px', cursor: 'pointer',
                  borderColor: selected === i ? `${r.color}40` : 'var(--bd)',
                  background: selected === i ? `${r.color}08` : 'var(--surf)',
                  transition: 'all .15s',
                }}
                onMouseEnter={e => { if (selected !== i) e.currentTarget.style.borderColor = 'var(--bdm)'; }}
                onMouseLeave={e => { if (selected !== i) e.currentTarget.style.borderColor = 'var(--bd)'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: r.color, boxShadow: `0 0 8px ${r.color}40`,
                  }} />
                  <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, color: selected === i ? r.color : 'var(--t1)' }}>{r.name}</p>
                </div>
                <p style={{ fontSize: 11.5, color: 'var(--t2)', lineHeight: 1.4 }}>{r.desc}</p>
                <p style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>
                  {r.members} member{r.members !== 1 ? 's' : ''}
                </p>
              </div>
            ))}
          </div>

          {/* Permissions matrix */}
          <div style={{ flex: 1, minWidth: 300 }}>
            <div style={{ ...card, overflow: 'hidden' }}>
              <div style={{
                padding: '16px 20px', borderBottom: '1px solid var(--bd)',
                display: 'flex', alignItems: 'center', gap: 10,
                background: `${role.color}06`,
              }}>
                <I n="shield" s={16} c={role.color} />
                <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>
                  {role.name} Permissions
                </span>
              </div>
              <div>
                {Object.entries(role.permissions).map(([perm, allowed], i, arr) => (
                  <div key={perm} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '14px 20px',
                    borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                    transition: 'background .12s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.015)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--t1)' }}>{perm}</span>
                    <div style={{
                      width: 24, height: 24, borderRadius: 6,
                      background: allowed ? `${role.color}15` : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${allowed ? `${role.color}30` : 'var(--bd)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <I n={allowed ? 'check' : 'x'} s={12} c={allowed ? role.color : 'var(--t3)'} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
