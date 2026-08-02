let _refreshing = null;

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
}

async function refreshAccessToken() {
  if (_refreshing) return _refreshing;

  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) {
    logout();
    throw new Error('no refresh token');
  }

  _refreshing = (async () => {
    const res = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      logout();
      throw new Error('refresh failed');
    }
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
  window.location.href = '/login';
}

async function authedFetch(url, opts = {}) {
  const token = localStorage.getItem('accessToken');
  if (!token) {
    logout();
    throw new Error('Missing access token');
  }

  // For FormData bodies the browser MUST set Content-Type itself (it includes
  // the multipart boundary). Forcing application/json breaks file uploads.
  const isFormData = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(opts.headers || {}),
    Authorization: `Bearer ${token}`,
  };

  const res = await fetch(url, { ...opts, headers });

  if (res.status === 401) {
    try {
      const newToken = await refreshAccessToken();
      headers.Authorization = `Bearer ${newToken}`;
      const retry = await fetch(url, { ...opts, headers });
      if (retry.status === 401) {
        logout();
        throw new Error('Session expired');
      }
      return retry;
    } catch {
      logout();
      throw new Error('Session expired');
    }
  }

  return res;
}

// Always returns a Promise (never throws synchronously), so both
// `wFetch(...).then().catch()` and try/await callers handle errors.
export const wFetch = (path, opts = {}) => {
  const user = getStoredUser();
  if (!user?.workspaceId) {
    return Promise.reject(new Error('Workspace not found'));
  }
  return authedFetch(`/api/v1/workspaces/${user.workspaceId}${path}`, opts);
};

export const adminFetch = (path, opts = {}) => {
  return authedFetch(`/api/v1/admin${path}`, opts);
};

export const apiFetch = authedFetch;

// Downloads a workspace-scoped file (invoice, CSV export) through the
// authenticated fetch path. A plain <a href> can't be used because every API
// route needs the Authorization header, so the response is pulled down as a
// blob and handed to a synthetic link instead.
export async function wDownload(path, fallbackName = 'download') {
  const res = await wFetch(path);
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try { const data = await res.json(); if (data.error) message = data.error; } catch { /* not JSON */ }
    throw new Error(message);
  }

  // Prefer the server's filename from Content-Disposition when it sent one.
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="?([^"';]+)"?/i.exec(disposition);
  const filename = match ? match[1] : fallbackName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoke on the next tick — revoking synchronously can cancel the download
  // in some browsers before it has started reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}
