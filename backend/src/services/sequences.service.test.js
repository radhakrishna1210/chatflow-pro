import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { validateSteps, advanceEnrollment, nextPermittedTime, findDueEnrollments } from './sequenceEngine.service.js';
import {
  createSequence, changeSequenceStatus, enrollContacts, unenroll, deleteSequence, updateSequence,
} from './sequences.service.js';

// ─── Step validation (pure) ────────────────────────────────────────────────

test('a sequence must have at least one step', () => {
  assert.throws(() => validateSteps([]), (e) => e.status === 400);
  assert.throws(() => validateSteps(null), (e) => e.status === 400);
});

test('each step kind is normalised and junk is refused', () => {
  const steps = validateSteps([
    { kind: 'MESSAGE', body: '  Hello  ', extra: 'ignored' },
    { kind: 'WAIT', minutes: '120' },
    { kind: 'TASK', title: 'Call them', dueInDays: 2 },
    { kind: 'UPDATE_FIELD', status: 'contacted' },
    { kind: 'EXIT' },
  ]);

  assert.deepEqual(steps[0], { kind: 'MESSAGE', body: 'Hello' });
  assert.deepEqual(steps[1], { kind: 'WAIT', minutes: 120 });
  assert.equal(steps[2].title, 'Call them');
  assert.equal(steps[3].status, 'CONTACTED');
  assert.equal(steps[4].kind, 'EXIT');
});

test('an empty message body is refused, naming the step', () => {
  assert.throws(
    () => validateSteps([{ kind: 'WAIT', minutes: 5 }, { kind: 'MESSAGE', body: '   ' }]),
    (e) => e.status === 400 && /Step 2/.test(e.message),
  );
});

test('a wait must be positive and bounded', () => {
  assert.throws(() => validateSteps([{ kind: 'WAIT', minutes: 0 }]), (e) => e.status === 400);
  assert.throws(() => validateSteps([{ kind: 'WAIT', minutes: -30 }]), (e) => e.status === 400);
  // 91 days exceeds the cap.
  assert.throws(() => validateSteps([{ kind: 'WAIT', minutes: 91 * 24 * 60 }]), (e) => e.status === 400);
});

test('a field-update step can only set an allowed lead status', () => {
  assert.throws(() => validateSteps([{ kind: 'UPDATE_FIELD', status: 'CONVERTED' }]), (e) => e.status === 400);
  assert.throws(() => validateSteps([{ kind: 'UPDATE_FIELD', status: 'whatever' }]), (e) => e.status === 400);
});

test('unknown step kinds are refused', () => {
  assert.throws(() => validateSteps([{ kind: 'DELETE_EVERYTHING' }]), (e) => e.status === 400);
});

test('business hours defer rather than skip', () => {
  // Closed all week.
  const closed = { tz: 'UTC', days: Array.from({ length: 7 }, (_, day) => ({ day, enabled: false })) };
  assert.equal(nextPermittedTime(closed, new Date('2026-08-17T10:00:00Z')), null);

  // Open Mondays 09:00–17:00 only.
  const monday = {
    tz: 'UTC',
    days: Array.from({ length: 7 }, (_, day) => ({ day, enabled: day === 1, start: '09:00', end: '17:00' })),
  };
  // Monday 03:00 UTC is before opening — must defer to later that morning.
  const deferred = nextPermittedTime(monday, new Date('2026-08-17T03:00:00Z'));
  assert.ok(deferred instanceof Date);
  assert.ok(deferred.getTime() > new Date('2026-08-17T03:00:00Z').getTime());

  // No config at all means always open.
  assert.equal(nextPermittedTime(null, new Date()), null);
});

// ─── Engine and enrolment (database) ───────────────────────────────────────

let dbAvailable = false;
let workspaceId;
let contactId;
let optedOutContactId;
let sequenceId;

const steps = [
  { kind: 'MESSAGE', body: 'First touch' },
  { kind: 'WAIT', minutes: 60 },
  { kind: 'TASK', title: 'Follow up by phone', dueInDays: 1 },
  { kind: 'MESSAGE', body: 'Second touch' },
];

test.before(async () => {
  try { await prisma.$connect(); dbAvailable = true; } catch { return; }
  const stamp = Date.now();
  workspaceId = (await prisma.workspace.create({ data: { name: `test-seq-${stamp}` } })).id;
  contactId = (await prisma.contact.create({
    data: { workspaceId, name: 'Prospect', phoneNumber: `+9133${stamp.toString().slice(-8)}` },
  })).id;
  optedOutContactId = (await prisma.contact.create({
    data: { workspaceId, name: 'Opted Out', phoneNumber: `+9134${stamp.toString().slice(-8)}`, optedOut: true },
  })).id;
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

test('a draft sequence cannot enrol anyone', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const seq = await createSequence(workspaceId, { name: 'Onboarding', steps }, null);
  sequenceId = seq.id;
  assert.equal(seq.status, 'DRAFT');

  await assert.rejects(
    () => enrollContacts(workspaceId, sequenceId, { contactIds: [contactId] }),
    (e) => e.status === 409,
  );
});

test('status moves follow the lifecycle', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const published = await changeSequenceStatus(workspaceId, sequenceId, 'PUBLISHED');
  assert.equal(published.status, 'PUBLISHED');

  // Published cannot go back to draft — people are already in it.
  await assert.rejects(() => changeSequenceStatus(workspaceId, sequenceId, 'DRAFT'), (e) => e.status === 409);
});

test('opted-out contacts are skipped with a stated reason', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const result = await enrollContacts(workspaceId, sequenceId, {
    contactIds: [contactId, optedOutContactId],
  });

  assert.equal(result.enrolled, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, 'Opted out');
});

test('the same contact cannot be enrolled twice', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const again = await enrollContacts(workspaceId, sequenceId, { contactIds: [contactId] });
  assert.equal(again.enrolled, 0);
  assert.equal(again.skipped[0].reason, 'Already in this sequence');
});

test('steps run in order, and a wait parks the enrollment', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const enrollment = await prisma.sequenceEnrollment.findFirst({ where: { sequenceId, contactId } });
  const sent = [];
  const send = async ({ body }) => { sent.push(body); return 'delivered'; };

  // Step 0: message
  let r = await advanceEnrollment(enrollment.id, { send });
  assert.equal(r.status, 'ACTIVE');
  assert.deepEqual(sent, ['First touch']);

  // Step 1: wait — parks with a future nextRunAt
  r = await advanceEnrollment(enrollment.id, { send });
  assert.equal(r.status, 'WAITING');
  assert.ok(r.nextRunAt.getTime() > Date.now());

  // Not due yet, so the sweep must not pick it up.
  const due = await findDueEnrollments({ now: new Date() });
  assert.ok(!due.some((d) => d.id === enrollment.id), 'a parked enrollment must not be due early');
});

test('a task step creates a real task linked to the contact', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const enrollment = await prisma.sequenceEnrollment.findFirst({ where: { sequenceId, contactId } });
  // Pretend the wait elapsed.
  await prisma.sequenceEnrollment.update({ where: { id: enrollment.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });

  const r = await advanceEnrollment(enrollment.id, { send: async () => 'ok' });
  assert.equal(r.status, 'ACTIVE');

  const task = await prisma.task.findFirst({ where: { workspaceId, contactId, title: 'Follow up by phone' } });
  assert.ok(task, 'the task step should have created a task');
  assert.ok(task.dueDate instanceof Date);
});

test('a reply exits the sequence before the next message goes out', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const enrollment = await prisma.sequenceEnrollment.findFirst({ where: { sequenceId, contactId } });

  // The contact replies.
  const conversation = await prisma.conversation.create({ data: { workspaceId, contactId } });
  await prisma.message.create({
    data: { conversationId: conversation.id, body: 'Yes, interested', direction: 'INBOUND', sentAt: new Date() },
  });

  const sent = [];
  const r = await advanceEnrollment(enrollment.id, { send: async ({ body }) => { sent.push(body); return 'ok'; } });

  assert.equal(r.status, 'EXITED');
  assert.equal(r.exitReason, 'Contact replied');
  assert.deepEqual(sent, [], 'no message may be sent after the contact replies');
});

test('opting out mid-sequence stops it at the next step', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await prisma.contact.create({
    data: { workspaceId, name: 'Will Opt Out', phoneNumber: `+9135${Date.now().toString().slice(-8)}` },
  });
  await enrollContacts(workspaceId, sequenceId, { contactIds: [contact.id] });
  const enrollment = await prisma.sequenceEnrollment.findFirst({ where: { sequenceId, contactId: contact.id } });

  await prisma.contact.update({ where: { id: contact.id }, data: { optedOut: true } });

  const sent = [];
  const r = await advanceEnrollment(enrollment.id, { send: async ({ body }) => { sent.push(body); return 'ok'; } });

  assert.equal(r.status, 'EXITED');
  assert.equal(r.exitReason, 'Contact opted out');
  assert.deepEqual(sent, [], 'an opted-out contact must never be messaged');
});

test('a paused sequence holds its enrollments instead of exiting them', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await prisma.contact.create({
    data: { workspaceId, name: 'Paused Person', phoneNumber: `+9136${Date.now().toString().slice(-8)}` },
  });
  await enrollContacts(workspaceId, sequenceId, { contactIds: [contact.id] });
  const enrollment = await prisma.sequenceEnrollment.findFirst({ where: { sequenceId, contactId: contact.id } });

  await changeSequenceStatus(workspaceId, sequenceId, 'PAUSED');

  const r = await advanceEnrollment(enrollment.id, { send: async () => 'ok' });
  assert.equal(r.status, 'HELD');

  const after = await prisma.sequenceEnrollment.findUnique({ where: { id: enrollment.id }, select: { status: true } });
  assert.equal(after.status, 'ACTIVE', 'a paused sequence must not terminate its enrollments');

  await changeSequenceStatus(workspaceId, sequenceId, 'PUBLISHED');
});

test('editing a published sequence does not move contacts already in it', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { sequenceId, status: { in: ['ACTIVE', 'WAITING'] } },
  });
  const before = JSON.stringify(enrollment.steps);

  await updateSequence(workspaceId, sequenceId, {
    steps: [{ kind: 'MESSAGE', body: 'Completely different cadence' }],
  });

  const after = await prisma.sequenceEnrollment.findUnique({ where: { id: enrollment.id }, select: { steps: true } });
  assert.equal(JSON.stringify(after.steps), before, 'an in-flight enrollment must keep its snapshot');
});

test('unenrolling stops an active enrollment', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { sequenceId, status: { in: ['ACTIVE', 'WAITING'] } },
  });
  const result = await unenroll(workspaceId, enrollment.id);
  assert.equal(result.status, 'EXITED');
  assert.match(result.exitReason, /Unenrolled/);
});

test('a sequence with people still in it cannot be deleted', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await prisma.contact.create({
    data: { workspaceId, name: 'Still Running', phoneNumber: `+9137${Date.now().toString().slice(-8)}` },
  });
  await enrollContacts(workspaceId, sequenceId, { contactIds: [contact.id] });

  await assert.rejects(
    () => deleteSequence(workspaceId, sequenceId),
    (e) => e.status === 409 && /still in this sequence/.test(e.message),
  );
});
