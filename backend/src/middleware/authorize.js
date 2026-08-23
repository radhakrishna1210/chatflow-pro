import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';

// Ordered by capability. VIEWER and AGENT sit below CLIENT, so every existing
// `authorize('CLIENT')` on a route automatically excludes them — which is
// correct: writing a campaign or a template is member-level work.
const ROLE_HIERARCHY = { VIEWER: 0, AGENT: 1, CLIENT: 2, ADMIN: 3 };

// What the four workspace roles actually mean here:
//
//   VIEWER sees the workspace and changes nothing. For a stakeholder who wants
//   the numbers — analytics, campaign results, the inbox as a record — without
//   any ability to send, spend or edit.
//
//   AGENT works the inbox: replying to conversations, assigning and resolving
//   them, taking notes, keeping contact records straight, and blocking a number
//   that asks to be left alone. Everything else is read-only. This is the role
//   for someone answering customers who should not be able to launch a campaign
//   or rewrite an automation.
//
//   CLIENT ("Member") runs the workspace day to day — numbers, templates,
//   campaigns, contacts, segments, automations, the AI agent, forms,
//   integrations, API keys, opt-outs and settings. Nothing operational is
//   withheld from them.
//
//   ADMIN additionally holds the two capabilities that are really one:
//     • spending money — wallet recharge and plan checkout;
//     • granting access — inviting members, changing roles, revoking invites.
//   The second guards the first. A member who could change roles could make
//   themselves an admin and then reach billing, which would leave "members
//   cannot pay" true only until someone noticed.
//
// So `authorize('ADMIN')` now appears on exactly those routes. Anything else
// needs only authenticate + workspaceContext, which already prove membership
// of this workspace.

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
