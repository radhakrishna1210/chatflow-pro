import { prisma } from '../lib/prisma.js';

// Per-entity cap. The palette shows a handful of each rather than a long tail
// of one type, so a query matching thousands of contacts still returns fast
// and still leaves room for the matching deal the user was actually after.
const PER_ENTITY_LIMIT = 5;

const insensitive = (q) => ({ contains: q, mode: 'insensitive' });

// Enum constants are storage values, not labels — the palette showed raw
// "CLOSED_WON" next to prettified stage names everywhere else in the UI.
const pretty = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// Cross-entity search for the command palette. Every query is scoped to the
// caller's workspace — that scoping IS the permission model here, since
// membership is verified upstream by workspaceContext and neither role can see
// another workspace's records.
export async function searchWorkspace(workspaceId, { q, limit = PER_ENTITY_LIMIT } = {}) {
  const term = String(q ?? '').trim();
  if (term.length < 2) return { query: term, results: [], total: 0 };

  const take = Math.min(Math.max(Number(limit) || PER_ENTITY_LIMIT, 1), 20);

  const [contacts, leads, deals, tasks] = await Promise.all([
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
      where: {
        workspaceId,
        OR: [
          { contact: { name: insensitive(term) } },
          { contact: { phoneNumber: { contains: term } } },
          { source: insensitive(term) },
        ],
      },
      select: { id: true, status: true, score: true, contact: { select: { name: true, phoneNumber: true } } },
      take,
      orderBy: { score: 'desc' },
    }),
    prisma.deal.findMany({
      where: {
        workspaceId,
        OR: [{ title: insensitive(term) }, { contact: { name: insensitive(term) } }],
      },
      select: { id: true, title: true, stage: true, value: true, contact: { select: { name: true } } },
      take,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.task.findMany({
      where: {
        workspaceId,
        OR: [{ title: insensitive(term) }, { description: insensitive(term) }],
      },
      select: { id: true, title: true, status: true, dueDate: true },
      take,
      orderBy: { dueDate: 'asc' },
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
  ];

  return { query: term, results, total: results.length };
}
