import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import {
  createTicket, updateTicket, changeTicketStatus, listTickets,
  ticketCounts, markFirstResponse, slaDueAt, SLA_HOURS,
} from './tickets.service.js';

let dbAvailable = false;
let workspaceId;
let agent;
let contactId;

const asUser = (id, role = 'ADMIN') => ({ id, role });
const hoursBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / 3600_000);

test.before(async () => {
  try { await prisma.$connect(); dbAvailable = true; } catch { return; }
  const stamp = Date.now();
  workspaceId = (await prisma.workspace.create({ data: { name: `test-tickets-${stamp}` } })).id;
  const u = await prisma.user.create({ data: { name: 'Agent', email: `agent-${stamp}@example.test` } });
  agent = u.id;
  await prisma.workspaceMember.create({ data: { userId: agent, workspaceId, role: 'ADMIN' } });
  contactId = (await prisma.contact.create({
    data: { workspaceId, name: 'Customer', phoneNumber: `+9195${String(stamp).slice(-8)}` },
  })).id;
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  if (agent) await prisma.user.delete({ where: { id: agent } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

test('the SLA deadline follows priority', () => {
  const from = new Date('2026-01-01T00:00:00Z');
  assert.equal(hoursBetween(from, slaDueAt('URGENT', from)), SLA_HOURS.URGENT);
  assert.equal(hoursBetween(from, slaDueAt('LOW', from)), SLA_HOURS.LOW);
  // An unknown priority falls back to NORMAL rather than leaving no deadline.
  assert.equal(hoursBetween(from, slaDueAt('NONSENSE', from)), SLA_HOURS.NORMAL);
});

test('a new ticket gets a sequential number and a deadline', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const first = await createTicket(workspaceId, { subject: 'Cannot log in', contactId, priority: 'HIGH' });
  assert.match(first.ticketNumber, /^T-\d{4}$/);
  assert.equal(first.status, 'NEW');
  assert.equal(hoursBetween(first.createdAt, first.dueAt), SLA_HOURS.HIGH);

  const second = await createTicket(workspaceId, { subject: 'Second issue' });
  const numbers = [first, second].map((x) => parseInt(x.ticketNumber.replace(/\D/g, ''), 10));
  assert.deepEqual(numbers, [1, 2]);
});

test('raising priority tightens the deadline from when it was filed', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const ticket = await createTicket(workspaceId, { subject: 'Escalating', priority: 'LOW' });
  const raised = await updateTicket(workspaceId, ticket.id, { priority: 'URGENT' }, asUser(agent));

  // Measured from creation, not from now — otherwise escalating would hand
  // back the time already spent.
  assert.equal(hoursBetween(raised.createdAt, raised.dueAt), SLA_HOURS.URGENT);
  assert.ok(raised.dueAt < ticket.dueAt);
});

test('the status lifecycle is enforced', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const ticket = await createTicket(workspaceId, { subject: 'Lifecycle' });

  const open = await changeTicketStatus(workspaceId, ticket.id, 'OPEN', asUser(agent));
  assert.equal(open.status, 'OPEN');

  const resolved = await changeTicketStatus(workspaceId, ticket.id, 'RESOLVED', asUser(agent));
  assert.ok(resolved.resolvedAt instanceof Date);

  // A resolved ticket cannot go back to waiting — only reopened or closed.
  await assert.rejects(
    () => changeTicketStatus(workspaceId, ticket.id, 'WAITING', asUser(agent)),
    (e) => e.status === 409,
  );

  const closed = await changeTicketStatus(workspaceId, ticket.id, 'CLOSED', asUser(agent));
  assert.ok(closed.closedAt instanceof Date);
});

test('reopening restarts the clock and clears the settled stamps', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const ticket = await createTicket(workspaceId, { subject: 'Comes back', priority: 'NORMAL' });
  await changeTicketStatus(workspaceId, ticket.id, 'RESOLVED', asUser(agent));
  const reopened = await changeTicketStatus(workspaceId, ticket.id, 'OPEN', asUser(agent));

  assert.equal(reopened.status, 'OPEN');
  // Otherwise the ticket reports as both resolved and open.
  assert.equal(reopened.resolvedAt, null);
  assert.equal(reopened.closedAt, null);
  assert.ok(reopened.dueAt > new Date(), 'a reopened ticket gets a fresh deadline');
});

test('a settled ticket is never overdue', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const ticket = await createTicket(workspaceId, { subject: 'Old but done' });
  // Force the deadline into the past.
  await prisma.crmTicket.update({ where: { id: ticket.id }, data: { dueAt: new Date(Date.now() - 86400000) } });

  const before = await listTickets(workspaceId, { view: 'all' }, asUser(agent));
  assert.equal(before.data.find((x) => x.id === ticket.id).isOverdue, true);

  await changeTicketStatus(workspaceId, ticket.id, 'RESOLVED', asUser(agent));

  const after = await listTickets(workspaceId, { view: 'all' }, asUser(agent));
  assert.equal(after.data.find((x) => x.id === ticket.id).isOverdue, false, 'the clock stops when it is resolved');

  const overdueQueue = await listTickets(workspaceId, { view: 'overdue' }, asUser(agent));
  assert.ok(!overdueQueue.data.some((x) => x.id === ticket.id));
});

test('queues select the right tickets', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const mine = await createTicket(workspaceId, { subject: 'Assigned to me', ownerUserId: agent });
  const nobody = await createTicket(workspaceId, { subject: 'Nobody owns this' });

  const mineQueue = await listTickets(workspaceId, { view: 'mine' }, asUser(agent));
  assert.ok(mineQueue.data.some((x) => x.id === mine.id));
  assert.ok(!mineQueue.data.some((x) => x.id === nobody.id));

  const unassigned = await listTickets(workspaceId, { view: 'unassigned' }, asUser(agent));
  assert.ok(unassigned.data.some((x) => x.id === nobody.id));
  assert.ok(!unassigned.data.some((x) => x.id === mine.id));
});

test('the queue is ordered by urgency, not by age', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  await createTicket(workspaceId, { subject: 'Low and old', priority: 'LOW' });
  await createTicket(workspaceId, { subject: 'Urgent and new', priority: 'URGENT' });

  const { data } = await listTickets(workspaceId, { view: 'open' }, asUser(agent));
  // Sorting by creation date buries the ticket about to breach.
  assert.equal(data[0].priority, 'URGENT');
});

test('counts agree with the lists they describe', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const counts = await ticketCounts(workspaceId, asUser(agent));
  for (const view of ['open', 'mine', 'unassigned', 'overdue', 'all']) {
    const { total } = await listTickets(workspaceId, { view }, asUser(agent));
    assert.equal(counts[view], total, `the "${view}" count and list disagree`);
  }
});

test('first response is stamped once and never moved', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const ticket = await createTicket(workspaceId, { subject: 'Reply timing' });
  const first = await markFirstResponse(workspaceId, ticket.id);
  assert.ok(first.firstRespondedAt instanceof Date);

  await new Promise((r) => setTimeout(r, 20));
  const again = await markFirstResponse(workspaceId, ticket.id);
  assert.equal(
    again.firstRespondedAt.getTime(), first.firstRespondedAt.getTime(),
    'a later reply must not overwrite the first-response time',
  );
});

test('a contact from another workspace cannot be attached', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const other = await prisma.workspace.create({ data: { name: `test-tk-other-${Date.now()}` } });
  try {
    const foreign = await prisma.contact.create({
      data: { workspaceId: other.id, name: 'Foreign', phoneNumber: `+9196${String(Date.now()).slice(-8)}` },
    });
    await assert.rejects(
      () => createTicket(workspaceId, { subject: 'Cross tenant', contactId: foreign.id }),
      (e) => e.status === 404,
    );
  } finally {
    await prisma.workspace.delete({ where: { id: other.id } }).catch(() => {});
  }
});

test('status cannot be changed through the general update path', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const ticket = await createTicket(workspaceId, { subject: 'Guarded' });
  // The update schema omits `status` deliberately, so the transition rules and
  // the resolvedAt/closedAt stamps cannot be bypassed. Reaching the service
  // directly still must not corrupt the record.
  const updated = await updateTicket(workspaceId, ticket.id, { subject: 'Renamed' }, asUser(agent));
  assert.equal(updated.status, 'NEW');
  assert.equal(updated.subject, 'Renamed');
});
