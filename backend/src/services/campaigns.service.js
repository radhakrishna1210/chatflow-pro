import { prisma } from '../lib/prisma.js';
import { campaignQueue } from '../queues/campaign.queue.js';

export async function listCampaigns(workspaceId, { page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    prisma.campaign.findMany({
      where: { workspaceId },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.campaign.count({ where: { workspaceId } }),
  ]);
  return { data, total };
}

export async function createCampaign(workspaceId, { name, templateId, numberId, whatsappNumberId }) {
  const resolvedNumberId = numberId ?? whatsappNumberId;
  const [template, waNumber] = await Promise.all([
    prisma.template.findFirst({ where: { id: templateId, workspaceId } }),
    prisma.waNumber.findFirst({ where: { id: resolvedNumberId, workspaceId } }),
  ]);

  if (!template) { const e = new Error('Template not found'); e.status = 404; throw e; }
  if (!waNumber) { const e = new Error('WhatsApp number not found'); e.status = 404; throw e; }

  return prisma.campaign.create({
    data: { workspaceId, name, templateId, waNumberId: waNumber.id, status: 'DRAFT' },
  });
}

export async function addRecipients(workspaceId, campaignId, contactIds) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!campaign) { const e = new Error('Campaign not found'); e.status = 404; throw e; }

  const ids = Array.isArray(contactIds) ? contactIds.filter(Boolean) : [];
  const validContacts = await prisma.contact.findMany({
    where: { id: { in: ids }, workspaceId },
    select: { id: true },
  });
  const validIds = validContacts.map((c) => c.id);
  const invalidIds = ids.filter((id) => !validIds.includes(id));

  if (validIds.length === 0) {
    const e = new Error(`No valid contacts in this workspace. Invalid IDs: ${JSON.stringify(invalidIds)}`);
    e.status = 400;
    throw e;
  }

  const createData = validIds.map((contactId) => ({ campaignId, contactId }));
  await prisma.campaignRecipient.createMany({ data: createData, skipDuplicates: true });

  const total = await prisma.campaignRecipient.count({ where: { campaignId } });
  await prisma.campaign.update({ where: { id: campaignId }, data: { totalContacts: total } });

  return { added: validIds.length, skipped: invalidIds.length, invalidIds };
}

export async function launchCampaign(workspaceId, campaignId, scheduledAt) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!campaign) { const e = new Error('Campaign not found'); e.status = 404; throw e; }
  if (campaign.status !== 'DRAFT') {
    const e = new Error('Campaign is not in DRAFT status'); e.status = 400; throw e;
  }

  if (scheduledAt) {
    const delay = new Date(scheduledAt).getTime() - Date.now();
    await campaignQueue.add('send-campaign', { campaignId, workspaceId }, { delay: Math.max(0, delay) });
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { scheduledAt: new Date(scheduledAt) },
    });
  } else {
    await campaignQueue.add('send-campaign', { campaignId, workspaceId });
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'RUNNING', launchedAt: new Date() },
    });
  }

  return prisma.campaign.findUnique({ where: { id: campaignId } });
}

export async function getCampaign(workspaceId, campaignId) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: { template: true, waNumber: { select: { id: true, phoneNumber: true, displayName: true } } },
  });
  if (!campaign) { const e = new Error('Campaign not found'); e.status = 404; throw e; }
  return campaign;
}

export async function cancelCampaign(workspaceId, campaignId) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!campaign) { const e = new Error('Campaign not found'); e.status = 404; throw e; }

  await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'CANCELLED' } });

  const jobs = await campaignQueue.getJobs(['delayed', 'waiting']);
  for (const job of jobs) {
    if (job.data?.campaignId === campaignId) await job.remove();
  }

  return prisma.campaign.findUnique({ where: { id: campaignId } });
}
