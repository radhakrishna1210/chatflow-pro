import axios from 'axios';
import { prisma } from '../lib/prisma.js';

export async function getSettings(workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      webhookUrl: true,
      webhookVerifyToken: true,
      webhookEvents: true,
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
  'webhookEvents',
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

// Sends a small sample payload to the workspace's configured webhook URL so
// the user can confirm their endpoint is reachable before relying on it.
export async function testWebhook(workspaceId) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { webhookUrl: true } });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  if (!ws.webhookUrl) { const e = new Error('No webhook URL configured — save one first'); e.status = 400; throw e; }

  try {
    const res = await axios.post(ws.webhookUrl, {
      event: 'test',
      workspaceId,
      timestamp: new Date().toISOString(),
    }, { timeout: 8000, validateStatus: () => true });

    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status };
    }
    const e = new Error(`Webhook endpoint responded with status ${res.status}`);
    e.status = 502;
    throw e;
  } catch (err) {
    if (err.status) throw err;
    const e = new Error(
      err.code === 'ECONNABORTED'
        ? 'Webhook request timed out'
        : `Could not reach webhook URL (${err.code || err.message})`
    );
    e.status = 502;
    throw e;
  }
}
