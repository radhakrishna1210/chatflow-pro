import { Worker } from 'bullmq';
import { createBullConnection } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import { advanceEnrollment, findDueEnrollments } from '../services/sequenceEngine.service.js';
import { enqueueAdvance } from '../queues/sequence.queue.js';
import { sendAutomatedReply } from '../services/outbound.service.js';
import { NOT_DEDICATED, NOT_ON_DEDICATED_NUMBER } from '../lib/dedicatedNumber.js';

export async function sendSequenceMessage({ enrollment, body }, { sendReply = sendAutomatedReply } = {}) {
  const contact = await prisma.contact.findFirst({
    where: { id: enrollment.contactId, workspaceId: enrollment.workspaceId },
    select: { id: true, phoneNumber: true, optedOut: true },
  });
  if (!contact) throw new Error('Contact no longer exists');
  if (contact.optedOut) throw new Error('Contact opted out');

  // A number dedicated to a context agent carries only that agent's replies,
  // so a sequence neither reuses a thread on one nor picks one as its default.
  let conversation = await prisma.conversation.findFirst({
    where: { workspaceId: enrollment.workspaceId, contactId: contact.id, ...NOT_ON_DEDICATED_NUMBER },
    orderBy: { lastMessageAt: 'desc' },
  });

  if (!conversation) {
    const waNumber = await prisma.waNumber.findFirst({
      where: { workspaceId: enrollment.workspaceId, status: 'ACTIVE', ...NOT_DEDICATED },
    });
    conversation = await prisma.conversation.create({
      data: { workspaceId: enrollment.workspaceId, contactId: contact.id, status: 'OPEN', waNumberId: waNumber?.id },
    });
  } else if (!conversation.waNumberId) {
    const waNumber = await prisma.waNumber.findFirst({
      where: { workspaceId: enrollment.workspaceId, status: 'ACTIVE', ...NOT_DEDICATED },
    });
    if (waNumber) {
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { waNumberId: waNumber.id },
      });
    }
  }
  if (!conversation.waNumberId) throw new Error('No connected WhatsApp number to send from');

  // Sent through the same path as every other automated message. This used to
  // call Meta directly, swallow any error, and then record the message as
  // OUTBOUND "DELIVERED" and the step as SENT — so a missing token, a closed
  // 24-hour window or a Meta rejection all showed in the inbox and the step
  // history as a message the customer had received. sendAutomatedReply checks
  // the opt-out list and the customer-service window, and stores the message
  // only once Meta has accepted it.
  const sent = await sendReply({
    conversationId: conversation.id,
    waNumberId: conversation.waNumberId,
    toPhone: contact.phoneNumber,
    body,
  });
  if (!sent) {
    throw new Error('Message not sent — the 24-hour window is closed, the number is opted out, or Meta rejected it');
  }
  return `Sent to ${contact.phoneNumber}${sent.metaMessageId ? ` (Meta ID: ${sent.metaMessageId})` : ''}`;
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
