import { prisma } from '../lib/prisma.js';
import { isWithinBusinessHours } from './businessHours.service.js';

export const STEP_KINDS = ['MESSAGE', 'WAIT', 'TASK', 'UPDATE_FIELD', 'EXIT'];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Upper bound on a single wait so a typo cannot park someone for a decade.
const MAX_WAIT_DAYS = 90;

export function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    const e = new Error('A sequence needs at least one step'); e.status = 400; throw e;
  }
  if (steps.length > 50) {
    const e = new Error('A sequence cannot have more than 50 steps'); e.status = 400; throw e;
  }

  return steps.map((step, i) => {
    const at = `Step ${i + 1}`;
    const fail = (msg) => { const e = new Error(`${at}: ${msg}`); e.status = 400; throw e; };

    if (!STEP_KINDS.includes(step?.kind)) fail(`unknown step type "${step?.kind}"`);

    switch (step.kind) {
      case 'MESSAGE': {
        const body = String(step.body ?? '').trim();
        if (!body) fail('a message step needs body text');
        if (body.length > 4096) fail('message body is too long');
        return { kind: 'MESSAGE', body };
      }
      case 'WAIT': {
        const minutes = Number(step.minutes);
        if (!Number.isFinite(minutes) || minutes <= 0) fail('a wait step needs a positive duration');
        if (minutes > MAX_WAIT_DAYS * 24 * 60) fail(`a wait cannot exceed ${MAX_WAIT_DAYS} days`);
        return { kind: 'WAIT', minutes: Math.round(minutes) };
      }
      case 'TASK': {
        const title = String(step.title ?? '').trim();
        if (!title) fail('a task step needs a title');
        return { kind: 'TASK', title, dueInDays: Math.max(0, Number(step.dueInDays) || 0) };
      }
      case 'UPDATE_FIELD': {
        // Only the lead's status is settable from a sequence. Arbitrary field
        // writes from an automated cadence are how records quietly rot.
        const status = String(step.status ?? '').trim().toUpperCase();
        const allowed = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'LOST'];
        if (!allowed.includes(status)) fail(`status must be one of: ${allowed.join(', ')}`);
        return { kind: 'UPDATE_FIELD', status };
      }
      case 'EXIT':
      default:
        return { kind: 'EXIT', reason: String(step.reason ?? 'Sequence complete').slice(0, 200) };
    }
  });
}

/**
 * Every reason an enrollment must stop before its next step runs.
 *
 * Checked immediately before each step rather than once at enrolment, because
 * all of these can become true while a contact is parked mid-cadence — which
 * is exactly when continuing would be worst.
 */
export async function findExitReason(enrollment) {
  const { workspaceId, contactId, sequenceId } = enrollment;

  const [contact, sequence] = await Promise.all([
    prisma.contact.findFirst({ where: { id: contactId, workspaceId }, select: { optedOut: true, phoneNumber: true } }),
    prisma.sequence.findFirst({ where: { id: sequenceId, workspaceId }, select: { status: true, exitOnReply: true } }),
  ]);

  if (!contact) return 'Contact no longer exists';
  if (contact.optedOut) return 'Contact opted out';
  if (!sequence) return 'Sequence no longer exists';
  if (sequence.status === 'PAUSED') return null; // handled by the caller as a hold, not an exit

  // A blocked number must never be messaged, whatever the cadence says.
  const blocked = await prisma.optOut.findFirst({
    where: { workspaceId, phoneNumber: contact.phoneNumber },
    select: { id: true },
  }).catch(() => null);
  if (blocked) return 'Number is on the blocked list';

  // Someone replying is the signal to stop automating and let a human take
  // over. Any inbound message after enrolment counts.
  if (sequence.exitOnReply) {
    const reply = await prisma.message.findFirst({
      where: {
        direction: 'INBOUND',
        sentAt: { gt: enrollment.enrolledAt },
        conversation: { contactId, workspaceId },
      },
      select: { id: true },
    });
    if (reply) return 'Contact replied';
  }

  return null;
}

/**
 * When a step may actually run, given business hours.
 *
 * Returns null if it can run now, or the next permitted time. Sending is
 * delayed rather than skipped: a follow-up that arrives next morning is fine,
 * one that silently never arrives is a broken cadence.
 */
export function nextPermittedTime(businessHours, from = new Date()) {
  if (isWithinBusinessHours(businessHours, from)) return null;

  // Step forward in 30-minute increments to the next open slot. Bounded to a
  // week so a workspace with every day disabled cannot loop forever.
  const probe = new Date(from.getTime());
  for (let i = 0; i < 7 * 48; i += 1) {
    probe.setTime(probe.getTime() + 30 * MINUTE);
    if (isWithinBusinessHours(businessHours, probe)) return new Date(probe.getTime());
  }
  return null;
}

// Records what happened, so a cadence's history is inspectable per contact.
export async function recordStep(enrollment, stepIndex, kind, outcome, detail = null) {
  return prisma.sequenceStepRun.create({
    data: { workspaceId: enrollment.workspaceId, enrollmentId: enrollment.id, stepIndex, kind, outcome, detail },
  });
}

/**
 * Runs one step of one enrollment and schedules whatever comes next.
 *
 * Returns { status, nextRunAt } describing where the enrollment now stands.
 * The caller (worker or manual tick) persists nothing itself — everything is
 * written here so a crash between steps leaves consistent state.
 */
export async function advanceEnrollment(enrollmentId, { now = new Date(), send } = {}) {
  const enrollment = await prisma.sequenceEnrollment.findUnique({
    where: { id: enrollmentId },
    include: { sequence: { select: { status: true, respectBusinessHours: true } } },
  });
  if (!enrollment) return { status: 'MISSING' };
  if (['COMPLETED', 'EXITED', 'FAILED'].includes(enrollment.status)) {
    return { status: enrollment.status };
  }

  // A paused sequence holds its enrollments where they are rather than
  // exiting them, so resuming picks up mid-cadence.
  if (enrollment.sequence?.status === 'PAUSED') {
    return { status: 'HELD' };
  }

  const exitReason = await findExitReason(enrollment);
  if (exitReason) {
    await recordStep(enrollment, enrollment.cursor, 'EXIT', 'SKIPPED', exitReason);
    await prisma.sequenceEnrollment.update({
      where: { id: enrollment.id },
      data: { status: 'EXITED', exitReason, nextRunAt: null, completedAt: now },
    });
    return { status: 'EXITED', exitReason };
  }

  const steps = Array.isArray(enrollment.steps) ? enrollment.steps : [];
  if (enrollment.cursor >= steps.length) {
    await prisma.sequenceEnrollment.update({
      where: { id: enrollment.id },
      data: { status: 'COMPLETED', nextRunAt: null, completedAt: now },
    });
    return { status: 'COMPLETED' };
  }

  const step = steps[enrollment.cursor];

  // Only outbound contact is confined to business hours; internal steps like
  // creating a task or updating a field can run any time.
  if (step.kind === 'MESSAGE' && enrollment.sequence?.respectBusinessHours) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: enrollment.workspaceId },
      select: { businessHours: true },
    });
    const deferUntil = nextPermittedTime(workspace?.businessHours, now);
    if (deferUntil) {
      await prisma.sequenceEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'WAITING', nextRunAt: deferUntil },
      });
      return { status: 'WAITING', nextRunAt: deferUntil, deferred: 'outside business hours' };
    }
  }

  try {
    switch (step.kind) {
      case 'WAIT': {
        const nextRunAt = new Date(now.getTime() + step.minutes * MINUTE);
        await recordStep(enrollment, enrollment.cursor, 'WAIT', 'SENT', `Waiting ${step.minutes} minute(s)`);
        await prisma.sequenceEnrollment.update({
          where: { id: enrollment.id },
          data: { cursor: enrollment.cursor + 1, status: 'WAITING', nextRunAt },
        });
        return { status: 'WAITING', nextRunAt };
      }

      case 'MESSAGE': {
        // `send` is injected so the engine stays testable without a live
        // WhatsApp provider. The worker supplies the real sender.
        const detail = send
          ? await send({ enrollment, body: step.body })
          : 'No sender configured — message not dispatched';
        await recordStep(enrollment, enrollment.cursor, 'MESSAGE', send ? 'SENT' : 'SKIPPED', String(detail).slice(0, 500));
        break;
      }

      case 'TASK': {
        const dueDate = new Date(now.getTime() + (step.dueInDays ?? 0) * DAY);
        await prisma.task.create({
          data: {
            workspaceId: enrollment.workspaceId,
            title: step.title,
            description: 'Created by a sequence',
            dueDate,
            contactId: enrollment.contactId,
            leadId: enrollment.leadId,
          },
        });
        await recordStep(enrollment, enrollment.cursor, 'TASK', 'SENT', step.title);
        break;
      }

      case 'UPDATE_FIELD': {
        if (enrollment.leadId) {
          await prisma.lead.update({ where: { id: enrollment.leadId }, data: { status: step.status } });
          await recordStep(enrollment, enrollment.cursor, 'UPDATE_FIELD', 'SENT', `status = ${step.status}`);
        } else {
          await recordStep(enrollment, enrollment.cursor, 'UPDATE_FIELD', 'SKIPPED', 'No lead attached');
        }
        break;
      }

      case 'EXIT': {
        await recordStep(enrollment, enrollment.cursor, 'EXIT', 'SENT', step.reason);
        await prisma.sequenceEnrollment.update({
          where: { id: enrollment.id },
          data: { status: 'EXITED', exitReason: step.reason, nextRunAt: null, completedAt: now },
        });
        return { status: 'EXITED', exitReason: step.reason };
      }

      default:
        await recordStep(enrollment, enrollment.cursor, String(step.kind), 'SKIPPED', 'Unknown step type');
    }
  } catch (err) {
    await recordStep(enrollment, enrollment.cursor, String(step.kind), 'FAILED', err.message);
    await prisma.sequenceEnrollment.update({
      where: { id: enrollment.id },
      data: { status: 'FAILED', lastError: err.message, nextRunAt: null },
    });
    return { status: 'FAILED', error: err.message };
  }

  // Immediate steps chain straight into the next one on the following tick.
  const cursor = enrollment.cursor + 1;
  if (cursor >= steps.length) {
    await prisma.sequenceEnrollment.update({
      where: { id: enrollment.id },
      data: { cursor, status: 'COMPLETED', nextRunAt: null, completedAt: now },
    });
    return { status: 'COMPLETED' };
  }

  await prisma.sequenceEnrollment.update({
    where: { id: enrollment.id },
    data: { cursor, status: 'ACTIVE', nextRunAt: now },
  });
  return { status: 'ACTIVE', nextRunAt: now };
}

// Enrollments whose next step is due. Used by the worker's periodic sweep and
// safe to call repeatedly — an enrollment stops appearing once it terminates.
export async function findDueEnrollments({ limit = 50, now = new Date() } = {}) {
  return prisma.sequenceEnrollment.findMany({
    where: {
      status: { in: ['ACTIVE', 'WAITING'] },
      nextRunAt: { lte: now },
      sequence: { status: 'PUBLISHED' },
    },
    select: { id: true, workspaceId: true },
    orderBy: { nextRunAt: 'asc' },
    take: limit,
  });
}
