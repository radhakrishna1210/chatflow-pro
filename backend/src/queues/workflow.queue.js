import { Queue } from 'bullmq';
import { createQueueConnection, logRedisError } from '../lib/redis.js';
import { workflowResumeJobId, delayedResponseJobId, replyReminderJobId } from './jobIds.js';

// Carries four kinds of deferred automation work:
//  - `resume`: a workflow run parked on a delay step
//  - `reply-reminder`: a nudge for a customer who has not answered a
//    wait_reply step within its `remindAfter`
//  - `delayed-response`: the "Delayed Response Message" basic automation,
//    which must check N minutes later whether a human ever replied
//  - `sweep`: a repeating tick that recovers parked runs from the database
export const workflowQueue = new Queue('workflows', {
  connection: createQueueConnection('workflow-queue'),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

workflowQueue.on('error', (err) => logRedisError('workflow-queue', err));

// BullMQ refuses to add a job whose jobId already exists — including one that
// has already completed but is still retained by removeOnComplete. The helpers
// below therefore clear the previous job before re-adding, and keep nothing
// after finishing, so an id can be reused on the next wave.
async function addReplacing(name, jobId, data, delayMs) {
  const existing = await workflowQueue.getJob(jobId);
  if (existing) await existing.remove().catch(() => {}); // a job already running or gone cannot be removed; add() below still dedupes by id
  return workflowQueue.add(name, data, {
    delay: delayMs,
    jobId,
    removeOnComplete: true,
    removeOnFail: true,
  });
}

// The cursor is part of the id because a workflow may park on several delay
// steps; a run-only id would be silently rejected on the second delay and
// strand the run in WAITING forever.
export async function enqueueWorkflowResume(runId, cursor, delayMs) {
  return addReplacing('resume', workflowResumeJobId(runId, cursor), { runId }, delayMs);
}

// One pending check per conversation — a customer sending five messages in a
// row should not queue five delayed-response replies, and re-arming restarts
// the timer from their latest message.
export async function enqueueDelayedResponseCheck(conversationId, delayMs) {
  return addReplacing('delayed-response', delayedResponseJobId(conversationId), { conversationId }, delayMs);
}

// "Remind them if they haven't answered in 5 minutes" on a wait_reply step.
// Keyed by run and cursor like a resume, so re-parking on the same step
// replaces the timer rather than stacking a second reminder.
export async function enqueueReplyReminder(runId, cursor, delayMs) {
  return addReplacing('reply-reminder', replyReminderJobId(runId, cursor), { runId, cursor }, delayMs);
}

export const WORKFLOW_SWEEP_INTERVAL_MS = 60_000;

// The delayed jobs above live only in Redis, which on this deployment has no
// persistence. Each parked run also records its due time in
// WorkflowRun.resumeAt, and this repeating sweep re-enqueues whatever is
// overdue, so a Redis restart delays a follow-up instead of losing it.
export async function startWorkflowSweep() {
  return workflowQueue.add('sweep', {}, {
    jobId: 'workflow-sweep',
    repeat: { every: WORKFLOW_SWEEP_INTERVAL_MS },
    removeOnComplete: true,
    removeOnFail: true,
  });
}
