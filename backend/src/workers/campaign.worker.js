import { Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/encryption.js';
import { sendWhatsAppMessage } from '../lib/meta.js';
import { env } from '../config/env.js';
import { queueCampaignCompletedEmail, queueCampaignFailedEmail } from '../services/email.service.js';

const RATE_DELAY_MS = 60;

async function processCampaign(job) {
  const { campaignId, workspaceId } = job.data;

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: { template: true, waNumber: true },
  });

  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  if (campaign.status === 'CANCELLED') return;

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: 'RUNNING', launchedAt: campaign.launchedAt || new Date() },
  });

  const accessToken = decrypt(campaign.waNumber.encryptedAccessToken);
  const phoneNumberId = campaign.waNumber.metaPhoneNumberId;

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: 'PENDING' },
    include: { contact: true },
  });

  const normalizePhone = (raw) => String(raw || '').replace(/[^\d]/g, '');
  const templateHasVariables = (components) => {
    if (!Array.isArray(components)) return false;
    return components.some((c) => /\{\{\d+\}\}/.test(c?.text || ''));
  };

  for (const recipient of recipients) {
    const refreshed = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
    if (refreshed?.status === 'CANCELLED') break;

    try {
      const templatePayload = {
        name: campaign.template.name,
        language: { code: campaign.template.language },
      };
      // Only include `components` if the template has variables to substitute.
      // Sending the template's own definition (type:BODY/text:...) causes Meta to reject.
      if (templateHasVariables(campaign.template.components)) {
        templatePayload.components = [];
      }

      const result = await sendWhatsAppMessage(
        phoneNumberId,
        accessToken,
        normalizePhone(recipient.contact.phoneNumber),
        templatePayload
      );
      console.log(`[CampaignWorker] sent to ${recipient.contact.phoneNumber}:`, result?.messages?.[0]?.id);

      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: 'SENT', sentAt: new Date() },
      });

      await prisma.campaign.update({
        where: { id: campaignId },
        data: { sent: { increment: 1 } },
      });

      if (result?.messages?.[0]?.id) {
        const convo = await prisma.conversation.findFirst({
          where: { contactId: recipient.contactId, waNumberId: campaign.waNumberId },
        });
        if (convo) {
          await prisma.message.create({
            data: {
              conversationId: convo.id,
              body: `[Campaign: ${campaign.name}]`,
              direction: 'OUTBOUND',
              metaMessageId: result.messages[0].id,
              sentAt: new Date(),
            },
          });
        }
      }
    } catch (err) {
      const metaErr = err.response?.data?.error;
      const reason = metaErr
        ? `${metaErr.message} (code ${metaErr.code}${metaErr.error_subcode ? `/${metaErr.error_subcode}` : ''})`
        : err.message;
      console.error(`[CampaignWorker] send failed for ${recipient.contact.phoneNumber}:`, reason, metaErr || '');
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: 'FAILED', failedAt: new Date(), failReason: reason },
      });
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { failed: { increment: 1 } },
      });
    }

    await new Promise((r) => setTimeout(r, RATE_DELAY_MS));
  }

  const completed = await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
  queueCampaignCompletedEmail(completed).catch(() => {});
}

export function startCampaignWorker() {
  const worker = new Worker('campaigns', processCampaign, {
    connection: redis,
    concurrency: env.CAMPAIGN_WORKER_CONCURRENCY,
  });

  worker.on('completed', (job) => console.log(`[CampaignWorker] Job ${job.id} completed`));
  worker.on('failed', async (job, err) => {
    console.error(`[CampaignWorker] Job ${job?.id} failed:`, err.message);
    if (job?.data?.campaignId) {
      const failed = await prisma.campaign.update({
        where: { id: job.data.campaignId },
        data: { status: 'FAILED' },
      }).catch(() => null);
      if (failed) queueCampaignFailedEmail(failed).catch(() => {});
    }
  });

  return worker;
}
