import { prisma } from '../lib/prisma.js';
import { campaignQueue } from '../queues/campaign.queue.js';
import { isRetryableFailure, calculateNextRetry } from '../lib/retry.js';
import { queueCampaignCompletedEmail } from './email.service.js';
import { runFallbackForRecipient } from './fallback.service.js';
import { notifyWorkspace } from './notification.service.js';

export async function checkAndCompleteCampaign(campaignId) {
  const pendingCount = await prisma.campaignRecipient.count({
    where: {
      campaignId,
      status: { in: ['PENDING', 'RETRYING'] },
    },
  });

  if (pendingCount === 0) {
    const done = await prisma.campaign.updateMany({
      where: { id: campaignId, status: 'RUNNING' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    if (done.count > 0) {
      console.log(`[CampaignWorker] All recipients finished. Campaign ${campaignId} completed.`);
      const completed = await prisma.campaign.findUnique({ where: { id: campaignId } });
      if (completed) {
        // Anything paid for but never sent (a contact who replied STOP after
        // launch, for instance) goes back to the wallet now that the
        // campaign is finished and the final tally is known.
        const { settleCampaignRefund } = await import('./campaigns.service.js');
        await settleCampaignRefund(campaignId, 'Refund for unsent campaign messages').catch((e) =>
          console.error(`[Campaign] Settlement failed for ${campaignId}:`, e.message));

        queueCampaignCompletedEmail(completed).catch(() => {});
        notifyWorkspace(completed.workspaceId, {
          type: 'CAMPAIGN_COMPLETED',
          title: `Campaign "${completed.name}" finished`,
          body: `${completed.sent} sent · ${completed.delivered} delivered · ${completed.failed} failed${completed.skipped ? ` · ${completed.skipped} skipped (opted out)` : ''}`,
          link: 'campaigns',
          meta: { campaignId },
        }).catch(() => {});
      }
      return true;
    }
  }
  return false;
}

export async function handleRecipientFailure(campaign, recipient, reason, metaCode = null) {
  const textReason = String(reason || 'Unknown error');
  const retryable = isRetryableFailure(textReason, metaCode);
  const currentAttempts = recipient.retryCount || 0;

  if (!retryable) {
    console.log(`[CampaignRetry] Permanent failure for recipient ${recipient.id}: ${textReason}`);
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        failReason: textReason,
        lastFailureReason: textReason,
        retryStatus: 'PERMANENT_FAILURE',
        nextRetryAt: null,
      },
    });
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { failed: { increment: 1 } },
    });
    await runFallbackForRecipient(campaign, recipient, recipient.contact || { id: recipient.contactId }).catch((e) =>
      console.error(`[CampaignRetry] Fallback error for ${recipient.id}:`, e.message)
    );
    await checkAndCompleteCampaign(campaign.id);
    return { retried: false, retryStatus: 'PERMANENT_FAILURE' };
  }

  const calculation = calculateNextRetry(campaign.retryConfig, currentAttempts);

  if (!calculation.shouldRetry) {
    let retryStatus = 'PERMANENT_FAILURE';
    if (calculation.status === 'MAX_RETRIES') {
      console.log(`[CampaignRetry] Maximum retries reached for recipient ${recipient.id}`);
      retryStatus = 'MAX_RETRIES';
    } else if (calculation.status === 'EXPIRED') {
      console.log(`[CampaignRetry] Retry expired for recipient ${recipient.id} (past retry end date)`);
      retryStatus = 'EXPIRED';
    } else {
      console.log(`[CampaignRetry] Retries disabled or not configured for campaign ${campaign.id}`);
    }

    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        failReason: textReason,
        lastFailureReason: textReason,
        retryStatus,
        nextRetryAt: null,
      },
    });
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { failed: { increment: 1 } },
    });
    await runFallbackForRecipient(campaign, recipient, recipient.contact || { id: recipient.contactId }).catch((e) =>
      console.error(`[CampaignRetry] Fallback error for ${recipient.id}:`, e.message)
    );
    await checkAndCompleteCampaign(campaign.id);
    return { retried: false, retryStatus };
  }

  // Schedule next retry! Do NOT increment campaign.failed because it is not permanently failed.
  console.log(
    `[CampaignRetry] Retry scheduled for recipient ${recipient.id} (attempt #${calculation.attempt}) at ${calculation.nextTime.toISOString()} [reason: ${textReason}]`
  );

  await prisma.campaignRecipient.update({
    where: { id: recipient.id },
    data: {
      status: 'RETRYING',
      retryStatus: 'SCHEDULED',
      lastFailureReason: textReason,
      nextRetryAt: calculation.nextTime,
    },
  });

  await campaignQueue.add(
    'retry-recipient',
    {
      type: 'retry',
      campaignId: campaign.id,
      workspaceId: campaign.workspaceId,
      recipientId: recipient.id,
      attempt: calculation.attempt,
    },
    { delay: calculation.delayMs }
  );

  return { retried: true, nextRetryAt: calculation.nextTime, attempt: calculation.attempt };
}
