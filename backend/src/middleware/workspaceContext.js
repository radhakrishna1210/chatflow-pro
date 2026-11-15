import { prisma } from '../lib/prisma.js';
import { checkRoleCapability } from './roleCapabilities.js';
import { runWithAiModel, workspaceAiModel } from '../lib/aiModel.js';

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

  // Capability floor for the read-mostly roles (VIEWER, AGENT). Applied here,
  // once, rather than as forty separate authorize() annotations — a workspace
  // route that nobody remembered to guard is then closed to them by default
  // instead of silently writable. See middleware/roleCapabilities.js.
  const refusal = checkRoleCapability(req);
  if (refusal) return res.status(refusal.status).json(refusal.body);

  // Everything this request goes on to do runs under the workspace's own AI
  // model when the super admin pinned one (lib/aiModel.js). The workspace row
  // is already loaded above, so this costs no query; with no override it is
  // the platform default exactly as before.
  return runWithAiModel(member.workspace.aiModel, () => next());
}

// The same, for the few AI routes that are not mounted under
// /workspaces/:workspaceId and so never pass through workspaceContext — the
// onboarding assistant and /ai. Mount after authenticate.
//
// The workspace is resolved the way those handlers resolve it: one named in
// the request body wins over the one in the token (the onboarding assistant
// accepts `workspaceId` so it follows a workspace switch), so the model always
// belongs to the workspace the work is actually done for. Membership is not
// checked here — the handlers do that before any model is called, so a
// non-member is refused without ever producing output under another
// workspace's model.
export async function workspaceAiModelContext(req, res, next) {
  const named = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : null;
  const model = await workspaceAiModel(named || req.user?.workspaceId);
  return runWithAiModel(model, () => next());
}
