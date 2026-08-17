import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { createTask, updateTask } from './tasks.service.js';
import { createActivity } from './activities.service.js';

// Workspace isolation for tasks and activities. Both services take a raw body
// straight from the request, so these cover the two ways a caller can reach
// across a workspace boundary: renaming the owning workspace on update, and
// attaching a record to another workspace's lead/deal/contact on create.
let dbAvailable = false;
let workspaceId;
let otherWorkspaceId;
let userId;
let otherDealId;
let otherContactId;

test.before(async () => {
  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    return;
  }
  const stamp = Date.now();
  const workspace = await prisma.workspace.create({ data: { name: `test-tasks-${stamp}` } });
  workspaceId = workspace.id;
  const other = await prisma.workspace.create({ data: { name: `test-tasks-other-${stamp}` } });
  otherWorkspaceId = other.id;
  const user = await prisma.user.create({ data: { name: 'Task Runner', email: `test-tasks-${stamp}@example.test` } });
  userId = user.id;

  const otherContact = await prisma.contact.create({
    data: { workspaceId: otherWorkspaceId, name: 'Foreign Contact', phoneNumber: `+9177${stamp.toString().slice(-8)}` },
  });
  otherContactId = otherContact.id;
  const otherDeal = await prisma.deal.create({
    data: { workspaceId: otherWorkspaceId, contactId: otherContact.id, title: 'Foreign Deal' },
  });
  otherDealId = otherDeal.id;
});

test.after(async () => {
  for (const id of [workspaceId, otherWorkspaceId]) {
    if (id) await prisma.workspace.delete({ where: { id } }).catch(() => {});
  }
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

test('a task cannot be moved into another workspace through the update body', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const task = await createTask(workspaceId, { title: 'Stays put' }, userId);

  await updateTask(workspaceId, task.id, { title: 'Renamed', workspaceId: otherWorkspaceId }).catch(() => {});

  const after = await prisma.task.findUnique({ where: { id: task.id }, select: { workspaceId: true } });
  assert.equal(after.workspaceId, workspaceId, 'task escaped its workspace via mass assignment');
});

test('a task cannot be attached to another workspace\'s deal', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  await assert.rejects(
    () => createTask(workspaceId, { title: 'Cross link', dealId: otherDealId }, userId),
    (err) => err.status === 400 || err.status === 404,
    'a foreign dealId was accepted on task creation',
  );
});

test('an activity cannot be attached to another workspace\'s contact', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  await assert.rejects(
    () => createActivity(workspaceId, { content: 'Cross link', contactId: otherContactId }, userId),
    (err) => err.status === 400 || err.status === 404,
    'a foreign contactId was accepted on activity creation',
  );
});

test('completing a task stamps completedAt, reopening clears it', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const task = await createTask(workspaceId, { title: 'Lifecycle' }, userId);
  assert.equal(task.completedAt, null);

  const done = await updateTask(workspaceId, task.id, { status: 'COMPLETED' });
  assert.ok(done.completedAt instanceof Date);

  const reopened = await updateTask(workspaceId, task.id, { status: 'PENDING' });
  assert.equal(reopened.completedAt, null);
});
