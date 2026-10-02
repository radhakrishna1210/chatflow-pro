import { getUserCrmPermissions } from '../services/crmPermissions.service.js';

export async function getMyCrmPermissions(req, res) {
  const role = req.user?.role;
  const perms = getUserCrmPermissions(role);
  res.json(perms);
}
