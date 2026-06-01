// Base URL of the backend API.
//  1. VITE_API_URL (build-time) wins if set.
//  2. Otherwise, when served from the deployed *.onrender.com frontend, talk to
//     the separately deployed backend.
//  3. Otherwise (local dev), use relative paths → Vite proxy / same-origin.
const PROD_API = 'https://chatflow-pro-backend.onrender.com';
const onRender =
  typeof window !== 'undefined' && window.location.hostname.endsWith('onrender.com');
export const API_BASE = (
  import.meta.env.VITE_API_URL || (onRender ? PROD_API : '')
).replace(/\/$/, '');

let _refreshing = null;

async function refreshAccessToken() {
  if (_refreshing) return _refreshing;
  _refreshing = (async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) throw new Error('no refresh token');
    const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) throw new Error('refresh failed');
    const data = await res.json();
    localStorage.setItem('accessToken', data.accessToken);
    if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken);
    return data.accessToken;
  })().finally(() => { _refreshing = null; });
  return _refreshing;
}

function logout() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  window.location.href = '/';
}

async function authedFetch(url, opts = {}) {
  const token = localStorage.getItem('accessToken');
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });

  if (res.status === 401) {
    try {
      const newToken = await refreshAccessToken();
      return fetch(url, {
        ...opts,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${newToken}`, ...(opts.headers || {}) },
      });
    } catch {
      logout();
      throw new Error('Session expired');
    }
  }

  return res;
}

export const wFetch = (path, opts = {}) => {
  const { workspaceId } = JSON.parse(localStorage.getItem('user') || '{}');
  return authedFetch(`${API_BASE}/api/v1/workspaces/${workspaceId}${path}`, opts);
};

export const adminFetch = (path, opts = {}) =>
  authedFetch(`${API_BASE}/api/v1/admin${path}`, opts);
