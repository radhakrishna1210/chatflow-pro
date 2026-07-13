import { prisma } from '../lib/prisma.js';

export async function createTicket(workspaceId, userId, { subject, message, category = 'GENERAL' }) {
  if (!subject?.trim() || !message?.trim()) { const e = new Error('subject and message are required'); e.status = 400; throw e; }
  return prisma.supportTicket.create({
    data: { workspaceId, userId, subject: subject.trim().slice(0, 200), message: message.trim().slice(0, 4000), category },
  });
}

export async function listWorkspaceTickets(workspaceId) {
  return prisma.supportTicket.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
}
