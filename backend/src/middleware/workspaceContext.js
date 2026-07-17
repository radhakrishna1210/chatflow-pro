import { prisma } from '../lib/prisma.js';

export async function workspaceContext(req, res, next) {
  const { workspaceId } = req.params;
  if (!workspaceId) return next();

  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: req.user.id, workspaceId } },
    include: { workspace: { include: { subscription: true } } },
  });

  if (!member) {
    return res.status(403).json({ error: 'Access denied to this workspace' });
  }

  // A suspended workspace is read-blocked for everyone except platform super
  // admins (who need access to review/reinstate it).
  if (member.workspace.suspended && req.user?.superAdmin !== true) {
    return res.status(403).json({ error: 'This workspace has been suspended. Please contact support.', suspended: true });
  }

  // A CANCELLED/EXPIRED subscription blocks the workspace the same way a
  // suspension does (README §12.4) — but the user must still be able to see
  // their plan/wallet state and recharge/renew, so exempt those two route
  // surfaces (matched by mount path, since this middleware runs generically
  // across many route files rather than once centrally).
  const subStatus = member.workspace.subscription?.status;
  if (subStatus && ['CANCELLED', 'EXPIRED'].includes(subStatus) && req.user?.superAdmin !== true) {
    const exempt = req.baseUrl.endsWith('/subscription') || req.baseUrl.endsWith('/wallet');
    if (!exempt) {
      return res.status(403).json({ error: 'This workspace\'s subscription is inactive. Renew your plan or recharge your wallet to continue.', code: 'SUBSCRIPTION_INACTIVE' });
    }
  }

  req.user.workspaceId = workspaceId;
  req.user.role = member.role;
  // Flag so authorize() can skip a duplicate WorkspaceMember lookup.
  req.user.workspaceRoleVerified = true;
  req.workspace = member.workspace;
  next();
}
