import { prisma } from '../lib/prisma.js';
import { queueMemberInvitedEmail } from './email.service.js';
import { assertWithinLimit } from './subscription.service.js';

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

export async function inviteMember(workspaceId, { email, role }, inviterName) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) { const e = new Error('User not found'); e.status = 404; throw e; }

  const existing = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId } },
  });
  if (existing) { const e = new Error('User already a member'); e.status = 409; throw e; }

  await assertWithinLimit(workspaceId, 'member');

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });

  const member = await prisma.workspaceMember.create({
    data: { userId: user.id, workspaceId, role },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  queueMemberInvitedEmail({
    inviteeEmail: user.email,
    inviteeName: user.name,
    inviterName: inviterName || 'A workspace admin',
    workspaceId,
    workspaceName: workspace?.name || 'your workspace',
  }).catch(() => {});

  return member;
}

// Counts admins in one query so the "last admin" checks below can't be raced
// by two concurrent demotions.
async function countAdmins(workspaceId, excludeUserId = null) {
  return prisma.workspaceMember.count({
    where: {
      workspaceId,
      role: 'ADMIN',
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
    },
  });
}

// A workspace must always keep at least one admin. Without this guard the sole
// admin could switch their own role to CLIENT and instantly lock everyone out
// of the workspace — there would be nobody left with permission to promote
// them back. Demoting yourself is refused outright; only another admin can
// change your role.
export async function updateMemberRole(workspaceId, userId, role, actingUserId = null) {
  const member = await prisma.workspaceMember.findUnique({
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
    const otherAdmins = await countAdmins(workspaceId, userId);
    if (otherAdmins === 0) {
      const e = new Error('This is the only admin in the workspace. Promote another member to admin first.');
      e.status = 409;
      e.code = 'LAST_ADMIN';
      throw e;
    }
  }

  return prisma.workspaceMember.update({
    where: { userId_workspaceId: { userId, workspaceId } },
    data: { role },
  });
}

// Same protection for deletion: removing the last admin would leave the
// workspace with no one who can manage it.
export async function removeMember(workspaceId, userId, actingUserId = null) {
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!member) { const e = new Error('Member not found'); e.status = 404; throw e; }

  if (member.role === 'ADMIN') {
    const otherAdmins = await countAdmins(workspaceId, userId);
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

  await prisma.workspaceMember.delete({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
}
