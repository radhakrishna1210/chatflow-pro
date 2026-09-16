import { prisma } from '../lib/prisma.js';
import { validateSteps } from './sequenceEngine.service.js';

const SEQUENCE_INCLUDE = {
  _count: { select: { enrollments: true } },
};

export async function listSequences(workspaceId, { status = '' } = {}) {
  const where = { workspaceId, ...(status ? { status } : {}) };
  const data = await prisma.sequence.findMany({
    where, include: SEQUENCE_INCLUDE, orderBy: { updatedAt: 'desc' },
  });

  // Per-sequence enrollment counts by state, so the list can show what is
  // actually happening rather than just a total.
  const grouped = await prisma.sequenceEnrollment.groupBy({
    by: ['sequenceId', 'status'],
    where: { workspaceId },
    _count: { _all: true },
  });

  const stats = new Map();
  for (const row of grouped) {
    if (!stats.has(row.sequenceId)) stats.set(row.sequenceId, {});
    stats.get(row.sequenceId)[row.status] = row._count._all;
  }

  return {
    data: data.map((s) => ({ ...s, stats: stats.get(s.id) ?? {} })),
    total: data.length,
  };
}

export async function getSequence(workspaceId, id) {
  const sequence = await prisma.sequence.findFirst({
    where: { id, workspaceId },
    include: {
      enrollments: {
        take: 100,
        orderBy: { enrolledAt: 'desc' },
        include: {
          contact: { select: { id: true, name: true, phoneNumber: true } },
          stepRuns: { orderBy: { ranAt: 'asc' }, take: 50 },
        },
      },
    },
  });
  if (!sequence) { const e = new Error('Sequence not found'); e.status = 404; throw e; }
  return sequence;
}

export async function createSequence(workspaceId, body, userId) {
  const steps = validateSteps(body.steps);
  return prisma.sequence.create({
    data: {
      workspaceId,
      name: body.name,
      description: body.description ?? null,
      steps,
      respectBusinessHours: body.respectBusinessHours ?? true,
      exitOnReply: body.exitOnReply ?? true,
      createdByUserId: userId ?? null,
    },
    include: SEQUENCE_INCLUDE,
  });
}

export async function updateSequence(workspaceId, id, updates) {
  const sequence = await prisma.sequence.findFirst({ where: { id, workspaceId }, select: { id: true, status: true } });
  if (!sequence) { const e = new Error('Sequence not found'); e.status = 404; throw e; }

  const data = { ...updates };
  if (updates.steps !== undefined) {
    // Editing steps is allowed at any time, but only affects future
    // enrolments: existing ones carry their own snapshot.
    data.steps = validateSteps(updates.steps);
  }

  return prisma.sequence.update({ where: { id }, data, include: SEQUENCE_INCLUDE });
}

const ALLOWED_STATUS_MOVES = {
  DRAFT: ['PUBLISHED'],
  PUBLISHED: ['PAUSED'],
  PAUSED: ['PUBLISHED'],
};

export async function changeSequenceStatus(workspaceId, id, status) {
  const sequence = await prisma.sequence.findFirst({ where: { id, workspaceId }, select: { status: true, steps: true } });
  if (!sequence) { const e = new Error('Sequence not found'); e.status = 404; throw e; }

  if (!(ALLOWED_STATUS_MOVES[sequence.status] ?? []).includes(status)) {
    const e = new Error(`A ${sequence.status.toLowerCase()} sequence cannot become ${status.toLowerCase()}`);
    e.status = 409;
    throw e;
  }

  // Publishing re-validates: a draft may have been saved with placeholder
  // steps, and publishing is the point where it starts contacting people.
  if (status === 'PUBLISHED') validateSteps(sequence.steps);

  return prisma.sequence.update({ where: { id }, data: { status }, include: SEQUENCE_INCLUDE });
}

export async function deleteSequence(workspaceId, id) {
  const active = await prisma.sequenceEnrollment.count({
    where: { workspaceId, sequenceId: id, status: { in: ['ACTIVE', 'WAITING'] } },
  });
  if (active > 0) {
    const e = new Error(`${active} contact(s) are still in this sequence. Pause it and unenroll them first.`);
    e.status = 409;
    throw e;
  }
  const sequence = await prisma.sequence.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!sequence) { const e = new Error('Sequence not found'); e.status = 404; throw e; }
  await prisma.sequence.delete({ where: { id } });
}

/**
 * Enrolls contacts. Anyone already enrolled, opted out, or blocked is skipped
 * with a stated reason rather than silently dropped — a rep needs to know why
 * 3 of their 10 selected contacts are not in the cadence.
 */
export async function enrollContacts(workspaceId, sequenceId, { contactIds = [], leadIds = [] } = {}) {
  const sequence = await prisma.sequence.findFirst({ where: { id: sequenceId, workspaceId } });
  if (!sequence) { const e = new Error('Sequence not found'); e.status = 404; throw e; }
  if (sequence.status !== 'PUBLISHED') {
    const e = new Error('Only a published sequence can enrol contacts'); e.status = 409; throw e;
  }

  // Leads are resolved to their contacts so both selection styles converge.
  const leadRows = leadIds.length
    ? await prisma.lead.findMany({ where: { workspaceId, id: { in: leadIds } }, select: { id: true, contactId: true } })
    : [];
  const leadByContact = new Map(leadRows.map((l) => [l.contactId, l.id]));

  const wanted = [...new Set([...contactIds, ...leadRows.map((l) => l.contactId)])];
  if (wanted.length === 0) {
    const e = new Error('Select at least one contact'); e.status = 400; throw e;
  }
  if (wanted.length > 1000) {
    const e = new Error('Enrol at most 1000 contacts at a time'); e.status = 400; throw e;
  }

  const [contacts, existing, blocked] = await Promise.all([
    prisma.contact.findMany({
      where: { workspaceId, id: { in: wanted } },
      select: { id: true, name: true, optedOut: true, phoneNumber: true },
    }),
    prisma.sequenceEnrollment.findMany({
      where: { sequenceId, contactId: { in: wanted } },
      select: { contactId: true },
    }),
    prisma.optOut.findMany({ where: { workspaceId }, select: { phoneNumber: true } }).catch(() => []),
  ]);

  const alreadyIn = new Set(existing.map((e) => e.contactId));
  const blockedNumbers = new Set(blocked.map((b) => b.phoneNumber));

  const enrolled = [];
  const skipped = [];
  const now = new Date();

  for (const contact of contacts) {
    if (alreadyIn.has(contact.id)) { skipped.push({ contactId: contact.id, name: contact.name, reason: 'Already in this sequence' }); continue; }
    if (contact.optedOut) { skipped.push({ contactId: contact.id, name: contact.name, reason: 'Opted out' }); continue; }
    if (blockedNumbers.has(contact.phoneNumber)) { skipped.push({ contactId: contact.id, name: contact.name, reason: 'Number is blocked' }); continue; }

    const created = await prisma.sequenceEnrollment.create({
      data: {
        workspaceId,
        sequenceId,
        contactId: contact.id,
        leadId: leadByContact.get(contact.id) ?? null,
        // The steps are snapshotted here, so editing the sequence later does
        // not move this contact into a different cadence mid-flight.
        steps: sequence.steps,
        status: 'ACTIVE',
        nextRunAt: now,
      },
      select: { id: true, contactId: true },
    });
    enrolled.push(created);
  }

  const missing = wanted.filter((id) => !contacts.some((c) => c.id === id));
  for (const id of missing) skipped.push({ contactId: id, reason: 'Contact not found in this workspace' });

  return { enrolled: enrolled.length, skipped, enrollmentIds: enrolled.map((e) => e.id) };
}

export async function unenroll(workspaceId, enrollmentId, reason = 'Unenrolled manually') {
  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { id: enrollmentId, workspaceId }, select: { id: true, status: true },
  });
  if (!enrollment) { const e = new Error('Enrollment not found'); e.status = 404; throw e; }
  if (['COMPLETED', 'EXITED'].includes(enrollment.status)) return enrollment;

  return prisma.sequenceEnrollment.update({
    where: { id: enrollmentId },
    data: { status: 'EXITED', exitReason: reason, nextRunAt: null, completedAt: new Date() },
  });
}
