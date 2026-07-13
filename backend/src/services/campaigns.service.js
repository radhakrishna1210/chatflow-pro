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
      include: {
        template: { select: { id: true, name: true } },
        waNumber: { select: { id: true, phoneNumber: true, displayName: true } },
      },
    }),
    prisma.campaign.count({ where: { workspaceId } }),
  ]);
  return { data, total };
}

export async function createCampaign(workspaceId, { name, templateId, numberId, whatsappNumberId, replyRules, retryConfig, trackingConfig }) {
  if (!name || !String(name).trim()) { const e = new Error('Campaign name is required'); e.status = 400; throw e; }
  const resolvedNumberId = numberId ?? whatsappNumberId;
  const [template, waNumber] = await Promise.all([
    prisma.template.findFirst({ where: { id: templateId, workspaceId } }),
    prisma.waNumber.findFirst({ where: { id: resolvedNumberId, workspaceId } }),
  ]);

  if (!template) { const e = new Error('Template not found'); e.status = 404; throw e; }
  if (!waNumber) { const e = new Error('WhatsApp number not found'); e.status = 404; throw e; }
  // Enforce per-number template privacy: the template must belong to this number
  // (or be a legacy template with no number binding yet).
  if (template.waNumberId && template.waNumberId !== waNumber.id) {
    const e = new Error('Selected template belongs to a different WhatsApp number'); e.status = 400; throw e;
  }

  return prisma.campaign.create({
    data: {
      workspaceId, name: String(name).trim(), templateId, waNumberId: waNumber.id, status: 'DRAFT',
      // Advanced wizard config (reply flows / retries / conversion tracking) is
      // persisted as JSON so it survives and can drive future execution.
      replyRules: replyRules ?? undefined,
      retryConfig: retryConfig ?? undefined,
      trackingConfig: trackingConfig ?? undefined,
    },
  });
}

export async function addRecipients(workspaceId, campaignId, contactIds) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!campaign) { const e = new Error('Campaign not found'); e.status = 404; throw e; }
  if (campaign.status !== 'DRAFT') { const e = new Error('Recipients can only be added while the campaign is a draft'); e.status = 400; throw e; }

  const ids = Array.isArray(contactIds) ? [...new Set(contactIds.filter(Boolean))] : [];
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
  // createMany reports the number of rows actually inserted — skipDuplicates
  // silently drops recipients already on the campaign, so use the real count.
  const { count: added } = await prisma.campaignRecipient.createMany({ data: createData, skipDuplicates: true });
  const duplicates = validIds.length - added;

  const total = await prisma.campaignRecipient.count({ where: { campaignId } });
  await prisma.campaign.update({ where: { id: campaignId }, data: { totalContacts: total } });

  return { added, skipped: invalidIds.length + duplicates, duplicates, invalidIds, totalContacts: total };
}

export async function launchCampaign(workspaceId, campaignId, scheduledAt) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!campaign) { const e = new Error('Campaign not found'); e.status = 404; throw e; }
  if (campaign.status !== 'DRAFT') {
    const e = new Error('Campaign is not in DRAFT status'); e.status = 400; throw e;
  }

  const recipientCount = await prisma.campaignRecipient.count({ where: { campaignId } });
  if (recipientCount === 0) {
    const e = new Error('Add at least one recipient before launching'); e.status = 400; throw e;
  }

  if (scheduledAt) {
    const scheduledDate = new Date(scheduledAt);
    if (Number.isNaN(scheduledDate.getTime())) {
      const e = new Error('Invalid scheduledAt date'); e.status = 400; throw e;
    }
    const delay = scheduledDate.getTime() - Date.now();
    // Reject clearly-past dates instead of silently firing immediately.
    if (delay < -60_000) {
      const e = new Error('scheduledAt must be in the future'); e.status = 400; throw e;
    }
    const job = await campaignQueue.add('send-campaign', { campaignId, workspaceId }, { delay: Math.max(0, delay) });
    // SCHEDULED status distinguishes "queued for future" from a true draft and
    // lets startup recovery re-queue lost jobs after a Redis/server restart.
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'SCHEDULED', scheduledAt: scheduledDate, queueJobId: String(job.id) },
    });
  } else {
    const job = await campaignQueue.add('send-campaign', { campaignId, workspaceId });
    // The worker flips the campaign to RUNNING once it actually starts —
    // marking RUNNING here would show a false "running" state if the worker
    // never picks the job up.
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { scheduledAt: new Date(), queueJobId: String(job.id) },
    });
  }

  return prisma.campaign.findUnique({ where: { id: campaignId } });
}

export async function getCampaign(workspaceId, campaignId) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: {
      template: true,
      waNumber: { select: { id: true, phoneNumber: true, displayName: true } },
      recipients: {
        take: 100,
        orderBy: { sentAt: 'desc' },
        include: { contact: { select: { id: true, name: true, phoneNumber: true } } },
      },
    },
  });
  if (!campaign) { const e = new Error('Campaign not found'); e.status = 404; throw e; }
  return campaign;
}

export async function cancelCampaign(workspaceId, campaignId) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!campaign) { const e = new Error('Campaign not found'); e.status = 404; throw e; }
  if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(campaign.status)) {
    const e = new Error(`Campaign is already ${campaign.status}`); e.status = 400; throw e;
  }

  // Set CANCELLED first: the worker re-checks this before every send and at
  // claim time, so even a job that slipped into 'active' stops quickly.
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'CANCELLED' } });

  // Remove the queued job by its stored ID (reliable) and by scan (fallback).
  if (campaign.queueJobId) {
    const job = await campaignQueue.getJob(campaign.queueJobId).catch(() => null);
    if (job) await job.remove().catch(() => {});
  }
  const jobs = await campaignQueue.getJobs(['delayed', 'waiting', 'paused']).catch(() => []);
  for (const job of jobs) {
    if (job.data?.campaignId === campaignId) await job.remove().catch(() => {});
  }

  return prisma.campaign.findUnique({ where: { id: campaignId } });
}

// Called at startup: re-queue SCHEDULED campaigns whose BullMQ jobs were lost
// (e.g. ephemeral Redis restart). Past-due campaigns fire immediately.
export async function recoverScheduledCampaigns() {
  const scheduled = await prisma.campaign.findMany({
    where: { status: 'SCHEDULED' },
    select: { id: true, workspaceId: true, scheduledAt: true, queueJobId: true },
  });

  let recovered = 0;
  for (const c of scheduled) {
    if (c.queueJobId) {
      const existing = await campaignQueue.getJob(c.queueJobId).catch(() => null);
      if (existing) continue; // job survived — nothing to do
    }
    const delay = Math.max(0, (c.scheduledAt?.getTime() ?? 0) - Date.now());
    const job = await campaignQueue.add('send-campaign', { campaignId: c.id, workspaceId: c.workspaceId }, { delay });
    await prisma.campaign.update({ where: { id: c.id }, data: { queueJobId: String(job.id) } });
    recovered++;
  }
  return recovered;
}
