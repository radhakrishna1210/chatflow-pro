import { prisma } from '../lib/prisma.js';

export async function listMembers(workspaceId) {
  return prisma.workspaceMember.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { joinedAt: 'asc' },
  });
}

export async function inviteMember(workspaceId, { email, role }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) { const e = new Error('User not found'); e.status = 404; throw e; }

  const existing = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId } },
  });
  if (existing) { const e = new Error('User already a member'); e.status = 409; throw e; }

  return prisma.workspaceMember.create({
    data: { userId: user.id, workspaceId, role },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
}

export async function updateMemberRole(workspaceId, userId, role) {
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!member) { const e = new Error('Member not found'); e.status = 404; throw e; }

  return prisma.workspaceMember.update({
    where: { userId_workspaceId: { userId, workspaceId } },
    data: { role },
  });
}

export async function removeMember(workspaceId, userId) {
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!member) { const e = new Error('Member not found'); e.status = 404; throw e; }

  await prisma.workspaceMember.delete({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
}
