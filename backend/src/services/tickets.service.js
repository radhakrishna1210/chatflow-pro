import { prisma } from '../lib/prisma.js';
import { scopeFilter } from './recordScope.service.js';

// Customer-facing support tickets.
//
// Response targets by priority, in hours. Stored as an absolute `dueAt` on the
// ticket rather than computed on read: changing this policy later must not
// retroactively make historical tickets look breached.
export const SLA_HOURS = { URGENT: 2, HIGH: 8, NORMAL: 24, LOW: 72 };

// Statuses where the clock has stopped. A resolved ticket cannot be overdue,
// and a ticket waiting on the customer is not waiting on us.
const SETTLED = ['RESOLVED', 'CLOSED'];

const ALLOWED_TRANSITIONS = {
  NEW: ['OPEN', 'WAITING', 'RESOLVED', 'CLOSED'],
  OPEN: ['WAITING', 'RESOLVED', 'CLOSED'],
  WAITING: ['OPEN', 'RESOLVED', 'CLOSED'],
  // Reopening is allowed — a customer replying to a "resolved" ticket is the
  // most common way one becomes live again.
  RESOLVED: ['OPEN', 'CLOSED'],
  CLOSED: ['OPEN'],
};

const TICKET_INCLUDE = {
  contact: { select: { id: true, name: true, phoneNumber: true, email: true } },
  owner: { select: { id: true, name: true, email: true } },
  team: { select: { id: true, name: true } },
};

export function slaDueAt(priority, from = new Date()) {
  const hours = SLA_HOURS[priority] ?? SLA_HOURS.NORMAL;
  return new Date(from.getTime() + hours * 3600_000);
}

// Sequential per workspace, generated inside the creating transaction so two
// agents filing at once cannot take the same number.
async function nextTicketNumber(tx, workspaceId) {
  const last = await tx.crmTicket.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    select: { ticketNumber: true },
  });
  const n = last ? (parseInt(String(last.ticketNumber).replace(/\D/g, ''), 10) || 0) + 1 : 1;
  return `T-${String(n).padStart(4, '0')}`;
}

/**
 * Named queues, matching §30's views. `view` is resolved to a where-fragment
 * here rather than in the controller so the same definition of "overdue" is
 * used by the list, the counts and any future notification.
 */
function viewFilter(view, userId) {
  switch (view) {
    case 'mine':       return { ownerUserId: userId };
    case 'unassigned': return { ownerUserId: null, status: { notIn: SETTLED } };
    case 'overdue':    return { status: { notIn: SETTLED }, dueAt: { lt: new Date() } };
    case 'open':       return { status: { notIn: SETTLED } };
    case 'all':
    default:           return {};
  }
}

export async function listTickets(workspaceId, { view = 'open', status = '', priority = '' } = {}, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const where = {
    workspaceId,
    ...scope,
    ...viewFilter(view, user?.id),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.crmTicket.findMany({
      where,
      include: TICKET_INCLUDE,
      // Urgent first, then closest to breaching. A queue sorted by creation
      // date buries the ticket that is about to miss its target.
      orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }],
    }),
    prisma.crmTicket.count({ where }),
  ]);

  const now = new Date();
  return {
    data: data.map((t) => ({
      ...t,
      isOverdue: !SETTLED.includes(t.status) && !!t.dueAt && t.dueAt < now,
    })),
    total,
  };
}

export async function getTicket(workspaceId, id, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const ticket = await prisma.crmTicket.findFirst({
    where: { id, workspaceId, ...scope },
    include: TICKET_INCLUDE,
  });
  if (!ticket) { const e = new Error('Ticket not found'); e.status = 404; throw e; }
  return ticket;
}

export async function createTicket(workspaceId, body) {
  for (const [field, model] of [['contactId', 'contact'], ['teamId', 'team'], ['conversationId', 'conversation']]) {
    if (!body[field]) continue;
    const row = await prisma[model].findFirst({ where: { id: body[field], workspaceId }, select: { id: true } });
    if (!row) { const e = new Error(`${model} not found in this workspace`); e.status = 404; throw e; }
  }

  const priority = body.priority || 'NORMAL';

  return prisma.$transaction(async (tx) => {
    const ticketNumber = await nextTicketNumber(tx, workspaceId);
    return tx.crmTicket.create({
      data: {
        workspaceId,
        ticketNumber,
        subject: body.subject,
        description: body.description ?? null,
        priority,
        category: body.category ?? null,
        contactId: body.contactId ?? null,
        ownerUserId: body.ownerUserId ?? null,
        teamId: body.teamId ?? null,
        conversationId: body.conversationId ?? null,
        dueAt: slaDueAt(priority),
      },
      include: TICKET_INCLUDE,
    });
  });
}

export async function updateTicket(workspaceId, id, updates, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const ticket = await prisma.crmTicket.findFirst({
    where: { id, workspaceId, ...scope },
    select: { id: true, priority: true, createdAt: true, status: true },
  });
  if (!ticket) { const e = new Error('Ticket not found'); e.status = 404; throw e; }

  const data = { ...updates };

  // Raising priority tightens the deadline, measured from when the ticket was
  // filed — not from now, which would hand back time already spent.
  if (updates.priority && updates.priority !== ticket.priority && !SETTLED.includes(ticket.status)) {
    data.dueAt = slaDueAt(updates.priority, ticket.createdAt);
  }

  return prisma.crmTicket.update({ where: { id }, data, include: TICKET_INCLUDE });
}

export async function changeTicketStatus(workspaceId, id, status, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const ticket = await prisma.crmTicket.findFirst({
    where: { id, workspaceId, ...scope },
    select: { id: true, status: true, priority: true, resolvedAt: true },
  });
  if (!ticket) { const e = new Error('Ticket not found'); e.status = 404; throw e; }

  const allowed = ALLOWED_TRANSITIONS[ticket.status] ?? [];
  if (!allowed.includes(status)) {
    const e = new Error(`A ${ticket.status.toLowerCase()} ticket cannot become ${status.toLowerCase()}`);
    e.status = 409;
    throw e;
  }

  const data = { status };
  if (status === 'RESOLVED') data.resolvedAt = new Date();
  if (status === 'CLOSED') data.closedAt = new Date();
  if (status === 'OPEN' && SETTLED.includes(ticket.status)) {
    // Reopening restarts the clock and clears the settled stamps, so a
    // reopened ticket is not reported as both resolved and open.
    data.resolvedAt = null;
    data.closedAt = null;
    data.dueAt = slaDueAt(ticket.priority);
  }

  return prisma.crmTicket.update({ where: { id }, data, include: TICKET_INCLUDE });
}

// Stamped once, on the first outbound reply. Used for first-response reporting,
// which is a different measure from resolution time.
export async function markFirstResponse(workspaceId, id) {
  const ticket = await prisma.crmTicket.findFirst({
    where: { id, workspaceId },
    select: { id: true, firstRespondedAt: true },
  });
  if (!ticket) { const e = new Error('Ticket not found'); e.status = 404; throw e; }
  if (ticket.firstRespondedAt) return ticket;
  return prisma.crmTicket.update({ where: { id }, data: { firstRespondedAt: new Date() } });
}

export async function deleteTicket(workspaceId, id, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const ticket = await prisma.crmTicket.findFirst({ where: { id, workspaceId, ...scope }, select: { id: true } });
  if (!ticket) { const e = new Error('Ticket not found'); e.status = 404; throw e; }
  await prisma.crmTicket.delete({ where: { id } });
}

// Queue sizes for the view switcher, computed in one pass so the counts and
// the list can never disagree about what "overdue" means.
export async function ticketCounts(workspaceId, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const base = { workspaceId, ...scope };

  const [open, mine, unassigned, overdue, all] = await Promise.all([
    prisma.crmTicket.count({ where: { ...base, ...viewFilter('open') } }),
    prisma.crmTicket.count({ where: { ...base, ...viewFilter('mine', user?.id) } }),
    prisma.crmTicket.count({ where: { ...base, ...viewFilter('unassigned') } }),
    prisma.crmTicket.count({ where: { ...base, ...viewFilter('overdue') } }),
    prisma.crmTicket.count({ where: base }),
  ]);

  return { open, mine, unassigned, overdue, all };
}
