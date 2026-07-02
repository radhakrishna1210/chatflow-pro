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
  window.location.href = '/';
}

async function authedFetch(url, opts = {}) {
  const token = localStorage.getItem('accessToken');
  if (!token) {
    logout();
    throw new Error('Missing access token');
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    ...opts,
    headers,
  });

  if (res.status === 401) {
    try {
      const newToken = await refreshAccessToken();
      headers.Authorization = `Bearer ${newToken}`;
      const retry = await fetch(url, {
        ...opts,
        headers,
      });
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

  if (res.status === 403) {
    throw new Error('Access denied');
  }

  return res;
}

export const wFetch = (path, opts = {}) => {
  const user = getStoredUser();
  if (!user?.workspaceId) {
    throw new Error('Workspace not found');
  }
  return authedFetch(`/api/v1/workspaces/${user.workspaceId}${path}`, opts);
};

export const adminFetch = (path, opts = {}) => {
  return authedFetch(`/api/v1/admin${path}`, opts);
};
