import { prisma } from '../lib/prisma.js';
import { campaignQueue } from '../queues/campaign.queue.js';
import { checkAndCompleteCampaign, recoverPendingRetries } from './retry.service.js';
import { settleFinishedCampaigns } from './campaigns.service.js';

// Database-driven recovery for campaigns whose BullMQ job is gone.
//
// Once the worker flips a campaign to RUNNING the only thing that ever sends
// its PENDING recipients is that job. A restart, a Redis flush, or a job that
// died after the claim used to strand the campaign in RUNNING forever, with
// the unspent reservation held until someone cancelled it by hand. The
// recipient rows are the source of truth, so the sweep reads them and
// re-enqueues whatever has work left and nobody working on it.
//
// Safe to run from several processes at once: each re-enqueue is claimed by a
// compare-and-set on Campaign.queueJobId, and the worker additionally claims
// every recipient PENDING -> SENDING before it sends, so a duplicate job can
// never send the same message twice.

// A launch stamps chargedAt, queues the job, then records queueJobId. A charged
// DRAFT younger than this is a launch still in flight, not a lost one; a RUNNING
// campaign touched more recently than this is very likely still sending.
export const RECOVERY_GRACE_MS = 2 * 60_000;
export const RECOVERY_INTERVAL_MS = 5 * 60_000;
const MAX_CAMPAIGNS_PER_SWEEP = 200;

const ALIVE_JOB_STATES = new Set(['active', 'waiting', 'delayed', 'prioritized', 'waiting-children', 'paused']);

// Whether the job recorded on the campaign still exists and will (or is) run.
// An unreadable state counts as alive: re-enqueueing on a Redis hiccup is the
// riskier mistake.
export async function isCampaignJobAlive(jobId) {
  if (!jobId) return false;
  let job;
  try {
    job = await campaignQueue.getJob(jobId);
  } catch {
    return true;
  }
  if (!job) return false;
  const state = await job.getState().catch(() => 'unknown');
  if (state === 'unknown') return true;
  return ALIVE_JOB_STATES.has(state);
}

// What to do with one candidate campaign. Pure, so the selection rules are
// testable without a database or a queue.
//   requeue  - recipients still owed a first attempt and no job to send them
//   complete - nothing left at all; the campaign only missed its completion
//   skip     - a live job owns it, or only retries remain (they finish it)
export function planCampaignRecovery({ status, jobAlive, pending = 0, sending = 0, retrying = 0 }) {
  if (jobAlive) return 'skip';
  if (pending + sending > 0) return 'requeue';
  if (status !== 'RUNNING') return 'skip';
  if (retrying > 0) return 'skip';
  return 'complete';
}

const recoveryJobId = (campaignId, now) => `recover-${campaignId}-${now.getTime()}`;

export async function recoverStrandedCampaigns({ now = new Date() } = {}) {
  const graceCutoff = new Date(now.getTime() - RECOVERY_GRACE_MS);
  const candidates = await prisma.campaign.findMany({
    where: {
      OR: [
        { status: 'RUNNING', updatedAt: { lt: graceCutoff } },
        // Paid for and queued, but the worker never picked it up. The cost
        // columns are written together with queueJobId, so a row without one
        // never reached the queue and is left for a human (and logged).
        { status: 'DRAFT', chargedAt: { lt: graceCutoff }, queueJobId: { not: null } },
      ],
    },
    select: { id: true, workspaceId: true, status: true, queueJobId: true },
    orderBy: { updatedAt: 'asc' },
    take: MAX_CAMPAIGNS_PER_SWEEP,
  });

  const result = { requeued: 0, completed: 0 };
  if (candidates.length === 0) return result;

  const groups = await prisma.campaignRecipient.groupBy({
    by: ['campaignId', 'status'],
    where: { campaignId: { in: candidates.map((c) => c.id) }, status: { in: ['PENDING', 'SENDING', 'RETRYING'] } },
    _count: { _all: true },
  });
  const counts = new Map();
  for (const g of groups) {
    const row = counts.get(g.campaignId) || {};
    row[g.status] = g._count._all;
    counts.set(g.campaignId, row);
  }

  for (const c of candidates) {
    const n = counts.get(c.id) || {};
    const jobAlive = await isCampaignJobAlive(c.queueJobId);
    const action = planCampaignRecovery({
      status: c.status, jobAlive, pending: n.PENDING, sending: n.SENDING, retrying: n.RETRYING,
    });

    if (action === 'complete') {
      if (await checkAndCompleteCampaign(c.id).catch(() => false)) result.completed += 1;
      continue;
    }
    if (action !== 'requeue') continue;

    // Only the process that swaps queueJobId from the value it read gets to
    // enqueue; anyone else racing this sweep loses here.
    const jobId = recoveryJobId(c.id, now);
    const claimed = await prisma.campaign.updateMany({
      where: { id: c.id, status: c.status, queueJobId: c.queueJobId },
      data: { queueJobId: jobId },
    });
    if (claimed.count === 0) continue;

    // The job that claimed these rows is gone, so nothing will ever finish
    // them. A row that reached Meta has sentAt and is left alone.
    if (n.SENDING) {
      await prisma.campaignRecipient.updateMany({
        where: { campaignId: c.id, status: 'SENDING', sentAt: null },
        data: { status: 'PENDING' },
      });
    }

    try {
      await campaignQueue.add(
        'send-campaign',
        { campaignId: c.id, workspaceId: c.workspaceId, resume: c.status === 'RUNNING' },
        { jobId },
      );
      result.requeued += 1;
      console.log(`[Recovery] Re-queued ${c.status} campaign ${c.id} whose job was lost`);
    } catch (err) {
      // queueJobId now names a job that does not exist, so the next sweep
      // sees it as lost and tries again.
      console.error(`[Recovery] Could not re-queue campaign ${c.id}:`, err.message);
    }
  }

  return result;
}

// One pass of everything that keeps campaigns moving without a live job.
export async function runCampaignRecoverySweep() {
  const campaigns = await recoverStrandedCampaigns();
  const retries = await recoverPendingRetries();
  const settled = await settleFinishedCampaigns();
  return { ...campaigns, retries, settled };
}

let sweepTimer = null;
let sweepRunning = false;

// In-process rather than a repeatable BullMQ job: the campaigns queue is busy
// with long send loops, and a sweep stuck behind them would not be periodic.
export function startCampaignRecoverySweep(intervalMs = RECOVERY_INTERVAL_MS) {
  if (sweepTimer) return sweepTimer;
  sweepTimer = setInterval(async () => {
    if (sweepRunning) return;
    sweepRunning = true;
    try {
      const r = await runCampaignRecoverySweep();
      if (r.requeued || r.completed || r.retries || r.settled) {
        console.log(`[Recovery] Campaign sweep: requeued=${r.requeued} completed=${r.completed} retries=${r.retries} settled=${r.settled}`);
      }
    } catch (err) {
      console.error('[Recovery] Campaign sweep failed:', err.message);
    } finally {
      sweepRunning = false;
    }
  }, intervalMs);
  sweepTimer.unref?.();
  return sweepTimer;
}

export function stopCampaignRecoverySweep() {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}
