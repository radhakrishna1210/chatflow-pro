import { prisma } from '../lib/prisma.js';
import { VISIBILITY_MODES } from './recordScope.service.js';

const TEAM_INCLUDE = {
  members: {
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { joinedAt: 'asc' },
  },
};

export async function listTeams(workspaceId) {
  const data = await prisma.team.findMany({
    where: { workspaceId },
    include: TEAM_INCLUDE,
    orderBy: { name: 'asc' },
  });
  return { data, total: data.length };
}

export async function createTeam(workspaceId, { name, description }) {
  const clash = await prisma.team.findFirst({ where: { workspaceId, name }, select: { id: true } });
  if (clash) { const e = new Error('A team with that name already exists'); e.status = 409; throw e; }

  return prisma.team.create({
    data: { workspaceId, name, description: description ?? null },
    include: TEAM_INCLUDE,
  });
}

export async function updateTeam(workspaceId, id, updates) {
  const team = await prisma.team.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!team) { const e = new Error('Team not found'); e.status = 404; throw e; }

  if (updates.name) {
    const clash = await prisma.team.findFirst({
      where: { workspaceId, name: updates.name, id: { not: id } }, select: { id: true },
    });
    if (clash) { const e = new Error('A team with that name already exists'); e.status = 409; throw e; }
  }
  return prisma.team.update({ where: { id }, data: updates, include: TEAM_INCLUDE });
}

export async function deleteTeam(workspaceId, id) {
  const team = await prisma.team.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!team) { const e = new Error('Team not found'); e.status = 404; throw e; }
  // Membership rows cascade. No record references a team, so nothing is
  // orphaned — visibility simply widens back for anyone who was in it.
  await prisma.team.delete({ where: { id } });
}

// Only workspace members can join a team, or a team becomes a way to grant
// visibility to someone who does not belong here at all.
export async function setTeamMembers(workspaceId, id, userIds) {
  const team = await prisma.team.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!team) { const e = new Error('Team not found'); e.status = 404; throw e; }

  const unique = [...new Set(userIds)];
  if (unique.length > 0) {
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: unique } },
      select: { userId: true },
    });
    const known = new Set(members.map((m) => m.userId));
    const outsiders = unique.filter((u) => !known.has(u));
    if (outsiders.length) {
      const e = new Error('Every team member must belong to this workspace');
      e.status = 400;
      throw e;
    }
  }

  await prisma.$transaction([
    prisma.teamMember.deleteMany({ where: { teamId: id } }),
    ...(unique.length ? [prisma.teamMember.createMany({ data: unique.map((userId) => ({ teamId: id, userId })) })] : []),
  ]);

  return prisma.team.findUnique({ where: { id }, include: TEAM_INCLUDE });
}

export async function getVisibility(workspaceId) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { recordVisibility: true },
  });
  return { recordVisibility: workspace?.recordVisibility ?? 'ALL', modes: VISIBILITY_MODES };
}

export async function setVisibility(workspaceId, mode) {
  if (!VISIBILITY_MODES.includes(mode)) {
    const e = new Error(`recordVisibility must be one of: ${VISIBILITY_MODES.join(', ')}`);
    e.status = 400;
    throw e;
  }
  const workspace = await prisma.workspace.update({
    where: { id: workspaceId },
    data: { recordVisibility: mode },
    select: { recordVisibility: true },
  });
  return { recordVisibility: workspace.recordVisibility, modes: VISIBILITY_MODES };
}
