import { prisma } from '../lib/prisma.js';

// Record-level visibility for leads, deals, tasks, tickets and everything
// hanging off them (activities, line items, reports, segment audiences).
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

// The owner ids whose records `user` may see — unowned records are visible on
// top of these — or null when nothing is restricted.
export async function visibleOwnerIds(workspaceId, user) {
  if (user.role === 'ADMIN' || user.superAdmin === true) return null;

  const mode = await getWorkspaceVisibility(workspaceId);
  if (mode === 'ALL') return null;
  if (mode === 'OWN') return [user.id];

  // In TEAM mode a user belonging to no team sees only their own work.
  return (await teammateIds(workspaceId, user.id)) ?? [user.id];
}

const ownedBy = (field, ids) => ({
  OR: [{ [field]: ids.length === 1 ? ids[0] : { in: ids } }, { [field]: null }],
});

/**
 * Builds the Prisma `where` fragment restricting a query to what this user may
 * see. Returns `{}` when everything is visible. Compose it with other filters
 * through `withScope` — never by spreading, see below.
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

  const ids = await visibleOwnerIds(workspaceId, user);
  return ids ? ownedBy(ownerField, ids) : {};
}

/**
 * Activities have no owner of their own: they belong to the lead or deal they
 * were logged against. One is visible when that lead or deal is, when the
 * caller wrote it, or — for a note attached to neither — when its author is
 * someone whose records the caller may see.
 */
export async function activityScopeFilter(workspaceId, user) {
  if (!user?.id) return { createdByUserId: '__no_user__' };

  const ids = await visibleOwnerIds(workspaceId, user);
  if (!ids) return {};
  const owned = ownedBy('ownerUserId', ids);
  return {
    OR: [
      { lead: { is: owned } },
      { deal: { is: owned } },
      { leadId: null, dealId: null, ...ownedBy('createdByUserId', ids) },
      { createdByUserId: user.id },
    ],
  };
}

/**
 * ANDs a scope fragment into a `where`. The fragment is itself an `OR`, so
 * spreading it beside a filter that also sets `OR` (a status or stage filter,
 * a search) lets the filter silently replace it. Under `AND` nothing written to
 * the rest of the `where` — before or after — can drop it.
 */
export function withScope(where, scope) {
  if (!scope || Object.keys(scope).length === 0) return where;
  const and = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
  return { ...where, AND: [...and, scope] };
}

/**
 * `where` restricted to what `user` may see. A null user marks an internal
 * caller (workflow engine, background job) and leaves `where` unscoped — the
 * same convention every service already followed with `user ? scopeFilter : {}`.
 * Route handlers must always pass `req.user`.
 */
export async function scopedWhere(workspaceId, user, where, { ownerField = 'ownerUserId' } = {}) {
  if (!user) return where;
  return withScope(where, await scopeFilter(workspaceId, user, { ownerField }));
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
    where: withScope({ id, workspaceId }, filter),
    select: { id: true },
  });
  if (!found) {
    const e = new Error('Not found');
    e.status = 404;
    throw e;
  }
  return true;
}
