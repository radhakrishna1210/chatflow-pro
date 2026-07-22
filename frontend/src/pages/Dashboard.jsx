import { useState, useRef, useEffect } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import CreateCampaign from './CreateCampaign.jsx';
import { wFetch, apiFetch } from '../lib/api.js';
import AIOnboardingCard from '../components/AIOnboardingCard.jsx';
import ContactsView from './ContactsView.jsx';
import InboxView from './InboxView.jsx';
import AutomationView from './AutomationView.jsx';
import AnalyticsView from './AnalyticsView.jsx';
import UserAnalyticsView from './UserAnalyticsView.jsx';
import ChatAnalytics from '../components/dashboard/ChatAnalytics.jsx';
import NumberSetupView from './NumberSetupView.jsx';
import ApiKeysView from './ApiKeysView.jsx';
import SettingsView from './SettingsView.jsx';
import ProfileView from './ProfileView.jsx';
import SuperAdminView from './SuperAdminView.jsx';
import SupportView from './SupportView.jsx';
import IntegrationsView from './IntegrationsView.jsx';
import PaymentsView from './PaymentsView.jsx';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const StatusBadge = ({ s }) => {
  const cfg = {
    Active:    { bg: 'var(--gbg)',                bd: 'var(--gbd)',                   c: 'var(--green)' },
    Approved:  { bg: 'var(--gbg)',                bd: 'var(--gbd)',                   c: 'var(--green)' },
    Completed: { bg: 'rgba(99,102,241,.1)',        bd: 'rgba(99,102,241,.25)',         c: '#818cf8' },
    Draft:     { bg: 'rgba(255,255,255,.04)',      bd: 'var(--bd)',                    c: 'var(--t2)' },
    Scheduled: { bg: 'rgba(14,165,233,.1)',         bd: 'rgba(14,165,233,.25)',         c: '#38bdf8' },
    Running:   { bg: 'rgba(14,165,233,.1)',         bd: 'rgba(14,165,233,.25)',         c: '#38bdf8' },
    Cancelled: { bg: 'rgba(239,68,68,.08)',         bd: 'rgba(239,68,68,.22)',          c: '#f87171' },
    Failed:    { bg: 'rgba(239,68,68,.08)',         bd: 'rgba(239,68,68,.22)',          c: '#f87171' },
    Rejected:  { bg: 'rgba(239,68,68,.08)',         bd: 'rgba(239,68,68,.22)',          c: '#f87171' },
    Pending:   { bg: 'rgba(245,158,11,.1)',        bd: 'rgba(245,158,11,.25)',         c: '#fbbf24' },
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

const Avatar = ({ name = '?', size = 34, showRing = false }) => {
  const init = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['#1EBF5E', '#0EA5E9', '#A78BFA', '#F59E0B', '#F472B6'];
  const col = colors[init.charCodeAt(0) % colors.length];
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: `${col}18`, border: `1.5px solid ${showRing ? col : col + '44'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * .33 + 'px', fontWeight: 700, color: col, flexShrink: 0 }}>
      {init}
    </div>
  );
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

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onEsc   = (e) => { if (e.key === 'Escape') setOpen(false); };
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
        onClick={() => setOpen(o => !o)}
        aria-label="Open profile menu"
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
          <div style={{ padding:'16px 18px', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid var(--bd)', background:'linear-gradient(135deg, rgba(30,191,94,0.06), transparent)' }}>
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
              background: isAdmin ? 'var(--gbg)' : 'rgba(167,139,250,.1)',
              border: `1px solid ${isAdmin ? 'var(--gbd)' : 'rgba(167,139,250,.25)'}`,
              color: isAdmin ? 'var(--green)' : '#c4b5fd',
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
                      background: current ? 'rgba(30,191,94,0.06)' : 'transparent', border:'none', textAlign:'left',
                      fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:12.5, fontWeight:600, color:'var(--t1)',
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
    style={{
      width:'100%', display:'flex', alignItems:'center', gap:11,
      padding:'9px 12px', borderRadius:8, cursor:'pointer',
      background:'transparent', border:'none', textAlign:'left',
      fontFamily:"'Plus Jakarta Sans',sans-serif",
      fontSize:13, fontWeight:500,
      color: danger ? '#f87171' : 'var(--t1)',
      transition:'background .12s',
    }}
    onMouseEnter={e => { e.currentTarget.style.background = danger ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.04)'; }}
    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
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
          return <circle key="dot" cx={x} cy={y} r="4" fill={color} stroke="var(--surf)" strokeWidth="2" />;
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

const DashHeader = ({ title, subtitle }) => (
  <div style={{ height: '58px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 28px', gap: '16px', flexShrink: 0, background: 'var(--surf)' }}>
    <div style={{ flex: 1 }}>
      <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: '16px', color: 'var(--t1)', letterSpacing: '-.02em' }}>{title}</h1>
      {subtitle && <p style={{ fontSize: '11.5px', color: 'var(--t2)', marginTop: '1px' }}>{subtitle}</p>}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <HeaderSearch />
      <NotificationsBell />
      <ProfileMenu />
    </div>
  </div>
);

// Functional global search: Enter jumps to Contacts with the query prefilled.
const HeaderSearch = () => {
  const [q, setQ] = useState('');
  const go = () => {
    const query = q.trim();
    window.dispatchEvent(new CustomEvent('app:nav', { detail: 'contacts' }));
    window.dispatchEvent(new CustomEvent('app:search', { detail: query }));
    setQ('');
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '7px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', width: '200px' }}>
      <I n="search" s={13} c="var(--t2)" />
      <input value={q} onChange={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && q.trim()) go(); }}
        placeholder="Search contacts…"
        aria-label="Search contacts"
        style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--t1)', fontSize: '13px', fontFamily: "'Plus Jakarta Sans',sans-serif", minWidth: 0 }} />
    </div>
  );
};

// Working notifications popover fed by live workspace data (pending templates,
// running/scheduled campaigns) — no fake red dot.
const NotificationsBell = () => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const ref = useRef(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [tRes, cRes] = await Promise.all([wFetch('/templates'), wFetch('/campaigns')]);
        const templates = tRes.ok ? await tRes.json() : [];
        const cData = cRes.ok ? await cRes.json() : {};
        const campaigns = Array.isArray(cData) ? cData : (cData?.data ?? []);
        const notes = [];
        (Array.isArray(templates) ? templates : []).filter(t => t.status === 'PENDING').slice(0, 3)
          .forEach(t => notes.push({ id: `t-${t.id}`, icon: 'file', text: `Template "${t.name}" is pending Meta review` }));
        campaigns.filter(c => c.status === 'RUNNING').slice(0, 3)
          .forEach(c => notes.push({ id: `c-${c.id}`, icon: 'send', text: `Campaign "${c.name}" is running` }));
        campaigns.filter(c => c.status === 'SCHEDULED').slice(0, 3)
          .forEach(c => notes.push({ id: `s-${c.id}`, icon: 'send', text: `Campaign "${c.name}" is scheduled${c.scheduledAt ? ' for ' + new Date(c.scheduledAt).toLocaleString() : ''}` }));
        if (alive) setItems(notes);
      } catch { /* ignore */ }
    };
    load();
    const iv = setInterval(load, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} aria-label="Notifications"
        style={{ position: 'relative', width: '34px', height: '34px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
        <I n="bell" s={15} c="var(--t2)" />
        {items.length > 0 && <div style={{ position: 'absolute', top: '7px', right: '7px', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--green)', border: '1.5px solid var(--surf)' }} />}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 300, background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 12, boxShadow: '0 16px 40px rgba(0,0,0,0.45)', zIndex: 200, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--bd)', fontSize: 12, fontWeight: 700, color: 'var(--t1)' }}>Notifications</div>
          {items.length === 0 ? (
            <div style={{ padding: '20px 16px', fontSize: 12, color: 'var(--t3)', textAlign: 'center' }}>You're all caught up.</div>
          ) : items.map(n => (
            <div key={n.id} style={{ padding: '11px 16px', borderBottom: '1px solid var(--bd)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <I n={n.icon} s={13} c="var(--green)" />
              <span style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.45 }}>{n.text}</span>
            </div>
          ))}
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
            <div style={{ background:'#070B14', border:'1px solid rgba(255,255,255,0.08)', width: 400, borderRadius: 12, padding: 24, display:'flex', flexDirection:'column', alignItems:'center', boxShadow:'0 24px 64px rgba(0,0,0,0.5)' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: '24px' }}>🔒</div>
              </div>
              <h3 style={{ fontFamily:"'Syne',sans-serif", fontWeight: 700, fontSize: 18, color:'#F0F2F8', marginBottom: 8, margin: 0 }}>Login Required</h3>
              <p style={{ fontSize: 14, color:'rgba(255,255,255,0.6)', textAlign:'center', marginBottom: 24, lineHeight: 1.5 }}>
                You need to be logged in to use the AI Agent. Please sign in to your account to continue.
              </p>
              <div style={{ display: 'flex', gap: 12, width: '100%' }}>
                <button onClick={() => setShowLoginModal(false)} style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}>Cancel</button>
                <button onClick={() => { window.dispatchEvent(new CustomEvent('app:nav', { detail: 'login' })); }} style={{ flex: 1, padding: '10px', borderRadius: 8, background: '#1EBF5E', color: '#000', border: 'none', cursor: 'pointer', fontWeight: 700 }}>Log in</button>
              </div>
            </div>
          </div>
        )}

        {!loading && (
        <>
        <div style={{ borderRadius: 'var(--rl)', background: 'linear-gradient(135deg,rgba(30,191,94,0.1),rgba(14,165,233,0.06))', border: '1px solid var(--gbd)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '9px', background: 'var(--gbg)', border: '1px solid var(--gbd)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <I n="spark" s={18} c="var(--green)" />
            </div>
            <div>
              <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: '14px', color: 'var(--t1)', marginBottom: '2px' }}>Unlock AI Smart Replies &amp; A/B Testing</p>
              <p style={{ fontSize: '12px', color: 'var(--t2)' }}>Upgrade to Growth plan for advanced features.</p>
            </div>
          </div>
          <Btn size="sm" style={{ flexShrink: 0 }} onClick={() => window.dispatchEvent(new CustomEvent('app:nav', { detail: 'payments' }))}>Upgrade Plan</Btn>
        </div>

        <div style={{ width: '100%', background: 'rgba(0, 0, 0, 0.4)', borderRadius: '12px', border: '1px solid rgba(30, 191, 94, 0.4)', boxShadow: '0 0 30px rgba(30, 191, 94, 0.15), inset 0 0 20px rgba(30, 191, 94, 0.05)', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', transition: 'all 0.3s ease', marginBottom: '16px' }}>
          <div style={{ padding: '24px 24px 12px' }}>
            <h3 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: '18px', color: '#fff', marginBottom: '8px' }}>Create your Free WhatsApp AI Assistant</h3>
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
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(30, 191, 94, 0.1)'; e.currentTarget.style.borderColor = 'rgba(30, 191, 94, 0.3)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
              >
                {s}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 24px 24px', background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#1EBF5E', fontWeight: 600 }}>
              <input type="checkbox" checked={guided} onChange={(e) => setGuided(e.target.checked)} style={{ accentColor: '#1EBF5E', width: '15px', height: '15px', cursor: 'pointer' }} />
              Guided Flow
            </label>
            <button 
              onClick={handleSend}
              disabled={aiLoading || !prompt.trim()}
              style={{ background: aiLoading || !prompt.trim() ? 'rgba(30,191,94,0.4)' : '#1EBF5E', color: '#000', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 700, cursor: aiLoading || !prompt.trim() ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', transition: 'transform 0.1s' }}
              onMouseDown={e => { if (!aiLoading && prompt.trim()) e.currentTarget.style.transform = 'scale(0.96)'; }}
              onMouseUp={e => { if (!aiLoading && prompt.trim()) e.currentTarget.style.transform = 'scale(1)'; }}
            >
              {aiLoading ? 'Sending…' : 'Send'}
            </button>
          </div>
          {aiResponse && (
            <div style={{ padding: '16px 24px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: '#fff', lineHeight: 1.6, fontSize: '13px' }}>
              <strong style={{ display: 'block', marginBottom: '8px', color: '#b8f3b8' }}>AI response:</strong>
              <div>{aiResponse}</div>
              {aiCard && (
                  <div style={{
                    marginTop: '10px',
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid rgba(30,191,94,0.3)',
                    borderRadius: '8px',
                    padding: '12px',
                  }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: '#1EBF5E', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {aiCard.icon || '✅'} {aiCard.title}
                    </div>
                    {aiCard.details && Object.entries(aiCard.details).map(([k, v]) => (
                      <div key={k} style={{ fontSize: '11px', marginBottom: '4px' }}>
                        <span style={{ color: '#56688A', textTransform: 'capitalize' }}>{k}:</span>{' '}
                        <span style={{ color: '#F0F2F8' }}>{typeof v === 'object' ? JSON.stringify(v) : v}</span>
                      </div>
                    ))}
                    {aiCard.preview && (
                       <div style={{ marginTop: '8px', background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '4px', fontSize: '11px', fontStyle: 'italic', borderLeft: '2px solid #1EBF5E' }}>
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={{ ...card, padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.08em' }}>WhatsApp Number</span>
              {number ? <StatusBadge s={number.status === 'ACTIVE' ? 'Approved' : (number.status ?? 'Pending')} /> : (
                <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.25)', color: '#fbbf24' }}>Not connected</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '11px', background: number ? 'var(--gbg)' : 'rgba(255,255,255,0.04)', border: `1px solid ${number ? 'var(--gbd)' : 'var(--bd)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <I n="phone" s={20} c={number ? 'var(--green)' : 'var(--t2)'} />
              </div>
              <div>
                <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: '15px', color: 'var(--t1)', marginBottom: '2px' }}>{number?.phoneNumber ?? 'No number connected'}</p>
                <p style={{ fontSize: '12px', color: 'var(--t2)' }}>
                  {number
                    ? `Quality: ${number.quality ?? 'Unknown'}${number.displayName ? ' · ' + number.displayName : ''}`
                    : 'Go to Number Setup to connect.'}
                </p>
              </div>
            </div>
          </div>
          <div style={{ ...card, padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Instagram</span>
              <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t2)' }}>Coming Soon</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '11px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <I n="insta" s={20} c="var(--t2)" />
              </div>
              <div>
                <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: '15px', color: 'var(--t1)', marginBottom: '2px' }}>Connect Account</p>
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

// Detail modal — surfaces the campaign's full timeline (created / scheduled /
// launched / completed), live counters and recipient list, plus a Cancel
// action for draft/scheduled/running campaigns.
const CampaignDetailModal = ({ campaignId, onClose, onChanged }) => {
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

  const isAdmin = JSON.parse(localStorage.getItem('user') || '{}').role === 'ADMIN';
  const cancellable = isAdmin && c && ['DRAFT', 'SCHEDULED', 'RUNNING'].includes(c.status);

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(3,5,12,0.78)', backdropFilter:'blur(4px)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width:'100%', maxWidth:640, maxHeight:'86vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'16px 22px', borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <p style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:16, color:'var(--t1)' }}>{c?.name || 'Campaign'}</p>
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
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
                {[['Sent', c.sent], ['Delivered', c.delivered], ['Read', c.read], ['Failed', c.failed]].map(([k, v]) => (
                  <div key={k} style={{ padding:'12px 14px', borderRadius:10, background:'rgba(255,255,255,0.02)', border:'1px solid var(--bd)' }}>
                    <p style={{ fontSize:10, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4 }}>{k}</p>
                    <p style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:18, color: k === 'Failed' && v > 0 ? '#f87171' : 'var(--t1)' }}>{(v ?? 0).toLocaleString()}</p>
                  </div>
                ))}
              </div>

              <div style={{ padding:'14px 16px', borderRadius:10, background:'rgba(255,255,255,0.02)', border:'1px solid var(--bd)', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 20px' }}>
                {[
                  ['Created',        fmtDate(c.createdAt)],
                  ['Scheduled for',  fmtDate(c.scheduledAt)],
                  ['Launched at',    fmtDate(c.launchedAt)],
                  ['Completed at',   fmtDate(c.completedAt)],
                  ['Template',       c.template?.name || '—'],
                  ['Send-from',      c.waNumber ? `${c.waNumber.phoneNumber}${c.waNumber.displayName ? ' · ' + c.waNumber.displayName : ''}` : '—'],
                  ['Recipients',     (c.totalContacts ?? 0).toLocaleString()],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p style={{ fontSize:10, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:3 }}>{k}</p>
                    <p style={{ fontSize:13, color:'var(--t1)' }}>{v}</p>
                  </div>
                ))}
              </div>

              {Array.isArray(c.recipients) && c.recipients.length > 0 && (
                <div>
                  <p style={{ fontSize:11, fontWeight:700, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:8 }}>Recipients ({c.recipients.length}{c.totalContacts > c.recipients.length ? ` of ${c.totalContacts}` : ''})</p>
                  <div style={{ maxHeight:220, overflowY:'auto', border:'1px solid var(--bd)', borderRadius:10 }}>
                    {c.recipients.map((r, i) => (
                      <div key={r.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 14px', borderBottom: i < c.recipients.length - 1 ? '1px solid var(--bd)' : 'none' }}>
                        <div style={{ minWidth:0 }}>
                          <p style={{ fontSize:12.5, fontWeight:600, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.contact?.name || '—'}</p>
                          <p style={{ fontSize:11, color:'var(--t3)' }}>{r.contact?.phoneNumber}{r.failReason ? ` · ${r.failReason}` : ''}</p>
                        </div>
                        <StatusBadge s={r.status} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ padding:'14px 22px', borderTop:'1px solid var(--bd)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:11, color:'var(--t3)' }}>Counters update live from delivery webhooks.</span>
          <div style={{ display:'flex', gap:8 }}>
            {cancellable && (
              <Btn variant="outline" size="sm" onClick={cancel} disabled={cancelling}
                style={{ borderColor:'rgba(239,68,68,.35)', color:'#f87171' }}>
                {cancelling ? 'Cancelling…' : 'Cancel Campaign'}
              </Btn>
            )}
            <Btn variant="ghost" size="sm" onClick={onClose}>Close</Btn>
          </div>
        </div>
      </div>
    </div>
  );
};

const CampaignsView = ({ onCreateCampaign }) => {
  const isAdmin = JSON.parse(localStorage.getItem('user') || '{}').role === 'ADMIN';
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [detailId, setDetailId]   = useState(null);

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
      <DashHeader title="Campaigns" subtitle="Manage and monitor your broadcasts" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        {isAdmin && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
            <Btn style={{ boxShadow: 'var(--glow)' }} onClick={onCreateCampaign}><I n="send" s={14} c="#060A10" /> New Campaign</Btn>
          </div>
        )}
        {loading ? (
          <div style={{ textAlign:'center', padding:'48px', color:'var(--t2)', fontSize:13 }}>Loading campaigns…</div>
        ) : campaigns.length === 0 ? (
          <div style={{ textAlign:'center', padding:'48px', color:'var(--t2)', fontSize:13 }}>No campaigns yet. Create your first campaign.</div>
        ) : (
          <div style={{ ...card, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bd)' }}>
                  {['Campaign', 'Status', 'Sent', 'Delivered', 'Read', 'Rate', 'Date', ''].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c, i) => {
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

// ─── New Template Dialog ───────────────────────────────────────
const TemplateModal = ({ onClose, onSaved, template = null }) => {
  const isEdit = !!template;
  const initialBody   = isEdit ? (Array.isArray(template.components) ? (template.components.find(c => (c.type || '').toUpperCase() === 'BODY')?.text ?? '') : '') : '';
  const initialFooter = isEdit ? (Array.isArray(template.components) ? (template.components.find(c => (c.type || '').toUpperCase() === 'FOOTER')?.text ?? '') : '') : '';
  const [name, setName]         = useState(isEdit ? template.name : '');
  const [category, setCategory] = useState(isEdit ? template.category : 'MARKETING');
  const [language, setLanguage] = useState(isEdit ? template.language : 'en');
  const [body, setBody]         = useState(initialBody);
  const [footer, setFooter]     = useState(initialFooter);
  const [examples, setExamples] = useState({});
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState(null);
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

  const submit = async () => {
    setErr(null);
    if (!nameValid) { setErr('Name must contain only lowercase letters, numbers and underscores.'); return; }
    if (!body.trim()) { setErr('Body text is required.'); return; }
    for (const n of vars) {
      if (!examples[n]?.trim()) { setErr(`Provide an example value for variable {{${n}}}.`); return; }
    }

    const components = [];
    const bodyComp = { type:'BODY', text: body.trim() };
    if (vars.length > 0) {
      bodyComp.example = { body_text: [vars.map(n => examples[n].trim())] };
    }
    components.push(bodyComp);
    if (footer.trim()) components.push({ type:'FOOTER', text: footer.trim() });

    if (!isEdit && numbers.length > 1 && !waNumberId) { setErr('Select which WhatsApp number this template belongs to.'); return; }

    setSaving(true);
    try {
      const res = isEdit
        ? await wFetch(`/templates/${template.id}`, {
            method:'PUT',
            body: JSON.stringify({ name: slug, category, language, components }),
          })
        : await wFetch('/templates', {
            method:'POST',
            body: JSON.stringify({ name: slug, category, language, components, ...(waNumberId ? { waNumberId } : {}) }),
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
    fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none', boxSizing:'border-box',
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)' }}>
      <div style={{ ...card, width:620, maxHeight:'88vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--bd)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div>
            <p style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:16, color:'var(--t1)' }}>{isEdit ? 'Edit Template' : 'New Message Template'}</p>
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
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
              {cats.map(c => (
                <div key={c.id} onClick={() => setCategory(c.id)}
                  style={{ padding:'10px 12px', borderRadius:8, border:`1.5px solid ${category === c.id ? 'var(--green)' : 'var(--bd)'}`, background: category === c.id ? 'var(--gbg)' : 'rgba(255,255,255,0.02)', cursor:'pointer' }}>
                  <p style={{ fontSize:13, fontWeight:600, color: category === c.id ? 'var(--green)' : 'var(--t1)', marginBottom:3 }}>{c.label}</p>
                  <p style={{ fontSize:10.5, color:'var(--t3)', lineHeight:1.4 }}>{c.hint}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Language */}
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>Language <span style={{ color:'#f87171' }}>*</span></label>
            <select value={language} onChange={e => setLanguage(e.target.value)}
              style={{ ...inputBase, appearance:'auto', colorScheme:'dark' }}>
              {langs.map(l => <option key={l.code} value={l.code}>{l.label} ({l.code})</option>)}
            </select>
          </div>

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
              <p style={{ fontSize:12, fontWeight:600, color:'#7dd3fc', marginBottom:10 }}>
                Variable example values
              </p>
              <p style={{ fontSize:11, color:'#7dd3fc', opacity:.8, marginBottom:10, lineHeight:1.5 }}>
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

          {/* Footer (optional) */}
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>Footer <span style={{ color:'var(--t3)', fontWeight:500 }}>(optional, max 60 chars)</span></label>
            <input value={footer} maxLength={60} onChange={e => setFooter(e.target.value)}
              placeholder="Reply STOP to unsubscribe" style={inputBase} />
          </div>

          {/* Preview */}
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>Preview</label>
            <div style={{ background:'#ECE5DD', borderRadius:10, padding:14, minHeight:60 }}>
              <div style={{ background:'#fff', borderRadius:'0 8px 8px 8px', padding:'10px 12px', maxWidth:'88%', boxShadow:'0 1px 3px rgba(0,0,0,0.1)', display:'inline-block' }}>
                <p style={{ fontSize:12, color:'#111', lineHeight:1.5, whiteSpace:'pre-wrap', wordBreak:'break-word', fontFamily:'system-ui,-apple-system,sans-serif', margin:0 }}>
                  {body || <span style={{ color:'#999', fontStyle:'italic' }}>Body preview…</span>}
                </p>
                {footer && (
                  <p style={{ fontSize:10.5, color:'#888', marginTop:6, lineHeight:1.4 }}>{footer}</p>
                )}
              </div>
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
  const isAdmin = JSON.parse(localStorage.getItem('user') || '{}').role === 'ADMIN';
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [syncing, setSyncing]     = useState(false);
  const [syncMsg, setSyncMsg]     = useState(null);
  const [newOpen, setNewOpen]     = useState(false);
  const [tab, setTab]             = useState('my');         // 'my' | 'library'
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

  const loadTemplates = () =>
    wFetch('/templates').then(r=>r.ok&&r.json()).then(d=>{ if(Array.isArray(d)) setTemplates(d); }).catch(()=>{});

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
      setSyncMsg({ ok: true, created: data.created, updated: data.updated, total: data.total });
      await loadTemplates();
    } catch (e) {
      setSyncMsg({ error: e.message });
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    loadHasNumber();
    loadTemplates().finally(() => setLoading(false));
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
      <DashHeader title="Templates" subtitle="Create and manage message templates" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
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
                style={{
                  display:'flex', alignItems:'center', gap:7, padding:'10px 14px', cursor:'pointer',
                  fontSize:13, fontWeight: on ? 700 : 500,
                  color: on ? 'var(--t1)' : 'var(--t2)',
                  borderBottom: `2px solid ${on ? 'var(--green)' : 'transparent'}`,
                  marginBottom: -1, transition: 'all .15s',
                }}>
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
              style={{ maxWidth:280, padding:'9px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none', boxSizing:'border-box', appearance:'auto', colorScheme:'dark' }}>
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
        {isAdmin && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <Btn variant="outline" onClick={syncFromMeta} disabled={syncing}>
              <I n="refresh" s={13} c={syncing ? 'var(--t3)' : 'var(--green)'} />
              {syncing ? 'Syncing from Meta…' : 'Sync from Meta'}
            </Btn>
            <Btn onClick={() => setNewOpen(true)} style={{ boxShadow: 'var(--glow)' }}>
              <I n="file" s={14} c="#060A10" /> New Template
            </Btn>
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
                  {syncMsg.updated > 0 ? ` · ${syncMsg.updated} updated` : ''}.
                </p>
            }
          </div>
        )}

        {loading ? (
          <div style={{ textAlign:'center', padding:'48px', color:'var(--t2)', fontSize:13 }}>
            <div style={{ width:28, height:28, border:'2px solid var(--green)', borderTopColor:'transparent', borderRadius:'50%', margin:'0 auto 12px', animation:'spin 1s linear infinite' }}/>
            Loading templates…
          </div>
        ) : templates.length === 0 ? (
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }}>
            {templates.map(t => {
              const bodyText = getBodyText(t.components);
              return (
                <div key={t.id} style={{ ...card, padding: '20px', transition: 'border-color .2s,transform .2s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--bdm)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--bd)'; e.currentTarget.style.transform = 'none'; }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: '14px', color: 'var(--t1)', marginBottom: '5px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.name}</p>
                      <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '5px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t2)' }}>{t.category}</span>
                        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '5px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t3)' }}>{t.language}</span>
                      </div>
                    </div>
                    <StatusBadge s={statusLabel(t.status)} />
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px', border: '1px solid var(--bd)', minHeight: '60px' }}>
                    <p style={{ fontSize: '12px', color: 'var(--t1)', lineHeight: 1.55 }}>
                      {bodyText || <span style={{ color:'var(--t3)', fontStyle:'italic' }}>No body text</span>}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {isAdmin && <Btn variant="ghost" size="sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setEditTpl(t)}>Edit</Btn>}
                    <Btn variant="outline" size="sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setPreviewTpl(t)}>Preview</Btn>
                    {isAdmin && <Btn variant="ghost" size="sm" onClick={() => deleteTemplate(t)} disabled={deletingId === t.id}
                      style={{ justifyContent: 'center', color: '#f87171' }} title="Delete template">
                      {deletingId === t.id ? '…' : <I n="trash" s={13} c="#f87171" />}
                    </Btn>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </>
        )}
      </div>

      {newOpen && (
        <TemplateModal
          onClose={() => setNewOpen(false)}
          onSaved={() => { setNewOpen(false); loadTemplates(); setSyncMsg({ ok:true, created:1, updated:0, total:1 }); }}
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
  const bodyText = getBodyText(template.components);
  const footerText = Array.isArray(template.components)
    ? (template.components.find(c => (c.type || '').toUpperCase() === 'FOOTER')?.text ?? '')
    : '';
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(3,5,12,0.78)', backdropFilter:'blur(4px)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width:'100%', maxWidth:480, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <p style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)' }}>{template.name}</p>
            <p style={{ fontSize:11.5, color:'var(--t2)', marginTop:2 }}>{template.category} · {template.language} · <StatusBadge s={statusLabel(template.status)} /></p>
          </div>
          <button onClick={onClose} style={{ width:28, height:28, borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="x" s={12} c="var(--t2)" />
          </button>
        </div>
        <div style={{ padding:20 }}>
          <div style={{ background:'#ECE5DD', borderRadius:10, padding:14, minHeight:60 }}>
            <div style={{ background:'#fff', borderRadius:'0 8px 8px 8px', padding:'10px 12px', maxWidth:'88%', boxShadow:'0 1px 3px rgba(0,0,0,0.1)', display:'inline-block' }}>
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
      <div style={{ ...card, padding:'18px 22px', marginBottom:18, display:'flex', alignItems:'center', gap:16, background:'linear-gradient(135deg, rgba(30,191,94,0.06), rgba(30,191,94,0.01))' }}>
        <div style={{ width:44, height:44, borderRadius:12, background:'var(--gbg)', border:'1px solid var(--gbd)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:'var(--glow)' }}>
          <I n="spark" s={20} c="var(--green)" />
        </div>
        <div style={{ flex:1 }}>
          <p style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)', marginBottom:3 }}>Pre-built template library</p>
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
                style={{ padding:'6px 12px', borderRadius:7, cursor:'pointer', fontSize:12, fontWeight: on ? 700 : 500, color: on ? '#060913' : 'var(--t2)', background: on ? 'var(--green)' : 'transparent', transition:'all .12s', whiteSpace:'nowrap' }}>
                {f.label}
              </div>
            );
          })}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', borderRadius:8, background:'var(--surf)', border:'1px solid var(--bd)', flex:1, minWidth:200, maxWidth:360 }}>
          <I n="search" s={13} c="var(--t2)" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search templates…"
            style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--t1)', fontSize:13, fontFamily:"'Plus Jakarta Sans',sans-serif" }} />
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
            const catColor = it.category === 'MARKETING' ? '#A78BFA' : it.category === 'UTILITY' ? '#0EA5E9' : '#fbbf24';
            return (
              <div key={it.id} style={{ ...card, padding:'18px', display:'flex', flexDirection:'column', gap:12, transition:'transform .15s, border-color .15s' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = 'var(--bdm)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = 'var(--bd)'; }}>

                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:14, color:'var(--t1)', marginBottom:4, lineHeight:1.3 }}>{it.title}</p>
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
                    {installed ? (<><I n="check" s={12} c="#060913" /> Installed</>)
                      : isInstalling ? 'Submitting…'
                      : (<><I n="download" s={12} c="#060913" /> Get it</>)}
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
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(3,5,12,0.78)', backdropFilter:'blur(4px)', zIndex:50, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width:'100%', maxWidth:520, maxHeight:'85vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <p style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)' }}>{item.title}</p>
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
            {installed ? (<><I n="check" s={12} c="#060913" /> Already installed</>)
              : installing ? 'Submitting…'
              : (<><I n="download" s={12} c="#060913" /> Get this template</>)}
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
        <h3 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: '17px', color: 'var(--t1)', marginBottom: '6px' }}>{title}</h3>
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
  { id: 'integrations',   label: 'Integrations',   icon: 'plug'  },
  { id: 'automation',     label: 'Automation',     icon: 'zap'   },
  { id: 'analytics',      label: 'Analytics',      icon: 'chart' },
  { id: 'chat-analysis',  label: 'Chat Analysis',  icon: 'chart' },
  { id: 'user-analytics', label: 'User Analytics', icon: 'user'  },
  { id: 'setup',          label: 'Number Setup',   icon: 'phone' },
  { id: 'payments',       label: 'Payments',       icon: 'credit' },
  { id: 'api',            label: 'API Keys',       icon: 'key'   },
  { id: 'support',        label: 'Help & Support', icon: 'msg'   },
  { id: 'settings',       label: 'Settings',       icon: 'cog'   },
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
];
const SUPERADMIN_NAV = [...ADMIN_TABS, { id: 'settings', label: 'Settings', icon: 'cog' }];

function navForUser(user) {
  return user?.superAdmin === true ? SUPERADMIN_NAV : ADMIN_NAV;
}

const Sidebar = ({ page, setPage, onNav, user }) => {
  const [col, setCol] = useState(false);
  const isAdmin = user?.role === 'ADMIN';
  const isSuperAdmin = user?.superAdmin === true;
  const NAV = navForUser(user);
  const planLabel = isSuperAdmin ? 'Super Admin' : isAdmin ? 'Admin' : 'Member';
  const [balance, setBalance] = useState(0);

  useEffect(() => {
    // Server-authoritative balance — fetched from the wallet ledger, updated
    // live via the wallet:balance-updated event that PaymentsView emits.
    wFetch('/wallet').then(r => r.ok ? r.json() : null).then(d => { if (d) setBalance(Number(d.balance) || 0); }).catch(() => {});
    const onBalanceUpdated = (e) => setBalance(Number(e.detail) || 0);
    window.addEventListener('wallet:balance-updated', onBalanceUpdated);
    return () => window.removeEventListener('wallet:balance-updated', onBalanceUpdated);
  }, []);

  return (
    <div style={{ width: col ? '60px' : '232px', background: '#060913', borderRight: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', transition: 'width .22s ease', flexShrink: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 14px', display: 'flex', alignItems: 'center', gap: '9px', borderBottom: '1px solid var(--bd)', minHeight: '62px' }}>
        <div onClick={() => setPage(isSuperAdmin ? 'admin-overview' : 'home')} style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', boxShadow: '0 0 16px rgba(30,191,94,0.3)' }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1C4.13 1 1 4.13 1 8c0 1.29.35 2.5.96 3.54L1 15l3.46-.96A7 7 0 1 0 8 1z" fill="#060913" /></svg>
        </div>
        {!col && <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: '15px', color: 'var(--t1)', whiteSpace: 'nowrap', letterSpacing: '-.02em' }}>ChatFlow<span style={{ color: 'var(--green)' }}>Pro</span></span>}
        {!col && <button onClick={() => setCol(true)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)', padding: '4px', display: 'flex' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 19l-7-7 7-7M18 19l-7-7 7-7" /></svg>
        </button>}
        {col && <button onClick={() => setCol(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)', padding: '4px', display: 'flex', marginLeft: '-2px' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 5l7 7-7 7M6 5l7 7-7 7" /></svg>
        </button>}
      </div>
      <div style={{ flex: 1, padding: '8px', display: 'flex', flexDirection: 'column', gap: '2px', overflowY: 'auto' }}>
        {!col && <div style={{ padding: '6px 8px 4px', fontSize: '10px', fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Menu</div>}
        {NAV.map(item => {
          const on = page === item.id || (page === 'campaigns-create' && item.id === 'campaigns');
          return (
            <div key={item.id} onClick={() => setPage(item.id)}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: col ? '10px' : '9px 10px', borderRadius: '8px', cursor: 'pointer', transition: 'background .12s', background: on ? 'rgba(30,191,94,0.1)' : 'transparent', justifyContent: col ? 'center' : 'flex-start' }}
              onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
              onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent'; }}
              title={col ? item.label : ''}>
              <I n={item.icon} s={16} c={on ? 'var(--green)' : 'var(--t2)'} w={on ? 2 : 1.75} />
              {!col && <span style={{ fontSize: '13px', fontWeight: on ? 600 : 500, color: on ? 'var(--t1)' : 'var(--t2)', whiteSpace: 'nowrap' }}>{item.label}</span>}
              {!col && on && <div style={{ marginLeft: 'auto', width: '5px', height: '5px', borderRadius: '50%', background: 'var(--green)' }} />}
            </div>
          );
        })}
      </div>
      {!col && !isSuperAdmin && (
        <div onClick={() => setPage('payments')} style={{ margin: '8px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(30,191,94,0.04)', border: '1px solid rgba(30,191,94,0.15)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '4px', transition: 'all 0.15s', marginBottom: '4px' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(30,191,94,0.08)'; e.currentTarget.style.borderColor = 'rgba(30,191,94,0.3)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(30,191,94,0.04)'; e.currentTarget.style.borderColor = 'rgba(30,191,94,0.15)'; }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            <I n="credit" s={12} c="var(--green)" /> Wallet Balance
          </div>
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--t1)' }}>
            ₹ {balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}
      <div style={{ padding: '10px 8px', borderTop: '1px solid var(--bd)' }}>
        {!col && <div style={{ padding: '10px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '9px' }}>
          <Avatar name={user?.name || 'User'} size={28} showRing />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name || 'User'}</p>
            <p style={{ fontSize: '10px', color: isAdmin ? 'var(--green)' : 'var(--t2)' }}>{planLabel}</p>
          </div>
        </div>}
        <div onClick={() => onNav('landing')} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: col ? '10px' : '9px 10px', borderRadius: '8px', cursor: 'pointer', transition: 'background .12s', justifyContent: col ? 'center' : 'flex-start' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          title={col ? 'Sign out' : ''}>
          <I n="logout" s={16} c="var(--t2)" />
          {!col && <span style={{ fontSize: '13px', color: 'var(--t2)', fontWeight: 500 }}>Sign out</span>}
        </div>
      </div>
    </div>
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

export default function Dashboard({ onNav, routePath }) {
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
  // Read fresh on every render (mirrors the routePath-falls-back-to-location
  // pattern above) — reflects whatever `?tab=` the current URL carries so a
  // deep-linked Quick Link can seed a tabbed page's initial sub-tab.
  const initialSubTab = new URLSearchParams(window.location.search).get('tab') || undefined;

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
    if (page === 'campaigns-create') return <CreateCampaign onBack={() => setPage('campaigns')} />;
    if (page.startsWith('admin-')) {
      // Each Platform Admin section is its own sidebar item now; regular users fall through.
      if (user?.superAdmin === true) return <SuperAdminView tab={page.slice('admin-'.length)} />;
      return <PlaceholderView title="Platform Admin" icon="chart" />;
    }
    if (page === 'home')       return <HomeView />;
    if (page === 'inbox')      return <InboxView />;
    if (page === 'campaigns')  return <CampaignsView onCreateCampaign={() => setPage('campaigns-create')} />;
    if (page === 'templates')  return <TemplatesView />;
    if (page === 'contacts')   return <ContactsView />;
    if (page === 'automation')     return <AutomationView initialTab={initialSubTab} />;
    if (page === 'analytics')      return <AnalyticsView />;
    if (page === 'chat-analysis')  return <ChatAnalytics workspaceId={user.workspaceId} token={token} />;
    if (page === 'user-analytics') return <UserAnalyticsView />;
    if (page === 'integrations')   return <IntegrationsView />;
    if (page === 'setup')          return <NumberSetupView />;
    if (page === 'payments')       return <PaymentsView initialTab={initialSubTab} />;
    if (page === 'api')            return <ApiKeysView />;
    if (page === 'support')        return <SupportView />;
    if (page === 'settings')       return <SettingsView />;
    if (page === 'profile')        return <ProfileView />;
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#060B18' }}>
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
        <Sidebar page={page} setPage={setPage} onNav={onNav} user={user} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: (isInbox || page === 'campaigns-create') ? 'hidden' : 'auto', minWidth: 0 }}>
          {renderView()}
        </div>
      </div>
    </div>
  );
}
