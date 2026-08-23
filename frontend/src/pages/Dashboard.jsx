import { useState, useRef, useEffect } from 'react';
import { canManage } from '../lib/permissions.js';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import CreateCampaign from './CreateCampaign.jsx';
import { wFetch, apiFetch } from '../lib/api.js';
import { validateMeaningfulText } from '../lib/validation.js';
import { useMessageRates, inr as inrRate } from '../lib/pricing.js';
import AIOnboardingCard from '../components/AIOnboardingCard.jsx';
import WalletStatusBanner from '../components/WalletStatusBanner.jsx';
import ContactsView from './ContactsView.jsx';
import InboxView from './InboxView.jsx';
import WidgetsView from './WidgetsView.jsx';
import AutomationView from './AutomationView.jsx';
import AnalyticsView from './AnalyticsView.jsx';
import UserAnalyticsView from './UserAnalyticsView.jsx';
import ChatAnalytics from '../components/dashboard/ChatAnalytics.jsx';
import { useIsMobile } from '../lib/useMediaQuery.js';
import NumberSetupView from './NumberSetupView.jsx';
import ApiKeysView from './ApiKeysView.jsx';
import SettingsView from './SettingsView.jsx';
import ProfileView from './ProfileView.jsx';
import SuperAdminView from './SuperAdminView.jsx';
import SupportView from './SupportView.jsx';
import IntegrationsView from './IntegrationsView.jsx';
import PaymentsView from './PaymentsView.jsx';
import LegalCenter from '../components/LegalCenter.jsx';
import { LEGAL_DOCS } from '../lib/legalContent.js';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const StatusBadge = ({ s }) => {
  const cfg = {
    Active:    { bg: 'var(--gbg)',                bd: 'var(--gbd)',                   c: 'var(--green)' },
    Approved:  { bg: 'var(--gbg)',                bd: 'var(--gbd)',                   c: 'var(--green)' },
    Completed: { bg: 'rgba(99,102,241,.1)',        bd: 'rgba(99,102,241,.25)',         c: '#818cf8' },
    Draft:     { bg: 'rgba(255,255,255,.04)',      bd: 'var(--bd)',                    c: 'var(--t2)' },
    Scheduled: { bg: 'rgba(14,165,233,.1)',         bd: 'rgba(14,165,233,.25)',         c: '#9d6bff' },
    Running:   { bg: 'rgba(14,165,233,.1)',         bd: 'rgba(14,165,233,.25)',         c: '#9d6bff' },
    Cancelled: { bg: 'rgba(239,68,68,.08)',         bd: 'rgba(239,68,68,.22)',          c: '#f87171' },
    Failed:    { bg: 'rgba(239,68,68,.08)',         bd: 'rgba(239,68,68,.22)',          c: '#f87171' },
    Rejected:  { bg: 'rgba(239,68,68,.08)',         bd: 'rgba(239,68,68,.22)',          c: '#f87171' },
    Pending:   { bg: 'rgba(245,158,11,.1)',        bd: 'rgba(245,158,11,.25)',         c: '#fbbf24' },
    Retrying:  { bg: 'rgba(168,85,247,.12)',       bd: 'rgba(168,85,247,.3)',          c: '#c4ff46' },
    urgent:    { bg: 'rgba(239,68,68,.08)',        bd: 'rgba(239,68,68,.22)',          c: '#f87171' },
    resolved:  { bg: 'var(--gbg)',                bd: 'var(--gbd)',                   c: 'var(--green)' },
    billing:   { bg: 'rgba(245,158,11,.08)',       bd: 'rgba(245,158,11,.22)',         c: '#fbbf24' },
  };
  const label = typeof s === 'string' && /^[A-Z_]+$/.test(s)
    ? s.charAt(0) + s.slice(1).toLowerCase()
    : s;
  const v = cfg[label] || cfg.Draft;
  return <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: v.bg, border: `1px solid ${v.bd}`, color: v.c, display: 'inline-block' }}>{label}</span>;
};

// Identity mark. The design set paints these as a filled brand gradient with
// dark ink initials, not a tinted outline — it is the one place colour is
// allowed to be loud. The pair is chosen from the name so two people in a list
// stay tellable apart, rather than every avatar being identical.
const AVATAR_GRADS = [
  'linear-gradient(135deg,#9d6bff,#35e8f2)',
  'linear-gradient(135deg,#35e8f2,#c4ff46)',
  'linear-gradient(135deg,#c4ff46,#9d6bff)',
  'linear-gradient(135deg,#f59e0b,#c4ff46)',
  'linear-gradient(135deg,#f472b6,#9d6bff)',
];
const Avatar = ({ name = '?', size = 34, showRing = false }) => {
  const init = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const seed = [...init].reduce((a, c) => a + c.charCodeAt(0), 0);
  const grad = AVATAR_GRADS[seed % AVATAR_GRADS.length];
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: grad,
      boxShadow: showRing ? '0 0 0 2px rgba(53,232,242,0.28), inset 0 1px 0 rgba(255,255,255,0.3)' : 'inset 0 1px 0 rgba(255,255,255,0.28)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * .38 + 'px', fontWeight: 800, color: 'var(--ink)',
      letterSpacing: '-.02em', flexShrink: 0 }}>
      {init}
    </div>
  );
};

// ─── Focus-trap helper for modals ─────────────────────────────
const useFocusTrap = (containerRef, isActive) => {
  useEffect(() => {
    if (!isActive || !containerRef.current) return;
    const container = containerRef.current;
    const focusable = () => container.querySelectorAll(
      'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])'
    );
    const first = () => { const els = focusable(); return els[0]; };
    const last  = () => { const els = focusable(); return els[els.length - 1]; };
    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const els = focusable();
      if (els.length === 0) { e.preventDefault(); return; }
      if (e.shiftKey) {
        if (document.activeElement === els[0]) { e.preventDefault(); els[els.length - 1].focus(); }
      } else {
        if (document.activeElement === els[els.length - 1]) { e.preventDefault(); els[0].focus(); }
      }
    };
    container.addEventListener('keydown', onKeyDown);
    // Auto-focus first focusable element when trap activates.
    requestAnimationFrame(() => { const f = first(); if (f) f.focus(); });
    return () => container.removeEventListener('keydown', onKeyDown);
  }, [isActive, containerRef]);
};

// ─── Profile menu (top-right) ─────────────────────────────────
const ProfileMenu = () => {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; }
  });
  const [workspaces, setWorkspaces] = useState([]);
  const [switching, setSwitching] = useState(false);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onEsc   = (e) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  // Re-read user info when menu opens (in case anything changed), and load
  // the full list of workspaces this account belongs to for the switcher.
  useEffect(() => {
    if (open) {
      try { setUser(JSON.parse(localStorage.getItem('user') || '{}')); } catch {}
      apiFetch('/api/v1/workspaces/mine').then(r => r.ok ? r.json() : []).then(d => { if (Array.isArray(d)) setWorkspaces(d); }).catch(() => {});
    }
  }, [open]);

  const fire = (action) => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent('app:nav', { detail: action }));
  };

  const switchTo = async (targetId) => {
    if (switching || targetId === user?.workspaceId) return;
    setSwitching(true);
    try {
      const res = await apiFetch(`/api/v1/workspaces/${targetId}/switch`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) return;
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify({
        id: data.user.id, name: data.user.name, email: data.user.email, role: data.user.role,
        superAdmin: data.user.superAdmin === true, workspaceId: data.workspace.id, workspaceName: data.workspace.name,
      }));
      setOpen(false);
      // A full reload, not an SPA navigate — the target path is the same
      // /dashboard we're already on (a same-path navigate() is a no-op),
      // and even a real path change wouldn't remount already-mounted
      // sibling views that fetched their data once on mount under the old
      // workspace scope. Every view needs to re-fetch under the new one.
      window.location.href = '/dashboard';
    } finally {
      setSwitching(false);
    }
  };

  const isAdmin = user?.role === 'ADMIN';
  const isSuperAdmin = user?.superAdmin === true;
  const name    = user?.name  || 'User';
  const email   = user?.email || '';
  const wsName  = user?.workspaceName || 'Workspace';

  return (
    <div ref={wrapRef} style={{ position:'relative' }}>
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
        aria-label="Open profile menu"
        aria-expanded={open}
        aria-haspopup="true"
        style={{ background:'none', border:'none', padding:0, cursor:'pointer', borderRadius:'50%' }}>
        <Avatar name={name} size={34} showRing />
      </button>

      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 8px)', right:0,
          width:280, background:'var(--surf)', border:'1px solid var(--bd)',
          borderRadius:12, boxShadow:'0 16px 40px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3)',
          zIndex:200, overflow:'hidden', animation:'fadeIn .12s ease-out',
        }}>
          {/* Header — identity */}
          <div style={{ padding:'16px 18px', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid var(--bd)', background:'linear-gradient(135deg, rgba(53,232,242,0.06), transparent)' }}>
            <Avatar name={name} size={44} showRing />
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ fontSize:14, fontWeight:700, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:2 }}>{name}</p>
              <p style={{ fontSize:11, color:'var(--t2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{email}</p>
            </div>
          </div>

          {/* Badge row */}
          <div style={{ padding:'12px 18px', display:'flex', flexWrap:'wrap', gap:6, borderBottom:'1px solid var(--bd)' }}>
            <span style={{
              padding:'3px 10px', borderRadius:12, fontSize:11, fontWeight:700,
              background: isAdmin ? 'var(--gbg)' : 'rgba(196,255,70,.1)',
              border: `1px solid ${isAdmin ? 'var(--gbd)' : 'rgba(196,255,70,.25)'}`,
              color: isAdmin ? 'var(--green)' : '#d8ff8a',
            }}>{isSuperAdmin ? 'Super Admin' : isAdmin ? 'Admin' : 'Member'}</span>
            <span style={{ padding:'3px 10px', borderRadius:12, fontSize:11, fontWeight:600, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:180 }}>
              {wsName}
            </span>
          </div>

          {/* Workspace switcher — only shown once the account belongs to more than one */}
          {workspaces.length > 1 && (
            <div style={{ padding:'8px 6px', borderBottom:'1px solid var(--bd)' }}>
              <p style={{ padding:'2px 12px 6px', fontSize:10, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.07em' }}>My Workspaces</p>
              {workspaces.map(w => {
                const current = w.id === user?.workspaceId;
                return (
                  <button key={w.id} onClick={() => switchTo(w.id)} disabled={switching}
                    style={{
                      width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8,
                      padding:'8px 12px', borderRadius:8, cursor: current ? 'default' : 'pointer',
                      background: current ? 'rgba(53,232,242,0.06)' : 'transparent', border:'none', textAlign:'left',
                      fontFamily:"'Manrope',sans-serif", fontSize:12.5, fontWeight:600, color:'var(--t1)',
                      transition:'background .12s', opacity: switching ? 0.6 : 1,
                    }}
                    onMouseEnter={e => { if (!current) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                    onMouseLeave={e => { if (!current) e.currentTarget.style.background = 'transparent'; }}>
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{w.name}</span>
                    {current && <I n="checkc" s={13} c="var(--green)" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Menu items — super admins only manage their own profile/settings here;
              workspace-scoped items (Number Setup, API Keys) don't apply to them. */}
          <div style={{ padding:6 }}>
            <MenuItem icon="user"  label="Profile"      onClick={() => fire('profile')} />
            <MenuItem icon="cog"   label="Settings"     onClick={() => fire('settings')} />
            {!isSuperAdmin && <MenuItem icon="phone" label="Number Setup" onClick={() => fire('setup')} />}
            {!isSuperAdmin && <MenuItem icon="key"   label="API Keys"     onClick={() => fire('api')} />}
            <MenuItem icon="file"  label="Legal & Policies" onClick={() => fire('legal')} />
          </div>

          {/* Sign out */}
          <div style={{ borderTop:'1px solid var(--bd)', padding:6 }}>
            <MenuItem icon="logout" label="Sign out" danger onClick={() => fire('signout')} />
          </div>
        </div>
      )}
    </div>
  );
};

const MenuItem = ({ icon, label, onClick, danger = false }) => (
  <button
    onClick={onClick}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
    role="menuitem"
    style={{
      width:'100%', display:'flex', alignItems:'center', gap:11,
      padding:'9px 12px', borderRadius:8, cursor:'pointer',
      background:'transparent', border:'none', textAlign:'left',
      fontFamily:"'Manrope',sans-serif",
      fontSize:13, fontWeight:500,
      color: danger ? '#f87171' : 'var(--t1)',
      transition:'background .12s',
    }}
    onMouseEnter={e => { e.currentTarget.style.background = danger ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.04)'; }}
    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    onFocus={e => { e.currentTarget.style.background = danger ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.04)'; }}
    onBlur={e => { e.currentTarget.style.background = 'transparent'; }}>
    <I n={icon} s={14} c={danger ? '#f87171' : 'var(--t2)'} />
    {label}
  </button>
);

const Spark = ({ data, color = 'var(--green)', id = 's', width = 80, height = 30 }) => {
  const max = Math.max(...data), min = Math.min(...data), range = (max - min) || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1) * width).toFixed(1);
    const y = (height - ((v - min) / range) * height * .75 - height * .1).toFixed(1);
    return `${x},${y}`;
  }).join(' ');
  const area = `0,${height} ${pts} ${width},${height}`;
  const gid = `sg-${id}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible', display: 'block' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

const ActivityChart = ({ data, labels, color = 'var(--green)' }) => {
  const W = 600, H = 100;
  const max = Math.max(...data), min = Math.min(...data), range = (max - min) || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1) * W).toFixed(1);
    const y = (H - ((v - min) / range) * H * .78 - H * .1).toFixed(1);
    return `${x},${y}`;
  }).join(' ');
  return (
    <div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="acg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${H} ${pts} ${W},${H}`} fill="url(#acg)" />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.split(' ').slice(-1).map(p => {
          const [x, y] = p.split(',');
          // --surf is a gradient (see index.css); an SVG stroke needs a colour.
          return <circle key="dot" cx={x} cy={y} r="4" fill={color} stroke="var(--surf-solid)" strokeWidth="2" />;
        })}
      </svg>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${labels.length},1fr)`, gap: '0', marginTop: '8px' }}>
        {labels.map(l => <div key={l} style={{ fontSize: '11px', color: 'var(--t3)', textAlign: 'center' }}>{l}</div>)}
      </div>
    </div>
  );
};

const CONVS = [
  { id: 1, name: 'Priya Sharma', phone: '+91 98001 11234', last: 'Is my order shipped?', time: '10:32', unread: 2, label: 'urgent' },
  { id: 2, name: 'Rahul Mehta', phone: '+91 97002 22345', last: 'Thanks! Got the invoice.', time: '09:58', unread: 0, label: 'resolved' },
  { id: 3, name: 'Ananya Iyer', phone: '+91 96003 33456', last: 'When does the offer end?', time: '09:12', unread: 1, label: '' },
  { id: 4, name: 'Karan Patel', phone: '+91 95004 44567', last: 'Please send catalogue', time: 'Yesterday', unread: 0, label: '' },
  { id: 5, name: 'Sneha Gupta', phone: '+91 94005 55678', last: 'Got it, thanks!', time: 'Yesterday', unread: 0, label: 'billing' },
];
const MSGS = {
  1: [{ id: 1, dir: 'IN', body: 'Hi! I placed an order yesterday. Is it shipped?', time: '10:28' }, { id: 2, dir: 'OUT', body: 'Hello Priya! Let me check that for you right away.', time: '10:30', sender: 'You' }, { id: 3, dir: 'IN', body: 'Order ID is #CFP-7821.', time: '10:31' }, { id: 4, dir: 'IN', body: 'Is my order shipped?', time: '10:32' }],
  2: [{ id: 1, dir: 'OUT', body: 'Hi Rahul! Your invoice is attached.', time: '09:50', sender: 'You' }, { id: 2, dir: 'IN', body: 'Thanks! Got the invoice.', time: '09:58' }],
  3: [{ id: 1, dir: 'IN', body: 'Hi, I wanted to ask about your Diwali offer.', time: '09:10' }, { id: 2, dir: 'OUT', body: 'Our Diwali Sale runs till Oct 31 — 30% off all plans!', time: '09:11', sender: 'AI' }, { id: 3, dir: 'IN', body: 'When does the offer end?', time: '09:12' }],
};

// `searchPlaceholder` + `onSearch` make the header search belong to the page
// it is on. Without them it keeps its original behaviour — jump to Contacts
// with the query prefilled — which is right for pages that have nothing of
// their own to search.
// Opens the nav drawer on mobile. An event rather than a prop because
// DashHeader is rendered by twenty different views, none of which should have
// to know the shell has a drawer — the same reason `app:nav` is an event.
export const openMobileNav = () => window.dispatchEvent(new CustomEvent('app:toggle-nav'));

const DashHeader = ({ title, subtitle, searchPlaceholder, onSearch, searchKey }) => {
  const mobile = useIsMobile();
  return (
    <div style={{ height: '58px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: mobile ? '0 14px' : '0 28px', gap: mobile ? '10px' : '16px', flexShrink: 0, background: 'var(--surf)' }}>
      {mobile && (
        <button onClick={openMobileNav} aria-label="Open navigation"
          style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 9, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t1)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 800, fontSize: '16px', color: 'var(--t1)', letterSpacing: '-.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h1>
        {/* The subtitle is the first thing to go: on a 360px screen it wraps
            the header to two lines and pushes the actions off the edge. */}
        {subtitle && !mobile && <p style={{ fontSize: '11.5px', color: 'var(--t2)', marginTop: '1px' }}>{subtitle}</p>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        {!mobile && <HeaderSearch key={searchKey} placeholder={searchPlaceholder} onSearch={onSearch} />}
        <NotificationsBell />
        <ProfileMenu />
      </div>
    </div>
  );
};

// The header search. When the page supplies `onSearch` it filters that page as
// you type; otherwise Enter jumps to Contacts with the query prefilled, which
// is what it always did.
//
// It used to say "Search contacts…" and navigate to Contacts on every page —
// so on Templates and Campaigns it was both mislabelled and pointed somewhere
// else entirely.
const HeaderSearch = ({ placeholder, onSearch }) => {
  const [q, setQ] = useState('');
  const local = typeof onSearch === 'function';
  const label = placeholder || 'Search contacts…';

  const change = (value) => {
    setQ(value);
    if (local) onSearch(value);
  };
  const go = () => {
    const query = q.trim();
    if (local) { onSearch(query); return; }
    window.dispatchEvent(new CustomEvent('app:nav', { detail: 'contacts' }));
    window.dispatchEvent(new CustomEvent('app:search', { detail: query }));
    setQ('');
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '7px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', width: '200px' }}>
      <I n="search" s={13} c="var(--t2)" />
      <input value={q} onChange={e => change(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && q.trim()) go(); }}
        placeholder={label}
        aria-label={label.replace('…', '')}
        style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--t1)', fontSize: '13px', fontFamily: "'Manrope',sans-serif", minWidth: 0 }} />
      {q && (
        <button onClick={() => change('')} aria-label="Clear search"
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', color: 'var(--t2)' }}>
          <I n="x" s={11} c="var(--t2)" />
        </button>
      )}
    </div>
  );
};

// Icon per notification type, so the feed is scannable without reading it.
const NOTIF_ICONS = {
  WORKSPACE_INVITE: 'users',
  WORKSPACE_INVITE_SENT: 'mail',
  CAMPAIGN_LAUNCHED: 'send',
  CAMPAIGN_COMPLETED: 'checkc',
  CAMPAIGN_FAILED: 'alertt',
  CAMPAIGN_RETRY_SCHEDULED: 'clock',
  CAMPAIGN_RETRY_SUCCESS: 'refresh',
  TEMPLATE_APPROVED: 'checkc',
  TEMPLATE_REJECTED: 'alertt',
  WALLET_RECHARGE: 'credit',
  OPT_OUT: 'shield',
};

const relativeTime = (iso) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

// Server-backed notifications with real read state. The old version derived
// its list from templates/campaigns on every poll, which meant the badge
// could never be cleared — reopening the popover just recomputed the same
// items. Opening it now marks everything read on the server, so the count
// resets and stays reset.
const NotificationsBell = () => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const ref = useRef(null);

  const load = async () => {
    try {
      const res = await apiFetch('/api/v1/notifications');
      if (!res.ok) return;
      const data = await res.json();
      setItems(Array.isArray(data.data) ? data.data : []);
      setUnread(Number(data.unread) || 0);
    } catch { /* offline — keep whatever is on screen */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 30000);
    // Anything that creates a notification (launching a campaign, sending an
    // invite, a recharge) fires this so the bell updates without waiting for
    // the next poll.
    const onRefresh = () => load();
    window.addEventListener('notifications:refresh', onRefresh);
    return () => { clearInterval(iv); window.removeEventListener('notifications:refresh', onRefresh); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next) return;

    await load();
    if (unread === 0) return;
    // Optimistic: the badge clears the moment the list is opened, then the
    // server is told. A failed call is re-synced by the next poll.
    setUnread(0);
    setItems(prev => prev.map(n => ({ ...n, read: true })));
    apiFetch('/api/v1/notifications/read-all', { method: 'POST' }).catch(() => load());
  };

  const openTarget = (n) => {
    setOpen(false);
    if (n.link) window.dispatchEvent(new CustomEvent('app:nav', { detail: n.link }));
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={toggle} aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-expanded={open} aria-haspopup="true"
        style={{ position: 'relative', width: '34px', height: '34px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
        <I n="bell" s={15} c="var(--t2)" />
        {unread > 0 && (
          <div style={{ position: 'absolute', top: -5, right: -5, minWidth: 17, height: 17, padding: '0 4px', borderRadius: 9, background: 'var(--green)', border: '1.5px solid var(--surf-solid)', color: '#08090c', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {unread > 9 ? '9+' : unread}
          </div>
        )}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 330, maxHeight: 420, background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 12, boxShadow: '0 16px 40px rgba(0,0,0,0.45)', zIndex: 200, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--bd)', fontSize: 12, fontWeight: 700, color: 'var(--t1)', flexShrink: 0 }}>Notifications</div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading ? (
              <div style={{ padding: '20px 16px', fontSize: 12, color: 'var(--t3)', textAlign: 'center' }}>Loading…</div>
            ) : items.length === 0 ? (
              <div style={{ padding: '24px 16px', fontSize: 12, color: 'var(--t3)', textAlign: 'center' }}>You're all caught up.</div>
            ) : items.map(n => (
              <div key={n.id} onClick={() => openTarget(n)}
                style={{ padding: '11px 16px', borderBottom: '1px solid var(--bd)', display: 'flex', gap: 10, alignItems: 'flex-start', cursor: n.link ? 'pointer' : 'default', background: n.read ? 'transparent' : 'rgba(53,232,242,0.05)', transition: 'background .12s' }}
                onMouseEnter={e => { if (n.link) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = n.read ? 'transparent' : 'rgba(53,232,242,0.05)'; }}>
                <div style={{ marginTop: 2, flexShrink: 0 }}>
                  <I n={NOTIF_ICONS[n.type] || 'bell'} s={13} c={n.read ? 'var(--t3)' : 'var(--green)'} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t1)', lineHeight: 1.4 }}>{n.title}</p>
                  {n.body && <p style={{ fontSize: 11.5, color: 'var(--t2)', lineHeight: 1.45, marginTop: 2 }}>{n.body}</p>}
                  <p style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 3 }}>{relativeTime(n.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const niceDateLabel = () => {
  const d = new Date();
  const parts = d.toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });
  const hour = d.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return `${parts} — ${greet}!`;
};

const slugify = (value) => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 60);

const createTemplatePayload = (prompt, body) => {
  const slug = slugify(prompt) || `ai_template_${Date.now()}`;
  return {
    name: `${slug}_${Date.now()}`.slice(0, 64),
    category: 'MARKETING',
    language: 'en',
    components: [{ type: 'BODY', text: body.trim() || prompt.trim() }],
  };
};

const inr = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Wallet & spend at a glance (spec Part 5). Refreshes on the same
// wallet:balance-updated event the sidebar listens to, so a recharge or a
// campaign deduction shows here immediately.
const WalletSummaryCards = () => {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => wFetch('/wallet/summary')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d) setSummary(d); })
      .catch(() => {});
    load();
    const onUpdated = () => load();
    window.addEventListener('wallet:balance-updated', onUpdated);
    return () => { alive = false; window.removeEventListener('wallet:balance-updated', onUpdated); };
  }, []);

  if (!summary) return null;

  const tiles = [
    { label: 'Wallet Balance',   value: inr(summary.balance), accent: summary.balance <= 0 ? '#f87171' : 'var(--green)' },
    { label: "Today's Spend",    value: inr(summary.todaySpend) },
    { label: 'Campaign Spend',   value: inr(summary.campaignSpend) },
    { label: 'Total Campaigns',  value: (summary.totalCampaigns || 0).toLocaleString() },
    { label: 'Avg / Campaign',   value: inr(summary.averageCostPerCampaign) },
    {
      label: 'Last Recharge',
      value: summary.lastRecharge ? inr(summary.lastRecharge.amount) : '—',
      sub: summary.lastRecharge ? new Date(summary.lastRecharge.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No recharges yet',
    },
  ];

  return (
    // 132px rather than 150px is what turns this into the design set's 2×N
    // phone grid: at 150px a 360px screen has room for one column and the
    // tiles stack into a six-deep list.
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 12 }}>
      {tiles.map(t => (
        <div key={t.label} style={{ ...card, padding: '14px 16px' }}>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 9.5, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 8 }}>{t.label}</p>
          <p style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 20, color: t.accent || 'var(--t1)', letterSpacing: '-.02em' }}>{t.value}</p>
          {t.sub && <p style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 3 }}>{t.sub}</p>}
        </div>
      ))}
    </div>
  );
};

// ─── command centre ──────────────────────────────────────────────────────────
//
// The design set's phone home screen opens on one thing to do next rather than
// on a wall of metrics, and it is just as true on a laptop: a workspace with a
// draft sitting unlaunched does not need another chart, it needs the launch
// button. The suggestion is derived from real state — a draft, a scheduled
// send, an unconnected number — never invented.
//
// Dismissal is per-session on purpose. "Later" means later today, not forever;
// a suggestion that can be permanently silenced from a card is a suggestion
// nobody ever sees twice.
const NEXT_ACTION_DISMISS_KEY = 'cfp:nextAction:dismissed';

const NextBestAction = ({ onGo }) => {
  const [action, setAction] = useState(null);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(NEXT_ACTION_DISMISS_KEY) === '1');

  useEffect(() => {
    let alive = true;
    Promise.all([
      wFetch('/campaigns').then(r => (r.ok ? r.json() : [])).catch(() => []),
      wFetch('/whatsapp/numbers').then(r => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([campaigns, numbers]) => {
      if (!alive) return;
      const list = Array.isArray(campaigns) ? campaigns : (campaigns?.data || []);
      const hasNumber = Array.isArray(numbers) && numbers.length > 0;

      if (!hasNumber) {
        setAction({
          kind: 'Connect a number',
          title: 'Connect your WhatsApp number to start sending.',
          detail: 'Everything else is ready — campaigns need a verified number.',
          cta: 'Connect', section: 'setup',
        });
        return;
      }
      const draft = list.find(c => c.status === 'DRAFT');
      if (draft) {
        setAction({
          kind: 'Ready to launch',
          title: `“${draft.name}” is still a draft.`,
          detail: 'Finish the last steps and send it.',
          cta: 'Open', section: 'campaigns', draftId: draft.id,
        });
        return;
      }
      const scheduled = list.find(c => c.status === 'SCHEDULED');
      if (scheduled) {
        setAction({
          kind: 'Scheduled',
          title: `“${scheduled.name}” goes out ${fmtDate(scheduled.scheduledAt)}.`,
          detail: 'Review the audience and message before it sends.',
          cta: 'Review', section: 'campaigns',
        });
        return;
      }
      if (list.length === 0) {
        setAction({
          kind: 'Get started',
          title: 'Send your first campaign.',
          detail: 'Pick a template, choose an audience, and go.',
          cta: 'Create', section: 'campaigns-create',
        });
      }
    });
    return () => { alive = false; };
  }, []);

  if (!action || dismissed) return null;

  const later = () => { sessionStorage.setItem(NEXT_ACTION_DISMISS_KEY, '1'); setDismissed(true); };

  return (
    <div style={{ borderRadius: 'var(--rl)', border: '1px solid var(--gbd)', background: 'linear-gradient(135deg, rgba(53,232,242,0.10), rgba(157,107,255,0.06))', padding: '16px 18px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '.14em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 7 }}>
          <I n="zap" s={12} c="var(--accent)" /> Next best action · {action.kind}
        </div>
        <p style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 15.5, color: 'var(--t1)', lineHeight: 1.3, letterSpacing: '-.02em' }}>{action.title}</p>
        <p style={{ fontSize: 12.5, color: 'var(--t2)', marginTop: 4 }}>{action.detail}</p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <Btn size="sm" onClick={() => onGo(action)}>{action.cta}</Btn>
        <Btn size="sm" variant="ghost" onClick={later}>Later</Btn>
      </div>
    </div>
  );
};

// The other half of the phone home screen: who is talking to you right now.
// Open conversations, most recent first, tapping through to the inbox.
const LiveConversations = () => {
  const [convs, setConvs] = useState(null);

  useEffect(() => {
    let alive = true;
    wFetch('/conversations')
      .then(r => (r.ok ? r.json() : []))
      .then(d => { if (alive) setConvs(Array.isArray(d) ? d : (d?.data || [])); })
      .catch(() => { if (alive) setConvs([]); });
    return () => { alive = false; };
  }, []);

  if (!convs || convs.length === 0) return null;
  const top = convs.slice(0, 4);

  return (
    <div style={{ ...card, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', flexShrink: 0 }} />
        <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--t1)' }}>Live conversations</span>
        <button onClick={() => window.dispatchEvent(new CustomEvent('app:nav', { detail: 'inbox' }))}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--accent)', fontFamily: "'Manrope',sans-serif" }}>
          Open inbox
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {top.map(c => (
          <button key={c.id} onClick={() => window.dispatchEvent(new CustomEvent('app:nav', { detail: 'inbox' }))}
            style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', background: 'none', border: 'none', borderBottom: '1px solid var(--bd)', cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: "'Manrope',sans-serif" }}>
            <Avatar name={c.contact?.name || c.contact?.phoneNumber || '?'} size={30} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.contact?.name || c.contact?.phoneNumber || 'Unknown'}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--t2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.messages?.[0]?.body || c.contact?.phoneNumber || '—'}
              </div>
            </div>
            {c.unreadCount > 0 && (
              <span style={{ flexShrink: 0, padding: '1px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: 'var(--green)', color: '#08090c' }}>{c.unreadCount}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

// Legal & Policies inside the app. Same documents as the public /legal pages,
// rendered in the dashboard shell so they are reachable from the sidebar like
// any other section. The chosen document rides in ?tab= — the convention the
// rest of the dashboard already uses for deep-linking a sub-tab — so a
// specific policy stays linkable from inside the app too.
const LegalView = ({ initialTab }) => {
  const [active, setActive] = useState(() => (LEGAL_DOCS[initialTab] ? initialTab : 'terms'));
  // Same reconciliation trap as AutomationView: the route can change while
  // React keeps this instance mounted, so a lazy useState initialiser only ever
  // runs for the first route that rendered it. Following the prop is what
  // actually moves the panel.
  useEffect(() => {
    if (LEGAL_DOCS[initialTab]) setActive(initialTab);
  }, [initialTab]);


  const select = (key) => {
    setActive(key);
    // Keep the address bar honest without a remount: this is the same section,
    // only a different document.
    const url = key === 'terms' ? '/dashboard/legal' : `/dashboard/legal?tab=${key}`;
    window.history.replaceState({}, '', url);
  };

  return (
    <div data-legal-scroll style={{ flex: 1, overflowY: 'auto' }}>
      <DashHeader title="Legal & Policies" subtitle="Terms, privacy, refunds and cookies" />
      <div style={{ padding: '24px 28px' }}>
        <LegalCenter active={active} onSelect={select} compact />
      </div>
    </div>
  );
};

const HomeView = () => {
  const [prompt, setPrompt] = useState('');
  const [guided, setGuided] = useState(true);
  const [number, setNumber] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiResponse, setAiResponse] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiCard, setAiCard] = useState(null);
  const [showLoginModal, setShowLoginModal] = useState(false);

  useEffect(() => {
    wFetch('/whatsapp/numbers')
      .then(r => r.ok && r.json())
      .then(nums => { if (Array.isArray(nums) && nums[0]) setNumber(nums[0]); })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  const handleSend = async () => {
    if (!prompt.trim() || aiLoading) return;

    const token = localStorage.getItem('accessToken');
    if (!token) {
      setShowLoginModal(true);
      return;
    }

    setAiLoading(true);
    setAiError(null);
    setAiResponse(null);
    setAiCard(null);

    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      
      const res = await fetch('/api/v1/onboarding/chat', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ message: prompt, workspaceId: user.workspaceId, guided }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.content || `Request failed (${res.status})`);
      
      setAiResponse(data.content || prompt);
      if (data.card) {
        setAiCard(data.card);
        window.dispatchEvent(new CustomEvent('app:data-updated', { detail: { templates: true, campaigns: true } }));
      }
      setPrompt('');
    } catch (err) {
      setAiError(err.message || 'Unable to send request');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <DashHeader title="Dashboard" subtitle={niceDateLabel()} />
      <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {loading && (
          <div style={{ textAlign:'center', padding:'40px 0', color:'var(--t2)', fontSize:13 }}>
            <div style={{ width:24, height:24, border:'2px solid var(--green)', borderTopColor:'transparent', borderRadius:'50%', margin:'0 auto 10px', animation:'spin 1s linear infinite' }} />
            Loading dashboard…
          </div>
        )}

        {showLoginModal && (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)' }}>
            <div className="modal-card" style={{ background:'#070B14', border:'1px solid rgba(255,255,255,0.08)', width: 400, borderRadius: 12, padding: 24, display:'flex', flexDirection:'column', alignItems:'center', boxShadow:'0 24px 64px rgba(0,0,0,0.5)' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: '24px' }}>🔒</div>
              </div>
              <h3 style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 18, color:'#eef0f3', marginBottom: 8, margin: 0 }}>Login Required</h3>
              <p style={{ fontSize: 14, color:'rgba(255,255,255,0.6)', textAlign:'center', marginBottom: 24, lineHeight: 1.5 }}>
                You need to be logged in to use the AI Agent. Please sign in to your account to continue.
              </p>
              <div style={{ display: 'flex', gap: 12, width: '100%' }}>
                <button onClick={() => setShowLoginModal(false)} style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}>Cancel</button>
                <button onClick={() => { window.dispatchEvent(new CustomEvent('app:nav', { detail: 'login' })); }} style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'var(--grad-cta)', color: 'var(--ink)', border: 'none', cursor: 'pointer', fontWeight: 700 }}>Log in</button>
              </div>
            </div>
          </div>
        )}

        {!loading && (
        <>
        <NextBestAction onGo={(a) => {
          // A draft opens straight into its own editor rather than the list —
          // the whole point of the card is to remove the next click.
          if (a.draftId) {
            window.history.pushState({}, '', `/dashboard/campaigns/create?draft=${encodeURIComponent(a.draftId)}`);
            window.dispatchEvent(new PopStateEvent('popstate'));
            return;
          }
          window.dispatchEvent(new CustomEvent('app:nav', { detail: a.section }));
        }} />

        <div style={{ borderRadius: 'var(--rl)', background: 'linear-gradient(135deg,rgba(53,232,242,0.1),rgba(14,165,233,0.06))', border: '1px solid var(--gbd)', padding: '16px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '9px', background: 'var(--gbg)', border: '1px solid var(--gbd)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <I n="spark" s={18} c="var(--green)" />
            </div>
            <div>
              <p style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: '14px', color: 'var(--t1)', marginBottom: '2px' }}>Unlock AI Smart Replies &amp; A/B Testing</p>
              <p style={{ fontSize: '12px', color: 'var(--t2)' }}>Upgrade to Growth plan for advanced features.</p>
            </div>
          </div>
          <Btn size="sm" style={{ flexShrink: 0 }} onClick={() => window.dispatchEvent(new CustomEvent('app:nav', { detail: 'payments' }))}>Upgrade Plan</Btn>
        </div>

        <WalletStatusBanner hideWhenHealthy style={{ marginBottom: 16 }} />

        <WalletSummaryCards />

        <div style={{ width: '100%', background: 'rgba(0, 0, 0, 0.4)', borderRadius: '12px', border: '1px solid rgba(53,232,242, 0.4)', boxShadow: '0 0 30px rgba(53,232,242, 0.15), inset 0 0 20px rgba(53,232,242, 0.05)', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', transition: 'all 0.3s ease', marginBottom: '16px' }}>
          <div style={{ padding: '24px 24px 12px' }}>
            <h3 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: '18px', color: '#fff', marginBottom: '8px' }}>Create your Free WhatsApp AI Assistant</h3>
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>Describe your business flow or campaign parameters below to automatically build and register templates.</p>
          </div>
          <textarea 
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe your ideal WhatsApp campaign or onboarding flow..."
            style={{ width: '100%', height: '120px', background: 'transparent', border: 'none', padding: '0 24px 24px', color: '#fff', fontSize: '15px', resize: 'none', outline: 'none', fontFamily: 'inherit' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', padding: '0 24px 16px' }}>
            {[
              'Create a template for an abandoned cart',
              'Delete a template',
              'Create a campaign for Diwali sale',
              'Delete a campaign'
            ].map(s => (
              <button
                key={s}
                onClick={() => setPrompt(s)}
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '10px 14px', color: '#fff', fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'left' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(53,232,242, 0.1)'; e.currentTarget.style.borderColor = 'rgba(53,232,242, 0.3)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
              >
                {s}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 24px 24px', background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#35e8f2', fontWeight: 600 }}>
              <input type="checkbox" checked={guided} onChange={(e) => setGuided(e.target.checked)} style={{ accentColor: '#35e8f2', width: '15px', height: '15px', cursor: 'pointer' }} />
              Guided Flow
            </label>
            <button 
              onClick={handleSend}
              disabled={aiLoading || !prompt.trim()}
              style={{ background: aiLoading || !prompt.trim() ? 'rgba(53,232,242,0.22)' : 'var(--grad-cta)', color: aiLoading || !prompt.trim() ? 'var(--t3)' : 'var(--ink)', border: 'none', borderRadius: '9px', padding: '9px 20px', fontSize: '13px', fontWeight: 700, cursor: aiLoading || !prompt.trim() ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', transition: 'transform 0.1s' }}
              onMouseDown={e => { if (!aiLoading && prompt.trim()) e.currentTarget.style.transform = 'scale(0.96)'; }}
              onMouseUp={e => { if (!aiLoading && prompt.trim()) e.currentTarget.style.transform = 'scale(1)'; }}
            >
              {aiLoading ? 'Sending…' : 'Send'}
            </button>
          </div>
          {aiResponse && (
            <div style={{ padding: '16px 24px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: '#fff', lineHeight: 1.6, fontSize: '13px' }}>
              <strong style={{ display: 'block', marginBottom: '8px', color: 'var(--accent)' }}>AI response:</strong>
              <div>{aiResponse}</div>
              {aiCard && (
                  <div style={{
                    marginTop: '10px',
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid rgba(53,232,242,0.3)',
                    borderRadius: '8px',
                    padding: '12px',
                  }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: '#35e8f2', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {aiCard.icon || '✅'} {aiCard.title}
                    </div>
                    {aiCard.details && Object.entries(aiCard.details).map(([k, v]) => (
                      <div key={k} style={{ fontSize: '11px', marginBottom: '4px' }}>
                        <span style={{ color: 'var(--t2)', textTransform: 'capitalize' }}>{k}:</span>{' '}
                        <span style={{ color: '#eef0f3' }}>{typeof v === 'object' ? JSON.stringify(v) : v}</span>
                      </div>
                    ))}
                    {aiCard.preview && (
                       <div style={{ marginTop: '8px', background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '4px', fontSize: '11px', fontStyle: 'italic', borderLeft: '2px solid #35e8f2' }}>
                         {aiCard.preview}
                       </div>
                    )}
                  </div>
              )}
            </div>
          )}
          {aiError && (
            <div style={{ padding: '16px 24px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: '10px', color: '#f8c6c6', lineHeight: 1.6, fontSize: '13px' }}>
              <strong style={{ display: 'block', marginBottom: '8px' }}>Error:</strong>
              <div>{aiError}</div>
            </div>
          )}
        </div>

        <LiveConversations />

        {/* auto-fit rather than a hard 1fr 1fr: the two channel cards sit side
            by side on a laptop and stack on a phone without a second grid. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
          <div style={{ ...card, padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', rowGap: 10 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.1em' }}>WhatsApp Number</span>
              {number ? <StatusBadge s={number.status === 'ACTIVE' ? 'Approved' : (number.status ?? 'Pending')} /> : (
                <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.25)', color: '#fbbf24' }}>Not connected</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '11px', background: number ? 'var(--gbg)' : 'rgba(255,255,255,0.04)', border: `1px solid ${number ? 'var(--gbd)' : 'var(--bd)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1, opacity: number ? 1 : .55 }}>{'\u{1F4F1}'}</span>
              </div>
              <div>
                <p style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: '15px', color: 'var(--t1)', marginBottom: '2px' }}>{number?.phoneNumber ?? 'No number connected'}</p>
                <p style={{ fontSize: '12px', color: 'var(--t2)' }}>
                  {number
                    ? `Quality: ${number.quality ?? 'Unknown'}${number.displayName ? ' · ' + number.displayName : ''}`
                    : 'Go to Number Setup to connect.'}
                </p>
              </div>
            </div>
          </div>
          <div style={{ ...card, padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', rowGap: 10 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Instagram</span>
              <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t2)' }}>Coming Soon</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '11px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1, opacity: .55 }}>{'\u{1F4F7}'}</span>
              </div>
              <div>
                <p style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: '15px', color: 'var(--t1)', marginBottom: '2px' }}>Connect Account</p>
                <p style={{ fontSize: '12px', color: 'var(--t2)' }}>Link your Instagram business account</p>
              </div>
            </div>
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
};

const fmtDate = (d) => d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

// How long until a scheduled retry fires — "2h", "2h 30m", "45m". Mirrors
// formatRetryEta() on the server so the bell and the report read the same.
const fmtEta = (iso) => {
  if (!iso) return null;
  const raw = new Date(iso).getTime() - Date.now();
  if (raw <= 0) return 'any moment now';
  // Rounded to whole minutes before splitting, so a 1h wait never reads "60m".
  const mins = Math.round(raw / 60000);
  if (mins < 1) return 'less than a minute';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
};

// The retry line under a recipient: what attempt they are on and when the next
// one runs, or — once it is over — whether retrying is what got them delivered.
const retryNote = (r, maxAttempts) => {
  const count = r.retryCount || 0;
  if (r.status === 'RETRYING') {
    const eta = fmtEta(r.nextRetryAt);
    const attempt = count + 1;
    return {
      color: '#c4ff46',
      text: `Attempt ${attempt}${maxAttempts ? ` of ${maxAttempts}` : ''}${eta ? ` · retrying in ${eta}` : ' · retrying shortly'}${r.lastFailureReason ? ` · ${r.lastFailureReason}` : ''}`,
    };
  }
  if (!count) return null;
  if (['DELIVERED', 'READ', 'SENT'].includes(r.status)) {
    return { color: 'var(--green)', text: `Recovered — delivered on retry attempt ${count}` };
  }
  if (r.status === 'FAILED') {
    return { color: '#f87171', text: `Failed after ${count} retr${count === 1 ? 'y' : 'ies'}` };
  }
  return null;
};

// Detail modal — surfaces the campaign's full timeline (created / scheduled /
// launched / completed), live counters and recipient list, plus a Cancel
// action for draft/scheduled/running campaigns.
const CampaignDetailModal = ({ campaignId, onClose, onChanged, onEdit }) => {
  const [c, setC] = useState(null);
  const [err, setErr] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  const load = async () => {
    try {
      const res = await wFetch(`/campaigns/${campaignId}`);
      const data = await res.json();
      if (!res.ok) { setErr(data.error || `Error ${res.status}`); return; }
      setC(data);
    } catch (e) { setErr(e.message); }
  };

  useEffect(() => { load(); const iv = setInterval(load, 8000); return () => clearInterval(iv); }, [campaignId]); // eslint-disable-line

  // The retry countdowns are rendered from nextRetryAt against the clock, so
  // they need a re-render of their own — otherwise a modal left open on a
  // failed poll would keep showing a stale "retrying in 2h".
  const [, setTick] = useState(0);
  useEffect(() => { const iv = setInterval(() => setTick(t => t + 1), 30000); return () => clearInterval(iv); }, []);

  const cancel = async () => {
    if (!window.confirm('Cancel this campaign? Pending messages will not be sent.')) return;
    setCancelling(true);
    try {
      const res = await wFetch(`/campaigns/${campaignId}/cancel`, { method: 'PATCH' });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Cancel failed'); return; }
      await load();
      onChanged?.();
    } catch (e) { setErr(e.message); }
    finally { setCancelling(false); }
  };

  // Members can cancel too — they can create and launch campaigns, so being
  // unable to stop one would be worse than not starting it.
  const cancellable = c && ['DRAFT', 'SCHEDULED', 'RUNNING'].includes(c.status);
  // A draft is unfinished work, so it gets a way back into the wizard. Only a
  // draft: anything launched is a report, and "editing" it would imply changes
  // reaching messages that have already gone out.
  const editable = c?.status === 'DRAFT';

  const modalRef = useRef(null);
  useFocusTrap(modalRef, true);

  return (
    <div onClick={onClose} onKeyDown={e => { if (e.key === 'Escape') onClose(); }} role="dialog" aria-modal="true" aria-label={c?.name || 'Campaign Detail'} style={{ position:'fixed', inset:0, background:'rgba(3,5,12,0.78)', backdropFilter:'blur(4px)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div ref={modalRef} onClick={e => e.stopPropagation()} style={{ ...card, width:'100%', maxWidth:640, maxHeight:'86vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'16px 22px', borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <p style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:16, color:'var(--t1)' }}>{c?.name || 'Campaign'}</p>
            {c && <div style={{ marginTop:5 }}><StatusBadge s={c.status} /></div>}
          </div>
          <button onClick={onClose} style={{ width:28, height:28, borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="x" s={12} c="var(--t2)" />
          </button>
        </div>

        <div style={{ padding:22, overflowY:'auto', flex:1, display:'flex', flexDirection:'column', gap:16 }}>
          {err && <div style={{ padding:'10px 14px', borderRadius:8, background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.25)', color:'#f87171', fontSize:12 }}>{err}</div>}
          {!c && !err && <div style={{ textAlign:'center', padding:'32px', color:'var(--t2)', fontSize:13 }}>Loading…</div>}
          {c && (
            <>
              {/* Total / Sent / Delivered / Read / Failed / Retries / Skipped —
                  the full report. Failed is only ever the permanent kind: a
                  message still owed an attempt counts under Retrying, not
                  Failed. Skipped counts numbers that opted out: they were
                  never sent to and never charged for. */}
              <div className="rgrid-3" style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
                {[
                  ['Total Contacts', c.report?.totalContacts ?? c.totalContacts, 'var(--t1)'],
                  ['Sent',           c.report?.sent ?? c.sent,                   'var(--t1)'],
                  ['Delivered',      c.report?.delivered ?? c.delivered,         'var(--t1)'],
                  ['Read',           c.report?.read ?? c.read,                   'var(--t1)'],
                  ['Failed',         c.report?.failed ?? c.failed,               '#f87171'],
                  ['Retries',        c.report?.retried ?? 0,                     '#c4ff46'],
                  ['Retrying Now',   c.report?.retrying ?? 0,                    '#c4ff46'],
                  ['Skipped (Opted Out)', c.report?.skipped ?? c.skipped,        '#fbbf24'],
                ].map(([k, v, danger]) => (
                  <div key={k} style={{ padding:'12px 14px', borderRadius:10, background:'rgba(255,255,255,0.02)', border:'1px solid var(--bd)' }}>
                    <p style={{ fontSize:10, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4 }}>{k}</p>
                    <p style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:800, fontSize:18, color: (v ?? 0) > 0 ? danger : 'var(--t1)' }}>{(v ?? 0).toLocaleString()}</p>
                  </div>
                ))}
              </div>

              {/* The retry engine, in the one place a campaign's owner looks
                  after a send goes wrong: how many messages are still owed an
                  attempt, when the next one runs, and how many earlier
                  failures retrying has already recovered. */}
              {(c.report?.retrying > 0 || c.report?.retried > 0) && (
                <div style={{ padding:'13px 16px', borderRadius:10, background:'rgba(168,85,247,.07)', border:'1px solid rgba(168,85,247,.28)', display:'flex', flexDirection:'column', gap:6 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <I n="refresh" s={13} c="#c4ff46" />
                    <span style={{ fontSize:12.5, fontWeight:700, color:'#c4ff46' }}>
                      {c.report.retrying > 0
                        ? `${c.report.retrying} message${c.report.retrying === 1 ? '' : 's'} waiting to be retried`
                        : 'Retries finished'}
                    </span>
                  </div>
                  <p style={{ fontSize:11.5, color:'var(--t2)', lineHeight:1.55 }}>
                    {c.report.retrying > 0 && c.report.nextRetryAt && (
                      <>Next attempt in <strong style={{ color:'var(--t1)' }}>{fmtEta(c.report.nextRetryAt)}</strong> ({fmtDate(c.report.nextRetryAt)}). </>
                    )}
                    {c.report.retrySucceeded > 0
                      ? `${c.report.retrySucceeded} of ${c.report.retried} retried message${c.report.retried === 1 ? '' : 's'} have been delivered so far.`
                      : `${c.report.retried} message${c.report.retried === 1 ? ' has' : 's have'} needed a retry (${c.report.retryAttempts ?? 0} attempt${(c.report.retryAttempts ?? 0) === 1 ? '' : 's'} in total).`}
                  </p>
                </div>
              )}

              {c.totalCost != null && (
                <div className="rgrid-4" style={{ padding:'14px 16px', borderRadius:10, background:'rgba(53,232,242,0.05)', border:'1px solid var(--gbd)', display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'10px 16px' }}>
                  {[
                    ['Cost / message', `₹${Number(c.costPerMessage ?? 0).toFixed(2)}`],
                    ['Campaign cost',  `₹${Number(c.totalCost ?? 0).toFixed(2)}`],
                    ['Wallet before',  c.walletBefore == null ? '—' : `₹${Number(c.walletBefore).toFixed(2)}`],
                    ['Wallet after',   c.walletAfter  == null ? '—' : `₹${Number(c.walletAfter).toFixed(2)}`],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <p style={{ fontSize:10, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:3 }}>{k}</p>
                      <p style={{ fontSize:13, fontWeight:700, color:'var(--t1)' }}>{v}</p>
                    </div>
                  ))}
                  {Number(c.refundAmount ?? 0) > 0 && (
                    <p style={{ gridColumn:'1 / -1', fontSize:11.5, color:'var(--green)' }}>
                      ₹{Number(c.refundAmount).toFixed(2)} was refunded to your wallet for messages that were never sent.
                    </p>
                  )}
                </div>
              )}

              <div className="rgrid-2" style={{ padding:'14px 16px', borderRadius:10, background:'rgba(255,255,255,0.02)', border:'1px solid var(--bd)', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 20px' }}>
                {[
                  ['Created',        fmtDate(c.createdAt)],
                  ['Scheduled for',  fmtDate(c.scheduledAt)],
                  ['Launched at',    fmtDate(c.launchedAt)],
                  ['Completed at',   fmtDate(c.completedAt)],
                  ['Template',       c.template?.name || '—'],
                  ['Send-from',      c.waNumber ? `${c.waNumber.phoneNumber}${c.waNumber.displayName ? ' · ' + c.waNumber.displayName : ''}` : '—'],
                  ['Recipients',     (c.totalContacts ?? 0).toLocaleString()],
                  ['AI Agent',       c.aiAgentEnabled ? `On · CTA “${c.aiAgentCtaLabel || 'Ask Anything'}”` : 'Off'],
                  ['Auto-Retry',     c.retryPolicy?.enabled
                    ? `On · ${c.retryPolicy.pattern === 'hourly' ? 'Hourly' : 'Smart'} · up to ${c.retryPolicy.maxAttempts} attempts`
                    : 'Off — failures are not retried'],
                  ['No-Retry Window', c.retryPolicy?.enabled && c.retryPolicy.noRetryWindow
                    ? `${c.retryPolicy.noRetryWindow.start} – ${c.retryPolicy.noRetryWindow.end}`
                    : '—'],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p style={{ fontSize:10, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:3 }}>{k}</p>
                    <p style={{ fontSize:13, color:'var(--t1)' }}>{v}</p>
                  </div>
                ))}
              </div>

              {/* Meta only renders buttons it approved with the template, so an
                  agent-enabled campaign on a button-less template can only be
                  reached by typing the CTA. The server works that out; this is
                  where the campaign's owner finds out. */}
              {Array.isArray(c.aiAgentWarnings) && c.aiAgentWarnings.map((warning, i) => (
                <div key={i} style={{ padding:'11px 14px', borderRadius:8, background:'rgba(245,158,11,.06)', border:'1px solid rgba(245,158,11,.25)', fontSize:12, color:'#fbbf24', lineHeight:1.55 }}>
                  {warning}
                </div>
              ))}

              {Array.isArray(c.recipients) && c.recipients.length > 0 && (
                <div>
                  <p style={{ fontSize:11, fontWeight:700, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:8 }}>Recipients ({c.recipients.length}{c.totalContacts > c.recipients.length ? ` of ${c.totalContacts}` : ''})</p>
                  <div style={{ maxHeight:220, overflowY:'auto', border:'1px solid var(--bd)', borderRadius:10 }}>
                    {c.recipients.map((r, i) => {
                      const note = retryNote(r, c.retryPolicy?.maxAttempts);
                      return (
                        <div key={r.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'9px 14px', borderBottom: i < c.recipients.length - 1 ? '1px solid var(--bd)' : 'none' }}>
                          <div style={{ minWidth:0 }}>
                            <p style={{ fontSize:12.5, fontWeight:600, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.contact?.name || '—'}</p>
                            <p style={{ fontSize:11, color:'var(--t3)' }}>{r.contact?.phoneNumber}{r.failReason ? ` · ${r.failReason}` : ''}</p>
                            {note && <p style={{ fontSize:11, color:note.color, marginTop:2, lineHeight:1.45 }}>{note.text}</p>}
                          </div>
                          <StatusBadge s={r.status} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ padding:'14px 22px', borderTop:'1px solid var(--bd)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:11, color:'var(--t3)' }}>
            {editable
              ? 'This campaign is a draft — nothing sends until you launch it.'
              : 'Counters update live from delivery webhooks.'}
          </span>
          <div style={{ display:'flex', gap:8 }}>
            {cancellable && (
              <Btn variant="outline" size="sm" onClick={cancel} disabled={cancelling}
                style={{ borderColor:'rgba(239,68,68,.35)', color:'#f87171' }}>
                {cancelling ? 'Cancelling…' : 'Cancel Campaign'}
              </Btn>
            )}
            {editable && (
              <Btn size="sm" onClick={() => onEdit?.(campaignId)} style={{ boxShadow:'var(--glow)' }}>
                <I n="pencil" s={12} c="#08090c" />
                Edit / Continue
              </Btn>
            )}
            <Btn variant="ghost" size="sm" onClick={onClose}>Close</Btn>
          </div>
        </div>
      </div>
    </div>
  );
};

const CampaignsView = ({ onCreateCampaign, onEditCampaign }) => {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [detailId, setDetailId]   = useState(null);
  const [search, setSearch]       = useState('');

  const loadCampaigns = async () => {
    setLoading(true);
    try {
      const res = await wFetch('/campaigns');
      const data = await res.json();
      const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
      setCampaigns(list);
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCampaigns();
  }, []);

  // Matched on the fields a person would actually search by. Campaigns are
  // already loaded in full, so this filters in place rather than refetching.
  const q = search.trim().toLowerCase();
  const visibleCampaigns = q
    ? campaigns.filter(c =>
        String(c.name || '').toLowerCase().includes(q) ||
        String(c.status || '').toLowerCase().includes(q) ||
        String(c.template?.name || '').toLowerCase().includes(q))
    : campaigns;

  // Deep link from the campaign completion/failure email's "View Full
  // Report" button (?campaignId=…) — open that campaign's report directly.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('campaignId');
    if (id) setDetailId(id);
  }, []);

  useEffect(() => {
    const active = campaigns.some(c => c.status === 'RUNNING' || c.status === 'SCHEDULED');
    if (!active) return;
    const iv = setInterval(loadCampaigns, 10000);
    return () => clearInterval(iv);
  }, [campaigns]); // eslint-disable-line

  useEffect(() => {
    const onDataUpdated = (e) => {
      if (e.detail?.campaigns) loadCampaigns();
    };
    window.addEventListener('app:data-updated', onDataUpdated);
    return () => window.removeEventListener('app:data-updated', onDataUpdated);
  }, []);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <DashHeader title="Campaigns" subtitle="Manage and monitor your broadcasts"
        searchPlaceholder="Search campaigns…" onSearch={setSearch} />
      <div className="dash-page" style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        {/* Every workspace member can create a campaign — the button used to
            be admin-only, which left members on a Free plan able to import
            contacts and then do nothing with them. */}
        <WalletStatusBanner style={{ marginBottom: 16 }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
          <Btn style={{ boxShadow: 'var(--glow)' }} onClick={onCreateCampaign}><I n="send" s={14} c="#08090c" /> New Campaign</Btn>
        </div>
        {loading ? (
          <div style={{ textAlign:'center', padding:'48px', color:'var(--t2)', fontSize:13 }}>Loading campaigns…</div>
        ) : visibleCampaigns.length === 0 ? (
          <div style={{ textAlign:'center', padding:'48px', color:'var(--t2)', fontSize:13 }}>
            {q ? `No campaigns match “${search.trim()}”.` : 'No campaigns yet. Create your first campaign.'}
          </div>
        ) : (
          <div style={{ ...card, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bd)' }}>
                  {['Campaign', 'Status', 'Sent', 'Delivered', 'Read', 'Failed', 'Retries', 'Skipped', 'Cost', 'Rate', 'Date', ''].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleCampaigns.map((c, i) => {
                  const sent = c.sentCount ?? c.sent ?? 0;
                  const delivered = c.deliveredCount ?? c.delivered ?? 0;
                  const read = c.readCount ?? c.read ?? 0;
                  const rate = sent > 0 ? +((delivered / sent) * 100).toFixed(1) : 0;
                  const bestDate = c.completedAt || c.launchedAt || c.scheduledAt || c.createdAt;
                  const date = bestDate ? new Date(bestDate).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—';
                  return (
                    <tr key={c.id} style={{ borderBottom: i < campaigns.length - 1 ? '1px solid var(--bd)' : 'none', transition: 'background .12s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.015)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '14px 16px', fontSize: '14px', fontWeight: 600, color: 'var(--t1)' }}>{c.name}</td>
                      <td style={{ padding: '14px 16px' }}><StatusBadge s={c.status} /></td>
                      <td style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--t2)' }}>{sent.toLocaleString()}</td>
                      <td style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--t2)' }}>{delivered.toLocaleString()}</td>
                      <td style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--t2)' }}>{read.toLocaleString()}</td>
                      <td style={{ padding: '14px 16px', fontSize: '13px', color: (c.failed ?? 0) > 0 ? '#f87171' : 'var(--t2)' }}>{(c.failed ?? 0).toLocaleString()}</td>
                      {/* Messages that needed a retry, with the ones still
                          waiting on an attempt called out — those are not
                          failures yet, and the Failed column excludes them. */}
                      <td style={{ padding: '14px 16px', fontSize: '13px', color: (c.retried ?? 0) > 0 ? '#c4ff46' : 'var(--t2)' }}
                        title={(c.retrying ?? 0) > 0 ? `${c.retrying} still waiting on a retry` : 'Messages that needed at least one retry'}>
                        {(c.retried ?? 0).toLocaleString()}
                        {(c.retrying ?? 0) > 0 && <span style={{ fontSize: '11px', color: 'var(--t3)' }}> · {c.retrying} waiting</span>}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: '13px', color: (c.skipped ?? 0) > 0 ? '#fbbf24' : 'var(--t2)' }}>{(c.skipped ?? 0).toLocaleString()}</td>
                      <td style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--t2)' }}>{c.totalCost == null ? '—' : `₹${Number(c.totalCost).toFixed(2)}`}</td>
                      <td style={{ padding: '14px 16px' }}>
                        {rate > 0 ? <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ width: '60px', height: '4px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)' }}><div style={{ height: '100%', width: `${Math.min(rate,100)}%`, borderRadius: '4px', background: 'var(--green)' }} /></div>
                          <span style={{ fontSize: '12px', color: 'var(--green)', fontWeight: 600 }}>{rate}%</span>
                        </div> : sent > 0 ? <span style={{ fontSize: '11.5px', color: 'var(--t3)' }} title="Delivery receipts arrive via webhook">Awaiting receipts</span> : <span style={{ fontSize: '12px', color: 'var(--t2)' }}>—</span>}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--t2)' }}>{date}</td>
                      <td style={{ padding: '14px 16px' }}><Btn variant="outline" size="sm" onClick={() => setDetailId(c.id)}>View</Btn></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {detailId && (
        <CampaignDetailModal
          campaignId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={loadCampaigns}
          onEdit={(id) => { setDetailId(null); onEditCampaign?.(id); }}
        />
      )}
    </div>
  );
};

const getBodyText = (components) => {
  if (!Array.isArray(components)) return '';
  const body = components.find(c => c.type === 'BODY' || c.type === 'body');
  return body?.text ?? '';
};

const statusLabel = s => {
  if (!s) return 'Pending';
  const m = { APPROVED:'Approved', PENDING:'Pending', REJECTED:'Rejected' };
  return m[s.toUpperCase()] ?? s;
};

// ─── Utility rewrite after a Meta re-categorisation ────────────
// Meta re-reviews approved templates and often moves UTILITY to MARKETING,
// which on this workspace's rates is a ~7x price rise per message. A rewrite
// is the only route back, so this drafts one to review — the original is
// never overwritten.
const UtilityVariantModal = ({ template, onClose, onUseDraft }) => {
  // Quoted from the API so this pitch can never advertise a price the billing
  // code does not charge.
  const rates = useMessageRates();
  const [variant, setVariant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);

  useEffect(() => {
    wFetch(`/templates/${template.id}/utility-variant`, { method: 'POST' })
      .then(async r => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { setErr(d.error || 'Could not produce a rewrite'); return; }
        setVariant(d);
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [template.id]);

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(3,5,12,0.78)', backdropFilter:'blur(4px)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', width:'100%', maxWidth:600, maxHeight:'90vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--bd)', display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
          <div>
            <h3 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:17, fontWeight:800, color:'var(--t1)', marginBottom:4 }}>Utility rewrite</h3>
            <p style={{ fontSize:12.5, color:'var(--t2)' }}>
              Rewrites <code style={{ fontFamily:'monospace', color:'var(--green)' }}>{template.name}</code> to read as UTILITY
              {rates ? `, so it bills at ${inrRate(rates.UTILITY)} instead of ${inrRate(rates.MARKETING)} per message.` : ', which bills at a much lower per-message rate.'}
            </p>
          </div>
          <button onClick={onClose} style={{ width:26, height:26, borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', color:'var(--t2)', flexShrink:0 }}>x</button>
        </div>

        <div style={{ padding:'18px 24px', overflowY:'auto', display:'flex', flexDirection:'column', gap:13 }}>
          {loading && <p style={{ fontSize:13, color:'var(--t2)' }}>Rewriting…</p>}
          {err && <p style={{ fontSize:12.5, color:'#f87171' }}>{err}</p>}

          {variant && (
            <>
              <div style={{ background:'#ECE5DD', borderRadius:9, padding:12 }}>
                <div style={{ background:'#fff', borderRadius:'0 8px 8px 8px', padding:'10px 12px', boxShadow:'0 1px 3px rgba(0,0,0,0.1)' }}>
                  {variant.headerText && <p style={{ fontSize:12.5, fontWeight:700, color:'#111', margin:'0 0 4px' }}>{variant.headerText}</p>}
                  <p style={{ fontSize:12, color:'#111', lineHeight:1.5, whiteSpace:'pre-wrap', margin:0 }}>{variant.body}</p>
                  {variant.footer && <p style={{ fontSize:10.5, color:'#888', marginTop:6 }}>{variant.footer}</p>}
                  {variant.buttons?.length > 0 && (
                    <div style={{ marginTop:8, borderTop:'1px solid #e4e0d8' }}>
                      {variant.buttons.map((b, i) => (
                        <div key={i} style={{ textAlign:'center', padding:'7px 4px', fontSize:12, color:'#00a5f4', fontWeight:500, borderTop: i > 0 ? '1px solid #e4e0d8' : 'none' }}>{b.text}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {variant.changes?.length > 0 && (
                <div>
                  <p style={{ fontSize:10.5, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>What changed</p>
                  <ul style={{ margin:0, paddingLeft:16, display:'flex', flexDirection:'column', gap:3 }}>
                    {variant.changes.map((c, i) => <li key={i} style={{ fontSize:12, color:'var(--t2)', lineHeight:1.5 }}>{c}</li>)}
                  </ul>
                </div>
              )}

              {variant.caveat && (
                <div style={{ padding:'11px 13px', borderRadius:8, background:'rgba(245,158,11,0.09)', border:'1px solid rgba(245,158,11,0.25)' }}>
                  <p style={{ fontSize:12, color:'#fbbf24', lineHeight:1.55 }}>{variant.caveat}</p>
                </div>
              )}

              <p style={{ fontSize:11.5, color:'var(--t3)', lineHeight:1.5 }}>
                This is saved as a new template for Meta to review. Your original is left untouched.
              </p>
            </>
          )}
        </div>

        <div style={{ padding:'13px 24px', borderTop:'1px solid var(--bd)', display:'flex', justifyContent:'flex-end', gap:8 }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          {variant && <Btn onClick={() => onUseDraft(variant)} style={{ boxShadow:'var(--glow)' }}>Open in builder</Btn>}
        </div>
      </div>
    </div>
  );
};

// ─── Draft a template with AI ──────────────────────────────────
// Produces an editable draft rather than saving directly: Meta reviews every
// template and rejects mis-categorised or spammy copy, so the user has to see
// and adjust it first. "Open in builder" hands the draft to TemplateModal.
const TemplateAiPanel = ({ onClose, onUseDraft }) => {
  const [prompt, setPrompt]         = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [draft, setDraft]           = useState(null);
  const [loading, setLoading]       = useState(false);
  const [err, setErr]               = useState(null);
  // The generated header image: { assetId, dataUri }. Held separately from the
  // draft because it is generated on its own request — image generation is
  // separately billed and can fail while the copy is perfectly good.
  const [image, setImage]           = useState(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgErr, setImgErr]         = useState(null);
  // Whether this template should carry an image header at all. Seeded from the
  // model's own judgement, then owned by the user.
  const [wantImage, setWantImage]   = useState(false);

  useEffect(() => {
    wFetch('/templates/ai/suggestions')
      .then(r => r.ok && r.json())
      .then(d => { if (Array.isArray(d?.suggestions)) setSuggestions(d.suggestions); })
      .catch(() => {});
  }, []);

  const generate = async (text) => {
    const p = (text ?? prompt).trim();
    if (!p) { setErr('Describe the template you want.'); return; }
    setPrompt(p); setLoading(true); setErr(null); setDraft(null);
    setImage(null); setImgErr(null);
    try {
      const res = await wFetch('/templates/ai/draft', { method: 'POST', body: JSON.stringify({ prompt: p }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || 'Could not draft that template'); return; }
      setDraft(data);
      // AUTHENTICATION templates may not carry a header at all.
      setWantImage(data.category !== 'AUTHENTICATION' && !!data.suggestImage);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const generateImage = async () => {
    if (!draft) return;
    setImgLoading(true); setImgErr(null);
    try {
      const res = await wFetch('/templates/ai/image', {
        method: 'POST',
        body: JSON.stringify({ imageIdea: draft.imageIdea, body: draft.body, category: draft.category }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setImgErr(data.error || 'Could not generate that image'); return; }
      setImage({ assetId: data.assetId, dataUri: data.dataUri });
    } catch (e) {
      setImgErr(e.message);
    } finally {
      setImgLoading(false);
    }
  };

  // Generate once automatically when the model asked for an image, so the
  // common case is a finished preview rather than another button to find.
  useEffect(() => {
    if (draft && wantImage && !image && !imgLoading && !imgErr) generateImage();
  }, [draft, wantImage]);

  const catTone = { MARKETING: '#f59e0b', UTILITY: '#9d6bff', AUTHENTICATION: '#c4ff46' };

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(3,5,12,0.78)', backdropFilter:'blur(4px)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', width:'100%', maxWidth:620, maxHeight:'90vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--bd)', display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
          <div>
            <h3 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:17, fontWeight:800, color:'var(--t1)', marginBottom:4 }}>Create Template with AI</h3>
            <p style={{ fontSize:12.5, color:'var(--t2)' }}>Describe the message. AI writes the copy, picks the category and suggests variables.</p>
          </div>
          <button onClick={onClose} style={{ width:26, height:26, borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', color:'var(--t2)', flexShrink:0 }}>x</button>
        </div>

        <div style={{ padding:'18px 24px', overflowY:'auto', display:'flex', flexDirection:'column', gap:14 }}>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
            placeholder="e.g. Remind a customer their dental appointment is tomorrow and let them confirm or reschedule."
            style={{ width:'100%', padding:'10px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13.5, outline:'none', resize:'vertical', fontFamily:"'Manrope',sans-serif", lineHeight:1.55 }} />

          {suggestions.length > 0 && !draft && (
            <div>
              <p style={{ fontSize:11, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:8 }}>Start from a common one</p>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {suggestions.map(sg => (
                  <button key={sg.label} onClick={() => generate(sg.prompt)} disabled={loading}
                    style={{ padding:'7px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', cursor: loading ? 'wait' : 'pointer', fontSize:12.5, fontWeight:600, fontFamily:"'Manrope',sans-serif" }}>
                    {sg.label}
                    <span style={{ marginLeft:7, fontSize:10, color: catTone[sg.category] || 'var(--t3)' }}>{sg.category[0] + sg.category.slice(1).toLowerCase()}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {err && <p style={{ fontSize:12.5, color:'#f87171' }}>{err}</p>}
          {draft?.provider === 'fallback' && (
            <p style={{ fontSize:12, color:'#fbbf24' }}>
              {draft.fallbackReason === 'error'
                ? 'Gemini could not be reached — this draft came from a built-in pattern. It is still fully editable.'
                : 'No AI key on the server — this draft came from a built-in pattern. It is still fully editable.'}
            </p>
          )}

          {draft && (
            <div style={{ border:'1px solid var(--bd)', borderRadius:10, background:'rgba(255,255,255,0.02)', padding:'14px 16px', display:'flex', flexDirection:'column', gap:11 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                <span style={{ fontFamily:'monospace', fontSize:12.5, color:'var(--green)' }}>{draft.name}</span>
                <span style={{ padding:'2px 9px', borderRadius:10, fontSize:10.5, fontWeight:700, color: catTone[draft.category], border:`1px solid ${catTone[draft.category]}44` }}>
                  {draft.category} · {draft.language}
                </span>
              </div>

              <div style={{ background:'#ECE5DD', borderRadius:9, padding:12 }}>
                <div style={{ background:'#fff', borderRadius:'0 8px 8px 8px', padding:'10px 12px', boxShadow:'0 1px 3px rgba(0,0,0,0.1)' }}>
                  {wantImage && (
                    image ? (
                      <img src={image.dataUri} alt="Generated header"
                        style={{ width:'100%', borderRadius:6, marginBottom:7, display:'block', objectFit:'cover', maxHeight:180 }} />
                    ) : (
                      <div style={{ width:'100%', height:120, borderRadius:6, marginBottom:7, background:'#d9d2c9', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10.5, color:'#7a736b', textAlign:'center', padding:6 }}>
                        {imgLoading ? 'Generating image…' : imgErr ? 'No image — add one in the builder' : 'Image header'}
                      </div>
                    )
                  )}
                  {draft.headerText && <p style={{ fontSize:12.5, fontWeight:700, color:'#111', margin:'0 0 4px' }}>{draft.headerText}</p>}
                  <p style={{ fontSize:12, color:'#111', lineHeight:1.5, whiteSpace:'pre-wrap', margin:0 }}>{draft.body}</p>
                  {draft.footer && <p style={{ fontSize:10.5, color:'#888', marginTop:6 }}>{draft.footer}</p>}
                  {draft.buttons?.length > 0 && (
                    <div style={{ marginTop:8, borderTop:'1px solid #e4e0d8' }}>
                      {draft.buttons.map((b, i) => (
                        <div key={i} style={{ textAlign:'center', padding:'7px 4px', fontSize:12, color:'#00a5f4', fontWeight:500, borderTop: i > 0 ? '1px solid #e4e0d8' : 'none' }}>
                          {b.text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {draft.variables?.length > 0 && (
                <div>
                  <p style={{ fontSize:10.5, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:5 }}>Variables</p>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                    {draft.variables.map(v => (
                      <span key={v.index} style={{ padding:'3px 9px', borderRadius:10, fontSize:11.5, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t2)' }}>
                        <code style={{ color:'var(--green)', fontFamily:'monospace' }}>{`{{${v.index}}}`}</code> {v.meaning} — {v.example}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {draft.category !== 'AUTHENTICATION' && (
                <div style={{ borderTop:'1px solid var(--bd)', paddingTop:11, display:'flex', flexDirection:'column', gap:8 }}>
                  <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12.5, color:'var(--t1)', cursor:'pointer' }}>
                    <input type="checkbox" checked={wantImage}
                      onChange={e => { setWantImage(e.target.checked); if (!e.target.checked) { setImage(null); setImgErr(null); } }}
                      style={{ accentColor:'var(--green)', width:15, height:15, cursor:'pointer' }} />
                    Add an image header
                    {draft.suggestImage && <span style={{ fontSize:10.5, color:'var(--t3)' }}>· recommended for this message</span>}
                  </label>

                  {wantImage && draft.imageIdea && (
                    <p style={{ fontSize:11.5, color:'var(--t2)', lineHeight:1.5 }}>
                      <strong style={{ color:'var(--t1)' }}>Image idea: </strong>{draft.imageIdea}
                    </p>
                  )}

                  {wantImage && (
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                      <Btn variant="outline" onClick={generateImage} disabled={imgLoading}>
                        {imgLoading ? 'Generating…' : image ? 'Regenerate image' : 'Generate image'}
                      </Btn>
                      {image && <span style={{ fontSize:11.5, color:'var(--t3)' }}>This exact image is what recipients receive.</span>}
                    </div>
                  )}

                  {imgErr && <p style={{ fontSize:11.5, color:'#fbbf24', lineHeight:1.5 }}>{imgErr}</p>}
                </div>
              )}
              {draft.buttonNote && <p style={{ fontSize:11.5, color:'#fbbf24', lineHeight:1.5 }}>{draft.buttonNote}</p>}
              {draft.buttonWarnings?.map((w, i) => (
                <p key={i} style={{ fontSize:11.5, color:'#fbbf24', lineHeight:1.5 }}>{w}</p>
              ))}
              {draft.rationale && <p style={{ fontSize:11.5, color:'var(--t3)', lineHeight:1.5 }}>{draft.rationale}</p>}
            </div>
          )}
        </div>

        <div style={{ padding:'13px 24px', borderTop:'1px solid var(--bd)', display:'flex', justifyContent:'flex-end', gap:8, flexWrap:'wrap' }}>
          <Btn variant="ghost" onClick={onClose} disabled={loading}>Cancel</Btn>
          <Btn variant={draft ? 'outline' : 'primary'} onClick={() => generate()} disabled={loading}
            style={draft ? {} : { boxShadow:'var(--glow)' }}>
            {loading ? 'Drafting...' : draft ? 'Regenerate' : 'Draft with AI'}
          </Btn>
          {draft && (
            <Btn onClick={() => onUseDraft({ ...draft, image: wantImage ? image : null })} style={{ boxShadow:'var(--glow)' }}>Open in builder</Btn>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Template shape rules (mirror of backend lib/templateStructure.js) ──────
// Which template types each category may use, and which headers each category
// allows. The builder only offers what Meta will actually accept, so a bad
// combination is impossible to submit rather than rejected hours later.
const TYPES_BY_CATEGORY = {
  MARKETING:      ['STANDARD', 'CATALOG', 'CAROUSEL'],
  UTILITY:        ['STANDARD', 'CAROUSEL'],
  AUTHENTICATION: ['STANDARD'],
};

const TEMPLATE_TYPE_META = {
  STANDARD: { label: 'Standard',  hint: 'Header, body, footer and buttons.' },
  CATALOG:  { label: 'Catalog',   hint: 'Opens the catalog linked to your WhatsApp account.' },
  CAROUSEL: { label: 'Carousel',  hint: 'Up to 10 swipeable cards, each with its own image.' },
};

const HEADER_FORMATS_BY_CATEGORY = {
  MARKETING:      ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'],
  UTILITY:        ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'],
  AUTHENTICATION: ['NONE'],
};

const HEADER_FORMAT_META = {
  NONE:     { label: 'None',     accept: null },
  TEXT:     { label: 'Text',     accept: null },
  IMAGE:    { label: 'Image',    accept: 'image/jpeg,image/png',  hint: 'JPG or PNG, up to 5 MB.' },
  VIDEO:    { label: 'Video',    accept: 'video/mp4',             hint: 'MP4, up to 16 MB.' },
  DOCUMENT: { label: 'Document', accept: 'application/pdf',       hint: 'PDF, up to 100 MB.' },
};

const CARD_MAX = 10;
const CARD_BODY_MAX = 160;

// Reads the type back off a saved template — the backend derives it the same
// way rather than storing it, so there is nothing to read from a column.
const detectTemplateType = (components) => {
  const list = Array.isArray(components) ? components : [];
  if (list.some(c => (c?.type || '').toUpperCase() === 'CAROUSEL')) return 'CAROUSEL';
  const buttons = list.find(c => (c?.type || '').toUpperCase() === 'BUTTONS')?.buttons;
  if (Array.isArray(buttons) && buttons.some(b => (b?.type || '').toUpperCase() === 'CATALOG')) return 'CATALOG';
  return 'STANDARD';
};

// ─── New Template Dialog ───────────────────────────────────────
const TemplateModal = ({ onClose, onSaved, template = null, seed = null }) => {
  const isEdit = !!template;
  const comps = isEdit && Array.isArray(template.components) ? template.components : [];
  const findComp = (t) => comps.find(c => (c.type || '').toUpperCase() === t);
  const initialBody   = isEdit ? (findComp('BODY')?.text ?? '') : (seed?.body ?? '');
  const initialFooter = isEdit ? (findComp('FOOTER')?.text ?? '') : (seed?.footer ?? '');
  const initialHeader = isEdit ? findComp('HEADER') : null;
  // A generated image wins over drafted header text — Meta allows only one
  // header, and the user explicitly asked for the picture.
  const initialHeaderKind = initialHeader
    ? (initialHeader.format || 'TEXT').toUpperCase()
    : (seed?.image ? 'IMAGE' : seed?.headerText ? 'TEXT' : 'NONE');
  const initialType = isEdit ? detectTemplateType(comps) : 'STANDARD';
  // Carousel cards, unpacked from the stored CAROUSEL component. `media` holds
  // what the upload endpoint returned; `assetId` is what the send path later
  // re-uploads, so an edited card keeps it even when the file is not touched.
  const initialCards = (comps.find(c => (c.type || '').toUpperCase() === 'CAROUSEL')?.cards || []).map(card => {
    const cc = Array.isArray(card?.components) ? card.components : [];
    const ch = cc.find(c => (c.type || '').toUpperCase() === 'HEADER');
    return {
      body: cc.find(c => (c.type || '').toUpperCase() === 'BODY')?.text || '',
      buttons: (cc.find(c => (c.type || '').toUpperCase() === 'BUTTONS')?.buttons || []).map(b => ({ ...b })),
      media: ch ? { format: (ch.format || 'IMAGE').toUpperCase(), assetId: ch._assetId || null, example: ch.example || null } : null,
      preview: null,
    };
  });

  const [name, setName]         = useState(isEdit ? template.name : (seed?.name ?? ''));
  const [category, setCategory] = useState(isEdit ? template.category : (seed?.category ?? 'MARKETING'));
  const [language, setLanguage] = useState(isEdit ? template.language : (seed?.language ?? 'en'));
  const [body, setBody]         = useState(initialBody);
  const [footer, setFooter]     = useState(initialFooter);
  // Header: 'none' | 'text' | 'image'. Meta allows at most one header, and a
  // media header needs a sample uploaded to Meta before the template can be
  // submitted — headerMedia holds the handle that upload returns.
  const [headerKind, setHeaderKind] = useState(initialHeaderKind);
  // Standard / catalog / carousel. Changing the category can make the current
  // type illegal, which the effect below corrects.
  const [templateType, setTemplateType] = useState(initialType);
  const [cards, setCards] = useState(initialCards);
  // A catalog template's single button; Meta only lets its label be chosen.
  const [catalogLabel, setCatalogLabel] = useState(() => {
    const b = (comps.find(c => (c.type || '').toUpperCase() === 'BUTTONS')?.buttons || [])
      .find(x => (x?.type || '').toUpperCase() === 'CATALOG');
    return b?.text || 'View catalog';
  });
  // Which product's picture heads the message. Meta calls it the thumbnail
  // product retailer id and it is the item's Content ID in Commerce Manager.
  // Optional — left blank, Meta uses the first item in the catalog.
  const [catalogThumbnailId, setCatalogThumbnailId] = useState(() => {
    const b = (comps.find(c => (c.type || '').toUpperCase() === 'BUTTONS')?.buttons || [])
      .find(x => (x?.type || '').toUpperCase() === 'CATALOG');
    return b?._thumbnailProductRetailerId || '';
  });
  const [cardUploading, setCardUploading] = useState(null);
  const [headerText, setHeaderText] = useState(initialHeader?.text ?? seed?.headerText ?? '');
  // Holds Meta's review handle once the image is uploaded, plus the assetId of
  // the stored bytes the send path re-uploads later. A generated image starts
  // with only the assetId — the handle is minted on save, so a draft the user
  // abandons never touches Meta.
  const [headerMedia, setHeaderMedia] = useState(seed?.image?.assetId ? { assetId: seed.image.assetId } : null);
  // Buttons component. Meta caps these at 2 URL, 1 phone, 1 copy-code and
  // 10 total, and quick replies must stay grouped — enforced on save.
  const [buttons, setButtons] = useState(() => {
    const existing = isEdit ? findComp('BUTTONS')?.buttons : seed?.buttons;
    return Array.isArray(existing) ? existing.map(b => ({ ...b })) : [];
  });
  const [headerPreview, setHeaderPreview] = useState(seed?.image?.dataUri ?? null);
  const [uploading, setUploading] = useState(false);
  const [examples, setExamples] = useState(() => {
    const out = {};
    for (const v of seed?.variables || []) out[v.index] = v.example || '';
    return out;
  });
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState(null);
  const modalRef = useRef(null);
  useFocusTrap(modalRef, true);
  // Templates are private per WhatsApp number. When a workspace has more than
  // one number, the user must choose which number this template belongs to.
  const [numbers, setNumbers]   = useState([]);
  const [waNumberId, setWaNumberId] = useState(isEdit ? (template.waNumberId || '') : '');

  useEffect(() => {
    if (isEdit) return; // editing keeps its existing number binding
    wFetch('/whatsapp/numbers').then(r => r.ok && r.json()).then(d => {
      if (Array.isArray(d)) {
        setNumbers(d);
        if (d.length === 1) setWaNumberId(d[0].id);
      }
    }).catch(() => {});
  }, []);

  // Show the image an existing template actually sends. Pulled as a blob
  // rather than pointed at with <img src> because every API route requires the
  // Authorization header (same reason wDownload exists).
  useEffect(() => {
    if (!isEdit || !template?.headerAssetId) return;
    let url = null;
    let cancelled = false;
    wFetch(`/templates/media/${template.headerAssetId}`)
      .then(r => r.ok ? r.blob() : null)
      .then(blob => {
        if (!blob || cancelled) return;
        url = URL.createObjectURL(blob);
        setHeaderPreview(url);
      })
      .catch(() => {});
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [isEdit, template?.headerAssetId]);

  const allowedTypes   = TYPES_BY_CATEGORY[category] || TYPES_BY_CATEGORY.MARKETING;
  const allowedHeaders = HEADER_FORMATS_BY_CATEGORY[category] || HEADER_FORMATS_BY_CATEGORY.MARKETING;

  // Picking a category narrows what is legal — an authentication template can
  // carry no header at all, and only marketing can use a catalog. Rather than
  // let the form hold a combination Meta would reject, the illegal choice falls
  // back to the safe one the moment the category changes.
  useEffect(() => {
    if (!allowedTypes.includes(templateType)) setTemplateType('STANDARD');
    if (!allowedHeaders.includes(headerKind)) setHeaderKind('NONE');
  }, [category]);

  // Show the pictures an existing carousel's cards will actually send, for the
  // same reason the main header is fetched as a blob: every API route needs the
  // Authorization header, so <img src> cannot reach them.
  useEffect(() => {
    if (!isEdit || initialCards.length === 0) return;
    const urls = [];
    let cancelled = false;
    Promise.all(initialCards.map((c, i) => (
      c.media?.assetId
        ? wFetch(`/templates/media/${c.media.assetId}`)
            .then(r => r.ok ? r.blob() : null)
            .then(blob => {
              if (!blob || cancelled) return null;
              const u = URL.createObjectURL(blob);
              urls.push(u);
              return [i, u];
            })
            .catch(() => null)
        : Promise.resolve(null)
    ))).then(pairs => {
      if (cancelled) return;
      const found = pairs.filter(Boolean);
      if (found.length) {
        setCards(list => list.map((c, i) => {
          const hit = found.find(([idx]) => idx === i);
          return hit ? { ...c, preview: hit[1] } : c;
        }));
      }
    });
    return () => { cancelled = true; urls.forEach(u => URL.revokeObjectURL(u)); };
  }, [isEdit]);

  const langs = [
    { code:'en',    label:'English' },
    { code:'en_US', label:'English (US)' },
    { code:'en_GB', label:'English (UK)' },
    { code:'es',    label:'Spanish' },
    { code:'hi',    label:'Hindi' },
    { code:'mr',    label:'Marathi' },
    { code:'pt_BR', label:'Portuguese (BR)' },
    { code:'fr',    label:'French' },
    { code:'de',    label:'German' },
    { code:'id',    label:'Indonesian' },
    { code:'ar',    label:'Arabic' },
  ];
  const cats = [
    { id:'MARKETING',      label:'Marketing',      hint:'Promotions, offers, announcements.' },
    { id:'UTILITY',        label:'Utility',        hint:'Order updates, confirmations, alerts.' },
    { id:'AUTHENTICATION', label:'Authentication', hint:'One-time passwords (OTP) only.' },
  ];

  // Extract {{1}}, {{2}}, ... in order
  const vars = Array.from(new Set((body.match(/\{\{\d+\}\}/g) || [])))
    .map(v => parseInt(v.replace(/\D/g, ''), 10))
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b);

  const slug = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64);
  const nameValid = /^[a-z0-9_]{1,64}$/.test(slug) && slug.length > 0;

  // Meta will not approve a media header without a sample file, so the image
  // is uploaded to Meta up front and only the returned handle is submitted
  // with the template. The preview is a local object URL — the bytes are
  // never stored on our side.
  const pickHeaderImage = async (file) => {
    if (!file) return;
    setErr(null);
    // The header format is an explicit choice now, so the file has to match it
    // rather than merely being one of the four types Meta accepts somewhere.
    const spec = {
      IMAGE:    { types: ['image/jpeg', 'image/png'], maxMb: 5,   label: 'a JPG or PNG image' },
      VIDEO:    { types: ['video/mp4'],               maxMb: 16,  label: 'an MP4 video' },
      DOCUMENT: { types: ['application/pdf'],         maxMb: 100, label: 'a PDF' },
    }[headerKind];
    if (!spec) return;
    if (!spec.types.includes(file.type)) { setErr(`The header is set to ${HEADER_FORMAT_META[headerKind].label} — use ${spec.label}.`); return; }
    if (file.size > spec.maxMb * 1024 * 1024) { setErr(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit for a ${HEADER_FORMAT_META[headerKind].label.toLowerCase()} header is ${spec.maxMb} MB.`); return; }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (waNumberId) fd.append('waNumberId', waNumberId);
      const res = await wFetch('/templates/media', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || 'Could not upload that file'); return; }
      setHeaderMedia({ ...data, name: file.name });
      setHeaderPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : null);
    } catch (e) {
      setErr(e.message || 'Could not upload that file');
    } finally {
      setUploading(false);
    }
  };

  // Carousel cards are limited to images: the send path has to re-upload the
  // real media on every send, and only image bytes are stored (a video header
  // is review-only in this product), so a video card could never be delivered.
  const pickCardImage = async (index, file) => {
    if (!file) return;
    setErr(null);
    if (!['image/jpeg', 'image/png'].includes(file.type)) { setErr(`Card ${index + 1}: use a JPG or PNG image.`); return; }
    if (file.size > 5 * 1024 * 1024) { setErr(`Card ${index + 1}: images must be 5 MB or smaller.`); return; }

    setCardUploading(index);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (waNumberId) fd.append('waNumberId', waNumberId);
      const res = await wFetch('/templates/media', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || `Card ${index + 1}: could not upload that image`); return; }
      const preview = URL.createObjectURL(file);
      setCards(list => list.map((c, i) => i === index
        ? { ...c, media: { ...data, format: 'IMAGE', name: file.name }, preview }
        : c));
    } catch (e) {
      setErr(e.message || 'Could not upload that image');
    } finally {
      setCardUploading(null);
    }
  };

  const submit = async () => {
    setErr(null);
    if (!nameValid) { setErr('Name must contain only lowercase letters, numbers and underscores.'); return; }
    const bodyError = validateMeaningfulText(body, 'Body text');
    if (bodyError) { setErr(bodyError); return; }
    for (const n of vars) {
      if (!examples[n]?.trim()) { setErr(`Provide an example value for variable {{${n}}}.`); return; }
    }

    const isCarousel = templateType === 'CAROUSEL';
    const isCatalog  = templateType === 'CATALOG';
    const isMediaHeader = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerKind);
    const usesHeader = templateType === 'STANDARD';

    if (usesHeader && isMediaHeader && !headerMedia && !isEdit) {
      setErr(`Upload a ${HEADER_FORMAT_META[headerKind].label.toLowerCase()} for the header, or set the header to None.`); return;
    }
    if (!isEdit && numbers.length > 1 && !waNumberId) { setErr('Select which WhatsApp number this template belongs to.'); return; }

    if (isCarousel) {
      if (cards.length === 0) { setErr('A carousel needs at least one card.'); return; }
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        if (!c.media?.handle && !c.media?.example) { setErr(`Card ${i + 1}: upload an image.`); return; }
        const labelled = c.buttons.filter(b => String(b.text || '').trim());
        if (labelled.length === 0) { setErr(`Card ${i + 1}: add at least one button — Meta requires them on every card.`); return; }
      }
      // Meta rejects the template unless every card repeats the same buttons in
      // the same order, so the mismatch is caught here rather than at review.
      const signature = (c) => c.buttons.filter(b => String(b.text || '').trim()).map(b => b.type).join(',');
      const first = signature(cards[0]);
      const odd = cards.findIndex(c => signature(c) !== first);
      if (odd > 0) { setErr(`Card ${odd + 1} has different buttons from card 1 — every card must repeat the same buttons in the same order.`); return; }
    }

    if (isCatalog && !catalogLabel.trim()) { setErr('Give the catalog button a label.'); return; }

    // A generated image has stored bytes but no Meta review handle yet — it is
    // uploaded here rather than at generation time so a draft the user
    // abandons never reaches Meta.
    let media = headerMedia;
    if (usesHeader && isMediaHeader && media?.assetId && !media.handle) {
      setSaving(true);
      try {
        const res = await wFetch('/templates/media', {
          method: 'POST',
          body: JSON.stringify({ assetId: media.assetId, ...(waNumberId ? { waNumberId } : {}) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setErr(data.error || 'Could not send the header image to Meta'); return; }
        media = { ...media, ...data };
        setHeaderMedia(media);
      } catch (e) {
        setErr(e.message); return;
      } finally {
        setSaving(false);
      }
    }
    if (usesHeader && headerKind === 'TEXT' && !headerText.trim()) {
      setErr('Enter the header text, or set the header to None.'); return;
    }

    const components = [];
    // Meta requires HEADER first, then BODY, then FOOTER.
    if (usesHeader && headerKind === 'TEXT') {
      components.push({ type:'HEADER', format:'TEXT', text: headerText.trim() });
    } else if (usesHeader && isMediaHeader) {
      const header = { type:'HEADER', format: media?.format || headerKind };
      // The handle is Meta's sample for review. Editing without re-uploading
      // keeps whatever the stored component already had.
      if (media?.handle) header.example = { header_handle: [media.handle] };
      else if (initialHeader?.example) header.example = initialHeader.example;
      components.push(header);
    }
    const bodyComp = { type:'BODY', text: body.trim() };
    if (vars.length > 0) {
      bodyComp.example = { body_text: [vars.map(n => examples[n].trim())] };
    }
    components.push(bodyComp);
    // A carousel carries no footer or buttons on the bubble itself.
    if (!isCarousel && footer.trim()) components.push({ type:'FOOTER', text: footer.trim() });

    // BUTTONS goes last. The server re-validates against Meta's rules, so a
    // bad set is caught before the template is submitted for review.
    const toMetaButton = (b) => {
      const out = { type: b.type, text: String(b.text).trim() };
      if (b.type === 'URL') { out.url = String(b.url || '').trim(); if (b.example) out.example = String(b.example).trim(); }
      if (b.type === 'PHONE_NUMBER') out.phone_number = String(b.phone_number || '').trim();
      if (b.type === 'COPY_CODE') out.example = String(b.example || '').trim();
      return out;
    };

    if (isCatalog) {
      const catalogBtn = { type:'CATALOG', text: catalogLabel.trim() };
      if (catalogThumbnailId.trim()) catalogBtn._thumbnailProductRetailerId = catalogThumbnailId.trim();
      components.push({ type:'BUTTONS', buttons: [catalogBtn] });
    } else if (isCarousel) {
      components.push({
        type: 'CAROUSEL',
        cards: cards.map(c => {
          const header = { type:'HEADER', format: c.media?.format || 'IMAGE' };
          if (c.media?.handle) header.example = { header_handle: [c.media.handle] };
          else if (c.media?.example) header.example = c.media.example;
          // Carried through so the send path can re-upload the real picture —
          // the review handle above cannot be sent. Stripped before Meta sees it.
          if (c.media?.assetId) header._assetId = c.media.assetId;
          const cardComponents = [header];
          if (c.body.trim()) cardComponents.push({ type:'BODY', text: c.body.trim() });
          cardComponents.push({
            type: 'BUTTONS',
            buttons: c.buttons.filter(b => String(b.text || '').trim()).map(toMetaButton),
          });
          return { components: cardComponents };
        }),
      });
    } else {
      const cleanButtons = buttons.filter(b => String(b.text || '').trim()).map(toMetaButton);
      if (cleanButtons.length) components.push({ type:'BUTTONS', buttons: cleanButtons });
    }

    setSaving(true);
    try {
      const res = isEdit
        ? await wFetch(`/templates/${template.id}`, {
            method:'PUT',
            body: JSON.stringify({ name: slug, category, language, components }),
          })
        : await wFetch('/templates', {
            method:'POST',
            body: JSON.stringify({
              name: slug, category, language, components,
              ...(waNumberId ? { waNumberId } : {}),
              // Binds the stored bytes to the template so campaign sends can
              // re-upload the picture — Meta's review handle cannot be sent.
              ...(templateType === 'STANDARD' && headerKind === 'IMAGE' && media?.assetId ? { headerAssetId: media.assetId } : {}),
            }),
          });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || `Error ${res.status}`); return; }
      onSaved?.(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const inputBase = {
    width:'100%', padding:'9px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)',
    border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13,
    fontFamily:"'Manrope',sans-serif", outline:'none', boxSizing:'border-box',
  };

  return (
    <div onKeyDown={e => { if (e.key === 'Escape') onClose(); }} role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit Template' : 'New Message Template'} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)' }}>
      <div ref={modalRef} className="modal-card" style={{ ...card, width:620, maxHeight:'88vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--bd)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div>
            <p style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:16, color:'var(--t1)' }}>{isEdit ? 'Edit Template' : 'New Message Template'}</p>
            <p style={{ fontSize:11, color:'var(--t3)', marginTop:2 }}>{isEdit ? 'Changes to a rejected template are re-submitted to Meta.' : 'Will be submitted to Meta for review.'}</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--t2)', display:'flex' }}>
            <I n="x" s={18} c="var(--t2)" />
          </button>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'20px 24px', display:'flex', flexDirection:'column', gap:14 }}>
          {err && (
            <div style={{ padding:'10px 13px', borderRadius:8, background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.25)', color:'#f87171', fontSize:12, lineHeight:1.55 }}>{err}</div>
          )}

          {/* Name */}
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>Template Name <span style={{ color:'#f87171' }}>*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="order_confirmation_v1" style={inputBase} />
            <p style={{ fontSize:11, color:'var(--t3)', marginTop:4 }}>
              Submits as <code style={{ fontFamily:'monospace', color:'var(--t2)' }}>{slug || '—'}</code>. Lowercase letters, numbers, underscores only.
            </p>
          </div>

          {/* WhatsApp number (only when the workspace has more than one — templates are per-number) */}
          {!isEdit && numbers.length > 1 && (
            <div>
              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>WhatsApp Number <span style={{ color:'#f87171' }}>*</span></label>
              <select value={waNumberId} onChange={e => setWaNumberId(e.target.value)}
                style={{ ...inputBase, appearance:'auto', colorScheme:'dark' }}>
                <option value="">Select a number…</option>
                {numbers.map(n => <option key={n.id} value={n.id}>{n.phoneNumber}{n.displayName ? ` · ${n.displayName}` : ''}</option>)}
              </select>
              <p style={{ fontSize:11, color:'var(--t3)', marginTop:5 }}>Templates are private to the number they're created on.</p>
            </div>
          )}

          {/* Category */}
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>Category <span style={{ color:'#f87171' }}>*</span></label>
            <div className="rgrid-3" style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }} role="radiogroup" aria-label="Template category">
              {cats.map(c => (
                <div key={c.id} onClick={() => setCategory(c.id)}
                  tabIndex={0} role="radio" aria-checked={category === c.id}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCategory(c.id); } }}
                  style={{ padding:'10px 12px', borderRadius:8, border:`1.5px solid ${category === c.id ? 'var(--green)' : 'var(--bd)'}`, background: category === c.id ? 'var(--gbg)' : 'rgba(255,255,255,0.02)', cursor:'pointer', outline:'none' }}
                  onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--green)'; }}
                  onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}>
                  <p style={{ fontSize:13, fontWeight:600, color: category === c.id ? 'var(--green)' : 'var(--t1)', marginBottom:3 }}>{c.label}</p>
                  <p style={{ fontSize:10.5, color:'var(--t3)', lineHeight:1.4 }}>{c.hint}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Template Type — only the types the chosen category allows */}
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>Template Type <span style={{ color:'#f87171' }}>*</span></label>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {allowedTypes.map(t => (
                <button key={t} type="button" onClick={() => { setTemplateType(t); setErr(null); }}
                  style={{ flex:'1 1 150px', textAlign:'left', padding:'9px 12px', borderRadius:8, cursor:'pointer',
                           fontFamily:"'Manrope',sans-serif",
                           border:`1.5px solid ${templateType === t ? 'var(--green)' : 'var(--bd)'}`,
                           background: templateType === t ? 'var(--gbg)' : 'rgba(255,255,255,0.02)' }}>
                  <p style={{ fontSize:13, fontWeight:600, color: templateType === t ? 'var(--green)' : 'var(--t1)', marginBottom:3 }}>{TEMPLATE_TYPE_META[t].label}</p>
                  <p style={{ fontSize:10.5, color:'var(--t3)', lineHeight:1.4 }}>{TEMPLATE_TYPE_META[t].hint}</p>
                </button>
              ))}
            </div>
            {allowedTypes.length === 1 && (
              <p style={{ fontSize:11, color:'var(--t3)', marginTop:5 }}>
                {category === 'AUTHENTICATION'
                  ? 'Authentication templates carry the passcode in the body — Meta does not allow other formats here.'
                  : 'Only the standard format is available for this category.'}
              </p>
            )}
          </div>

          {/* Language */}
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>Language <span style={{ color:'#f87171' }}>*</span></label>
            <select value={language} onChange={e => setLanguage(e.target.value)}
              style={{ ...inputBase, appearance:'auto', colorScheme:'dark' }}>
              {langs.map(l => <option key={l.code} value={l.code}>{l.label} ({l.code})</option>)}
            </select>
          </div>

          {/* Header — the formats depend on the category; a carousel puts its
              media on the cards instead, and a catalog template allows none. */}
          {templateType === 'STANDARD' && allowedHeaders.length > 1 && (
            <div>
              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>
                Header <span style={{ color:'var(--t3)', fontWeight:500 }}>(optional)</span>
              </label>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom: headerKind === 'NONE' ? 0 : 10 }}>
                {allowedHeaders.map(fmt => (
                  <button key={fmt} type="button" onClick={() => { setHeaderKind(fmt); setErr(null); }}
                    style={{ padding:'7px 13px', borderRadius:8, cursor:'pointer', fontSize:12.5, fontWeight:600,
                             fontFamily:"'Manrope',sans-serif",
                             border:`1px solid ${headerKind === fmt ? 'var(--gbd)' : 'var(--bd)'}`,
                             background: headerKind === fmt ? 'var(--gbg)' : 'rgba(255,255,255,0.04)',
                             color: headerKind === fmt ? 'var(--green)' : 'var(--t2)' }}>
                    {HEADER_FORMAT_META[fmt].label}
                  </button>
                ))}
              </div>

              {headerKind === 'TEXT' && (
                <input value={headerText} maxLength={60} onChange={e => setHeaderText(e.target.value)}
                  placeholder="e.g. Your order is on the way" style={inputBase} />
              )}

              {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerKind) && (
                <div style={{ border:'1px dashed var(--bd)', borderRadius:10, padding:14, display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
                  {headerKind === 'IMAGE' && headerPreview ? (
                    <img src={headerPreview} alt="Header preview"
                      style={{ width:72, height:72, objectFit:'cover', borderRadius:8, border:'1px solid var(--bd)' }} />
                  ) : (
                    <div style={{ width:72, height:72, borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <I n="file" s={22} c="var(--t3)" />
                    </div>
                  )}
                  <div style={{ flex:1, minWidth:190 }}>
                    <input type="file" accept={HEADER_FORMAT_META[headerKind].accept} disabled={uploading}
                      onChange={e => pickHeaderImage(e.target.files?.[0])}
                      style={{ fontSize:12, color:'var(--t2)', maxWidth:'100%' }} />
                    <p style={{ fontSize:11, color:'var(--t3)', marginTop:6, lineHeight:1.5 }}>
                      {uploading ? 'Uploading to Meta…'
                        : headerMedia ? `Uploaded ${headerMedia.name} — ${headerMedia.format} header ready.`
                        : isEdit && initialHeader ? 'This template already has a media header. Upload a new file only to replace it.'
                        : `${HEADER_FORMAT_META[headerKind].hint} Meta needs this sample to review the template.`}
                    </p>
                    {headerMedia && (
                      <button type="button" onClick={() => { setHeaderMedia(null); setHeaderPreview(null); }}
                        style={{ marginTop:6, background:'none', border:'none', padding:0, cursor:'pointer', color:'#f87171', fontSize:11.5, fontWeight:600 }}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {templateType === 'CAROUSEL' && (
            <p style={{ fontSize:11.5, color:'var(--t3)', lineHeight:1.5, margin:0 }}>
              A carousel has no header of its own — each card carries its own image, configured below.
            </p>
          )}
          {templateType === 'CATALOG' && (
            <p style={{ fontSize:11.5, color:'var(--t3)', lineHeight:1.5, margin:0 }}>
              Catalog templates cannot have a header. The button opens the catalog already linked to your WhatsApp Business account.
            </p>
          )}

          {/* Body */}
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>Body Text <span style={{ color:'#f87171' }}>*</span></label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={4}
              placeholder="Hello {{1}}, your order #{{2}} has been confirmed!"
              style={{ ...inputBase, resize:'vertical', minHeight:90, lineHeight:1.55 }} />
            <p style={{ fontSize:11, color:'var(--t3)', marginTop:4 }}>
              Use <code style={{ fontFamily:'monospace', color:'var(--green)' }}>{'{{1}}'}</code>, <code style={{ fontFamily:'monospace', color:'var(--green)' }}>{'{{2}}'}</code> etc. for variables. Max 1024 chars.
            </p>
          </div>

          {/* Variable examples */}
          {vars.length > 0 && (
            <div style={{ padding:'12px 14px', borderRadius:8, background:'rgba(14,165,233,.06)', border:'1px solid rgba(14,165,233,.18)' }}>
              <p style={{ fontSize:12, fontWeight:600, color:'#b9a3ff', marginBottom:10 }}>
                Variable example values
              </p>
              <p style={{ fontSize:11, color:'#b9a3ff', opacity:.8, marginBottom:10, lineHeight:1.5 }}>
                Meta requires a sample value for each variable so reviewers can understand the message context.
              </p>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {vars.map(n => (
                  <div key={n} style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontFamily:'monospace', fontSize:12, color:'var(--green)', minWidth:42 }}>{`{{${n}}}`}</span>
                    <input value={examples[n] || ''} onChange={e => setExamples(x => ({ ...x, [n]: e.target.value }))}
                      placeholder={`Sample value for {{${n}}}`} style={{ ...inputBase, flex:1 }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer — independent of the header. Meta has no footer on a carousel. */}
          {templateType !== 'CAROUSEL' && (
            <div>
              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>Footer <span style={{ color:'var(--t3)', fontWeight:500 }}>(optional, max 60 chars)</span></label>
              <input value={footer} maxLength={60} onChange={e => setFooter(e.target.value)}
                placeholder="Reply STOP to unsubscribe" style={inputBase} />
              <p style={{ fontSize:11, color:'var(--t3)', marginTop:4 }}>Plain text only — Meta does not allow variables in a footer.</p>
            </div>
          )}

          {/* Catalog configuration */}
          {templateType === 'CATALOG' && (
            <div>
              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>Catalog Button <span style={{ color:'#f87171' }}>*</span></label>
              <input value={catalogLabel} maxLength={25} onChange={e => setCatalogLabel(e.target.value)}
                placeholder="View catalog" style={inputBase} />
              <p style={{ fontSize:11, color:'var(--t3)', marginTop:4, lineHeight:1.5 }}>
                The button opens the product catalog connected to this WhatsApp Business account.
              </p>

              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', margin:'14px 0 6px' }}>
                Thumbnail product ID <span style={{ color:'var(--t3)', fontWeight:500 }}>(optional)</span>
              </label>
              <input value={catalogThumbnailId} maxLength={100} onChange={e => setCatalogThumbnailId(e.target.value)}
                placeholder="e.g. 2lc20305pt" style={inputBase} />
              <p style={{ fontSize:11, color:'var(--t3)', marginTop:4, lineHeight:1.5 }}>
                The item whose picture heads the message — its Content ID in Commerce Manager. Leave blank to use the first product in the catalog.
              </p>
            </div>
          )}

          {/* Buttons — the message bubble's own buttons. A carousel puts
              buttons on each card instead, and a catalog template's single
              button is configured above. */}
          {templateType === 'STANDARD' && (
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>
              Buttons <span style={{ color:'var(--t3)', fontWeight:500 }}>(optional)</span>
            </label>

            {buttons.length > 0 && (
              <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:10 }}>
                {buttons.map((b, i) => (
                  <div key={i} style={{ border:'1px solid var(--bd)', borderRadius:9, padding:'10px 12px', background:'rgba(255,255,255,0.02)', display:'flex', flexDirection:'column', gap:8 }}>
                    <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                      <span style={{ fontSize:10.5, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.06em', minWidth:76 }}>
                        {{ QUICK_REPLY:'Quick reply', URL:'Link', PHONE_NUMBER:'Call', COPY_CODE:'Copy code' }[b.type]}
                      </span>
                      <input value={b.text || ''} maxLength={25}
                        onChange={e => setButtons(list => list.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
                        placeholder="Button label" style={{ ...inputBase, flex:1, minWidth:130 }} />
                      <span style={{ fontSize:10.5, color: (b.text || '').length >= 25 ? '#fbbf24' : 'var(--t3)' }}>{(b.text || '').length}/25</span>
                      <button type="button" onClick={() => setButtons(list => list.filter((_, j) => j !== i))}
                        style={{ padding:'5px 9px', borderRadius:6, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.22)', color:'#f87171', cursor:'pointer', fontSize:11 }}>Remove</button>
                    </div>
                    {b.type === 'URL' && (
                      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                        <input value={b.url || ''}
                          onChange={e => setButtons(list => list.map((x, j) => j === i ? { ...x, url: e.target.value } : x))}
                          placeholder="https://example.com/orders/{{1}}" style={{ ...inputBase, flex:2, minWidth:190 }} />
                        {/\{\{\d+\}\}/.test(b.url || '') && (
                          <input value={b.example || ''}
                            onChange={e => setButtons(list => list.map((x, j) => j === i ? { ...x, example: e.target.value } : x))}
                            placeholder="Example for {{1}}" style={{ ...inputBase, flex:1, minWidth:130 }} />
                        )}
                      </div>
                    )}
                    {b.type === 'PHONE_NUMBER' && (
                      <input value={b.phone_number || ''}
                        onChange={e => setButtons(list => list.map((x, j) => j === i ? { ...x, phone_number: e.target.value } : x))}
                        placeholder="+91 98765 43210" style={inputBase} />
                    )}
                    {b.type === 'COPY_CODE' && (
                      <input value={b.example || ''}
                        onChange={e => setButtons(list => list.map((x, j) => j === i ? { ...x, example: e.target.value } : x))}
                        placeholder="Example code, e.g. SAVE20" style={inputBase} />
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {[
                ['QUICK_REPLY',  'Quick reply', b => b.filter(x => x.type === 'QUICK_REPLY').length >= 10],
                ['URL',          'Link',        b => b.filter(x => x.type === 'URL').length >= 2],
                ['PHONE_NUMBER', 'Call',        b => b.some(x => x.type === 'PHONE_NUMBER')],
                ['COPY_CODE',    'Copy code',   b => b.some(x => x.type === 'COPY_CODE')],
              ].map(([type, label, atLimit]) => {
                const disabled = buttons.length >= 10 || atLimit(buttons);
                return (
                  <button key={type} type="button" disabled={disabled}
                    onClick={() => setButtons(list => [...list, { type, text:'' }])}
                    style={{ padding:'7px 12px', borderRadius:8, background:'transparent', border:'1px solid var(--bd)',
                             color: disabled ? 'var(--t3)' : 'var(--green)', cursor: disabled ? 'not-allowed' : 'pointer',
                             fontSize:12, fontWeight:600, opacity: disabled ? 0.5 : 1, fontFamily:"'Manrope',sans-serif" }}>
                    + {label}
                  </button>
                );
              })}
            </div>
            <p style={{ fontSize:11, color:'var(--t3)', marginTop:6, lineHeight:1.5 }}>
              Up to 2 links, 1 call and 1 copy-code button. More than 3 buttons are hidden on WhatsApp desktop.
              {buttons.length > 3 && <span style={{ color:'#fbbf24' }}> This template has {buttons.length}.</span>}
            </p>
          </div>
          )}

          {/* Carousel cards */}
          {templateType === 'CAROUSEL' && (
            <div>
              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>
                Cards <span style={{ color:'var(--t3)', fontWeight:500 }}>({cards.length}/{CARD_MAX})</span>
              </label>
              <p style={{ fontSize:11, color:'var(--t3)', marginBottom:10, lineHeight:1.5 }}>
                Every card needs an image and the same buttons in the same order — Meta rejects the whole template otherwise.
              </p>

              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {cards.map((c, ci) => (
                  <div key={ci} style={{ border:'1px solid var(--bd)', borderRadius:10, padding:'12px 13px', background:'rgba(255,255,255,0.02)', display:'flex', flexDirection:'column', gap:10 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <span style={{ fontSize:11, fontWeight:700, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.06em' }}>Card {ci + 1}</span>
                      <button type="button" onClick={() => setCards(l => l.filter((_, k) => k !== ci))}
                        style={{ padding:'4px 9px', borderRadius:6, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.22)', color:'#f87171', cursor:'pointer', fontSize:11 }}>Remove</button>
                    </div>

                    <div style={{ display:'flex', gap:12, alignItems:'flex-start', flexWrap:'wrap' }}>
                      {c.preview ? (
                        <img src={c.preview} alt="" style={{ width:64, height:64, objectFit:'cover', borderRadius:8, border:'1px solid var(--bd)' }} />
                      ) : (
                        <div style={{ width:64, height:64, borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                          <I n="file" s={20} c="var(--t3)" />
                        </div>
                      )}
                      <div style={{ flex:1, minWidth:180 }}>
                        <input type="file" accept="image/jpeg,image/png" disabled={cardUploading === ci}
                          onChange={e => pickCardImage(ci, e.target.files?.[0])}
                          style={{ fontSize:12, color:'var(--t2)', maxWidth:'100%' }} />
                        <p style={{ fontSize:11, color:'var(--t3)', marginTop:5 }}>
                          {cardUploading === ci ? 'Uploading to Meta…'
                            : c.media?.handle ? `Uploaded ${c.media.name || 'image'} — ready.`
                            : c.media?.example ? 'This card already has an image. Upload a new one only to replace it.'
                            : 'JPG or PNG up to 5 MB.'}
                        </p>
                      </div>
                    </div>

                    <input value={c.body} maxLength={CARD_BODY_MAX}
                      onChange={e => setCards(l => l.map((x, k) => k === ci ? { ...x, body: e.target.value } : x))}
                      placeholder={`Card text (optional, max ${CARD_BODY_MAX} chars)`} style={inputBase} />

                    <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
                      {c.buttons.map((b, bi) => (
                        <div key={bi} style={{ display:'flex', gap:7, alignItems:'center', flexWrap:'wrap' }}>
                          <span style={{ fontSize:10.5, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.06em', minWidth:72 }}>
                            {b.type === 'URL' ? 'Link' : 'Quick reply'}
                          </span>
                          <input value={b.text || ''} maxLength={25}
                            onChange={e => setCards(l => l.map((x, k) => k === ci ? { ...x, buttons: x.buttons.map((y, m) => m === bi ? { ...y, text: e.target.value } : y) } : x))}
                            placeholder="Button label" style={{ ...inputBase, flex:1, minWidth:120 }} />
                          {b.type === 'URL' && (
                            <input value={b.url || ''}
                              onChange={e => setCards(l => l.map((x, k) => k === ci ? { ...x, buttons: x.buttons.map((y, m) => m === bi ? { ...y, url: e.target.value } : y) } : x))}
                              placeholder="https://example.com" style={{ ...inputBase, flex:1, minWidth:150 }} />
                          )}
                          <button type="button" onClick={() => setCards(l => l.map((x, k) => k === ci ? { ...x, buttons: x.buttons.filter((_, m) => m !== bi) } : x))}
                            style={{ padding:'5px 9px', borderRadius:6, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.22)', color:'#f87171', cursor:'pointer', fontSize:11 }}>Remove</button>
                        </div>
                      ))}
                      {c.buttons.length < 2 && (
                        <div style={{ display:'flex', gap:6 }}>
                          {[['QUICK_REPLY', 'Quick reply'], ['URL', 'Link']].map(([t, label]) => (
                            <button key={t} type="button"
                              onClick={() => setCards(l => l.map((x, k) => k === ci ? { ...x, buttons: [...x.buttons, { type: t, text: '' }] } : x))}
                              style={{ padding:'6px 11px', borderRadius:8, background:'transparent', border:'1px solid var(--bd)', color:'var(--green)', cursor:'pointer', fontSize:11.5, fontWeight:600, fontFamily:"'Manrope',sans-serif" }}>
                              + {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {cards.length < CARD_MAX && (
                <button type="button"
                  onClick={() => setCards(l => [...l, {
                    body: '', media: null, preview: null,
                    // A new card copies card 1's button set, because Meta requires
                    // every card to carry the same buttons in the same order.
                    buttons: l[0] ? l[0].buttons.map(b => ({ ...b, text: b.text || '' })) : [],
                  }])}
                  style={{ marginTop:10, padding:'8px 13px', borderRadius:8, background:'transparent', border:'1px dashed var(--bd)', color:'var(--green)', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:"'Manrope',sans-serif" }}>
                  + Add card
                </button>
              )}
            </div>
          )}

          {/* Preview — rendered from the same state the submit builds from, so
              what is shown is what Meta receives. */}
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>Preview</label>
            <div style={{ background:'#ECE5DD', borderRadius:10, padding:14, minHeight:60 }}>
              <div style={{ background:'#fff', borderRadius:'0 8px 8px 8px', padding:'10px 12px', maxWidth:'88%', boxShadow:'0 1px 3px rgba(0,0,0,0.1)', display:'inline-block' }}>
                {templateType === 'STANDARD' && headerKind === 'IMAGE' && (
                  headerPreview
                    ? <img src={headerPreview} alt="" style={{ display:'block', width:'100%', maxWidth:220, borderRadius:6, marginBottom:7 }} />
                    : <div style={{ width:220, height:110, borderRadius:6, marginBottom:7, background:'#d9d2c9', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#7a736b' }}>Image header</div>
                )}
                {templateType === 'STANDARD' && ['VIDEO', 'DOCUMENT'].includes(headerKind) && (
                  <div style={{ width:220, height: headerKind === 'VIDEO' ? 110 : 64, borderRadius:6, marginBottom:7, background:'#d9d2c9', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#7a736b' }}>
                    {HEADER_FORMAT_META[headerKind].label} header
                  </div>
                )}
                {templateType === 'STANDARD' && headerKind === 'TEXT' && headerText && (
                  <p style={{ fontSize:12.5, fontWeight:700, color:'#111', margin:'0 0 4px', lineHeight:1.4 }}>{headerText}</p>
                )}
                <p style={{ fontSize:12, color:'#111', lineHeight:1.5, whiteSpace:'pre-wrap', wordBreak:'break-word', fontFamily:'system-ui,-apple-system,sans-serif', margin:0 }}>
                  {body || <span style={{ color:'#999', fontStyle:'italic' }}>Body preview…</span>}
                </p>
                {templateType !== 'CAROUSEL' && footer && (
                  <p style={{ fontSize:10.5, color:'#888', marginTop:6, lineHeight:1.4 }}>{footer}</p>
                )}
                {templateType === 'STANDARD' && buttons.filter(b => (b.text || '').trim()).length > 0 && (
                  <div style={{ marginTop:8, borderTop:'1px solid #e4e0d8', paddingTop:2 }}>
                    {buttons.filter(b => (b.text || '').trim()).map((b, i) => (
                      <div key={i} style={{ textAlign:'center', padding:'7px 4px', fontSize:12, color:'#00a5f4', fontWeight:500, borderTop: i > 0 ? '1px solid #e4e0d8' : 'none' }}>
                        {{ URL:'↗ ', PHONE_NUMBER:'✆ ', COPY_CODE:'⧉ ' }[b.type] || ''}{b.text}
                      </div>
                    ))}
                  </div>
                )}
                {templateType === 'CATALOG' && catalogLabel.trim() && (
                  <div style={{ marginTop:8, borderTop:'1px solid #e4e0d8', paddingTop:2 }}>
                    <div style={{ textAlign:'center', padding:'7px 4px', fontSize:12, color:'#00a5f4', fontWeight:500 }}>
                      {'▦ '}{catalogLabel}
                    </div>
                  </div>
                )}
              </div>

              {/* Cards sit below the bubble and scroll sideways, the way WhatsApp shows them. */}
              {templateType === 'CAROUSEL' && cards.length > 0 && (
                <div style={{ display:'flex', gap:8, marginTop:8, overflowX:'auto', paddingBottom:4 }}>
                  {cards.map((c, i) => (
                    <div key={i} style={{ flex:'0 0 150px', background:'#fff', borderRadius:8, overflow:'hidden', boxShadow:'0 1px 3px rgba(0,0,0,0.1)' }}>
                      {c.preview
                        ? <img src={c.preview} alt="" style={{ display:'block', width:'100%', height:88, objectFit:'cover' }} />
                        : <div style={{ width:'100%', height:88, background:'#d9d2c9', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10.5, color:'#7a736b' }}>Card {i + 1} image</div>}
                      {c.body.trim() && (
                        <p style={{ fontSize:11, color:'#111', lineHeight:1.45, padding:'7px 9px 0', margin:0, wordBreak:'break-word' }}>{c.body}</p>
                      )}
                      <div style={{ marginTop:6 }}>
                        {c.buttons.filter(b => (b.text || '').trim()).map((b, bi) => (
                          <div key={bi} style={{ textAlign:'center', padding:'6px 4px', fontSize:11.5, color:'#00a5f4', fontWeight:500, borderTop:'1px solid #e4e0d8' }}>
                            {b.type === 'URL' ? '↗ ' : ''}{b.text}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ padding:'14px 24px', borderTop:'1px solid var(--bd)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <span style={{ fontSize:11, color:'var(--t3)' }}>Approval by Meta usually takes minutes to hours.</span>
          <div style={{ display:'flex', gap:8 }}>
            <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            <Btn onClick={submit} disabled={saving || !body.trim() || !nameValid} style={{ boxShadow: (saving || !body.trim() || !nameValid) ? 'none' : 'var(--glow)' }}>
              {saving ? (isEdit ? 'Saving…' : 'Submitting…') : (isEdit ? 'Save Changes' : 'Submit to Meta')}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
};

const CATEGORY_FILTERS = [
  { id: 'ALL',            label: 'All'              },
  { id: 'MARKETING',      label: 'Marketing'        },
  { id: 'UTILITY',        label: 'Utility'          },
  { id: 'AUTHENTICATION', label: 'Authentication'   },
];

const TemplatesView = () => {
  const rates = useMessageRates();
  // Templates are day-to-day work, not an admin privilege.
  const isAdmin = canManage();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [syncing, setSyncing]     = useState(false);
  const [syncMsg, setSyncMsg]     = useState(null);
  const [newOpen, setNewOpen]     = useState(false);
  const [aiOpen, setAiOpen]       = useState(false);
  // Template whose Meta re-categorisation we are rewriting.
  const [variantTpl, setVariantTpl] = useState(null);
  // Draft handed from the AI panel to TemplateModal as its initial values.
  const [aiSeed, setAiSeed]       = useState(null);
  const [tab, setTab]             = useState('my');         // 'my' | 'library'
  // 'ACTIVE' | 'DELETED' — the recycle bin is a server-side filter, not a
  // client-side one, because deleted templates are excluded from the default
  // list entirely rather than being fetched and hidden.
  const [view, setView]           = useState('ACTIVE');
  const [restoringId, setRestoringId] = useState(null);
  // Category segregation for "My Templates". Meta's three categories price and
  // behave differently, so filtering by them is how you actually find anything
  // once a workspace has more than a handful.
  const [catFilter, setCatFilter] = useState('ALL');
  const [search, setSearch]       = useState('');
  const [hasNumber, setHasNumber] = useState(null);          // null = unknown, true/false
  // Library installs and Meta syncs are per-number — when a workspace has
  // more than one, resolveWaNumber() on the backend can't guess which one,
  // so the UI must collect it (same requirement TemplateModal already has
  // for manual template creation).
  const [numbers, setNumbers]     = useState([]);
  const [waNumberId, setWaNumberId] = useState('');
  const [library, setLibrary]     = useState([]);
  const [libLoading, setLibLoading] = useState(false);
  const [libFilter, setLibFilter] = useState('ALL');
  const [libSearch, setLibSearch] = useState('');
  const [installing, setInstalling] = useState(null);        // libraryId being installed
  const [previewLib, setPreviewLib] = useState(null);        // library item shown in preview modal
  const [editTpl, setEditTpl]     = useState(null);           // template being edited
  const [previewTpl, setPreviewTpl] = useState(null);         // template shown in preview modal
  const [deletingId, setDeletingId] = useState(null);
  const [toast, setToast]         = useState(null);

  const deleteTemplate = async (t) => {
    if (!window.confirm(`Delete template "${t.name}"? If synced to Meta, it will be deleted there too.`)) return;
    setDeletingId(t.id);
    try {
      const res = await wFetch(`/templates/${t.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        setToast({ error: data.error || `Delete failed (${res.status})` });
        return;
      }
      setToast({ ok: `Deleted "${t.name}".` });
      await loadTemplates();
    } catch (e) {
      setToast({ error: e.message });
    } finally {
      setDeletingId(null);
    }
  };

  // The 20s poll below is set up once, so it closes over the first render's
  // `view`. Reading through a ref instead keeps a poll that fires while the
  // recycle bin is open from replacing it with the active list.
  const viewRef = useRef(view);
  viewRef.current = view;

  const loadTemplates = (which = viewRef.current) =>
    wFetch(which === 'DELETED' ? '/templates?status=DELETED' : '/templates')
      .then(r=>r.ok&&r.json()).then(d=>{ if(Array.isArray(d)) setTemplates(d); }).catch(()=>{});

  // Switching views refetches rather than filtering what is already loaded.
  useEffect(() => { setTemplates([]); setLoading(true); loadTemplates(view).finally(() => setLoading(false)); }, [view]); // eslint-disable-line

  // Category segregation and search, applied to whichever view (Active or
  // Deleted) is loaded. Both filter in place — the list is already fetched, and
  // the server-side split is by deleted/live, not by category.
  const tplQuery = search.trim().toLowerCase();
  const visibleTemplates = templates.filter((t) => {
    if (catFilter !== 'ALL' && t.category !== catFilter) return false;
    if (!tplQuery) return true;
    return String(t.name || '').toLowerCase().includes(tplQuery)
      || String(t.category || '').toLowerCase().includes(tplQuery)
      || String(t.language || '').toLowerCase().includes(tplQuery)
      || getBodyText(t.components).toLowerCase().includes(tplQuery);
  });

  // Counts per category, so the chips say how much is behind each one rather
  // than making the user click to find out.
  const catCounts = templates.reduce((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + 1;
    return acc;
  }, {});

  const restoreTemplate = async (t) => {
    setRestoringId(t.id);
    setToast(null);
    try {
      const res = await wFetch(`/templates/${t.id}/restore`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setToast({ error: data.error || `Could not restore (${res.status})` }); return; }
      setToast({ ok: data.status === 'PENDING'
        ? `"${t.name}" was restored and resubmitted to Meta for review.`
        : `"${t.name}" was restored.` });
      loadTemplates(view);
    } catch (e) {
      setToast({ error: e.message });
    } finally {
      setRestoringId(null);
    }
  };

  const loadHasNumber = () =>
    wFetch('/whatsapp/numbers').then(r=>r.ok&&r.json()).then(d=>{
      const list = Array.isArray(d) ? d : [];
      setNumbers(list);
      setHasNumber(list.length > 0);
      if (list.length === 1) setWaNumberId(list[0].id);
    }).catch(()=>setHasNumber(false));

  const loadLibrary = async () => {
    setLibLoading(true);
    try {
      const res  = await wFetch('/templates/library');
      const data = await res.json();
      if (res.ok && Array.isArray(data)) setLibrary(data);
      else setLibrary([]);
    } catch { setLibrary([]); }
    finally { setLibLoading(false); }
  };

  const installLib = async (item) => {
    if (hasNumber === false) {
      setToast({ error: 'You must purchase a WhatsApp number before getting templates from the library.' });
      return;
    }
    if (numbers.length > 1 && !waNumberId) {
      setToast({ error: 'Select which WhatsApp number to install this template on first.' });
      return;
    }
    setInstalling(item.id);
    try {
      const res  = await wFetch(`/templates/library/${item.id}/install`, {
        method: 'POST',
        body: JSON.stringify({ ...(waNumberId ? { waNumberId } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) { setToast({ error: data.error || 'Install failed' }); return; }
      setToast({ ok: `"${item.title}" submitted to Meta — status: PENDING.` });
      await Promise.all([loadTemplates(), loadLibrary()]);
    } catch (e) {
      setToast({ error: e.message });
    } finally {
      setInstalling(null);
    }
  };

  const syncFromMeta = async () => {
    if (numbers.length > 1 && !waNumberId) {
      setSyncMsg({ error: 'Select which WhatsApp number to sync templates for first.' });
      return;
    }
    setSyncing(true); setSyncMsg(null);
    try {
      const res  = await wFetch('/templates/sync-from-meta', {
        method:'POST',
        body: JSON.stringify({ ...(waNumberId ? { waNumberId } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) { setSyncMsg({ error: data.error || 'Sync failed' }); return; }
      setSyncMsg({ ok: true, created: data.created, updated: data.updated, removed: data.removed, total: data.total });
      await loadTemplates();
    } catch (e) {
      setSyncMsg({ error: e.message });
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    loadHasNumber();
    // The initial fetch belongs to the view effect above, which runs on mount
    // too — doing it here as well would race it.
    // Poll every 20s so Meta status changes (APPROVED/REJECTED) surface even if
    // the message_template_status_update webhook isn't subscribed.
    const interval = setInterval(() => {
      loadTemplates();
      if (tab === 'library') loadLibrary();
    }, 20000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line

  useEffect(() => {
    const onDataUpdated = (e) => {
      if (e.detail?.templates) loadTemplates();
    };
    window.addEventListener('app:data-updated', onDataUpdated);
    return () => window.removeEventListener('app:data-updated', onDataUpdated);
  }, []);

  useEffect(() => {
    if (tab === 'library' && library.length === 0) loadLibrary();
  }, [tab]); // eslint-disable-line

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const filteredLib = library.filter(l => {
    if (libFilter !== 'ALL' && l.category !== libFilter) return false;
    if (libSearch && !`${l.title} ${l.description} ${l.useCase} ${l.body}`.toLowerCase().includes(libSearch.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <DashHeader title="Templates" subtitle="Create and manage message templates"
        searchKey={tab}
        searchPlaceholder={tab === 'library' ? 'Search library…' : 'Search templates…'}
        onSearch={tab === 'library' ? setLibSearch : setSearch} />
      <div className="dash-page" style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        {/* Sending an approved template spends from the wallet, so the warning
            states belong here too — but not the healthy one, which would just
            be noise on a screen that is mostly authoring. */}
        <WalletStatusBanner hideWhenHealthy style={{ marginBottom: 16 }} />
        {/* Tab switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 18, borderBottom: '1px solid var(--bd)' }}>
          {[
            { id: 'my',      label: 'My Templates', icon: 'file' },
            { id: 'library', label: 'Library',      icon: 'spark' },
          ].map(t => {
            const on = tab === t.id;
            return (
              <div key={t.id}
                onClick={() => setTab(t.id)}
                tabIndex={0} role="tab" aria-selected={on}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTab(t.id); } }}
                style={{
                  display:'flex', alignItems:'center', gap:7, padding:'10px 14px', cursor:'pointer',
                  fontSize:13, fontWeight: on ? 700 : 500,
                  color: on ? 'var(--t1)' : 'var(--t2)',
                  borderBottom: `2px solid ${on ? 'var(--green)' : 'transparent'}`,
                  marginBottom: -1, transition: 'all .15s', outline:'none',
                }}
                onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--green)'; }}
                onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}>
                <I n={t.icon} s={13} c={on ? 'var(--green)' : 'var(--t2)'} />
                {t.label}
                {t.id === 'library' && (
                  <span style={{ marginLeft:4, padding:'1px 6px', borderRadius:8, fontSize:9, fontWeight:800, background:'var(--gbg)', border:'1px solid var(--gbd)', color:'var(--green)', letterSpacing:'.04em' }}>NEW</span>
                )}
              </div>
            );
          })}
        </div>

        {/* WhatsApp number — templates are private per number, so a workspace
            with more than one must pick which number Library installs and
            Meta syncs apply to. */}
        {numbers.length > 1 && (
          <div style={{ marginBottom:16, display:'flex', alignItems:'center', gap:10 }}>
            <label style={{ fontSize:12, fontWeight:700, color:'var(--t2)', whiteSpace:'nowrap' }}>WhatsApp Number</label>
            <select value={waNumberId} onChange={e => setWaNumberId(e.target.value)}
              style={{ maxWidth:280, padding:'9px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, fontFamily:"'Manrope',sans-serif", outline:'none', boxSizing:'border-box', appearance:'auto', colorScheme:'dark' }}>
              <option value="">Select a number…</option>
              {numbers.map(n => <option key={n.id} value={n.id}>{n.phoneNumber}{n.displayName ? ` · ${n.displayName}` : ''}</option>)}
            </select>
          </div>
        )}

        {/* Toast — global for both tabs */}
        {toast && (
          <div style={{ marginBottom:14, padding:'10px 14px', borderRadius:8,
            background: toast.error ? 'rgba(239,68,68,.08)' : 'var(--gbg)',
            border: `1px solid ${toast.error ? 'rgba(239,68,68,.22)' : 'var(--gbd)'}`,
            display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <p style={{ fontSize:12, color: toast.error ? '#f87171' : 'var(--green)' }}>{toast.error || toast.ok}</p>
            <button onClick={()=>setToast(null)} style={{ background:'none', border:'none', cursor:'pointer', padding:0, display:'flex' }}>
              <I n="x" s={12} c={toast.error ? '#f87171' : 'var(--green)'} />
            </button>
          </div>
        )}

        {tab === 'library' ? (
          <LibraryPane
            hasNumber={hasNumber}
            loading={libLoading}
            items={filteredLib}
            filter={libFilter} setFilter={setLibFilter}
            search={libSearch} setSearch={setLibSearch}
            onPreview={setPreviewLib}
            onInstall={installLib}
            installing={installing}
          />
        ) : (
        <>
        {/* Active / Deleted. Deleted templates are kept rather than removed, so a
            template deleted by mistake — or one Meta dropped — can be brought
            back instead of rebuilt. */}
        <div style={{ display:'flex', gap:4, padding:3, borderRadius:9, background:'var(--surf)', border:'1px solid var(--bd)', marginBottom:16, width:'fit-content' }}>
          {[['ACTIVE', 'Active'], ['DELETED', 'Deleted']].map(([id, label]) => {
            const on = view === id;
            return (
              <div key={id} onClick={() => setView(id)}
                style={{ padding:'6px 14px', borderRadius:7, cursor:'pointer', fontSize:12, fontWeight: on ? 700 : 500,
                         color: on ? '#08090c' : 'var(--t2)', background: on ? 'var(--green)' : 'transparent',
                         transition:'all .12s', whiteSpace:'nowrap' }}>
                {label}
              </div>
            );
          })}
        </div>

        {/* Category segregation. Meta's three categories price and behave
            differently, so this is the split that matters once a workspace has
            more than a handful of templates. */}
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:16, flexWrap:'wrap' }}>
          <div style={{ display:'flex', gap:4, padding:3, borderRadius:9, background:'var(--surf)', border:'1px solid var(--bd)' }}>
            {CATEGORY_FILTERS.map(f => {
              const on = catFilter === f.id;
              const n = f.id === 'ALL' ? templates.length : (catCounts[f.id] || 0);
              return (
                <div key={f.id} onClick={() => setCatFilter(f.id)}
                  style={{ padding:'6px 12px', borderRadius:7, cursor:'pointer', fontSize:12, fontWeight: on ? 700 : 500,
                           color: on ? '#08090c' : 'var(--t2)', background: on ? 'var(--green)' : 'transparent',
                           transition:'all .12s', whiteSpace:'nowrap' }}>
                  {f.label}
                  <span style={{ marginLeft:6, opacity:.7, fontWeight:600 }}>{n}</span>
                </div>
              );
            })}
          </div>
          {(catFilter !== 'ALL' || tplQuery) && (
            <span style={{ fontSize:11.5, color:'var(--t3)' }}>
              Showing {visibleTemplates.length} of {templates.length}
              <button onClick={() => { setCatFilter('ALL'); setSearch(''); }}
                style={{ marginLeft:8, background:'none', border:'none', padding:0, cursor:'pointer', color:'var(--green)', fontSize:11.5, fontWeight:600 }}>
                Clear
              </button>
            </span>
          )}
        </div>

        {isAdmin && view === 'ACTIVE' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', rowGap: 10 }}>
            <Btn variant="outline" onClick={syncFromMeta} disabled={syncing}>
              <I n="refresh" s={13} c={syncing ? 'var(--t3)' : 'var(--green)'} />
              {syncing ? 'Syncing from Meta…' : 'Sync from Meta'}
            </Btn>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <Btn variant="outline" onClick={() => setAiOpen(true)}>
                <I n="spark" s={14} c="var(--green)" /> Create with AI
              </Btn>
              <Btn onClick={() => setNewOpen(true)} style={{ boxShadow: 'var(--glow)' }}>
                <I n="file" s={14} c="#08090c" /> New Template
              </Btn>
            </div>
          </div>
        )}

        {syncMsg && (
          <div style={{ marginBottom:16, padding:'10px 14px', borderRadius:8,
            background: syncMsg.error ? 'rgba(239,68,68,.08)' : 'var(--gbg)',
            border: `1px solid ${syncMsg.error ? 'rgba(239,68,68,.2)' : 'var(--gbd)'}` }}>
            {syncMsg.error
              ? <p style={{ fontSize:12, color:'#f87171' }}>{syncMsg.error}</p>
              : <p style={{ fontSize:12, color:'var(--green)' }}>
                  Synced {syncMsg.total} template{syncMsg.total !== 1 ? 's' : ''} from Meta
                  {syncMsg.created > 0 ? ` · ${syncMsg.created} new` : ''}
                  {syncMsg.updated > 0 ? ` · ${syncMsg.updated} updated` : ''}
                  {syncMsg.removed > 0 ? ` · ${syncMsg.removed} removed (deleted on Meta)` : ''}.
                </p>
            }
          </div>
        )}

        {loading ? (
          <div style={{ textAlign:'center', padding:'48px', color:'var(--t2)', fontSize:13 }}>
            <div style={{ width:28, height:28, border:'2px solid var(--green)', borderTopColor:'transparent', borderRadius:'50%', margin:'0 auto 12px', animation:'spin 1s linear infinite' }}/>
            Loading templates…
          </div>
        ) : visibleTemplates.length === 0 && (catFilter !== 'ALL' || tplQuery) ? (
          <div style={{ textAlign:'center', padding:'48px' }}>
            <I n="filter" s={34} c="var(--t3)" />
            <p style={{ fontSize:13, color:'var(--t2)', marginTop:12 }}>No templates match.</p>
            <p style={{ fontSize:11.5, color:'var(--t3)', marginTop:5 }}>
              {templates.length} template{templates.length === 1 ? '' : 's'} in this view — try a different category or search.
            </p>
            <Btn variant="outline" size="sm" style={{ marginTop:14 }} onClick={() => { setCatFilter('ALL'); setSearch(''); }}>
              Clear filters
            </Btn>
          </div>
        ) : visibleTemplates.length === 0 && view === 'DELETED' ? (
          <div style={{ textAlign:'center', padding:'48px' }}>
            <I n="trash" s={36} c="var(--t3)" />
            <p style={{ fontSize:13, color:'var(--t2)', marginTop:12 }}>Nothing deleted.</p>
            <p style={{ fontSize:11.5, color:'var(--t3)', marginTop:5 }}>Deleted templates are kept here so you can restore them.</p>
          </div>
        ) : visibleTemplates.length === 0 ? (
          <div style={{ textAlign:'center', padding:'48px' }}>
            <I n="file" s={40} c="var(--t3)" />
            <p style={{ fontSize:13, color:'var(--t2)', marginTop:12, marginBottom:16 }}>No templates yet.</p>
            {isAdmin && (
              <Btn variant="outline" onClick={syncFromMeta} disabled={syncing}>
                <I n="refresh" s={13} c="var(--green)" />
                {syncing ? 'Syncing…' : 'Sync from Meta'}
              </Btn>
            )}
          </div>
        ) : (
          <div className="rgrid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }}>
            {visibleTemplates.map(t => {
              const bodyText = getBodyText(t.components);
              return (
                <div key={t.id} style={{ ...card, padding: '20px', transition: 'border-color .2s,transform .2s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--bdm)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--bd)'; e.currentTarget.style.transform = 'none'; }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', flexWrap: 'wrap', rowGap: 10 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: '14px', color: 'var(--t1)', marginBottom: '5px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.name}</p>
                      <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '5px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t2)' }}>{t.category}</span>
                        {/* Standard is the norm, so only the shopping formats are called out. */}
                        {t.templateType && t.templateType !== 'STANDARD' && (
                          <span style={{ fontSize:'11px', padding:'2px 8px', borderRadius:'5px', background:'rgba(196,255,70,.10)', border:'1px solid rgba(196,255,70,.28)', color:'#c4ff46', fontWeight:700 }}>
                            {TEMPLATE_TYPE_META[t.templateType]?.label || t.templateType}
                          </span>
                        )}
                        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '5px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t3)' }}>{t.language}</span>
                        {/* Meta moved this template's category after approval.
                            Worth flagging because the per-message price follows
                            the category. */}
                        {t.previousCategory && t.previousCategory !== t.category && (
                          <span title={`Meta moved this from ${t.previousCategory} on ${t.categoryUpdatedAt ? new Date(t.categoryUpdatedAt).toLocaleDateString() : 'a recent review'}`}
                            style={{ fontSize:'11px', padding:'2px 8px', borderRadius:'5px', background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.3)', color:'#fbbf24' }}>
                            was {t.previousCategory}
                          </span>
                        )}
                      </div>
                    </div>
                    <StatusBadge s={statusLabel(t.status)} />
                  </div>
                  {/* Meta rejection reason */}
                  {t.status === 'REJECTED' && t.rejectedReason && (
                    <div style={{ padding:'8px 11px', borderRadius:6, background:'rgba(239,68,68,.06)', border:'1px solid rgba(239,68,68,.18)', marginBottom:12 }}>
                      <p style={{ fontSize:11, color:'#f87171', lineHeight:1.45 }}>
                        <strong>Rejected:</strong> {t.rejectedReason}
                      </p>
                    </div>
                  )}
                  <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px', border: '1px solid var(--bd)', minHeight: '60px' }}>
                    <p style={{ fontSize: '12px', color: 'var(--t1)', lineHeight: 1.55 }}>
                      {bodyText || <span style={{ color:'var(--t3)', fontStyle:'italic' }}>No body text</span>}
                    </p>
                  </div>
                  {/* Meta re-categorised this to MARKETING, which is ~7x the
                      utility rate per message. Offer the rewrite that gets it
                      back rather than leaving them to absorb the price. */}
                  {isAdmin && t.category === 'MARKETING' && t.previousCategory === 'UTILITY' && (
                    <div style={{ marginBottom:12, padding:'10px 12px', borderRadius:8, background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.25)' }}>
                      <p style={{ fontSize:11.5, color:'#fbbf24', lineHeight:1.5, marginBottom:7 }}>
                        Meta moved this to Marketing{rates ? ` — now ${inrRate(rates.MARKETING)} per message instead of ${inrRate(rates.UTILITY)}.` : ' — it now bills at the higher marketing rate.'}
                      </p>
                      <button onClick={() => setVariantTpl(t)}
                        style={{ background:'none', border:'none', padding:0, cursor:'pointer', color:'var(--green)', fontSize:11.5, fontWeight:700, fontFamily:"'Manrope',sans-serif" }}>
                        Generate a utility rewrite →
                      </button>
                    </div>
                  )}
                  {view === 'DELETED' ? (
                    <>
                      <p style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8 }}>
                        Deleted {t.updatedAt ? new Date(t.updatedAt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : ''}
                      </p>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <Btn variant="outline" size="sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setPreviewTpl(t)}>Preview</Btn>
                        {isAdmin && (
                          <Btn size="sm" style={{ flex: 1, justifyContent: 'center' }}
                            onClick={() => restoreTemplate(t)} disabled={restoringId === t.id}>
                            <I n="rotate" s={12} c="#08090c" />
                            {restoringId === t.id ? 'Restoring…' : 'Restore'}
                          </Btn>
                        )}
                      </div>
                    </>
                  ) : (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {isAdmin && <Btn variant="ghost" size="sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setEditTpl(t)}>Edit</Btn>}
                    <Btn variant="outline" size="sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setPreviewTpl(t)}>Preview</Btn>
                    {isAdmin && <Btn variant="ghost" size="sm" onClick={() => deleteTemplate(t)} disabled={deletingId === t.id}
                      style={{ justifyContent: 'center', color: '#f87171' }} title="Delete template">
                      {deletingId === t.id ? '…' : <I n="trash" s={13} c="#f87171" />}
                    </Btn>}
                  </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </>
        )}
      </div>

      {variantTpl && (
        <UtilityVariantModal
          template={variantTpl}
          onClose={() => setVariantTpl(null)}
          onUseDraft={(v) => { setVariantTpl(null); setAiSeed(v); setNewOpen(true); }}
        />
      )}

      {aiOpen && (
        <TemplateAiPanel
          onClose={() => setAiOpen(false)}
          onUseDraft={(draft) => { setAiSeed(draft); setAiOpen(false); setNewOpen(true); }}
        />
      )}

      {newOpen && (
        <TemplateModal
          seed={aiSeed}
          onClose={() => { setNewOpen(false); setAiSeed(null); }}
          onSaved={() => { setNewOpen(false); setAiSeed(null); loadTemplates(); setSyncMsg({ ok:true, created:1, updated:0, total:1 }); }}
        />
      )}

      {editTpl && (
        <TemplateModal
          template={editTpl}
          onClose={() => setEditTpl(null)}
          onSaved={() => { setEditTpl(null); loadTemplates(); setToast({ ok: 'Template updated.' }); }}
        />
      )}

      {previewTpl && (
        <TemplatePreviewModal template={previewTpl} onClose={() => setPreviewTpl(null)} />
      )}

      {previewLib && (
        <LibraryPreviewModal
          item={previewLib}
          onClose={() => setPreviewLib(null)}
          onInstall={() => { installLib(previewLib); setPreviewLib(null); }}
          installing={installing === previewLib.id}
        />
      )}
    </div>
  );
};

// WhatsApp-style bubble preview of one of the workspace's own templates.
const TemplatePreviewModal = ({ template, onClose }) => {
  const [headerPreview, setHeaderPreview] = useState(null);

  useEffect(() => {
    const headerComp = Array.isArray(template?.components)
      ? template.components.find(c => (c.type || '').toUpperCase() === 'HEADER')
      : null;

    if (template?.headerAssetId) {
      let active = true;
      let objectUrl = null;
      wFetch(`/templates/media/${template.headerAssetId}`)
        .then(res => res.ok ? res.blob() : null)
        .then(blob => {
          if (active && blob) {
            objectUrl = URL.createObjectURL(blob);
            setHeaderPreview(objectUrl);
          } else if (active) {
            setHeaderPreview('placeholder');
          }
        })
        .catch(() => {
          if (active) setHeaderPreview('placeholder');
        });
      return () => {
        active = false;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    } else {
      const exampleUrl = headerComp?.example?.header_url?.[0] || headerComp?.example?.header_handle?.[0];
      if (exampleUrl && typeof exampleUrl === 'string' && exampleUrl.startsWith('http')) {
        setHeaderPreview(exampleUrl);
      } else if (headerComp?.format === 'IMAGE') {
        setHeaderPreview('placeholder');
      }
    }
  }, [template]);

  const bodyText = getBodyText(template.components);
  const footerText = Array.isArray(template.components)
    ? (template.components.find(c => (c.type || '').toUpperCase() === 'FOOTER')?.text ?? '')
    : '';

  const headerComp = Array.isArray(template.components)
    ? template.components.find(c => (c.type || '').toUpperCase() === 'HEADER')
    : null;
  const isTextHeader = headerComp?.format === 'TEXT';
  const isImageHeader = headerComp?.format === 'IMAGE';

  return (
    <div onClick={onClose} onKeyDown={e => { if (e.key === 'Escape') onClose(); }} role="dialog" aria-modal="true" aria-label={template.name} style={{ position:'fixed', inset:0, background:'rgba(3,5,12,0.78)', backdropFilter:'blur(4px)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e => e.stopPropagation()} tabIndex={-1} style={{ ...card, width:'100%', maxWidth:480, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <p style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)' }}>{template.name}</p>
            <p style={{ fontSize:11.5, color:'var(--t2)', marginTop:2 }}>{template.category} · {template.language} · <StatusBadge s={statusLabel(template.status)} /></p>
          </div>
          <button onClick={onClose} style={{ width:28, height:28, borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="x" s={12} c="var(--t2)" />
          </button>
        </div>
        <div style={{ padding:20 }}>
          <div style={{ background:'#ECE5DD', borderRadius:10, padding:14, minHeight:60 }}>
            <div style={{ background:'#fff', borderRadius:'0 8px 8px 8px', padding:'10px 12px', maxWidth:'88%', boxShadow:'0 1px 3px rgba(0,0,0,0.1)', display:'inline-block' }}>
              {isImageHeader && (
                <div style={{ marginBottom: 8, borderRadius: 6, overflow: 'hidden', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: (headerPreview && headerPreview !== 'placeholder') ? 'auto' : 120 }}>
                  {headerPreview === 'placeholder' ? (
                    <span style={{ fontSize: 12, color: '#888', padding: 20 }}>Image header</span>
                  ) : headerPreview ? (
                    <img src={headerPreview} alt="Header" style={{ width: '100%', display: 'block' }} />
                  ) : (
                    <span style={{ fontSize: 11, color: '#999', padding: 20 }}>Loading image…</span>
                  )}
                </div>
              )}
              {isTextHeader && headerComp.text && (
                <p style={{ fontSize: 13, fontWeight: 700, color: '#111', margin: '0 0 6px', fontFamily: 'system-ui,-apple-system,sans-serif' }}>
                  {headerComp.text}
                </p>
              )}
              <p style={{ fontSize:12, color:'#111', lineHeight:1.5, whiteSpace:'pre-wrap', wordBreak:'break-word', fontFamily:'system-ui,-apple-system,sans-serif', margin:0 }}>
                {bodyText || <span style={{ color:'#999', fontStyle:'italic' }}>No body text</span>}
              </p>
              {footerText && <p style={{ fontSize:10.5, color:'#888', marginTop:6, lineHeight:1.4 }}>{footerText}</p>}
            </div>
          </div>
          <p style={{ fontSize:11, color:'var(--t3)', marginTop:8 }}>Placeholders like {'{{1}}'} are filled per recipient at send time.</p>
        </div>
        <div style={{ padding:'12px 20px', borderTop:'1px solid var(--bd)', display:'flex', justifyContent:'flex-end' }}>
          <Btn variant="ghost" size="sm" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </div>
  );
};

const LibraryPane = ({ hasNumber, loading, items, filter, setFilter, search, setSearch, onPreview, onInstall, installing }) => {
  if (hasNumber === null) {
    return (
      <div style={{ textAlign:'center', padding:'48px', color:'var(--t2)', fontSize:13 }}>
        <div style={{ width:28, height:28, border:'2px solid var(--green)', borderTopColor:'transparent', borderRadius:'50%', margin:'0 auto 12px', animation:'spin 1s linear infinite' }}/>
        Checking workspace…
      </div>
    );
  }

  return (
    <>
      {hasNumber === false && (
        <div style={{ ...card, padding:'14px 18px', marginBottom:14, display:'flex', alignItems:'center', gap:12,
          background:'rgba(245,158,11,.06)', border:'1px solid rgba(245,158,11,.25)' }}>
          <I n="alertt" s={18} c="#fbbf24" />
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontSize:13, fontWeight:700, color:'#fbbf24', marginBottom:2 }}>No WhatsApp number connected</p>
            <p style={{ fontSize:12, color:'var(--t2)', lineHeight:1.45 }}>You can browse and preview templates, but you need a connected number before you can install one.</p>
          </div>
          <Btn variant="outline" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('app:nav', { detail: 'setup' }))}>
            <I n="phone" s={12} c="var(--green)" /> Get a number
          </Btn>
        </div>
      )}

      {/* Hero strip */}
      <div style={{ ...card, padding:'18px 22px', marginBottom:18, display:'flex', alignItems:'center', gap:16, background:'linear-gradient(135deg, rgba(53,232,242,0.06), rgba(53,232,242,0.01))' }}>
        <div style={{ width:44, height:44, borderRadius:12, background:'var(--gbg)', border:'1px solid var(--gbd)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:'var(--glow)' }}>
          <I n="spark" s={20} c="var(--green)" />
        </div>
        <div style={{ flex:1 }}>
          <p style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)', marginBottom:3 }}>Pre-built template library</p>
          <p style={{ fontSize:12, color:'var(--t2)' }}>One click to submit a battle-tested template to Meta for approval — usually approved in minutes.</p>
        </div>
      </div>

      {/* Filters + search */}
      <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ display:'flex', gap:4, padding:3, borderRadius:9, background:'var(--surf)', border:'1px solid var(--bd)' }}>
          {CATEGORY_FILTERS.map(f => {
            const on = filter === f.id;
            return (
              <div key={f.id} onClick={() => setFilter(f.id)}
                tabIndex={0} role="tab" aria-selected={on}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFilter(f.id); } }}
                style={{ padding:'6px 12px', borderRadius:7, cursor:'pointer', fontSize:12, fontWeight: on ? 700 : 500, color: on ? '#08090c' : 'var(--t2)', background: on ? 'var(--green)' : 'transparent', transition:'all .12s', whiteSpace:'nowrap', outline:'none' }}
                onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--green)'; }}
                onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}>
                {f.label}
              </div>
            );
          })}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', borderRadius:8, background:'var(--surf)', border:'1px solid var(--bd)', flex:1, minWidth:200, maxWidth:360 }}>
          <I n="search" s={13} c="var(--t2)" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search templates…"
            style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--t1)', fontSize:13, fontFamily:"'Manrope',sans-serif" }} />
        </div>
        <span style={{ fontSize:12, color:'var(--t3)', marginLeft:'auto' }}>{items.length} template{items.length !== 1 ? 's' : ''}</span>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:'48px', color:'var(--t2)', fontSize:13 }}>
          <div style={{ width:28, height:28, border:'2px solid var(--green)', borderTopColor:'transparent', borderRadius:'50%', margin:'0 auto 12px', animation:'spin 1s linear infinite' }}/>
          Loading library…
        </div>
      ) : items.length === 0 ? (
        <div style={{ textAlign:'center', padding:'48px', color:'var(--t2)', fontSize:13 }}>No templates match.</div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:14 }}>
          {items.map(it => {
            const installed = !!it.installedStatus;
            const isInstalling = installing === it.id;
            const catColor = it.category === 'MARKETING' ? '#c4ff46' : it.category === 'UTILITY' ? '#9d6bff' : '#fbbf24';
            return (
              <div key={it.id} style={{ ...card, padding:'18px', display:'flex', flexDirection:'column', gap:12, transition:'transform .15s, border-color .15s' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = 'var(--bdm)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = 'var(--bd)'; }}>

                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:14, color:'var(--t1)', marginBottom:4, lineHeight:1.3 }}>{it.title}</p>
                    <p style={{ fontSize:11.5, color:'var(--t2)', lineHeight:1.45 }}>{it.description}</p>
                  </div>
                  {installed && <StatusBadge s={it.installedStatus === 'APPROVED' ? 'Approved' : it.installedStatus === 'REJECTED' ? 'Rejected' : 'Pending'} />}
                </div>

                <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                  <span style={{ fontSize:10, padding:'2px 7px', borderRadius:5, background:`${catColor}14`, border:`1px solid ${catColor}33`, color:catColor, fontWeight:700, letterSpacing:'.04em' }}>{it.category}</span>
                  <span style={{ fontSize:10, padding:'2px 7px', borderRadius:5, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t3)' }}>{it.useCase}</span>
                  <span style={{ fontSize:10, padding:'2px 7px', borderRadius:5, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t3)' }}>{it.language}</span>
                </div>

                <div style={{ flex:1, background:'rgba(255,255,255,0.02)', border:'1px solid var(--bd)', borderRadius:8, padding:'10px 12px', minHeight:70 }}>
                  <p style={{ fontSize:12, color:'var(--t1)', lineHeight:1.5, overflow:'hidden', display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical' }}>{it.body}</p>
                </div>

                <div style={{ display:'flex', gap:8 }}>
                  <Btn variant="outline" size="sm" style={{ flex:1, justifyContent:'center' }} onClick={() => onPreview(it)}>
                    <I n="eye" s={12} c="var(--green)" /> Preview
                  </Btn>
                  <Btn size="sm" style={{ flex:1, justifyContent:'center', opacity: (installed || isInstalling) ? 0.55 : 1, cursor: (installed || isInstalling) ? 'not-allowed' : 'pointer' }}
                    disabled={installed || isInstalling}
                    onClick={() => onInstall(it)}>
                    {installed ? (<><I n="check" s={12} c="#08090c" /> Installed</>)
                      : isInstalling ? 'Submitting…'
                      : (<><I n="download" s={12} c="#08090c" /> Get it</>)}
                  </Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};

const LibraryPreviewModal = ({ item, onClose, onInstall, installing }) => {
  const installed = !!item.installedStatus;
  return (
    <div onClick={onClose} onKeyDown={e => { if (e.key === 'Escape') onClose(); }} role="dialog" aria-modal="true" aria-label={item.title} style={{ position:'fixed', inset:0, background:'rgba(3,5,12,0.78)', backdropFilter:'blur(4px)', zIndex:50, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e => e.stopPropagation()} tabIndex={-1} style={{ ...card, width:'100%', maxWidth:520, maxHeight:'85vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <p style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)' }}>{item.title}</p>
            <p style={{ fontSize:11.5, color:'var(--t2)', marginTop:2 }}>{item.useCase} · {item.category} · {item.language}</p>
          </div>
          <button onClick={onClose} style={{ width:28, height:28, borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="x" s={12} c="var(--t2)" />
          </button>
        </div>

        <div style={{ padding:20, overflowY:'auto', flex:1, display:'flex', flexDirection:'column', gap:14 }}>
          <p style={{ fontSize:13, color:'var(--t2)', lineHeight:1.55 }}>{item.description}</p>

          {/* Chat-bubble preview */}
          <div>
            <p style={{ fontSize:10, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:8 }}>Preview</p>
            <div style={{ padding:16, borderRadius:10, background:'#0a1426', border:'1px solid var(--bd)', backgroundImage:'radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)', backgroundSize:'12px 12px' }}>
              <div style={{ display:'inline-block', maxWidth:'90%', padding:'10px 14px', background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'14px 14px 14px 3px', boxShadow:'var(--card-shadow)' }}>
                <p style={{ fontSize:13, color:'var(--t1)', lineHeight:1.55, whiteSpace:'pre-wrap' }}>{item.body}</p>
                <p style={{ fontSize:10, color:'var(--t3)', textAlign:'right', marginTop:4 }}>now</p>
              </div>
            </div>
            <p style={{ fontSize:11, color:'var(--t3)', marginTop:6 }}>Placeholders like <code style={{ background:'rgba(255,255,255,0.05)', padding:'1px 5px', borderRadius:4 }}>{`{{1}}`}</code> are filled in per recipient at send time.</p>
          </div>

          <div>
            <p style={{ fontSize:10, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:6 }}>Template Name</p>
            <code style={{ display:'inline-block', fontSize:12, color:'var(--t1)', background:'rgba(255,255,255,0.04)', padding:'5px 10px', borderRadius:6, border:'1px solid var(--bd)', fontFamily:'monospace' }}>{item.name}</code>
          </div>
        </div>

        <div style={{ padding:'14px 20px', borderTop:'1px solid var(--bd)', display:'flex', gap:10, justifyContent:'flex-end' }}>
          <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
          <Btn size="sm" disabled={installed || installing} onClick={onInstall}
            style={{ opacity: (installed || installing) ? 0.55 : 1, cursor: (installed || installing) ? 'not-allowed' : 'pointer', boxShadow:'var(--glow)' }}>
            {installed ? (<><I n="check" s={12} c="#08090c" /> Already installed</>)
              : installing ? 'Submitting…'
              : (<><I n="download" s={12} c="#08090c" /> Get this template</>)}
          </Btn>
        </div>
      </div>
    </div>
  );
};

const PlaceholderView = ({ title, icon }) => (
  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    <DashHeader title={title} />
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '14px', color: 'var(--t2)' }}>
      <div style={{ width: '56px', height: '56px', borderRadius: '14px', background: 'var(--surf)', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--card-shadow)' }}>
        <I n={icon} s={24} c="var(--t2)" />
      </div>
      <div style={{ textAlign: 'center' }}>
        <h3 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: '17px', color: 'var(--t1)', marginBottom: '6px' }}>{title}</h3>
        <p style={{ fontSize: '13px' }}>Full interface available in the production app.</p>
      </div>
    </div>
  </div>
);

const ADMIN_NAV = [
  { id: 'home',           label: 'Home',           icon: 'home'  },
  { id: 'templates',      label: 'Templates',      icon: 'file'  },
  { id: 'campaigns',      label: 'Campaigns',      icon: 'send'  },
  { id: 'contacts',       label: 'Contacts',       icon: 'users' },
  { id: 'inbox',          label: 'Inbox',          icon: 'msg'   },
  { id: 'widget',         label: 'Website Widget', icon: 'globe' },
  { id: 'integrations',   label: 'Integrations',   icon: 'plug'  },
  { id: 'ai-agent',       label: 'AI Agent',       icon: 'bot'   },
  { id: 'automation',     label: 'Automation',     icon: 'zap'   },
  { id: 'intent-matching', label: 'Intent Matching', icon: 'spark' },
  { id: 'analytics',      label: 'Analytics',      icon: 'chart' },
  { id: 'chat-analysis',  label: 'Chat Analysis',  icon: 'chart' },
  { id: 'user-analytics', label: 'User Analytics', icon: 'user'  },
  { id: 'setup',          label: 'Number Setup',   icon: 'phone' },
  { id: 'payments',       label: 'Payments',       icon: 'credit' },
  { id: 'api',            label: 'API Keys',       icon: 'key'   },
  { id: 'support',        label: 'Help & Support', icon: 'msg'   },
  { id: 'settings',       label: 'Settings',       icon: 'cog'   },
  { id: 'legal',          label: 'Legal',          icon: 'file'  },
];

// Super admins are platform operators, not workspace users — they only get
// the Platform Admin sections and their own account Settings, not the full
// per-workspace nav (Campaigns, Contacts, Inbox, etc.) that regular members
// see. Each section is its own top-level sidebar item (ids prefixed 'admin-'
// so they never collide with the workspace-scoped ids above, e.g. 'payments'
// / 'campaigns' / 'analytics' both exist under different meanings per role).
const ADMIN_TABS = [
  { id: 'admin-overview',     label: 'Overview',     icon: 'columns' },
  { id: 'admin-analytics',    label: 'Analytics',    icon: 'chart'   },
  { id: 'admin-revenue',      label: 'Revenue',      icon: 'credit'  },
  { id: 'admin-transactions', label: 'Transactions', icon: 'note'    },
  { id: 'admin-payments',     label: 'Payments',     icon: 'checkc'  },
  { id: 'admin-campaigns',    label: 'Campaigns',    icon: 'send'    },
  { id: 'admin-workspaces',   label: 'Workspaces',   icon: 'users'   },
  { id: 'admin-users',        label: 'Users',        icon: 'user'    },
  { id: 'admin-numbers',      label: 'Numbers',      icon: 'phone'   },
  { id: 'admin-plans',        label: 'Plans',        icon: 'file'    },
  { id: 'admin-support',      label: 'Support',      icon: 'msg'     },
  { id: 'admin-api-management', label: 'API Management', icon: 'key' },
  { id: 'admin-audit',        label: 'Audit & Security', icon: 'shield' },
];
const SUPERADMIN_NAV = [...ADMIN_TABS, { id: 'settings', label: 'Settings', icon: 'cog' }, { id: 'legal', label: 'Legal', icon: 'file' }];

// Sidebar grouping, from the ChatFlow Pro dashboard design: the nav is banded into
// labelled sections under mono eyebrows rather than presented as one flat run
// of sixteen items. Purely presentational — the ids are the same section ids
// ADMIN_NAV/ADMIN_TABS already define, so routing and VALID_SECTIONS are
// untouched. Any id not listed here still renders, under a trailing "MORE"
// band, so a new nav entry can never silently vanish from the sidebar.
// Sidebar glyphs, lifted from the design set's own nav (ChatFlow Pro Dashboard's
// navData). The app keeps its SVG icon set everywhere else — these are only
// the sidebar, which is what the design specifies.
//
// Written as escapes rather than literal characters so the file stays ASCII and
// survives any editor or terminal that is not UTF-8 clean.
//
// Worth knowing: colour emoji are painted from the platform's own font, so they
// ignore currentColor and will not tint with the active state, and they differ
// between Windows, macOS and Android. The active row is still unmistakable from
// its fill, left border and bolder label. U+2726 and U+26A1 are text glyphs
// rather than colour emoji, so those two do follow the text colour.
const NAV_EMOJI = {
  // straight from the design set
  home: '\u{1F3E0}', inbox: '\u{1F4AC}', campaigns: '\u{1F4E3}', templates: '\u{1F4C4}',
  contacts: '\u{1F465}', 'ai-agent': '\u2726', automation: '\u26A1', 'intent-matching': '\u{1F3AF}',
  analytics: '\u{1F4CA}', 'chat-analysis': '\u{1F50E}', 'user-analytics': '\u{1F4C8}',
  integrations: '\u{1F50C}', setup: '\u{1F4F1}', api: '\u{1F511}', payments: '\u{1F4B3}',
  support: '\u{1F6DF}', settings: '\u2699\uFE0F',
  // absent from the design set — chosen to sit alongside the rest
  widget: '\u{1F310}', legal: '\u{1F4DC}',
  'admin-overview': '\u{1F9ED}', 'admin-analytics': '\u{1F4CA}', 'admin-revenue': '\u{1F4B0}',
  'admin-transactions': '\u{1F9FE}', 'admin-payments': '\u2705', 'admin-campaigns': '\u{1F4E3}',
  'admin-workspaces': '\u{1F3E2}', 'admin-users': '\u{1F464}', 'admin-numbers': '\u{1F4F1}',
  'admin-plans': '\u{1F4CB}', 'admin-support': '\u{1F6DF}', 'admin-api-management': '\u{1F511}',
};

// The two glyphs the design set uses that are text, not colour emoji: these
// alone follow currentColor and need a little more size to hold their own.
const TEXT_GLYPHS = new Set(['\u2726', '\u26A1']);

const NAV_GROUPS = [
  { name: 'COMMAND',    ids: ['home', 'inbox'] },
  { name: 'GROW',       ids: ['campaigns', 'templates', 'contacts'] },
  { name: 'AUTOMATE',   ids: ['ai-agent', 'automation', 'intent-matching'] },
  { name: 'UNDERSTAND', ids: ['analytics', 'chat-analysis', 'user-analytics'] },
  { name: 'CONNECT',    ids: ['widget', 'integrations', 'setup', 'api', 'payments', 'support', 'settings'] },
];

// Super admins get their own banding: the platform sections have no analogue
// in the design set, so these are grouped by what an operator is doing —
// watching the platform, following the money, running it, answering for it.
const SUPERADMIN_GROUPS = [
  { name: 'PLATFORM', ids: ['admin-overview', 'admin-analytics'] },
  { name: 'REVENUE',  ids: ['admin-revenue', 'admin-transactions', 'admin-payments'] },
  { name: 'OPERATE',  ids: ['admin-campaigns', 'admin-workspaces', 'admin-users', 'admin-numbers', 'admin-plans'] },
  { name: 'ATTEND',   ids: ['admin-support', 'admin-api-management', 'settings'] },
  { name: 'GOVERN',   ids: ['admin-audit'] },
];

// Sections the sidebar renders in its fixed bottom block rather than in the
// scrolling bands. Legal has to be reachable without scrolling the nav — the
// policy links are what Meta's onboarding and the payment gateway check for —
// so it lives next to Sign out and is deliberately absent from NAV_GROUPS.
// Listed here so navGroupsForUser does not hand it back under "MORE" and give
// us the same entry twice.
const PINNED_NAV_IDS = new Set(['legal']);

// Resolves a group spec against the flat nav for this user, so the two can
// never drift: whatever ADMIN_NAV/ADMIN_TABS contain is what gets rendered.
function navGroupsForUser(user) {
  const flat = navForUser(user);
  const spec = user?.superAdmin === true ? SUPERADMIN_GROUPS : NAV_GROUPS;
  const byId = new Map(flat.map(i => [i.id, i]));
  const used = new Set();
  const bands = spec.map(g => {
    const items = g.ids.map(id => byId.get(id)).filter(Boolean);
    items.forEach(i => used.add(i.id));
    return { name: g.name, items };
  }).filter(g => g.items.length);
  const rest = flat.filter(i => !used.has(i.id) && !PINNED_NAV_IDS.has(i.id));
  return rest.length ? [...bands, { name: 'MORE', items: rest }] : bands;
}

function navForUser(user) {
  return user?.superAdmin === true ? SUPERADMIN_NAV : ADMIN_NAV;
}

// ─── mobile bottom tab bar ───────────────────────────────────────────────────
//
// The four destinations the design set puts on the phone's home screen. The
// rest of the nav stays reachable through the drawer — a tab bar with nineteen
// entries is a sidebar lying down.
//
// Super admins get their own four, because "Campaigns" for an operator means
// every workspace's campaigns, not their own.
const MOBILE_TABS = [
  { id: 'home',      label: 'Home',      icon: 'home'  },
  { id: 'campaigns', label: 'Campaigns', icon: 'send'  },
  { id: 'inbox',     label: 'Inbox',     icon: 'msg'   },
  { id: 'analytics', label: 'Analytics', icon: 'chart' },
];
const MOBILE_TABS_SUPERADMIN = [
  { id: 'admin-overview',   label: 'Overview',   icon: 'columns' },
  { id: 'admin-revenue',    label: 'Revenue',    icon: 'credit'  },
  { id: 'admin-workspaces', label: 'Spaces',     icon: 'users'   },
  { id: 'admin-support',    label: 'Support',    icon: 'msg'     },
];

const MobileTabBar = ({ page, setPage, user }) => {
  const tabs = user?.superAdmin === true ? MOBILE_TABS_SUPERADMIN : MOBILE_TABS;
  return (
    <nav style={{
      flexShrink: 0, display: 'flex', justifyContent: 'space-around', alignItems: 'stretch',
      borderTop: '1px solid var(--bd)', background: 'rgba(6,9,19,0.94)',
      backdropFilter: 'blur(18px) saturate(140%)', WebkitBackdropFilter: 'blur(18px) saturate(140%)',
      // The extra bottom padding clears the iOS home indicator; on anything
      // else env() resolves to 0 and this is a plain 8px bar.
      padding: '6px 0 calc(6px + env(safe-area-inset-bottom, 0px))',
    }}>
      {tabs.map(t => {
        const on = page === t.id || (t.id === 'campaigns' && page === 'campaigns-create');
        return (
          <button key={t.id} onClick={() => setPage(t.id)} aria-current={on ? 'page' : undefined}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '7px 4px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Manrope',sans-serif" }}>
            <I n={t.icon} s={19} c={on ? 'var(--accent)' : 'var(--t3)'} />
            <span style={{ fontSize: 10, fontWeight: on ? 700 : 500, color: on ? 'var(--accent)' : 'var(--t3)' }}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

const Sidebar = ({ page, setPage, onNav, user, mobile = false, open = false, onClose }) => {
  // Collapsing is a desktop affordance — in the drawer there is nothing to
  // collapse into, so it is forced off.
  const [colState, setCol] = useState(false);
  const col = mobile ? false : colState;
  const isAdmin = user?.role === 'ADMIN';
  const isSuperAdmin = user?.superAdmin === true;
  const GROUPS = navGroupsForUser(user);
  const planLabel = isSuperAdmin ? 'Super Admin' : isAdmin ? 'Admin' : 'Member';
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    if (isSuperAdmin) return undefined;

    // Server-authoritative balance. It used to be read once on mount, so a
    // recharge or a campaign deduction left a stale figure in the sidebar
    // until the user logged out and back in. Now it refreshes on the
    // wallet:balance-updated event, whenever the tab regains focus, and on a
    // slow background poll — so it is never more than a moment out of date
    // and never needs a manual reload.
    let alive = true;
    const load = () => wFetch('/wallet')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d) setBalance(Number(d.balance) || 0); })
      .catch(() => {});

    load();
    const onBalanceUpdated = (e) => {
      const next = Number(e.detail);
      if (Number.isFinite(next)) setBalance(next);
      else load();
    };
    const onFocus = () => { if (document.visibilityState === 'visible') load(); };

    const iv = setInterval(load, 60000);
    window.addEventListener('wallet:balance-updated', onBalanceUpdated);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      clearInterval(iv);
      window.removeEventListener('wallet:balance-updated', onBalanceUpdated);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [isSuperAdmin]);

  // On mobile every navigation also dismisses the drawer — leaving it open
  // over the page the user just asked for is the classic drawer bug.
  const go = (id) => { setPage(id); if (mobile) onClose?.(); };
  const legalOn = page === 'legal';

  const panel = (
    <div role="navigation" aria-label="Main navigation" style={{
      width: col ? '60px' : '232px', background: mobile ? 'rgba(6,9,19,0.97)' : 'rgba(6,9,19,0.72)',
      backdropFilter: 'blur(18px) saturate(140%)', WebkitBackdropFilter: 'blur(18px) saturate(140%)',
      borderRight: '1px solid var(--bd)', boxShadow: mobile ? '8px 0 40px rgba(0,0,0,0.55)' : 'inset -1px 0 0 rgba(255,255,255,0.03)',
      display: 'flex', flexDirection: 'column', transition: mobile ? 'transform .24s ease' : 'width .22s ease',
      flexShrink: 0, overflow: 'hidden', minHeight: 0,
      ...(mobile ? {
        position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 91, height: '100%',
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
      } : null),
    }}>
      {/* Collapsed, this header has 60px of width minus 2x8px padding to fit a
          32px logo *and* the expand button. It did not fit, the panel clips
          (overflow:hidden), and the button — the only way to reopen the
          sidebar — was pushed outside it and became unclickable. Collapsed, the
          logo is hidden and the button takes the row on its own. */}
      <div style={{ padding: col ? '16px 8px' : '16px 14px', display: 'flex', alignItems: 'center', justifyContent: col ? 'center' : 'flex-start', gap: '9px', borderBottom: '1px solid var(--bd)', minHeight: '62px', flexShrink: 0 }}>
        {!col && <div onClick={() => go(isSuperAdmin ? 'admin-overview' : 'home')} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }} title="Dashboard">
          <span className="sp-pulse" style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 12px var(--accent)' }} />
        </div>}
        {!col && <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: '15px', color: 'var(--t1)', whiteSpace: 'nowrap', letterSpacing: '-.02em' }}>ChatFlow Pro</span>}
        {mobile && (
          <button onClick={onClose} aria-label="Close navigation" style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)', padding: '4px', display: 'flex' }}>
            <I n="x" s={15} c="var(--t2)" />
          </button>
        )}
        {!mobile && !col && <button onClick={() => setCol(true)} aria-label="Collapse sidebar" style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)', padding: '4px', display: 'flex' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 19l-7-7 7-7M18 19l-7-7 7-7" /></svg>
        </button>}
        {!mobile && col && <button onClick={() => setCol(false)} aria-label="Expand sidebar" title="Expand sidebar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)', padding: '8px', display: 'flex', flexShrink: 0 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 5l7 7-7 7M6 5l7 7-7 7" /></svg>
        </button>}
      </div>
      {/* minHeight:0 is what makes this actually scroll: without it a flex
          child refuses to shrink below its content height, so on a short
          viewport the nav pushed the wallet card and the footer off-screen
          and the tabs past "Payments" became unreachable. */}
      <div className="cfp-scroll" style={{ flex: 1, minHeight: 0, padding: '8px', display: 'flex', flexDirection: 'column', gap: '2px', overflowY: 'auto', overflowX: 'hidden' }}>
        {GROUPS.map(group => (
          <div key={group.name} style={{ display: 'flex', flexDirection: 'column', gap: '1px', marginBottom: col ? '4px' : '9px' }}>
            {/* Collapsed, the eyebrow has no room and the bands read as a
                hairline rule instead — the grouping survives, the label
                does not. */}
            {!col
              ? <div style={{ fontFamily: 'var(--mono)', fontSize: '9.5px', letterSpacing: '.18em', color: 'var(--t3)', padding: '0 8px 6px' }}>{group.name}</div>
              : <div style={{ height: '1px', background: 'var(--bd)', margin: '5px 8px' }} />}
            {group.items.map(item => {
              const on = page === item.id || (page === 'campaigns-create' && item.id === 'campaigns');
              return (
                <div key={item.id} onClick={() => go(item.id)}
                  tabIndex={0} role="link" aria-current={on ? 'page' : undefined}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(item.id); } }}
                  onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent)'; }}
                  onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: col ? '10px' : '7px 10px', borderRadius: '9px', cursor: 'pointer', transition: 'background .15s ease, border-color .15s ease', justifyContent: col ? 'center' : 'flex-start',
                    background: on ? 'rgba(53,232,242,0.10)' : 'transparent',
                    borderLeft: col ? 'none' : `2px solid ${on ? 'var(--accent)' : 'transparent'}` }}
                  onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent'; }}
                  title={col ? item.label : ''}>
                  {/* Fixed-width cell so labels line up whether the glyph is
                      wide (emoji) or narrow, and held back when inactive so
                      nineteen colour glyphs don't all shout at once. */}
                  <span aria-hidden="true" style={{ width: 18, textAlign: 'center', fontSize: TEXT_GLYPHS.has(NAV_EMOJI[item.id]) ? 15.5 : 14.5, lineHeight: 1, flexShrink: 0, opacity: on ? 1 : 0.85, color: on ? 'var(--accent)' : 'var(--t2)' }}>
                    {NAV_EMOJI[item.id] || '\u2022'}
                  </span>
                  {!col && <span style={{ fontSize: '13.5px', fontWeight: on ? 700 : 500, color: on ? 'var(--t1)' : 'var(--t2)', whiteSpace: 'nowrap' }}>{item.label}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {!col && !isSuperAdmin && (
        <div onClick={() => go('payments')} title="Open Payments to recharge" style={{ margin: '8px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(53,232,242,0.04)', border: '1px solid rgba(53,232,242,0.15)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '4px', transition: 'all 0.15s', marginBottom: '4px', flexShrink: 0 }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(53,232,242,0.08)'; e.currentTarget.style.borderColor = 'rgba(53,232,242,0.3)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(53,232,242,0.04)'; e.currentTarget.style.borderColor = 'rgba(53,232,242,0.15)'; }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--mono)', fontSize: '9.5px', fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
            <I n="credit" s={12} c="var(--accent)" /> Wallet Balance
          </div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '14px', fontWeight: 600, color: balance != null && balance <= 0 ? '#f87171' : 'var(--accent)' }}>
            {balance == null ? '—' : `₹ ${balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </span>
        </div>
      )}
      <div style={{ padding: '10px 8px', borderTop: '1px solid var(--bd)', flexShrink: 0 }}>
        {!col && <div style={{ padding: '10px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '9px' }}>
          <Avatar name={user?.name || 'User'} size={28} showRing />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name || 'User'}</p>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '9.5px', letterSpacing: '.08em', textTransform: 'uppercase', color: isAdmin ? 'var(--accent)' : 'var(--t2)' }}>{planLabel}</p>
          </div>
        </div>}
        {/* Pinned rather than banded with the rest of the nav: this is the only
            entry point to the policies inside the app now, and it has to be
            visible without scrolling the nav on a short viewport. Kept out of
            NAV_GROUPS — see PINNED_NAV_IDS. */}
        <div onClick={() => go('legal')} tabIndex={0} role="link" aria-current={legalOn ? 'page' : undefined}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('legal'); } }}
          onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent)'; }}
          onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: col ? '10px' : '9px 10px', borderRadius: '8px', cursor: 'pointer', transition: 'background .12s', justifyContent: col ? 'center' : 'flex-start', background: legalOn ? 'rgba(53,232,242,0.10)' : 'transparent' }}
          onMouseEnter={e => { if (!legalOn) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
          onMouseLeave={e => { if (!legalOn) e.currentTarget.style.background = 'transparent'; }}
          title={col ? 'Legal & Policies' : ''}>
          <I n="file" s={16} c={legalOn ? 'var(--accent)' : 'var(--t2)'} />
          {!col && <span style={{ fontSize: '13px', color: legalOn ? 'var(--t1)' : 'var(--t2)', fontWeight: legalOn ? 700 : 500 }}>Legal &amp; Policies</span>}
        </div>
        <div onClick={() => onNav('landing')} tabIndex={0} role="button"
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNav('landing'); } }}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: col ? '10px' : '9px 10px', borderRadius: '8px', cursor: 'pointer', transition: 'background .12s', justifyContent: col ? 'center' : 'flex-start' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--green)'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
          onBlur={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.background = 'transparent'; }}
          title={col ? 'Sign out' : ''}>
          <I n="logout" s={16} c="var(--t2)" />
          {!col && <span style={{ fontSize: '13px', color: 'var(--t2)', fontWeight: 500 }}>Sign out</span>}
        </div>
      </div>
    </div>
  );

  if (!mobile) return panel;

  // The scrim is a sibling, not a parent: the panel has to keep its own
  // stacking context so the drawer slides over the scrim rather than with it.
  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
          opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity .24s ease',
        }}
      />
      {panel}
    </>
  );
};

const VALID_SECTIONS = new Set([...ADMIN_NAV.map(n => n.id), ...ADMIN_TABS.map(n => n.id), 'campaigns-create', 'profile']);

function sectionFromPath(path, user) {
  const defaultSection = user?.superAdmin === true ? 'admin-overview' : 'home';
  const rest = String(path || '').replace(/^\/dashboard\/?/, '');
  if (!rest) return defaultSection;
  if (rest === 'campaigns/create') return 'campaigns-create';
  if (rest === 'platform') return 'admin-overview'; // pre-restructure bookmark
  const section = rest.split('/')[0];
  return VALID_SECTIONS.has(section) ? section : defaultSection;
}

// `subTab` becomes a `?tab=` query param so a Quick Link can deep-link into a
// specific sub-tab of a tabbed page (e.g. Automation's "WhatsApp AI Agent",
// Payments' "Invoices") instead of always landing on that page's default tab.
function pathFromSection(section, subTab) {
  const path = section === 'home' ? '/dashboard'
    : section === 'campaigns-create' ? '/dashboard/campaigns/create'
    : `/dashboard/${section}`;
  return subTab ? `${path}?tab=${encodeURIComponent(subTab)}` : path;
}

export default function Dashboard({ onNav, routePath, routeSearch }) {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const token = localStorage.getItem('accessToken');
  const isAdmin = user?.role === 'ADMIN';
  const NAV = navForUser(user);

  const page = sectionFromPath(routePath ?? window.location.pathname, user);
  const setPage = (p, subTab) => {
    if (!p) return;
    const target = pathFromSection(p, subTab);
    if (window.location.pathname + window.location.search === target) return;
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  const isInbox = page === 'inbox';
  const mobile = useIsMobile();
  const [navOpen, setNavOpen] = useState(false);

  // The drawer listens for the header's hamburger, and shuts itself on every
  // route change and on Escape. Closing on route change matters because the
  // profile menu and quick links navigate without going through the drawer.
  useEffect(() => {
    const onToggle = () => setNavOpen(o => !o);
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('app:toggle-nav', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('app:toggle-nav', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  useEffect(() => { setNavOpen(false); }, [page]);
  // A drawer over a page that is still scrollable behind it feels broken.
  useEffect(() => {
    if (!mobile) return undefined;
    document.body.style.overflow = navOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [navOpen, mobile]);
  // Read fresh on every render (mirrors the routePath-falls-back-to-location
  // pattern above) — reflects whatever `?tab=` the current URL carries so a
  // deep-linked Quick Link can seed a tabbed page's initial sub-tab.
  const initialSubTab = new URLSearchParams(routeSearch ?? window.location.search).get('tab') || undefined;

  // Which draft the campaign wizard is editing, if any. Kept in the URL rather
  // than component state for the same reason `page` is: a refresh mid-edit
  // then reopens the same draft instead of dropping the user into a blank new
  // campaign, and the link can be shared.
  const editingCampaignId = new URLSearchParams(window.location.search).get('draft') || null;
  const openCampaignEditor = (id) => {
    const target = id
      ? `/dashboard/campaigns/create?draft=${encodeURIComponent(id)}`
      : '/dashboard/campaigns/create';
    if (window.location.pathname + window.location.search === target) return;
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  // Listen for nav events from ProfileMenu / QuickLinksGrid (so we don't need
  // to thread setPage as a prop). detail is either a plain section string, or
  // { section, subTab } when a deep-link into a specific sub-tab is wanted.
  useEffect(() => {
    const onAppNav = (e) => {
      const detail = e.detail;
      const action = typeof detail === 'string' ? detail : detail?.section;
      const subTab = typeof detail === 'object' ? detail?.subTab : undefined;
      if (action === 'signout') return onNav('landing');
      if (action === 'login')  return onNav('login');
      if (action === 'profile') return setPage('profile');
      if (action) setPage(action, subTab);
    };
    window.addEventListener('app:nav', onAppNav);
    return () => window.removeEventListener('app:nav', onAppNav);
  }, [onNav]); // eslint-disable-line

  const renderView = () => {
    if (page === 'campaigns-create') {
      return (
        <CreateCampaign
          // Set when continuing a draft; null for a brand-new campaign. Keyed
          // so switching from one draft to another remounts the wizard rather
          // than leaving the previous draft's answers in the form.
          key={editingCampaignId || 'new'}
          campaignId={editingCampaignId}
          onBack={() => setPage('campaigns')}
        />
      );
    }
    if (page.startsWith('admin-')) {
      // Each Platform Admin section is its own sidebar item now; regular users fall through.
      if (user?.superAdmin === true) return <SuperAdminView tab={page.slice('admin-'.length)} />;
      return <PlaceholderView title="Platform Admin" icon="chart" />;
    }
    if (page === 'home')       return <HomeView />;
    if (page === 'inbox')      return <InboxView />;
    if (page === 'campaigns')  return (
      <CampaignsView
        onCreateCampaign={() => openCampaignEditor(null)}
        onEditCampaign={(id) => openCampaignEditor(id)}
      />
    );
    if (page === 'templates')  return <TemplatesView />;
    if (page === 'widget')     return <WidgetsView />;
    if (page === 'contacts')   return <ContactsView />;
    if (page === 'automation')     return <AutomationView initialTab={initialSubTab || 'basic'} />;
    // The WhatsApp AI Agent and AI Intent Matching are tabs 4 and 5 of the
    // Automation page, which buried two of the product's headline features.
    // The design set lists them as first-class destinations, so they get their
    // own routes and sidebar entries — pointing at the existing, already-wired
    // implementation rather than a second copy of it.
    if (page === 'ai-agent')        return <AutomationView initialTab="wa-agent" />;
    if (page === 'intent-matching') return <AutomationView initialTab="ai-intent" />;
    if (page === 'analytics')      return <AnalyticsView />;
    if (page === 'chat-analysis')  return <ChatAnalytics workspaceId={user.workspaceId} />;
    if (page === 'user-analytics') return <UserAnalyticsView />;
    if (page === 'integrations')   return <IntegrationsView />;
    if (page === 'setup')          return <NumberSetupView />;
    if (page === 'payments')       return <PaymentsView initialTab={initialSubTab || 'wallet'} />;
    if (page === 'api')            return <ApiKeysView />;
    if (page === 'support')        return <SupportView />;
    if (page === 'settings')       return <SettingsView />;
    if (page === 'profile')        return <ProfileView />;
    if (page === 'legal')          return <LegalView initialTab={initialSubTab || 'terms'} />;
    const navItem = NAV.find(n => n.id === page);
    return <PlaceholderView title={navItem?.label || 'Section'} icon={navItem?.icon || 'cog'} />;
  };

  // Set only while a super admin is impersonating another user (see UsersTab
  // in SuperAdminView) — holds the admin's own tokens so they can be restored.
  let impersonator = null;
  try { impersonator = JSON.parse(sessionStorage.getItem('impersonatorSession') || 'null'); } catch { /* ignore */ }

  const returnToAdmin = () => {
    if (!impersonator) return;
    localStorage.setItem('accessToken', impersonator.accessToken);
    if (impersonator.refreshToken) localStorage.setItem('refreshToken', impersonator.refreshToken);
    localStorage.setItem('user', impersonator.user);
    sessionStorage.removeItem('impersonatorSession');
    window.location.href = '/dashboard';
  };

  return (
    // Two very low-opacity washes behind everything, so the panels above them
    // read as translucent panes rather than flat blocks. Static, not animated:
    // this is a work surface, not a landing page.
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'radial-gradient(1200px 600px at 12% -8%, rgba(53,232,242,0.07), transparent 60%), radial-gradient(1000px 520px at 100% 0%, rgba(14,165,233,0.06), transparent 62%), #060B18' }}>
      {impersonator && (
        <div style={{ flexShrink: 0, height: 38, background: 'linear-gradient(135deg, rgba(245,158,11,.16), rgba(245,158,11,.06))', borderBottom: '1px solid rgba(245,158,11,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontSize: 12.5, color: '#fbbf24', fontWeight: 600 }}>
          <I n="eye" s={13} c="#fbbf24" />
          Impersonating {user?.name} ({user?.email})
          <button onClick={returnToAdmin} style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(245,158,11,.15)', border: '1px solid rgba(245,158,11,.4)', color: '#fbbf24', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
            Return to admin
          </button>
        </div>
      )}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        <Sidebar
          page={page} setPage={setPage} onNav={onNav} user={user}
          mobile={mobile} open={navOpen} onClose={() => setNavOpen(false)}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: (isInbox || page === 'campaigns-create') ? 'hidden' : 'auto', minWidth: 0 }}>
          {renderView()}
        </div>
      </div>
      {/* Outside the scrolling row so it stays pinned while the view scrolls,
          and after it in the DOM so it is last in the tab order. */}
      {mobile && <MobileTabBar page={page} setPage={setPage} user={user} />}
    </div>
  );
}
