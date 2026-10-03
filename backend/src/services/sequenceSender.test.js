import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Sequence sends go through the shared, metered automated-reply path, and a
// send that does not happen is recorded as a FAILED step — never as a
// DELIVERED message. Also covers the per-step claim
// that keeps two jobs from running the same step.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';

let outcome = { ok: true, message: { id: 'm1', metaMessageId: 'wamid.1' } };
const delivered = [];
mock.module('./outbound.service.js', {
  namedExports: {
    deliverAutomatedReply: async (args) => { delivered.push(args); return outcome; },
  },
});
let blocked = false;
mock.module('./optout.service.js', { namedExports: { isOptedOut: async () => blocked } });
mock.module('./sequenceAlerts.service.js', { namedExports: { notifySequenceProblem: async () => true } });

const { prisma } = await import('../lib/prisma.js');
const { sendSequenceMessage } = await import('./sequenceSender.js');
const { advanceEnrollment } = await import('./sequenceEngine.service.js');

let conversation = { id: 'conv_1', waNumberId: 'wa_1' };
prisma.contact.findUnique = async () => ({ id: 'ct_1', phoneNumber: '+911234567890', optedOut: false });
prisma.contact.findFirst = async () => ({ optedOut: false, phoneNumber: '+911234567890' });
prisma.conversation.findFirst = async () => conversation;
prisma.sequence.findFirst = async () => ({ status: 'PUBLISHED', exitOnReply: false });
prisma.message.findFirst = async () => null;

const stepRuns = [];
prisma.sequenceStepRun.create = async ({ data }) => { stepRuns.push(data); return data; };
prisma.sequenceStepRun.findFirst = async () => null;

let row;
const matches = (where) => {
  if (where.id !== row.id) return false;
  if (where.cursor !== undefined && where.cursor !== row.cursor) return false;
  if (where.status?.in && !where.status.in.includes(row.status)) return false;
  if (where.OR && !(row.nextRunAt === null || row.nextRunAt <= where.OR[1].nextRunAt.lte)) return false;
  return true;
};
prisma.sequenceEnrollment.findUnique = async () => ({ ...row, sequence: { status: 'PUBLISHED', respectBusinessHours: false } });
prisma.sequenceEnrollment.updateMany = async ({ where, data }) => {
  if (!matches(where)) return { count: 0 };
  Object.assign(row, data);
  return { count: 1 };
};
prisma.sequenceEnrollment.update = async ({ data }) => Object.assign(row, data);

const enrollment = { id: 'enr_1', workspaceId: 'ws_1', contactId: 'ct_1', sequenceId: 'seq_1', enrolledAt: new Date(0) };
function reset(steps = [{ kind: 'MESSAGE', body: 'Hi there' }, { kind: 'EXIT', reason: 'done' }]) {
  row = { ...enrollment, status: 'ACTIVE', cursor: 0, nextRunAt: new Date(Date.now() - 1000), steps };
  stepRuns.length = 0; delivered.length = 0;
  outcome = { ok: true, message: { id: 'm1', metaMessageId: 'wamid.1' } };
  conversation = { id: 'conv_1', waNumberId: 'wa_1' };
  blocked = false;
}

test('a sequence message is sent through the metered automated-reply path', async () => {
  reset();
  const detail = await sendSequenceMessage({ enrollment, body: 'Hi there' });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].recordFailure, true, 'a Meta rejection must leave a FAILED message row');
  assert.equal(delivered[0].conversationId, 'conv_1');
  assert.match(detail, /wamid\.1/);
});

test('a contact who never wrote in is refused rather than messaged outside the window', async () => {
  reset();
  conversation = null;
  await assert.rejects(() => sendSequenceMessage({ enrollment, body: 'Hi' }), /template/);
  assert.equal(delivered.length, 0);
});

test('a failed send fails the step and the enrollment — never SENT/DELIVERED', async () => {
  reset();
  outcome = { ok: false, code: 'META_REJECTED', detail: 'Undeliverable' };
  const r = await advanceEnrollment('enr_1', { send: sendSequenceMessage });
  assert.equal(r.status, 'FAILED');
  assert.equal(stepRuns.at(-1).outcome, 'FAILED');
  assert.match(stepRuns.at(-1).detail, /Undeliverable/);
  assert.equal(row.status, 'FAILED');
});

test('exhausted credit pauses the enrollment on that step instead of failing it', async () => {
  reset();
  outcome = { ok: false, code: 'NO_CREDIT', detail: 'Message quota and wallet balance exhausted' };
  const r = await advanceEnrollment('enr_1', { send: sendSequenceMessage });
  assert.equal(r.status, 'WAITING');
  assert.equal(row.status, 'WAITING');
  assert.equal(row.cursor, 0);
  assert.equal(stepRuns.at(-1).outcome, 'DEFERRED');
  assert.match(stepRuns.at(-1).detail, /NO_CREDIT/);
});

test('a closed window fails the step with the reason and moves on', async () => {
  reset();
  outcome = { ok: false, code: 'WINDOW_CLOSED', detail: 'The 24-hour customer service window is closed' };
  const r = await advanceEnrollment('enr_1', { send: sendSequenceMessage });
  assert.equal(r.status, 'ACTIVE');
  assert.equal(row.cursor, 1);
  assert.equal(stepRuns.at(-1).outcome, 'FAILED');
  assert.match(stepRuns.at(-1).detail, /WINDOW_CLOSED/);
});

test('a successful send records SENT and moves the cursor', async () => {
  reset();
  const r = await advanceEnrollment('enr_1', { send: sendSequenceMessage });
  assert.equal(r.status, 'ACTIVE');
  assert.equal(row.cursor, 1);
  assert.equal(stepRuns.at(-1).outcome, 'SENT');
});

test('a blocked number (OptOut table) exits before anything is sent', async () => {
  reset();
  blocked = true;
  const r = await advanceEnrollment('enr_1', { send: sendSequenceMessage });
  assert.equal(r.status, 'EXITED');
  assert.equal(delivered.length, 0);
});

test('a step claimed by another job is not run twice', async () => {
  reset();
  // Another job claimed step 0 between our read and our claim.
  const realFind = prisma.sequenceEnrollment.findUnique;
  prisma.sequenceEnrollment.findUnique = async () => {
    const snapshot = await realFind();
    row.cursor = 1;
    row.nextRunAt = new Date(Date.now() + 600_000);
    return snapshot;
  };
  try {
    const r = await advanceEnrollment('enr_1', { send: sendSequenceMessage });
    assert.equal(r.status, 'BUSY');
    assert.equal(delivered.length, 0, 'the losing job must not send');
  } finally {
    prisma.sequenceEnrollment.findUnique = realFind;
  }
});

test('an enrollment that is not due yet is left alone', async () => {
  reset();
  row.status = 'WAITING';
  row.nextRunAt = new Date(Date.now() + 60_000);
  const r = await advanceEnrollment('enr_1', { send: sendSequenceMessage });
  assert.equal(r.status, 'NOT_DUE');
  assert.equal(delivered.length, 0);
  assert.equal(row.cursor, 0);
});
