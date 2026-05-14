import { prisma } from '../lib/prisma.js';

export async function getSettings(workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      webhookUrl: true,
      webhookVerifyToken: true,
      notifyNewConversation: true,
      notifyTemplateApproved: true,
      notifyTemplateRejected: true,
      notifyCampaignCompleted: true,
      notifyHighOptout: true,
      notifyRateLimit: true,
    },
  });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  return ws;
}

export async function updateSettings(workspaceId, updates) {
  return prisma.workspace.update({ where: { id: workspaceId }, data: updates });
}

export async function getInvoices(workspaceId) {
  return prisma.invoice.findMany({ where: { workspaceId }, orderBy: { invoiceDate: 'desc' } });
}
