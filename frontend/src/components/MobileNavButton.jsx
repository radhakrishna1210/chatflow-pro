import { useIsMobile } from '../lib/useMediaQuery.js';

// Opens the shell's nav drawer. An event rather than a prop because the header
// that carries this button is rendered by a dozen different views, none of
// which should have to know the shell has a drawer — the same reason `app:nav`
// is an event.
export const openMobileNav = () => window.dispatchEvent(new CustomEvent('app:toggle-nav'));

// The hamburger, extracted from Dashboard's DashHeader.
//
// Roughly half the dashboard's pages build their own 58px header rather than
// using DashHeader, and those headers had no hamburger — so on a phone the nav
// drawer was unreachable from Contacts, Settings, Widgets, Payments and the
// rest, and the four-entry tab bar was the only navigation left. It lives here
// rather than in Dashboard.jsx so those pages can import it without importing
// the shell that renders them.
export default function MobileNavButton() {
  const mobile = useIsMobile();
  if (!mobile) return null;
  return (
    <button onClick={openMobileNav} aria-label="Open navigation"
      style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 9, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t1)' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
  );
}
