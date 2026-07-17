import { Worker } from 'bullmq';
import { createBullConnection } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/encryption.js';
import { sendWhatsAppMessage } from '../lib/meta.js';
import { env } from '../config/env.js';
import { queueCampaignCompletedEmail, queueCampaignFailedEmail } from '../services/email.service.js';
import { consumeMessageCredit } from '../services/subscription.service.js';
import { runFallbackForRecipient } from '../services/fallback.service.js';

// Meta Cloud API Tier-1 numbers are limited to ~250 msgs/min. The old 60ms
// delay (~1000/min) triggered rate-limit errors (code 131042). 250ms ≈ 240/min.
const RATE_DELAY_MS = Math.max(env.CAMPAIGN_RATE_DELAY_MS, 250);

const normalizePhone = (raw) => String(raw || '').replace(/[^\d]/g, '');

const templateHasVariables = (components) => {
  if (!Array.isArray(components)) return false;
  return components.some((c) => /\{\{\d+\}\}/.test(c?.text || ''));
};

const countVariables = (text) => {
  const nums = [...String(text || '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => parseInt(m[1], 10));
  return nums.length ? Math.max(...nums) : 0;
};

// Builds the `components` array Meta expects for a template send, with a
// `parameters` entry for every {{n}} placeholder in each component's text.
// Contacts only carry name/phone/email — {{1}} is filled with the contact's
// name (the convention used everywhere else templates are authored, e.g.
// data/templateLibrary.js); any further placeholders reuse it since there's
// no per-recipient custom-field data to draw from. Sending the right *count*
// of parameters is what matters to Meta — an empty/short components array
// caused error 132000 (param count mismatch).
const buildTemplateComponents = (components, contact) => {
  const name = (contact?.name || '').trim() || 'there';
  return (components || [])
    .filter((c) => /\{\{\d+\}\}/.test(c?.text || ''))
    .map((c) => ({
      type: String(c.type || 'body').toLowerCase(),
      parameters: Array.from({ length: countVariables(c.text) }, () => ({ type: 'text', text: name })),
    }));
};

async function processCampaign(job) {
  const { campaignId, workspaceId } = job.data;

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: { template: true, waNumber: true },
  });

  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  // Cancellation may have happened while the job sat in the queue. Never
  // resurrect a cancelled/completed campaign.
  if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED' && campaign.status !== 'RUNNING') {
    console.log(`[CampaignWorker] Campaign ${campaignId} is ${campaign.status} — skipping`);
    return;
  }
  if (!campaign.waNumber) {
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'FAILED' } });
    throw new Error(`Campaign ${campaignId} has no WhatsApp number`);
  }

  // Atomic status guard: only transition to RUNNING if the campaign wasn't
  // cancelled in the meantime (closes the cancel race with getJobs()).
  const claimed = await prisma.campaign.updateMany({
    where: { id: campaignId, status: { in: ['DRAFT', 'SCHEDULED', 'RUNNING'] } },
    data: { status: 'RUNNING', launchedAt: campaign.launchedAt || new Date() },
  });
  if (claimed.count === 0) {
    console.log(`[CampaignWorker] Campaign ${campaignId} could not be claimed (likely cancelled) — skipping`);
    return;
  }

  const accessToken = decrypt(campaign.waNumber.encryptedAccessToken);
  const phoneNumberId = campaign.waNumber.metaPhoneNumberId;

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: 'PENDING' },
    include: { contact: true },
  });

  let cancelled = false;

  for (const recipient of recipients) {
    const refreshed = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
    if (refreshed?.status === 'CANCELLED') { cancelled = true; break; }

    try {
      const credit = await consumeMessageCredit(campaign.workspaceId, { reason: 'Campaign overage' });
      if (!credit.ok) {
        console.warn(`[CampaignWorker] quota/wallet exhausted for ${recipient.contact.phoneNumber}: ${credit.code}`);
        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: 'FAILED', failedAt: new Date(), failReason: 'Quota and wallet balance exhausted' },
        });
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { failed: { increment: 1 } },
        });
        await new Promise((r) => setTimeout(r, RATE_DELAY_MS));
        continue;
      }

      const templatePayload = {
        name: campaign.template.name,
        language: { code: campaign.template.language },
      };
      // Only include `components` if the template has variables to substitute.
      // Sending the template's own definition (type:BODY/text:...) causes Meta to reject.
      if (templateHasVariables(campaign.template.components)) {
        templatePayload.components = buildTemplateComponents(campaign.template.components, recipient.contact);
      }

      const result = await sendWhatsAppMessage(
        phoneNumberId,
        accessToken,
        normalizePhone(recipient.contact.phoneNumber),
        templatePayload
      );
      const metaMessageId = result?.messages?.[0]?.id ?? null;
      console.log(`[CampaignWorker] sent to ${recipient.contact.phoneNumber}:`, metaMessageId);

      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: 'SENT', sentAt: new Date() },
      });

      await prisma.campaign.update({
        where: { id: campaignId },
        data: { sent: { increment: 1 } },
      });

      // Persist the outbound message with a link back to the campaign
      // recipient so delivery/read webhooks can update the right rows.
      if (metaMessageId) {
        let convo = await prisma.conversation.findFirst({
          where: { contactId: recipient.contactId, waNumberId: campaign.waNumberId },
        });
        if (!convo) {
          convo = await prisma.conversation.create({
            data: {
              workspaceId: campaign.workspaceId,
              contactId: recipient.contactId,
              waNumberId: campaign.waNumberId,
              status: 'OPEN',
            },
          }).catch(() => null);
        }
        if (convo) {
          await prisma.message.create({
            data: {
              conversationId: convo.id,
              body: `[Campaign: ${campaign.name}]`,
              direction: 'OUTBOUND',
              metaMessageId,
              campaignRecipientId: recipient.id,
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

      // Fallback channels (wizard step 8): route the failed recipient through
      // SMS/email if the campaign configured them. Outcome is appended to the
      // recipient's failReason — real attempts, honestly recorded.
      await runFallbackForRecipient(campaign, recipient, recipient.contact).catch((fbErr) => {
        console.error(`[CampaignWorker] fallback error for ${recipient.contact.phoneNumber}:`, fbErr.message);
      });
    }

    await new Promise((r) => setTimeout(r, RATE_DELAY_MS));
  }

  // A cancelled campaign must stay CANCELLED — never flip it to COMPLETED.
  if (cancelled) {
    console.log(`[CampaignWorker] Campaign ${campaignId} cancelled mid-run — leaving status CANCELLED`);
    return;
  }

  // Atomic completion: only mark COMPLETED if still RUNNING.
  const done = await prisma.campaign.updateMany({
    where: { id: campaignId, status: 'RUNNING' },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
  if (done.count > 0) {
    const completed = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (completed) queueCampaignCompletedEmail(completed).catch(() => {});
  }
}

export function startCampaignWorker() {
  const worker = new Worker('campaigns', processCampaign, {
    connection: createBullConnection('campaign-worker'),
    concurrency: env.CAMPAIGN_WORKER_CONCURRENCY,
  });

  worker.on('completed', (job) => console.log(`[CampaignWorker] Job ${job.id} completed`));
  worker.on('failed', async (job, err) => {
    console.error(`[CampaignWorker] Job ${job?.id} failed:`, err.message);
    // Only flag FAILED after the final attempt, and never overwrite a
    // CANCELLED/COMPLETED campaign.
    const isFinalAttempt = job && job.attemptsMade >= (job.opts?.attempts ?? 1);
    if (isFinalAttempt && job?.data?.campaignId) {
      const res = await prisma.campaign.updateMany({
        where: { id: job.data.campaignId, status: { in: ['RUNNING', 'SCHEDULED', 'DRAFT'] } },
        data: { status: 'FAILED' },
      }).catch(() => null);
      if (res?.count > 0) {
        const failed = await prisma.campaign.findUnique({ where: { id: job.data.campaignId } }).catch(() => null);
        if (failed) queueCampaignFailedEmail(failed).catch(() => {});
      }
    }
  });

  return worker;
}
