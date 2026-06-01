import * as authService from '../services/auth.service.js';

export async function register(req, res) {
  const result = await authService.register(req.body);
  res.status(201).json(result);
}

export async function login(req, res) {
  const result = await authService.login(req.body);
  res.json(result);
}

export async function refresh(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
  const result = await authService.refresh(refreshToken);
  res.json(result);
}

export async function logout(req, res) {
  const { refreshToken } = req.body;
  await authService.logout(refreshToken);
  res.json({ message: 'Logged out successfully' });
}

export function googleCallback(req, res) {
  const { accessToken, refreshToken, user, workspace } = req.user;
  const params = new URLSearchParams({
    accessToken,
    refreshToken,
    userName: user.name,
    userEmail: user.email,
    userRole: user.role,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
  });
  // Redirect to the root path (always served by the static host) with tokens in
  // the query — the SPA picks them up there. Avoids needing a deep-link rewrite.
  res.redirect(`${process.env.CLIENT_URL}/?${params}`);
}
