import { getUserCrmPermissions } from '../services/crmPermissions.service.js';

export async function getMyCrmPermissions(req, res) {
  const role = req.membership?.role || req.user?.role || 'AGENT';
  const perms = getUserCrmPermissions(role);
  res.json(perms);
}
