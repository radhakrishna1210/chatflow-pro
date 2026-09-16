import { prisma } from '../lib/prisma.js';
import { scopeFilter } from './recordScope.service.js';

// Per-entity cap. The palette shows a handful of each rather than a long tail
// of one type, so a query matching thousands of contacts still returns fast
// and still leaves room for the matching deal the user was actually after.
const PER_ENTITY_LIMIT = 5;

const insensitive = (q) => ({ contains: q, mode: 'insensitive' });

// Enum constants are storage values, not labels — the palette showed raw
// "CLOSED_WON" next to prettified stage names everywhere else in the UI.
const pretty = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// Cross-entity search for the command palette.
//
// Workspace scoping alone was the permission model here until record-level
// visibility arrived. It is not sufficient any more: under TEAM or OWN, search
// happily returned deals, leads and tasks belonging to other people — titles,
// stages and values included — which opening one then 404s on. A list that
// shows you what you cannot open is a leak, not a feature, so the same
// `scopeFilter` the list endpoints use is applied here.
//
// Contacts are deliberately left unscoped: they have no owner field, and the
// contact book is shared workspace-wide by design.
export async function searchWorkspace(workspaceId, { q, limit = PER_ENTITY_LIMIT } = {}, user = null) {
  const term = String(q ?? '').trim();
  if (term.length < 2) return { query: term, results: [], total: 0 };

  const take = Math.min(Math.max(Number(limit) || PER_ENTITY_LIMIT, 1), 20);

  // Tasks key visibility off assignee rather than owner.
  const [ownedScope, taskScope] = user
    ? await Promise.all([
      scopeFilter(workspaceId, user),
      scopeFilter(workspaceId, user, { ownerField: 'assignedToUserId' }),
    ])
    : [{}, {}];

  const [contacts, leads, deals, tasks, tickets] = await Promise.all([
    prisma.contact.findMany({
      where: {
        workspaceId,
        OR: [{ name: insensitive(term) }, { phoneNumber: { contains: term } }, { email: insensitive(term) }],
      },
      select: { id: true, name: true, phoneNumber: true, email: true },
      take,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.lead.findMany({
      // The scope fragment is itself an `OR`, so it has to be AND-ed with the
      // search terms rather than spread beside them — a sibling `OR` key simply
      // replaces it, which silently drops the scoping altogether.
      where: {
        workspaceId,
        AND: [
          ownedScope,
          {
            OR: [
              { contact: { name: insensitive(term) } },
              { contact: { phoneNumber: { contains: term } } },
              { source: insensitive(term) },
            ],
          },
        ],
      },
      select: { id: true, status: true, score: true, contact: { select: { name: true, phoneNumber: true } } },
      take,
      orderBy: { score: 'desc' },
    }),
    prisma.deal.findMany({
      where: {
        workspaceId,
        AND: [
          ownedScope,
          { OR: [{ title: insensitive(term) }, { contact: { name: insensitive(term) } }] },
        ],
      },
      select: { id: true, title: true, stage: true, value: true, contact: { select: { name: true } } },
      take,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.task.findMany({
      where: {
        workspaceId,
        AND: [
          taskScope,
          { OR: [{ title: insensitive(term) }, { description: insensitive(term) }] },
        ],
      },
      select: { id: true, title: true, status: true, dueDate: true },
      take,
      orderBy: { dueDate: 'asc' },
    }),
    prisma.crmTicket.findMany({
      where: {
        workspaceId,
        AND: [
          ownedScope,
          {
            OR: [
              { ticketNumber: insensitive(term) },
              { subject: insensitive(term) },
              { description: insensitive(term) },
              { contact: { name: insensitive(term) } },
            ],
          },
        ],
      },
      select: { id: true, ticketNumber: true, subject: true, status: true, priority: true },
      take,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const results = [
    ...contacts.map((c) => ({
      type: 'contact',
      id: c.id,
      title: c.name,
      subtitle: c.phoneNumber || c.email || '',
      href: 'contacts',
    })),
    ...leads.map((l) => ({
      type: 'lead',
      id: l.id,
      title: l.contact?.name || 'Unnamed lead',
      subtitle: `${pretty(l.status)} · score ${l.score}`,
      href: 'leads',
    })),
    ...deals.map((d) => ({
      type: 'deal',
      id: d.id,
      title: d.title,
      subtitle: [d.contact?.name, pretty(d.stage)].filter(Boolean).join(' · '),
      href: 'deals',
    })),
    ...tasks.map((t) => ({
      type: 'task',
      id: t.id,
      title: t.title,
      subtitle: t.status === 'COMPLETED' ? 'Completed' : t.dueDate ? `Due ${t.dueDate.toISOString().slice(0, 10)}` : 'No due date',
      href: 'tasks',
    })),
    ...tickets.map((k) => ({
      type: 'ticket',
      id: k.id,
      title: `${k.ticketNumber}: ${k.subject}`,
      subtitle: `${pretty(k.status)} · ${pretty(k.priority)}`,
      href: 'tickets',
    })),
  ];

  return { query: term, results, total: results.length };
}
