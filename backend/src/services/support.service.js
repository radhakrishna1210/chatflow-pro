import { prisma } from '../lib/prisma.js';

// The categories the Help & Support form offers. Anything else was stored
// verbatim (any type, any length) and then rendered in the super-admin queue.
export const TICKET_CATEGORIES = ['GENERAL', 'BILLING', 'TECHNICAL', 'BUG', 'FEATURE'];

const badRequest = (message) => { const e = new Error(message); e.status = 400; return e; };

export async function createTicket(workspaceId, userId, { subject, message, category = 'GENERAL' } = {}) {
  // typeof first: a non-string subject used to reach `.trim()` and 500.
  if (typeof subject !== 'string' || typeof message !== 'string' || !subject.trim() || !message.trim()) {
    throw badRequest('subject and message are required');
  }
  const cat = typeof category === 'string' ? category.trim().toUpperCase() : '';
  if (!TICKET_CATEGORIES.includes(cat)) throw badRequest(`category must be one of ${TICKET_CATEGORIES.join(', ')}`);
  return prisma.supportTicket.create({
    data: { workspaceId, userId, subject: subject.trim().slice(0, 200), message: message.trim().slice(0, 4000), category: cat },
  });
}

export async function listWorkspaceTickets(workspaceId) {
  return prisma.supportTicket.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
}
