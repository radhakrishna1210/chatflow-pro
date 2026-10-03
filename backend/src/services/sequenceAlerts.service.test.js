import test from 'node:test';
import assert from 'node:assert/strict';

// A failed or paused sequence enrollment tells the workspace, at most once per
// sequence per day (WF-EV-9).
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';

const { prisma } = await import('../lib/prisma.js');
const { notifySequenceProblem, resetSequenceAlerts, SEQUENCE_ALERT_TYPE } = await import('./sequenceAlerts.service.js');

const DAY = 24 * 3_600_000;
let created;
prisma.sequence.findFirst = async () => ({ name: 'Onboarding' });
prisma.notification.create = async ({ data }) => { created.push({ ...data, createdAt: data.createdAt ?? new Date() }); return data; };
prisma.notification.findFirst = async ({ where }) => created.find((n) => n.workspaceId === where.workspaceId
  && n.type === where.type
  && n.meta?.sequenceId === where.meta.equals
  && n.createdAt >= where.createdAt.gte) ?? null;

const enrollment = (sequenceId = 'seq_1', id = 'en_1') => ({ id, workspaceId: 'ws', sequenceId });

test('the first problem notifies the workspace, naming the sequence and the reason', async () => {
  resetSequenceAlerts(); created = [];
  assert.equal(await notifySequenceProblem(enrollment(), 'no_credit', 'Message quota and wallet balance exhausted'), true);
  assert.equal(created.length, 1);
  assert.equal(created[0].type, SEQUENCE_ALERT_TYPE);
  assert.equal(created[0].userId, null);
  assert.equal(created[0].link, 'sequences');
  assert.match(created[0].title, /"Onboarding" needs attention/);
  assert.match(created[0].body, /paused.*wallet/);
  assert.deepEqual(created[0].meta, { sequenceId: 'seq_1', enrollmentId: 'en_1', kind: 'no_credit' });
});

test('a whole cohort hitting the same wall is one notification per sequence per day', async () => {
  resetSequenceAlerts(); created = [];
  const now = new Date();
  for (let i = 0; i < 20; i += 1) await notifySequenceProblem(enrollment('seq_1', `en_${i}`), 'failed', 'Meta rejected it', { now });
  await notifySequenceProblem(enrollment('seq_2'), 'window', '', { now });
  assert.deepEqual(created.map((n) => n.meta.sequenceId), ['seq_1', 'seq_2']);

  // Another process (empty memory) still sees today's notification.
  resetSequenceAlerts();
  assert.equal(await notifySequenceProblem(enrollment('seq_1'), 'failed', '', { now: new Date(now.getTime() + 3_600_000) }), false);

  // A day later it may notify again.
  assert.equal(await notifySequenceProblem(enrollment('seq_1'), 'failed', '', { now: new Date(now.getTime() + DAY + 1000) }), true);
});

test('a notification that could not be written does not use up the day', async () => {
  resetSequenceAlerts(); created = [];
  const realCreate = prisma.notification.create;
  prisma.notification.create = async () => { throw new Error('db down'); };
  try {
    assert.equal(await notifySequenceProblem(enrollment('seq_3'), 'failed'), false);
  } finally {
    prisma.notification.create = realCreate;
  }
  assert.equal(await notifySequenceProblem(enrollment('seq_3'), 'failed'), true);
});
