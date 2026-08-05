import * as usersService from '../services/users.service.js';

export async function getMe(req, res) {
  const result = await usersService.getProfile(req.user.id, req.user.workspaceId);
  res.json(result);
}

export async function updateMe(req, res) {
  const result = await usersService.updateProfile(req.user.id, req.body);
  res.json(result);
}

export async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  const result = await usersService.changePassword(req.user.id, currentPassword, newPassword);
  res.json(result);
}

export async function listSessions(req, res) {
  const currentToken = typeof req.query.currentToken === 'string' ? req.query.currentToken : null;
  const result = await usersService.listSessions(req.user.id, currentToken);
  res.json(result);
}

export async function revokeOtherSessions(req, res) {
  const { keepToken } = req.body || {};
  const result = await usersService.revokeOtherSessions(req.user.id, typeof keepToken === 'string' ? keepToken : null);
  res.json(result);
}

export async function deletionPreview(req, res) {
  const result = await usersService.previewAccountDeletion(req.user.id);
  res.json(result);
}

export async function deleteMe(req, res) {
  // Refresh tokens cascade from the User row, so every session dies with the
  // account — the client just needs to clear its own local copy.
  const result = await usersService.deleteAccount(req.user.id, req.body || {});
  res.json(result);
}
