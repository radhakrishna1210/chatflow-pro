import { prisma } from '../lib/prisma.js';
import { campaignQueue } from '../queues/campaign.queue.js';
import { isRetryableFailure, calculateNextRetry, formatRetryEta, retryPolicySummary } from '../lib/retry.js';
import { queueCampaignCompletedEmail } from './email.service.js';
import { runFallbackForRecipient } from './fallback.service.js';
import { notifyWorkspace, notifyWorkspaceGrouped } from './notification.service.js';
import { markRecipientNotCharged } from './campaignBilling.service.js';

// Recomputes a campaign's headline counters from its recipients.
//
// sent/delivered/read/failed/skipped are denormalised columns incremented from
// four different files — the worker, the retry path, the status webhook and the
// failure handler — with nothing reconciling them. Any increment lost to a
// crash, or applied twice by a redelivery, left the campaign list and the
// Analytics page quoting figures that disagreed with the recipients themselves.
//
// The campaign detail view already recomputed its own report from recipient
// rows, which is why the two never matched. This makes the stored columns agree
// with that same source of truth, once, when the campaign finishes.
async function reconcileCampaignCounters(campaignId) {
  const groups = await prisma.campaignRecipient.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: { _all: true },
  });
  const n = Object.fromEntries(groups.map((g) => [g.status, g._count._all]));

  // DELIVERED and READ are states a send reached *through* SENT, so each counts
  // toward every stage below it — the same rollup the detail view uses.
  const read = n.READ ?? 0;
  const delivered = (n.DELIVERED ?? 0) + read;
  const sent = (n.SENT ?? 0) + delivered;

  const totals = {
    sent,
    delivered,
    read,
    failed: n.FAILED ?? 0,
    skipped: n.SKIPPED ?? 0,
  };

  const before = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { sent: true, delivered: true, read: true, failed: true, skipped: true },
  });
  const drifted = before && Object.entries(totals).some(([k, v]) => before[k] !== v);
  if (drifted) {
    console.warn(`[Campaign] Counters for ${campaignId} drifted from the recipients — correcting`,
      { stored: before, actual: totals });
  }

  await prisma.campaign.update({ where: { id: campaignId }, data: totals });
  return totals;
}

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
      // Before anything reads the totals — the completion email, the
      // notification and the outgoing webhook all quote them.
      await reconcileCampaignCounters(campaignId).catch((e) =>
        console.error(`[Campaign] Could not reconcile counters for ${campaignId}:`, e.message));
      const completed = await prisma.campaign.findUnique({ where: { id: campaignId } });
      if (completed) {
        // Anything paid for but never sent (a contact who replied STOP after
        // launch, for instance) goes back to the wallet now that the
        // campaign is finished and the final tally is known.
        const { settleCampaignRefund } = await import('./campaigns.service.js');
        await settleCampaignRefund(campaignId, 'Refund for unsent campaign messages').catch((e) =>
          console.error(`[Campaign] Settlement failed for ${campaignId}:`, e.message));

        queueCampaignCompletedEmail(completed).catch(() => {});
        // The customer's own system is told too — the settings screen has
        // offered a "campaign.completed" subscription all along while nothing
        // ever dispatched one.
        const { emitWebhook } = await import('./outgoingWebhook.service.js');
        emitWebhook(completed.workspaceId, 'campaign.completed', {
          campaignId: completed.id,
          name: completed.name,
          sent: completed.sent,
          delivered: completed.delivered,
          read: completed.read,
          failed: completed.failed,
          skipped: completed.skipped,
          completedAt: completed.completedAt,
        });
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

// "Retrying in 2h · 12 messages waiting" — one line in the bell per campaign
// per attempt number, not one per recipient, kept current as the rest of the
// wave lands on the same schedule.
async function notifyRetryScheduled(campaign, { attempt, nextRetryAt, reason }) {
  const waiting = await prisma.campaignRecipient.count({
    where: { campaignId: campaign.id, status: 'RETRYING' },
  });
  const eta = formatRetryEta(nextRetryAt.getTime() - Date.now());
  const { maxAttempts } = retryPolicySummary(campaign.retryConfig);

  await notifyWorkspaceGrouped(campaign.workspaceId, {
    key: `campaign-retry:${campaign.id}:${attempt}`,
    type: 'CAMPAIGN_RETRY_SCHEDULED',
    // The eta is this wave's; the count is every message the campaign still
    // owes an attempt, which may span earlier waves — hence "waiting" rather
    // than claiming they all go out at once.
    title: `Retrying in ${eta} · ${waiting} message${waiting === 1 ? '' : 's'} waiting`,
    body: `Campaign "${campaign.name}" · attempt ${attempt}${maxAttempts ? ` of ${maxAttempts}` : ''} at ${nextRetryAt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} — ${reason}`,
    link: 'campaigns',
    meta: { campaignId: campaign.id, attempt, nextRetryAt: nextRetryAt.toISOString(), waiting },
  });
}

// "3 messages delivered on retry" — the other half of the pair above, so a wave
// that was announced as "retrying in 2h" is reported on when it succeeds.
export async function notifyRetrySucceeded(campaign, recipient, attempt) {
  const recovered = await prisma.campaignRecipient.count({
    where: { campaignId: campaign.id, retryStatus: 'SUCCESS' },
  });

  await notifyWorkspaceGrouped(campaign.workspaceId, {
    key: `campaign-retry-success:${campaign.id}`,
    type: 'CAMPAIGN_RETRY_SUCCESS',
    title: `Retry successful — ${recovered} message${recovered === 1 ? '' : 's'} recovered`,
    body: `Campaign "${campaign.name}" · ${recipient.contact?.name || recipient.contact?.phoneNumber || 'a recipient'} was delivered on retry attempt ${attempt}.`,
    link: 'campaigns',
    meta: { campaignId: campaign.id, recipientId: recipient.id, attempt, recovered },
  }).catch(() => {});
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

  // Best-effort: the retry is already queued, and a notification that could not
  // be written must never undo that.
  await notifyRetryScheduled(campaign, {
    attempt: calculation.attempt,
    nextRetryAt: calculation.nextTime,
    reason: textReason,
  }).catch((e) => console.error(`[CampaignRetry] Retry notification failed for ${campaign.id}:`, e.message));

  return { retried: true, nextRetryAt: calculation.nextTime, attempt: calculation.attempt };
}
