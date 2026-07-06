import * as securityService from '../services/security.service.js';

export async function getSessions(req, res) {
  try {
    const list = await securityService.getSessions(req.user.id);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function revokeSession(req, res) {
  try {
    await securityService.revokeSession(req.user.id, req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: 'New password is required' });
    const result = await securityService.changePassword(req.user.id, currentPassword, newPassword);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function get2FA(req, res) {
  try {
    const status = await securityService.get2FA(req.params.workspaceId || req.user.workspaceId);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function toggle2FA(req, res) {
  try {
    const status = await securityService.toggle2FA(req.params.workspaceId || req.user.workspaceId, req.body.enabled);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
