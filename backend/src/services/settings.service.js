import { prisma } from '../lib/prisma.js';
import { getWorkspaceMetadata, updateWorkspaceMetadata } from './metadata.service.js';

export async function getSettings(workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      name: true,
      businessEmail: true,
      phone: true,
      website: true,
      address: true,
      description: true,
      logoUrl: true,
      businessName: true,
      language: true,
      timezone: true,
      dateFormat: true,
      timeFormat: true,
      currency: true,
      businessCategory: true,
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
  'name',
  'businessEmail',
  'phone',
  'website',
  'address',
  'description',
  'logoUrl',
  'businessName',
  'language',
  'timezone',
  'dateFormat',
  'timeFormat',
  'currency',
  'businessCategory',
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

export async function getBilling(workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      name: true,
      businessName: true,
      businessEmail: true,
      address: true,
      phone: true,
      website: true,
    }
  });
  if (!ws) throw new Error('Workspace not found');
  const meta = getWorkspaceMetadata(workspaceId);
  return {
    bizName: ws.businessName || ws.name || '',
    bizEmail: ws.businessEmail || '',
    bizAddress: ws.address || '',
    phone: ws.phone || '',
    website: ws.website || '',
    gstNum: meta.gstNum || ''
  };
}

export async function updateBilling(workspaceId, updates) {
  const { bizName, bizEmail, bizAddress, phone, website, gstNum } = updates;
  const ws = await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      businessName: bizName,
      businessEmail: bizEmail,
      address: bizAddress,
      phone: phone !== undefined ? phone : undefined,
      website: website !== undefined ? website : undefined,
    }
  });
  if (gstNum !== undefined) {
    updateWorkspaceMetadata(workspaceId, { gstNum });
  }
  return getBilling(workspaceId);
}

export async function getWallet(workspaceId) {
  const meta = getWorkspaceMetadata(workspaceId);
  return { balance: meta.walletBalance };
}

export async function rechargeWallet(workspaceId, amount) {
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) throw new Error('Invalid recharge amount');
  const meta = getWorkspaceMetadata(workspaceId);
  const newBal = (meta.walletBalance || 0) + amt;
  updateWorkspaceMetadata(workspaceId, { walletBalance: newBal });
  
  // Create an invoice in PostgreSQL database!
  const invoice = await prisma.invoice.create({
    data: {
      workspaceId,
      invoiceDate: new Date(),
      amount: amt,
      currency: 'INR',
      status: 'PAID'
    }
  });
  
  return { balance: newBal, invoice };
}

export async function getSubscription(workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true }
  });
  if (!ws) throw new Error('Workspace not found');
  
  const meta = getWorkspaceMetadata(workspaceId);
  
  // Get actual counts of members, messages, and workflows
  const memberCount = await prisma.workspaceMember.count({ where: { workspaceId } });
  const workflowCount = await prisma.workflow.count({ where: { workspaceId } });
  
  // Count messages in this workspace (by querying all conversations in the workspace)
  const messageCount = await prisma.message.count({
    where: { conversation: { workspaceId } }
  });

  return {
    plan: ws.plan || 'FREE',
    addons: meta.addons || { crm: false, events: false, tags: false, fields: false },
    usage: {
      messages: messageCount,
      members: memberCount,
      workflows: workflowCount
    }
  };
}

export async function updateAddons(workspaceId, addons) {
  updateWorkspaceMetadata(workspaceId, { addons });
  return getSubscription(workspaceId);
}
