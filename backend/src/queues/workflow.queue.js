import { Queue } from 'bullmq';
import { createBullConnection } from '../lib/redis.js';

// Carries two kinds of deferred automation work:
//  - `resume`: a workflow run parked on a delay step
//  - `delayed-response`: the "Delayed Response Message" basic automation,
//    which must check N minutes later whether a human ever replied
export const workflowQueue = new Queue('workflows', {
  connection: createBullConnection('workflow-queue'),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

// BullMQ refuses to add a job whose jobId already exists — including one that
// has already completed but is still retained by removeOnComplete. Both helpers
// below therefore clear the previous job before re-adding, and keep nothing
// after finishing, so an id can be reused on the next wave.
async function addReplacing(name, jobId, data, delayMs) {
  const existing = await workflowQueue.getJob(jobId);
  if (existing) await existing.remove().catch(() => {});
  return workflowQueue.add(name, data, {
    delay: delayMs,
    jobId,
    removeOnComplete: true,
    removeOnFail: true,
  });
}

// BullMQ rejects a custom job id containing ':' — it is the delimiter in its own
// Redis key scheme. Both ids below used colons, so every add() threw
// "Custom Id cannot contain :" and was swallowed by the caller's catch: no
// workflow ever resumed after a delay step, and the delayed-response auto-reply
// never fired at all. '__' separates the parts instead.
const jobKey = (...parts) => parts.join('__');

// The cursor is part of the id because a workflow may park on several delay
// steps; a run-only id would be silently rejected on the second delay and
// strand the run in WAITING forever.
export async function enqueueWorkflowResume(runId, cursor, delayMs) {
  return addReplacing('resume', jobKey('resume', runId, cursor), { runId }, delayMs);
}

// One pending check per conversation — a customer sending five messages in a
// row should not queue five delayed-response replies, and re-arming restarts
// the timer from their latest message.
export async function enqueueDelayedResponseCheck(conversationId, delayMs) {
  return addReplacing('delayed-response', jobKey('delayed', conversationId), { conversationId }, delayMs);
}
