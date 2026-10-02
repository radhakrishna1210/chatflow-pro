import test from 'node:test';
import assert from 'node:assert/strict';
import { Job } from 'bullmq';
import {
  workflowResumeJobId,
  delayedResponseJobId,
  replyReminderJobId,
  sequenceAdvanceJobId,
  sequenceFollowUpJobId,
  retryJobId,
} from './jobIds.js';

// A rejected custom id throws at enqueue time, which — when the caller
// swallows the error — means the job silently never runs. These tests run the
// real builders through BullMQ's own validator (no Redis needed: the check is
// synchronous and only reads the options), and additionally refuse any colon,
// which BullMQ currently tolerates only through a legacy exception it has
// marked for removal.

const stubQueue = { opts: {}, client: Promise.resolve(), toKey: (k) => k, keys: {} };

function bullmqAccepts(jobId) {
  new Job(stubQueue, 'probe', {}, { jobId }).validateOptions({ data: '{}' });
  return true;
}

const ALL_IDS = {
  workflowResume: workflowResumeJobId('run_1', 3),
  delayedResponse: delayedResponseJobId('conv_1'),
  replyReminder: replyReminderJobId('run_1', 4),
  sequenceAdvance: sequenceAdvanceJobId('enr_1'),
  sequenceFollowUp: sequenceFollowUpJobId('enr_1', 1_700_000_000_000),
  retry: retryJobId('rcp_1', 2),
};

for (const [name, id] of Object.entries(ALL_IDS)) {
  test(`${name} job id is accepted by BullMQ and has no colon`, () => {
    assert.ok(bullmqAccepts(id));
    assert.ok(!id.includes(':'), `"${id}" relies on BullMQ's legacy colon exception`);
    assert.notEqual(`${parseInt(id, 10)}`, id);
  });
}

test('the validator really rejects the shapes that used to break enqueueing', () => {
  assert.throws(() => bullmqAccepts('delayed:conv123'), /cannot contain/);
  assert.throws(() => bullmqAccepts('12345'), /integers/);
});

test('ids are deterministic per entity so a re-enqueue replaces rather than duplicates', () => {
  assert.equal(sequenceAdvanceJobId('a'), sequenceAdvanceJobId('a'));
  assert.notEqual(sequenceAdvanceJobId('a'), sequenceAdvanceJobId('b'));
  assert.equal(workflowResumeJobId('r', 1), workflowResumeJobId('r', 1));
  assert.notEqual(workflowResumeJobId('r', 1), workflowResumeJobId('r', 2));
  assert.notEqual(retryJobId('x', 1), retryJobId('x', 2));
});

test('a sequence follow-up never reuses the id of the advance job that schedules it', () => {
  assert.notEqual(sequenceFollowUpJobId('enr_1', Date.now()), sequenceAdvanceJobId('enr_1'));
  assert.notEqual(sequenceFollowUpJobId('enr_1', 1000), sequenceFollowUpJobId('enr_1', 2000));
});
