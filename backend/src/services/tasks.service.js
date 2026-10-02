import { prisma } from '../lib/prisma.js';
import { resolveCrmReferences } from './crmReferences.js';
import { scopeFilter, scopedWhere, withScope } from './recordScope.service.js';
import { awardXp, earnsClearedOverdue, checkInboxZero } from './gamification.service.js';

// Tasks are visible by assignee rather than owner.
const TASK_SCOPE = { ownerField: 'assignedToUserId' };

const TASK_INCLUDE = {
  assignedTo: { select: { id: true, name: true, email: true } },
  lead: { select: { id: true, status: true } },
  deal: { select: { id: true, title: true, stage: true } },
  contact: { select: { id: true, name: true, email: true } },
};

// Capped by default instead of returning every matching task; `total` still
// counts everything, so a client can tell it got a page.
const LIST_DEFAULT_LIMIT = 500;
const LIST_MAX_LIMIT = 1000;

export async function listTasks(workspaceId, { status, assignedToUserId, isOverdue, limit, offset } = {}, user = null) {
  const take = Math.min(Math.max(Number.parseInt(limit, 10) || LIST_DEFAULT_LIMIT, 1), LIST_MAX_LIMIT);
  const skip = Math.max(Number.parseInt(offset, 10) || 0, 0);
  const scope = user ? await scopeFilter(workspaceId, user, TASK_SCOPE) : {};
  const filters = {
    workspaceId,
    ...(status ? { status } : {}),
    ...(assignedToUserId ? { assignedToUserId } : {}),
  };

  if (isOverdue === 'true') {
    filters.status = 'PENDING';
    filters.dueDate = { lt: new Date() };
  }
  const where = withScope(filters, scope);

  const [data, total] = await Promise.all([
    prisma.task.findMany({ where, include: TASK_INCLUDE, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], skip, take }),
    prisma.task.count({ where }),
  ]);
  
  return { data, total, limit: take, offset: skip };
}

export async function getTask(workspaceId, id, user = null) {
  const task = await prisma.task.findFirst({
    where: await scopedWhere(workspaceId, user, { id, workspaceId }, TASK_SCOPE),
    include: TASK_INCLUDE,
  });
  if (!task) { const e = new Error('Task not found'); e.status = 404; throw e; }
  return task;
}

export async function createTask(workspaceId, body, userId) {
  const refs = await resolveCrmReferences(workspaceId, body, { includeAssignee: true });

  return prisma.task.create({
    data: {
      workspaceId,
      title: body.title,
      description: body.description ?? null,
      status: body.status || 'PENDING',
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      assignedToUserId: refs.assignedToUserId ?? userId,
      leadId: refs.leadId ?? null,
      dealId: refs.dealId ?? null,
      contactId: refs.contactId ?? null,
      completedAt: body.status === 'COMPLETED' ? new Date() : null,
    },
    include: TASK_INCLUDE,
  });
}

// Only the fields listed here can be written. Spreading `updates` straight
// into Prisma let a caller pass workspaceId and move the task out of the
// workspace entirely, which the route schema now also rejects — this is the
// second line of defence, and the one the service tests exercise directly.
const TASK_WRITABLE = ['title', 'description', 'status', 'dueDate'];

export async function updateTask(workspaceId, id, updates, user = null) {
  // dueDate and assignee are needed to decide whether clearing this earns XP.
  const task = await prisma.task.findFirst({
    where: await scopedWhere(workspaceId, user, { id, workspaceId }, TASK_SCOPE),
    select: { id: true, status: true, dueDate: true, assignedToUserId: true, createdAt: true },
  });
  if (!task) { const e = new Error('Task not found'); e.status = 404; throw e; }

  const refs = await resolveCrmReferences(workspaceId, updates, { includeAssignee: true });

  const data = { ...refs };
  for (const key of TASK_WRITABLE) {
    if (updates[key] !== undefined) data[key] = updates[key];
  }
  if (data.dueDate) data.dueDate = new Date(data.dueDate);

  if (data.status && data.status !== task.status) {
    data.completedAt = data.status === 'COMPLETED' ? new Date() : null;
  }

  // Only *overdue* work pays. Completing a task before it was due is normal
  // and needs no incentive; digging out of a backlog is the behaviour worth
  // encouraging.
  // A task created already past due does not count: it was never overdue work.
  const completing = data.status === 'COMPLETED' && task.status !== 'COMPLETED';
  const earns = completing && task.assignedToUserId && earnsClearedOverdue(task);

  const result = await prisma.task.update({ where: { id }, data, include: TASK_INCLUDE });

  if (earns) {
    awardXp(workspaceId, task.assignedToUserId, 'cleared_overdue', { recordType: 'task', recordId: id })
      .then(() => checkInboxZero(workspaceId, task.assignedToUserId))
      .catch((e) => console.error('[Gamification] award failed:', e.message));
  }
  return result;
}

export async function deleteTask(workspaceId, id, user = null) {
  const task = await prisma.task.findFirst({
    where: await scopedWhere(workspaceId, user, { id, workspaceId }, TASK_SCOPE),
    select: { id: true },
  });
  if (!task) { const e = new Error('Task not found'); e.status = 404; throw e; }
  await prisma.task.delete({ where: { id } });
}
