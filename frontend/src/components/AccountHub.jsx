import { useState, useEffect, useRef } from 'react';
import { I } from './Icons.jsx';

const SECTIONS = [
  {
    label: 'Account',
    items: [
      { id: 'profile',         icon: 'user',         label: 'Business Profile',         desc: 'Company info, logo & branding',         color: '#1EBF5E' },
      { id: 'general-settings', icon: 'cog',          label: 'General Settings',         desc: 'Workspace, locale & preferences',       color: '#0EA5E9' },
      { id: 'security',        icon: 'lock',         label: 'Security',                 desc: 'Password, 2FA & sessions',              color: '#EF4444' },
      { id: 'notifications',   icon: 'bell',         label: 'Notification Preferences', desc: 'Email, push & system alerts',           color: '#F59E0B' },
      { id: 'account-details', icon: 'grid',         label: 'Account Details',          desc: 'Owner, workspace & metadata',           color: '#F59E0B' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { id: 'settings',        icon: 'cog',          label: 'Workspace Settings',       desc: 'Webhooks, preferences & config',        color: '#0EA5E9' },
      { id: 'team',            icon: 'team',         label: 'Team Members',             desc: 'Invite & manage your team',             color: '#1EBF5E' },
      { id: 'roles',           icon: 'shield',       label: 'Role Permissions',         desc: 'Access control & roles',                color: '#A78BFA' },
      { id: 'integrations',    icon: 'plug',         label: 'Integrations',             desc: 'Connect third-party tools',             color: '#F472B6' },
      { id: 'widget-settings', icon: 'smartphone',   label: 'Widget Settings',          desc: 'Chat widget & install code',            color: '#14B8A6' },
      { id: 'automation-settings', icon: 'zap',      label: 'Automation Settings',      desc: 'Messages, working hours & AI',          color: '#F59E0B' },
      { id: 'quick-replies',   icon: 'reply',        label: 'Quick Replies',            desc: 'Saved message templates',               color: '#0EA5E9' },
    ],
  },
  {
    label: 'Billing',
    items: [
      { id: 'subscription',    icon: 'subscription', label: 'Subscription',             desc: 'Plan, billing cycle & usage',           color: '#A78BFA' },
      { id: 'wallet',          icon: 'wallet',       label: 'Wallet',                   desc: 'Balance, credits & recharge',           color: '#F59E0B' },
      { id: 'invoices',        icon: 'invoice',      label: 'Invoices',                 desc: 'Billing history & downloads',           color: '#F472B6' },
    ],
  },
  {
    label: 'Developer',
    items: [
      { id: 'api',             icon: 'key',          label: 'API Keys',                 desc: 'Manage access tokens',                  color: '#0EA5E9' },
      { id: 'marketing-api',   icon: 'code2',        label: 'Marketing API',            desc: 'Endpoints & usage docs',                color: '#1EBF5E' },
    ],
  },
];

// Flatten all items for search
const ALL_ITEMS = SECTIONS.flatMap(s => s.items);

const Avatar = ({ name = '?', size = 48 }) => {
  const init = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['#1EBF5E', '#0EA5E9', '#A78BFA', '#F59E0B', '#F472B6'];
  const col = colors[init.charCodeAt(0) % colors.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `${col}18`, border: `2px solid ${col}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * .33, fontWeight: 800, color: col, flexShrink: 0,
      boxShadow: `0 0 20px ${col}30`,
    }}>
      {init}
    </div>
  );
};

export default function AccountHub({ onClose, setPage, onNav }) {
  const overlayRef = useRef(null);
  const searchRef = useRef(null);
  const [search, setSearch] = useState('');
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; }
  });

  const isAdmin = user?.role === 'ADMIN';
  const name = user?.name || 'User';
  const email = user?.email || '';
  const wsName = user?.workspaceName || 'Workspace';

  // Close on Escape
  useEffect(() => {
    const onEsc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  // Auto-focus search
  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 200);
  }, []);

  // Close on backdrop click
  const handleBackdropClick = (e) => {
    if (e.target === overlayRef.current) onClose();
  };

  const handleCardClick = (id) => {
    setPage(id);
  };

  const handleLogout = () => {
    onNav('landing');
  };

  // Filter items by search
  const filteredSections = search.trim()
    ? [{
        label: 'Search Results',
        items: ALL_ITEMS.filter(item =>
          `${item.label} ${item.desc}`.toLowerCase().includes(search.toLowerCase())
        ),
      }]
    : SECTIONS;

  const totalCards = filteredSections.reduce((sum, s) => sum + s.items.length, 0);

  // Quick stats
  const balance = (() => {
    try {
      const saved = localStorage.getItem('chatflow_wallet_balance');
      return saved !== null ? parseFloat(saved) : 2462.11;
    } catch { return 2462.11; }
  })();

  return (
    <div
      ref={overlayRef}
      onClick={handleBackdropClick}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(3, 5, 12, 0.82)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
        animation: 'fadeIn .2s ease-out',
      }}
    >
      <div style={{
        width: '100%', maxWidth: 920, maxHeight: '92vh',
        background: 'linear-gradient(165deg, #0D1121 0%, #0A0E1A 100%)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 20,
        boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        animation: 'scaleIn .28s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>

        {/* ═══ App Logo & Name Bar ═══ */}
        <div style={{
          padding: '16px 28px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'rgba(6, 9, 19, 0.4)',
        }}>
          <div style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: 'var(--green)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 12px rgba(30,191,94,0.4)',
          }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M8 1C4.13 1 1 4.13 1 8c0 1.29.35 2.5.96 3.54L1 15l3.46-.96A7 7 0 1 0 8 1z" fill="#060913" />
            </svg>
          </div>
          <span style={{
            fontFamily: "'Syne',sans-serif",
            fontWeight: 800,
            fontSize: 14,
            color: 'var(--t1)',
            letterSpacing: '-.02em',
          }}>
            ChatFlow<span style={{ color: 'var(--green)' }}>Pro</span>
          </span>
          <span style={{
            fontSize: 11,
            color: 'var(--t3)',
            marginLeft: 8,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '.05em',
          }}>
            Account Hub
          </span>
        </div>

        {/* ═══ Header ═══ */}
        <div style={{
          padding: '24px 28px 20px',
          background: 'linear-gradient(135deg, rgba(30,191,94,0.06) 0%, rgba(14,165,233,0.03) 50%, transparent 100%)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <Avatar name={name} size={52} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{
              fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18,
              color: 'var(--t1)', letterSpacing: '-.02em', marginBottom: 3,
            }}>{name}</h2>
            <p style={{ fontSize: 12.5, color: 'var(--t2)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {email}
            </p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span style={{
                padding: '3px 10px', borderRadius: 12, fontSize: 10.5, fontWeight: 700,
                background: isAdmin ? 'rgba(30,191,94,0.1)' : 'rgba(167,139,250,0.1)',
                border: `1px solid ${isAdmin ? 'rgba(30,191,94,0.25)' : 'rgba(167,139,250,0.25)'}`,
                color: isAdmin ? '#4ade80' : '#c4b5fd',
                letterSpacing: '.03em',
              }}>
                {isAdmin ? '✦ Admin' : 'Member'}
              </span>
              <span style={{
                padding: '3px 10px', borderRadius: 12, fontSize: 10.5, fontWeight: 600,
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
                color: 'var(--t2)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {wsName}
              </span>
            </div>
          </div>

          {/* Quick stats */}
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            <div style={{
              padding: '8px 14px', borderRadius: 10,
              background: 'rgba(30,191,94,0.06)', border: '1px solid rgba(30,191,94,0.15)',
              textAlign: 'center',
            }}>
              <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>Balance</p>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
            </div>
            <div style={{
              padding: '8px 14px', borderRadius: 10,
              background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.15)',
              textAlign: 'center',
            }}>
              <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>Plan</p>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#c4b5fd' }}>Growth</p>
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all .15s', flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
          >
            <I n="x" s={16} c="var(--t2)" />
          </button>
        </div>

        {/* ═══ Search ═══ */}
        <div style={{ padding: '14px 24px 0' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 9,
            padding: '9px 14px', borderRadius: 10,
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
            transition: 'all .15s',
          }}>
            <I n="search" s={14} c="var(--t3)" />
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search settings…"
              style={{
                flex: 1, background: 'none', border: 'none', outline: 'none',
                color: 'var(--t1)', fontSize: 13,
                fontFamily: "'Plus Jakarta Sans',sans-serif",
              }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{
                background: 'none', border: 'none', cursor: 'pointer', display: 'flex',
                padding: 2,
              }}>
                <I n="x" s={12} c="var(--t3)" />
              </button>
            )}
          </div>
        </div>

        {/* ═══ Grid ═══ */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '16px 24px 16px',
        }}>
          {totalCards === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--t3)' }}>
              <I n="search" s={24} c="var(--t3)" />
              <p style={{ marginTop: 10, fontSize: 13 }}>No settings found for "{search}"</p>
            </div>
          ) : (
            filteredSections.map((section, si) => (
              section.items.length > 0 && (
                <div key={section.label} style={{ marginBottom: si < filteredSections.length - 1 ? 18 : 0 }}>
                  <p style={{
                    fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase',
                    letterSpacing: '.1em', marginBottom: 10, paddingLeft: 4,
                  }}>{section.label}</p>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))',
                    gap: 10,
                  }}>
                    {section.items.map((item, i) => (
                      <HubCard
                        key={item.id}
                        item={item}
                        index={si * 5 + i}
                        onClick={() => handleCardClick(item.id)}
                      />
                    ))}
                  </div>
                </div>
              )
            ))
          )}
        </div>

        {/* ═══ Footer ═══ */}
        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <p style={{ fontSize: 11, color: 'var(--t3)' }}>
            ChatFlow<span style={{ color: 'var(--green)' }}>Pro</span> · Enterprise Account Hub
          </p>
          <button
            onClick={handleLogout}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 16px', borderRadius: 8,
              background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)',
              color: '#f87171', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              fontFamily: "'Plus Jakarta Sans',sans-serif",
              transition: 'all .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.06)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.15)'; }}
          >
            <I n="logout" s={13} c="#f87171" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Hub Card ─────────────────────────────────────────────── */
const HubCard = ({ item, index, onClick }) => {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        padding: '16px 14px',
        borderRadius: 14,
        background: hovered
          ? `linear-gradient(135deg, ${item.color}0A, ${item.color}04)`
          : 'rgba(255,255,255,0.02)',
        border: `1px solid ${hovered ? item.color + '30' : 'rgba(255,255,255,0.06)'}`,
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: "'Plus Jakarta Sans',sans-serif",
        transition: 'all .2s cubic-bezier(0.16, 1, 0.3, 1)',
        transform: hovered ? 'translateY(-2px) scale(1.01)' : 'none',
        boxShadow: hovered
          ? `0 8px 24px ${item.color}12, 0 0 0 1px ${item.color}15`
          : 'none',
        animation: `hubCardIn .3s ${index * 0.03}s ease both`,
      }}
    >
      {/* Icon */}
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: `${item.color}12`,
        border: `1px solid ${item.color}25`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all .2s',
        boxShadow: hovered ? `0 0 16px ${item.color}20` : 'none',
      }}>
        <I n={item.icon} s={17} c={item.color} />
      </div>

      {/* Text */}
      <div>
        <p style={{
          fontSize: 13, fontWeight: 700, color: 'var(--t1)',
          marginBottom: 2, lineHeight: 1.3,
          transition: 'color .15s',
          ...(hovered ? { color: item.color } : {}),
        }}>
          {item.label}
        </p>
        <p style={{
          fontSize: 11, color: 'var(--t3)', lineHeight: 1.35,
          transition: 'color .15s',
          ...(hovered ? { color: 'var(--t2)' } : {}),
        }}>
          {item.desc}
        </p>
      </div>
    </button>
  );
};
