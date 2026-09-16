import { prisma } from '../lib/prisma.js';

// Record-level visibility for leads, deals and tasks.
//
// §45 requires this to be enforced on the server, never by hiding UI. Every
// list and every fetch-by-id runs through the same `where` fragment, so a
// caller cannot reach a record by guessing its id.
//
// Three modes, set per workspace:
//
//   ALL   every member sees every record. This is the default and is exactly
//         how the product behaved before scoping existed, so enabling the
//         feature changes nothing until an admin opts in.
//   TEAM  a member sees records they own, records owned by anyone sharing a
//         team with them, and unowned records.
//   OWN   a member sees only records they own, plus unowned ones.
//
// Admins always see everything: they administer the workspace, and a workspace
// nobody can fully see cannot be administered.
export const VISIBILITY_MODES = ['ALL', 'TEAM', 'OWN'];

// Unowned records stay visible in every mode. A lead nobody owns would
// otherwise be invisible to the whole workspace and quietly rot — the opposite
// of what scoping is for.
const UNOWNED = { ownerUserId: null };

export async function getWorkspaceVisibility(workspaceId) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { recordVisibility: true },
  });
  const mode = workspace?.recordVisibility;
  return VISIBILITY_MODES.includes(mode) ? mode : 'ALL';
}

// Every user id that shares at least one team with this user, including
// themselves. Returns null when the user is in no team, which the caller
// treats as "own records only" rather than "everyone".
export async function teammateIds(workspaceId, userId) {
  const memberships = await prisma.teamMember.findMany({
    where: { userId, team: { workspaceId } },
    select: { teamId: true },
  });
  if (memberships.length === 0) return null;

  const peers = await prisma.teamMember.findMany({
    where: { teamId: { in: memberships.map((m) => m.teamId) } },
    select: { userId: true },
  });
  return [...new Set([userId, ...peers.map((p) => p.userId)])];
}

/**
 * Builds the Prisma `where` fragment restricting a query to what this user may
 * see. Returns `{}` when everything is visible, so callers can spread it
 * unconditionally.
 *
 * `ownerField` differs by model — leads and deals use `ownerUserId`, tasks use
 * `assignedToUserId`.
 */
export async function scopeFilter(workspaceId, user, { ownerField = 'ownerUserId' } = {}) {
  if (!user?.id) {
    // No identified user means no records. Failing closed matters more here
    // than convenience: an unauthenticated path reaching this should see
    // nothing, not everything.
    return { [ownerField]: '__no_user__' };
  }

  if (user.role === 'ADMIN' || user.superAdmin === true) return {};

  const mode = await getWorkspaceVisibility(workspaceId);
  if (mode === 'ALL') return {};

  if (mode === 'OWN') {
    return { OR: [{ [ownerField]: user.id }, { [ownerField]: null }] };
  }

  const peers = await teammateIds(workspaceId, user.id);
  if (!peers) {
    // In TEAM mode a user belonging to no team sees only their own work.
    return { OR: [{ [ownerField]: user.id }, { [ownerField]: null }] };
  }
  return { OR: [{ [ownerField]: { in: peers } }, { [ownerField]: null }] };
}

/**
 * Throws 404 — not 403 — when a record exists but is out of scope.
 *
 * A 403 would confirm the record exists, letting someone enumerate ids to map
 * a colleague's pipeline. 404 is indistinguishable from "no such record".
 */
export async function assertInScope(workspaceId, user, model, id, { ownerField = 'ownerUserId' } = {}) {
  const filter = await scopeFilter(workspaceId, user, { ownerField });
  const found = await prisma[model].findFirst({
    where: { id, workspaceId, ...filter },
    select: { id: true },
  });
  if (!found) {
    const e = new Error('Not found');
    e.status = 404;
    throw e;
  }
  return true;
}
