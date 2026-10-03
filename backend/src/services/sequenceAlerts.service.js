import { prisma } from '../lib/prisma.js';
import { notifyWorkspace } from './notification.service.js';

// Tells the workspace when a sequence stops reaching people (WF-EV-9).
//
// An enrollment that failed, was paused for want of message credit, or had a
// message skipped because the 24-hour window had closed used to be visible
// only on the sequence's own detail screen — nobody was told. One bell entry
// per sequence per day: enough to be noticed, never a flood when a whole
// cohort hits the same wall at once.

export const SEQUENCE_ALERT_TYPE = 'SEQUENCE_ATTENTION';
const THROTTLE_MS = 24 * 60 * 60 * 1000;

// Per-process memory of the last alert, so a cohort failing together costs
// one database check rather than one per enrollment. The database check below
// is what holds the limit across processes and restarts.
const lastAlertAt = new Map();

const SUMMARY = {
  failed: 'An enrollment stopped with an error.',
  no_credit: 'Sending is paused: the message quota and wallet balance are exhausted. It retries hourly — top up the wallet or upgrade the plan to resume.',
  window: 'A message step was skipped because the 24-hour WhatsApp window had closed. Use a template step for messages sent after a long wait, or to contacts who have not written in.',
};

/**
 * @param {{ id, workspaceId, sequenceId }} enrollment
 * @param {'failed'|'no_credit'|'window'} kind
 * @param {string} detail   the step's reason, shown in the notification body
 * @returns {Promise<boolean>} whether a notification was created
 */
export async function notifySequenceProblem(enrollment, kind, detail = '', { now = new Date() } = {}) {
  const { workspaceId, sequenceId } = enrollment ?? {};
  if (!workspaceId || !sequenceId) return false;
  const at = now.getTime();

  const memo = lastAlertAt.get(sequenceId);
  if (memo && at - memo < THROTTLE_MS) return false;
  lastAlertAt.set(sequenceId, at);

  try {
    const recent = await prisma.notification.findFirst({
      where: {
        workspaceId,
        type: SEQUENCE_ALERT_TYPE,
        createdAt: { gte: new Date(at - THROTTLE_MS) },
        meta: { path: ['sequenceId'], equals: sequenceId },
      },
      select: { createdAt: true },
    });
    if (recent) {
      // Throttled from when that one was sent, not from now.
      lastAlertAt.set(sequenceId, new Date(recent.createdAt).getTime());
      return false;
    }

    const sequence = await prisma.sequence.findFirst({ where: { id: sequenceId, workspaceId }, select: { name: true } });
    const name = sequence?.name ?? 'A sequence';
    await notifyWorkspace(workspaceId, {
      type: SEQUENCE_ALERT_TYPE,
      title: `Sequence "${name}" needs attention`,
      body: `${SUMMARY[kind] ?? SUMMARY.failed}${detail ? ` ${String(detail).slice(0, 300)}` : ''}`,
      link: 'sequences',
      meta: { sequenceId, enrollmentId: enrollment.id ?? null, kind },
    });
    return true;
  } catch (err) {
    // Not remembered as sent: the next problem may try again.
    lastAlertAt.delete(sequenceId);
    console.warn(`[Sequence] Could not notify about sequence ${sequenceId}:`, err.message);
    return false;
  }
}

// Tests only.
export function resetSequenceAlerts() {
  lastAlertAt.clear();
}
