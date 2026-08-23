import { useState, useEffect, useCallback } from 'react';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import AuthCallback from './pages/AuthCallback.jsx';
import WorkspaceSetup from './pages/WorkspaceSetup.jsx';
import InviteAccept from './pages/InviteAccept.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import Legal from './pages/Legal.jsx';
import CampaignAI from './pages/CampaignAI.jsx';
import SiteAssistant from './components/SiteAssistant.jsx';
import { clearStoredSession } from './lib/api.js';

// ─── Tiny history-based router ────────────────────────────────────────────────
// Real URLs (/login, /register, /dashboard/campaigns, …) so browser
// back/forward, page refresh and deep links all work. Legacy onNav('page')
// calls are translated to paths for backwards compatibility.

const LEGACY_PATHS = {
  landing: '/',
  login: '/login',
  register: '/register',
  dashboard: '/dashboard',
  setup: '/setup',
};

export function navigate(path, { replace = false } = {}) {
  if (window.location.pathname + window.location.search === path) return;
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

// Seconds-since-epoch `exp` out of a JWT, or null when it can't be read. Not a
// security check — the server verifies the signature — just enough to tell a
// live session from the remains of an old one without a network round trip.
function tokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

const alive = (token) => {
  if (!token) return false;
  const exp = tokenExpiry(token);
  // Unreadable expiry: assume it's usable and let the server be the judge.
  return exp === null || exp > Date.now();
};

// A leftover token in localStorage is not a session. Checking it here is what
// keeps a visitor with an old, dead login on the landing page: without it the
// router sent them to /dashboard, the first API call 401'd, and the app bounced
// them to a login screen they never asked for — which looked like the site
// opening on /login instead of the landing page.
function isAuthed() {
  const accessToken = localStorage.getItem('accessToken');
  if (!accessToken || !localStorage.getItem('user')) return false;
  if (alive(accessToken)) return true;
  // An expired access token is still a session while a refresh token can renew
  // it. When neither can, the session is over — drop it so the visitor gets a
  // clean landing page rather than a redirect loop.
  if (alive(localStorage.getItem('refreshToken'))) return true;
  clearStoredSession();
  return false;
}

// Users without a workspace (fresh signups) must create or join one before
// they can use the dashboard. Super admins can access the dashboard directly.
function isSuperAdmin() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null')?.superAdmin === true;
  } catch {
    return false;
  }
}

function hasWorkspace() {
  try {
    return !!JSON.parse(localStorage.getItem('user') || 'null')?.workspaceId;
  } catch {
    return false;
  }
}

function canAccessDashboard() {
  return hasWorkspace() || isSuperAdmin();
}

// Signing out from the UI. Shares one implementation with the API layer's
// automatic logout so the two can't drift over which keys a session is made of.
const clearSession = clearStoredSession;

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  // The query string is tracked separately from the pathname. Route matching
  // below is all pathname equality, so the search must not be folded into
  // `path` — but it still has to be state, because a navigation that changes
  // only the query (…/payments?tab=invoices → …/payments) leaves the pathname
  // identical, setPath is handed the value it already holds, React bails out
  // of the re-render, and every page that reads `?tab=` keeps showing the old
  // sub-tab while the address bar says otherwise.
  const [search, setSearch] = useState(window.location.search);

  useEffect(() => {
    const onPop = () => {
      setPath(window.location.pathname);
      setSearch(window.location.search);
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Legacy navigation API used by existing pages: onNav('login'|'dashboard'|…)
  const nav = useCallback((p) => {
    if (p === 'landing') clearSession();
    navigate(LEGACY_PATHS[p] || `/${p}`);
  }, []);

  // Route guards
  useEffect(() => {
    if (path.startsWith('/dashboard') && !isAuthed()) {
      navigate('/login', { replace: true });
    } else if (path.startsWith('/dashboard') && !canAccessDashboard()) {
      navigate('/setup', { replace: true });
    } else if (path === '/setup' && !isAuthed()) {
      navigate('/login', { replace: true });
    } else if (path === '/setup' && canAccessDashboard()) {
      navigate('/dashboard', { replace: true });
    } else if ((path === '/login' || path === '/register') && isAuthed()) {
      navigate(canAccessDashboard() ? '/dashboard' : '/setup', { replace: true });
    }
  }, [path]);

  const page = renderPage(path, nav, search);

  // The website assistant rides above every screen, so a question that occurs
  // to someone on the pricing page is still answerable once they are inside
  // the dashboard. It is withheld from /auth/callback, which is a redirect in
  // progress rather than a page anyone reads.
  return (
    <>
      {page}
      {path !== '/auth/callback' && <SiteAssistant />}
    </>
  );
}

function renderPage(path, nav, search) {
  if (path === '/auth/callback') return <AuthCallback />;
  // Deliberately not covered by the route-guard effect above (only handles
  // /dashboard, /setup, /login, /register) — this page must work whether or
  // not the visitor is currently logged in, so it branches internally.
  if (path === '/invite/accept') return <InviteAccept />;
  // Policy pages are public by design: Meta's WhatsApp onboarding and the
  // payment gateway both require these URLs to resolve for a signed-out
  // visitor, so they sit outside every guard.
  if (path === '/legal' || path.startsWith('/legal/')) return <Legal routePath={path} />;
  // Product pages are public and stay public for signed-in visitors too: the
  // only redirect on this side of the guards is the landing page's, and a
  // logged-in user following a link to a feature page wants to read the page,
  // not be bounced to their dashboard.
  if (path === '/product/campaign-ai') return <CampaignAI onNav={nav} />;
  if (path === '/login')         return <Login onNav={nav} mode="login" />;
  if (path === '/register')      return <Register onNav={nav} />;
  // Must work whether or not the visitor is logged in, same as /invite/accept.
  if (path === '/forgot-password') return <ForgotPassword />;
  if (path === '/setup') {
    if (!isAuthed() || canAccessDashboard()) return null; // guard effect redirects
    return <WorkspaceSetup onNav={nav} />;
  }
  if (path.startsWith('/dashboard')) {
    if (!isAuthed() || !canAccessDashboard()) return null; // guard effect redirects
    return <Dashboard onNav={nav} routePath={path} routeSearch={search} />;
  }
  if (path === '/' && isAuthed()) {
    // Logged-in users land on the dashboard, matching the pre-router behaviour.
    navigate(canAccessDashboard() ? '/dashboard' : '/setup', { replace: true });
    return null;
  }
  return <Landing onNav={nav} />;
}
