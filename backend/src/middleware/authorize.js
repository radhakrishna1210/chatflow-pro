import { prisma } from '../lib/prisma.js';

const ROLE_HIERARCHY = { CLIENT: 0, ADMIN: 1 };

export function authorize(...roles) {
  return async (req, res, next) => {
    const { id: userId, workspaceId } = req.user;
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!member) return res.status(403).json({ error: 'Not a member of this workspace' });

    const userLevel = ROLE_HIERARCHY[member.role] ?? -1;
    const required = Math.min(...roles.map((r) => ROLE_HIERARCHY[r] ?? 99));
    if (userLevel < required) return res.status(403).json({ error: 'Insufficient permissions' });

    req.user.role = member.role;
    next();
  };
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
