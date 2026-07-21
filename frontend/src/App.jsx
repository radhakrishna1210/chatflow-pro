import { useState, useEffect, useCallback } from 'react';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import AuthCallback from './pages/AuthCallback.jsx';
import WorkspaceSetup from './pages/WorkspaceSetup.jsx';
import InviteAccept from './pages/InviteAccept.jsx';

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

function isAuthed() {
  return !!(localStorage.getItem('accessToken') && localStorage.getItem('user'));
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

function clearSession() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  sessionStorage.removeItem('impersonatorSession');
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => {
      setPath(window.location.pathname);
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

  if (path === '/auth/callback') return <AuthCallback />;
  // Deliberately not covered by the route-guard effect above (only handles
  // /dashboard, /setup, /login, /register) — this page must work whether or
  // not the visitor is currently logged in, so it branches internally.
  if (path === '/invite/accept') return <InviteAccept />;
  if (path === '/login')         return <Login onNav={nav} mode="login" />;
  if (path === '/register')      return <Register onNav={nav} />;
  if (path === '/setup') {
    if (!isAuthed() || canAccessDashboard()) return null; // guard effect redirects
    return <WorkspaceSetup onNav={nav} />;
  }
  if (path.startsWith('/dashboard')) {
    if (!isAuthed() || !canAccessDashboard()) return null; // guard effect redirects
    return <Dashboard onNav={nav} routePath={path} />;
  }
  if (path === '/' && isAuthed()) {
    // Logged-in users land on the dashboard, matching the pre-router behaviour.
    navigate(canAccessDashboard() ? '/dashboard' : '/setup', { replace: true });
    return null;
  }
  return <Landing onNav={nav} />;
}
