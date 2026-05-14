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

  req.user.workspaceId = workspaceId;
  req.user.role = member.role;
  req.workspace = member.workspace;
  next();
}
