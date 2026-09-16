import { prisma } from '../lib/prisma.js';
import { resolveCrmReferences } from './crmReferences.js';
import { scopeFilter } from './recordScope.service.js';
import { awardXp } from './gamification.service.js';

const TASK_INCLUDE = {
  assignedTo: { select: { id: true, name: true, email: true } },
  lead: { select: { id: true, status: true } },
  deal: { select: { id: true, title: true, stage: true } },
  contact: { select: { id: true, name: true, email: true } },
};

export async function listTasks(workspaceId, { status, assignedToUserId, isOverdue } = {}, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user, { ownerField: 'assignedToUserId' }) : {};
  const where = {
    workspaceId,
    ...scope,
    ...(status ? { status } : {}),
    ...(assignedToUserId ? { assignedToUserId } : {}),
  };

  if (isOverdue === 'true') {
    where.status = 'PENDING';
    where.dueDate = { lt: new Date() };
  }

  const [data, total] = await Promise.all([
    prisma.task.findMany({ where, include: TASK_INCLUDE, orderBy: { dueDate: 'asc' } }),
    prisma.task.count({ where }),
  ]);
  
  return { data, total };
}

export async function getTask(workspaceId, id) {
  const task = await prisma.task.findFirst({
    where: { id, workspaceId },
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

export async function updateTask(workspaceId, id, updates) {
  // dueDate and assignee are needed to decide whether clearing this earns XP.
  const task = await prisma.task.findFirst({
    where: { id, workspaceId },
    select: { id: true, status: true, dueDate: true, assignedToUserId: true },
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
  const wasOverdue = task.dueDate && task.dueDate < new Date();
  if (data.status === 'COMPLETED' && task.status !== 'COMPLETED' && wasOverdue && task.assignedToUserId) {
    awardXp(workspaceId, task.assignedToUserId, 'cleared_overdue', { recordType: 'task', recordId: id })
      .catch((e) => console.error('[Gamification] award failed:', e.message));
  }

  return prisma.task.update({ where: { id }, data, include: TASK_INCLUDE });
}

export async function deleteTask(workspaceId, id) {
  const task = await prisma.task.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!task) { const e = new Error('Task not found'); e.status = 404; throw e; }
  await prisma.task.delete({ where: { id } });
}
