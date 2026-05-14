import { useState, useEffect } from 'react';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';

function getInitialPage() {
  const params = new URLSearchParams(window.location.search);
  const accessToken = params.get('accessToken');

  if (window.location.pathname === '/auth/callback' && accessToken) {
    localStorage.setItem('accessToken', accessToken);
    const refreshToken = params.get('refreshToken');
    if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
    localStorage.setItem('user', JSON.stringify({
      name:          params.get('userName'),
      email:         params.get('userEmail'),
      role:          params.get('userRole'),
      workspaceId:   params.get('workspaceId'),
      workspaceName: params.get('workspaceName'),
    }));
    window.history.replaceState({}, '', '/');
    return 'dashboard';
  }

  if (localStorage.getItem('accessToken')) return 'dashboard';
  return 'landing';
}

export default function App() {
  const [page, setPage] = useState(getInitialPage);

  const nav = (p) => {
    if (p === 'landing') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
    }
    setPage(p);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  if (page === 'landing')   return <Landing onNav={nav} />;
  if (page === 'login')     return <Login onNav={nav} />;
  if (page === 'dashboard') return <Dashboard onNav={nav} />;

  return <Landing onNav={nav} />;
}
