import { Worker } from 'bullmq';
import { createBullConnection } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import { advanceEnrollment, findDueEnrollments } from '../services/sequenceEngine.service.js';
import { enqueueAdvance } from '../queues/sequence.queue.js';

// Sends one sequence message. Kept here rather than in the engine so the
// engine stays free of provider concerns and testable without a live number.
//
// Messages are written into the contact's existing conversation so a sequence
// message and a human reply sit in one thread, which is what makes
// exit-on-reply meaningful.
async function sendSequenceMessage({ enrollment, body }) {
  const contact = await prisma.contact.findUnique({
    where: { id: enrollment.contactId },
    select: { id: true, phoneNumber: true, optedOut: true },
  });
  if (!contact) throw new Error('Contact no longer exists');
  // Re-checked at the moment of sending, not merely before the step: the
  // window between the two is exactly where an opt-out would be missed.
  if (contact.optedOut) throw new Error('Contact opted out');

  let conversation = await prisma.conversation.findFirst({
    where: { workspaceId: enrollment.workspaceId, contactId: contact.id },
    orderBy: { lastMessageAt: 'desc' },
    select: { id: true },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { workspaceId: enrollment.workspaceId, contactId: contact.id, status: 'OPEN' },
      select: { id: true },
    });
  }

  await prisma.message.create({
    data: { conversationId: conversation.id, body, direction: 'OUTBOUND', sentAt: new Date() },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });

  return `Queued to ${contact.phoneNumber}`;
}

export function startSequenceWorker() {
  const worker = new Worker(
    'sequences',
    async (job) => {
      if (job.name === 'sweep') {
        const due = await findDueEnrollments({ limit: 100 });
        for (const row of due) await enqueueAdvance(row.id).catch(() => {});
        return { swept: due.length };
      }

      const { enrollmentId } = job.data;

      // Instant steps (message, task, field update) chain inside this one job
      // rather than re-queueing. Re-queueing used the same deterministic job
      // id as the job currently running, so the remove-then-add collided with
      // the in-flight job and the chain stalled after the first step.
      //
      // Bounded so a pathological sequence cannot spin a worker forever; the
      // remainder is picked up by the next sweep.
      const MAX_STEPS_PER_JOB = 20;
      let result;
      for (let i = 0; i < MAX_STEPS_PER_JOB; i += 1) {
        result = await advanceEnrollment(enrollmentId, { send: sendSequenceMessage });
        if (result.status !== 'ACTIVE') break;
      }

      // A wait short enough to be worth its own job gets one; anything longer
      // is left to the sweep, which survives a Redis restart because
      // `nextRunAt` lives in the database.
      if (result?.status === 'WAITING' && result.nextRunAt) {
        const delay = Math.max(0, new Date(result.nextRunAt).getTime() - Date.now());
        if (delay < 5 * 60_000) {
          await enqueueAdvance(enrollmentId, delay).catch((err) => {
            console.error(`[Sequence] Could not schedule the next step for ${enrollmentId}:`, err.message);
          });
        }
      }

      return result;
    },
    { connection: createBullConnection('sequence-worker'), concurrency: 5 },
  );

  worker.on('failed', (job, err) => {
    console.error(`[Sequence] job ${job?.id} failed:`, err?.message);
  });

  return worker;
}
