import { prisma } from '../lib/prisma.js';

export const SAVED_VIEW_ENTITIES = ['leads', 'deals', 'tasks'];

const VIEW_SELECT = {
  id: true,
  entity: true,
  name: true,
  filters: true,
  isShared: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  createdByUser: { select: { id: true, name: true } },
};

// A user sees their own views plus anything shared with the workspace. Someone
// else's private view is invisible, which is what makes "private unless shared"
// mean anything.
const visibleTo = (workspaceId, userId, entity) => ({
  workspaceId,
  ...(entity ? { entity } : {}),
  OR: [{ createdByUserId: userId }, { isShared: true }],
});

export async function listSavedViews(workspaceId, userId, { entity } = {}) {
  if (entity && !SAVED_VIEW_ENTITIES.includes(entity)) {
    const e = new Error(`entity must be one of: ${SAVED_VIEW_ENTITIES.join(', ')}`);
    e.status = 400;
    throw e;
  }
  const data = await prisma.savedView.findMany({
    where: visibleTo(workspaceId, userId, entity),
    select: VIEW_SELECT,
    orderBy: [{ entity: 'asc' }, { name: 'asc' }],
  });
  return { data, total: data.length };
}

// Saving a view whose name already exists for this user and entity overwrites
// it, so "save" from the UI is idempotent rather than a way to accumulate five
// views all called "Hot leads".
export async function createSavedView(workspaceId, userId, { entity, name, filters, isShared = false }) {
  if (!SAVED_VIEW_ENTITIES.includes(entity)) {
    const e = new Error(`entity must be one of: ${SAVED_VIEW_ENTITIES.join(', ')}`);
    e.status = 400;
    throw e;
  }

  const existing = await prisma.savedView.findFirst({
    where: { workspaceId, entity, createdByUserId: userId, name },
    select: { id: true },
  });

  if (existing) {
    return prisma.savedView.update({
      where: { id: existing.id },
      data: { filters, isShared },
      select: VIEW_SELECT,
    });
  }

  return prisma.savedView.create({
    data: { workspaceId, entity, name, filters, isShared, createdByUserId: userId },
    select: VIEW_SELECT,
  });
}

// Only the author may change or remove a view. A shared view is readable by the
// workspace but is still owned by whoever made it — otherwise one person's
// cleanup silently deletes a filter the rest of the team relies on.
async function assertAuthor(workspaceId, userId, id) {
  const view = await prisma.savedView.findFirst({
    where: { id, workspaceId },
    select: { id: true, createdByUserId: true },
  });
  if (!view) { const e = new Error('Saved view not found'); e.status = 404; throw e; }
  if (view.createdByUserId !== userId) {
    const e = new Error('Only the author can modify this view');
    e.status = 403;
    throw e;
  }
  return view;
}

export async function updateSavedView(workspaceId, userId, id, updates) {
  await assertAuthor(workspaceId, userId, id);
  return prisma.savedView.update({ where: { id }, data: updates, select: VIEW_SELECT });
}

export async function deleteSavedView(workspaceId, userId, id) {
  await assertAuthor(workspaceId, userId, id);
  await prisma.savedView.delete({ where: { id } });
}
