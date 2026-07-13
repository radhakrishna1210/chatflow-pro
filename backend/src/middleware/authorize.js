import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';

const ROLE_HIERARCHY = { CLIENT: 0, ADMIN: 1 };

// Require the user's *live DB* workspace role to be at least the highest role
// listed (permissions are hierarchical: ADMIN ⊃ CLIENT). Using Math.max fixes
// the old `authorize('ADMIN','CLIENT')` pattern which resolved to CLIENT.
export function authorize(...roles) {
  return async (req, res, next) => {
    const { id: userId, workspaceId } = req.user;

    // workspaceContext already verified membership and stored the live role —
    // reuse it instead of a second identical DB query per request.
    let role = req.user.workspaceRoleVerified ? req.user.role : null;
    if (!role) {
      const member = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } },
      });
      if (!member) return res.status(403).json({ error: 'Not a member of this workspace' });
      role = member.role;
      req.user.role = role;
      req.user.workspaceRoleVerified = true;
    }

    const userLevel = ROLE_HIERARCHY[role] ?? -1;
    const required = Math.max(...roles.map((r) => ROLE_HIERARCHY[r] ?? 99));
    if (userLevel < required) return res.status(403).json({ error: 'Insufficient permissions' });

    next();
  };
}

// Platform-level gate for global /admin routes (number pool, workspace
// assignment). Verified against the DB (ADMIN_EMAIL) rather than trusting a
// stale JWT claim, so revoking super-admin takes effect immediately.
export async function requireSuperAdmin(req, res, next) {
  try {
    if (req.user?.superAdmin !== true) {
      return res.status(403).json({ error: 'Super admin access required' });
    }
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { email: true } });
    if (!user || user.email.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) {
      return res.status(403).json({ error: 'Super admin access required' });
    }
    next();
  } catch (err) {
    next(err);
  }
}
