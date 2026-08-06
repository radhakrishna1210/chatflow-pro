import { prisma } from '../lib/prisma.js';
import { campaignQueue } from '../queues/campaign.queue.js';
import { isRetryableFailure, calculateNextRetry } from '../lib/retry.js';
import { queueCampaignCompletedEmail } from './email.service.js';
import { runFallbackForRecipient } from './fallback.service.js';
import { notifyWorkspace } from './notification.service.js';
import { markRecipientNotCharged } from './campaignBilling.service.js';

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

// One id per (recipient, attempt). Recovery reconstructs it from the row, so
// it must stay derivable from data the database already holds.
export const retryJobId = (recipientId, attempt) => `retry:${recipientId}:${attempt}`;

// Re-queues retries whose delayed jobs no longer exist.
//
// Retry delays run to 24 hours, but the queue holding them is Redis — and on
// the deployment's Key Value plan Redis has no persistence, so every waiting
// retry job dies with the process. Nothing else notices: the recipient stays
// RETRYING forever, which also blocks checkAndCompleteCampaign, so the
// campaign never completes and its unsent messages are never refunded. One
// lost restart used to strand both the messages and the money.
//
// Called at boot, alongside recoverScheduledCampaigns().
export async function recoverPendingRetries() {
  const waiting = await prisma.campaignRecipient.findMany({
    where: {
      status: 'RETRYING',
      campaign: { status: { in: ['RUNNING', 'SCHEDULED'] } },
    },
    select: {
      id: true, retryCount: true, nextRetryAt: true, retryStatus: true,
      campaign: { select: { id: true, workspaceId: true } },
    },
  });

  let requeued = 0;
  for (const r of waiting) {
    // A job that died mid-attempt left IN_PROGRESS behind, which the claim
    // guard in the worker would refuse forever. Hand it back to SCHEDULED so
    // the recovered job can claim it.
    if (r.retryStatus === 'IN_PROGRESS') {
      await prisma.campaignRecipient.update({
        where: { id: r.id }, data: { retryStatus: 'SCHEDULED' },
      }).catch(() => {});
    }

    // retryCount is the last attempt that actually ran, so the one still owed
    // is the next number up — the same value handleRecipientFailure used when
    // it queued the job, which is what makes the id line up.
    const attempt = (r.retryCount || 0) + 1;
    const delay = Math.max(0, (r.nextRetryAt?.getTime() ?? 0) - Date.now());

    await campaignQueue.add(
      'retry-recipient',
      {
        type: 'retry',
        campaignId: r.campaign.id,
        workspaceId: r.campaign.workspaceId,
        recipientId: r.id,
        attempt,
      },
      { delay, jobId: retryJobId(r.id, attempt) },
    ).then(() => { requeued++; }).catch(() => {});
  }

  return requeued;
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
    // A recipient whose message never reached Meta owes nothing. This mark is
    // what settlement refunds against, and it never overwrites a charge
    // already claimed by a successful earlier attempt.
    await markRecipientNotCharged(recipient.id);
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
    await markRecipientNotCharged(recipient.id);
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
    // A deterministic id makes queueing idempotent: BullMQ drops an add() for
    // an id it already holds, so the restart sweep below can re-queue every
    // waiting retry without checking whether its job survived.
    { delay: calculation.delayMs, jobId: retryJobId(recipient.id, calculation.attempt) },
  );

  return { retried: true, nextRetryAt: calculation.nextTime, attempt: calculation.attempt };
}
