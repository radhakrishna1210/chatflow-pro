import { prisma } from '../lib/prisma.js';
import { notifyWorkspace } from './notification.service.js';

// Tells the workspace when a workflow run fails.
//
// A failed run used to be visible only in that workflow's run history, so a
// workflow that stopped reaching customers (empty wallet, unapproved template,
// closed 24-hour window) looked like one that "isn't triggering". One bell
// entry per workflow per day — the same throttle as sequence alerts — so a
// burst of failures is noticed without flooding the bell.

export const WORKFLOW_ALERT_TYPE = 'WORKFLOW_FAILED';
const THROTTLE_MS = 24 * 60 * 60 * 1000;

// Per-process memory of the last alert; the database check below holds the
// limit across processes and restarts.
const lastAlertAt = new Map();

/**
 * @param {{ id, workspaceId, workflowId }} run
 * @param {string} error   the run's failure summary, shown in the body
 * @returns {Promise<boolean>} whether a notification was created
 */
export async function notifyWorkflowFailed(run, error = '', { now = new Date() } = {}) {
  const { workspaceId, workflowId } = run ?? {};
  if (!workspaceId || !workflowId) return false;
  const at = now.getTime();

  const memo = lastAlertAt.get(workflowId);
  if (memo && at - memo < THROTTLE_MS) return false;
  lastAlertAt.set(workflowId, at);

  try {
    const recent = await prisma.notification.findFirst({
      where: {
        workspaceId,
        type: WORKFLOW_ALERT_TYPE,
        createdAt: { gte: new Date(at - THROTTLE_MS) },
        meta: { path: ['workflowId'], equals: workflowId },
      },
      select: { createdAt: true },
    });
    if (recent) {
      lastAlertAt.set(workflowId, new Date(recent.createdAt).getTime());
      return false;
    }

    const workflow = await prisma.workflow.findFirst({ where: { id: workflowId, workspaceId }, select: { name: true } });
    const name = workflow?.name ?? 'A workflow';
    await notifyWorkspace(workspaceId, {
      type: WORKFLOW_ALERT_TYPE,
      title: `Workflow "${name}" failed`,
      body: `${String(error || 'A run stopped with an error.').slice(0, 300)} See the workflow's run history for details.`,
      link: 'automation',
      meta: { workflowId, runId: run.id ?? null },
    });
    return true;
  } catch (err) {
    // Not remembered as sent: the next failure may try again.
    lastAlertAt.delete(workflowId);
    console.warn(`[Workflow] Could not notify about workflow ${workflowId}:`, err.message);
    return false;
  }
}

// Tests only.
export function resetWorkflowAlerts() {
  lastAlertAt.clear();
}
