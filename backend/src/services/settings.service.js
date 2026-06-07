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
      emailNotifyCampaignCompleted: true,
      emailNotifyTemplateApproved: true,
      emailNotifyTemplateRejected: true,
      emailNotifyMemberInvite: true,
    },
  });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  return ws;
}

// Only these fields may be changed via the settings API — prevents mass-assignment
// of sensitive columns (plan, webhookVerifyToken, etc.) from the request body.
const ALLOWED_SETTINGS_FIELDS = [
  'webhookUrl',
  'notifyNewConversation',
  'notifyTemplateApproved',
  'notifyTemplateRejected',
  'notifyCampaignCompleted',
  'notifyHighOptout',
  'notifyRateLimit',
  'emailNotifyCampaignCompleted',
  'emailNotifyTemplateApproved',
  'emailNotifyTemplateRejected',
  'emailNotifyMemberInvite',
];

export async function updateSettings(workspaceId, updates) {
  const data = {};
  for (const key of ALLOWED_SETTINGS_FIELDS) {
    if (updates[key] !== undefined) data[key] = updates[key];
  }
  return prisma.workspace.update({ where: { id: workspaceId }, data });
}

export async function getInvoices(workspaceId) {
  return prisma.invoice.findMany({ where: { workspaceId }, orderBy: { invoiceDate: 'desc' } });
}
