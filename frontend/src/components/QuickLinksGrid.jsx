import { I } from './Icons.jsx';

// Shared "jump to a related section" grid, shown on both the Profile page and
// the Settings page. `currentPage` hides any tile that would just navigate
// back to the page it's already rendered on. `subTab` (where present) deep
// links straight into the destination page's relevant tab instead of
// dropping the user on that page's default tab (see Dashboard.jsx's
// `pathFromSection`/`onAppNav`, which turns this into a `?tab=` URL param).
export const QUICK_LINKS = [
  { id: 'wa-profile',   label: 'WhatsApp Profile',    desc: 'Manage your connected WhatsApp Business number', icon: 'phone',  nav: 'setup' },
  { id: 'contacts',     label: 'Contact Settings',    desc: 'View and manage your contact list',              icon: 'users',  nav: 'contacts' },
  { id: 'agent',        label: 'Agent Settings',      desc: 'Configure your WhatsApp AI Agent',                icon: 'bot',    nav: 'automation', subTab: 'wa-agent' },
  { id: 'roles',        label: 'Role Permissions',    desc: 'Review admin and member role access',            icon: 'shield', nav: 'settings' },
  { id: 'teams',        label: 'Manage Teams',        desc: 'Invite teammates and manage workspace members',  icon: 'users',  nav: 'settings' },
  { id: 'tags',         label: 'Manage Tags',         desc: 'Organize contacts with tags',                    icon: 'filter', nav: 'contacts' },
  { id: 'invoices',     label: 'Invoices',            desc: 'View and download billing invoices',             icon: 'note',   nav: 'payments', subTab: 'invoices' },
  { id: 'subscription', label: 'Manage Subscription', desc: 'Upgrade, downgrade, or manage your plan',        icon: 'credit', nav: 'payments', subTab: 'subscription' },
];

const go = (nav, subTab) => window.dispatchEvent(new CustomEvent('app:nav', { detail: subTab ? { section: nav, subTab } : nav }));

export default function QuickLinksGrid({ currentPage }) {
  const links = QUICK_LINKS.filter(l => l.nav !== currentPage);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
      {links.map(l => (
        <button key={l.id} onClick={() => go(l.nav, l.subTab)} style={{
          display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left', padding: 16, borderRadius: 12,
          background: 'rgba(255,255,255,0.02)', border: '1px solid var(--bd)', cursor: 'pointer', transition: 'all .15s ease',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(30,191,94,0.06)'; e.currentTarget.style.borderColor = 'var(--gbd)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'var(--bd)'; e.currentTarget.style.transform = 'none'; }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--gbg)', border: '1px solid var(--gbd)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <I n={l.icon} s={16} c="var(--green)" />
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)', marginBottom: 3 }}>{l.label}</p>
            <p style={{ fontSize: 11.5, color: 'var(--t2)', lineHeight: 1.4 }}>{l.desc}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
