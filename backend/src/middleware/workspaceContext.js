import { prisma } from '../lib/prisma.js';

export async function workspaceContext(req, res, next) {
  const { workspaceId } = req.params;
  if (!workspaceId) return next();

  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: req.user.id, workspaceId } },
    include: { workspace: true },
  });

  if (!member) {
    return res.status(403).json({ error: 'Access denied to this workspace' });
  }

  // A suspended workspace is read-blocked for everyone except platform super
  // admins (who need access to review/reinstate it).
  if (member.workspace.suspended && req.user?.superAdmin !== true) {
    return res.status(403).json({ error: 'This workspace has been suspended. Please contact support.', suspended: true });
  }

  req.user.workspaceId = workspaceId;
  req.user.role = member.role;
  // Flag so authorize() can skip a duplicate WorkspaceMember lookup.
  req.user.workspaceRoleVerified = true;
  req.workspace = member.workspace;
  next();
}
