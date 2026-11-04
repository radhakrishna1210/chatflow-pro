import { prisma } from '../lib/prisma.js';

export async function listMembers(workspaceId) {
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { joinedAt: 'asc' },
  });

  // The first admin to join is the workspace owner. The UI needs to know both
  // that and how many admins there are so it can grey out the actions the
  // server would refuse anyway (demoting or deleting the last admin).
  const admins = members.filter((m) => m.role === 'ADMIN');
  const ownerId = admins[0]?.userId ?? members[0]?.userId ?? null;

  return members.map((m) => ({
    ...m,
    isOwner: m.userId === ownerId,
    // Set on the only remaining admin: this membership is what keeps the
    // workspace administrable, so its role and its removal are both locked.
    isLastAdmin: m.role === 'ADMIN' && admins.length === 1,
  }));
}

// Every role change and removal runs inside one transaction that first locks
// the workspace's membership rows. Counting admins and then writing are two
// statements, so without the lock two admins demoting each other at the same
// moment would each see "one other admin left" and both succeed, leaving the
// workspace with none.
async function withMembershipLock(workspaceId, fn) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "userId" FROM "WorkspaceMember" WHERE "workspaceId" = ${workspaceId} FOR UPDATE`;
    return fn(tx);
  });
}

async function countAdmins(tx, workspaceId, excludeUserId = null) {
  return tx.workspaceMember.count({
    where: {
      workspaceId,
      role: 'ADMIN',
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
    },
  });
}

// The owner is the earliest-joined admin — the same rule listMembers() uses to
// badge them. Admins are otherwise equal, but an admin someone invited (or who
// joined through a shared admin link) must not be able to demote or remove the
// person who created the workspace and take it over.
async function ownerUserId(tx, workspaceId) {
  const owner = await tx.workspaceMember.findFirst({
    where: { workspaceId, role: 'ADMIN' },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true },
  });
  return owner?.userId ?? null;
}

function ownerProtected(action) {
  const e = new Error(`The workspace owner can't be ${action} by another admin.`);
  e.status = 403;
  e.code = 'OWNER_PROTECTED';
  return e;
}

// A workspace must always keep at least one admin. Without this guard the sole
// admin could switch their own role to CLIENT and instantly lock everyone out
// of the workspace — there would be nobody left with permission to promote
// them back. Demoting yourself is refused outright; only another admin can
// change your role.
export async function updateMemberRole(workspaceId, userId, role, actingUserId = null) {
  return withMembershipLock(workspaceId, async (tx) => {
    const member = await tx.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!member) { const e = new Error('Member not found'); e.status = 404; throw e; }
    if (member.role === role) return member;

    if (member.role === 'ADMIN' && role !== 'ADMIN') {
      if (actingUserId && actingUserId === userId) {
        const e = new Error("You can't change your own role. Ask another admin to do it.");
        e.status = 403;
        e.code = 'CANNOT_CHANGE_OWN_ROLE';
        throw e;
      }
      if (actingUserId && (await ownerUserId(tx, workspaceId)) === userId) throw ownerProtected('demoted');
      const otherAdmins = await countAdmins(tx, workspaceId, userId);
      if (otherAdmins === 0) {
        const e = new Error('This is the only admin in the workspace. Promote another member to admin first.');
        e.status = 409;
        e.code = 'LAST_ADMIN';
        throw e;
      }
    }

    return tx.workspaceMember.update({
      where: { userId_workspaceId: { userId, workspaceId } },
      data: { role },
    });
  });
}

// Same protection for deletion: removing the last admin would leave the
// workspace with no one who can manage it.
export async function removeMember(workspaceId, userId, actingUserId = null) {
  await withMembershipLock(workspaceId, async (tx) => {
    const member = await tx.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!member) { const e = new Error('Member not found'); e.status = 404; throw e; }

    if (member.role === 'ADMIN') {
      if (actingUserId && actingUserId !== userId && (await ownerUserId(tx, workspaceId)) === userId) {
        throw ownerProtected('removed');
      }
      const otherAdmins = await countAdmins(tx, workspaceId, userId);
      if (otherAdmins === 0) {
        const e = new Error(
          actingUserId === userId
            ? "You're the only admin in this workspace and can't remove yourself. Promote another member to admin first."
            : 'This is the only admin in the workspace and cannot be removed. Promote another member to admin first.'
        );
        e.status = 409;
        e.code = 'LAST_ADMIN';
        throw e;
      }
    }

    await tx.workspaceMember.delete({
      where: { userId_workspaceId: { userId, workspaceId } },
    });

    // What the membership granted goes with it, in the same transaction.
    // These rows used to survive removal: the user stayed listed on this
    // workspace's teams (and so in ticket routing), their consent to third-party
    // apps kept skipping the consent screen for a workspace they no longer
    // belonged to, and an unredeemed authorization code could still be
    // exchanged for an API key. Their inbox assignments are released so the
    // threads are not stranded on someone who can no longer open them.
    await tx.teamMember.deleteMany({ where: { userId, team: { workspaceId } } });
    await tx.oAuthConsent.updateMany({ where: { userId, workspaceId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.oAuthAuthorizationCode.deleteMany({ where: { userId, workspaceId, consumedAt: null } });
    await tx.conversation.updateMany({ where: { workspaceId, assignedToUserId: userId }, data: { assignedToUserId: null } });
  });
}
