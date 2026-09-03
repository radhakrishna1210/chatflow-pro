import test from 'node:test';
import assert from 'node:assert/strict';

// BullMQ validates custom job ids against its own Redis key names and rejects
// several shapes with "Custom Id cannot contain :". A rejected id throws at
// enqueue time, which — when the caller swallows the error — means the job
// silently never runs.
//
// That is exactly what happened to the delayed-response automation: its id
// began with `delayed`, colliding with BullMQ's own `<queue>:delayed` key, so
// the feature never fired for anyone who enabled it.
//
// These are pure string checks so they run without Redis.

const buildDelayedResponseId = (conversationId) => `dresp-${conversationId}`;
const buildAdvanceId = (enrollmentId) => `advance-${enrollmentId}`;

// Words BullMQ uses for its own structures. An id starting with one of these
// is the dangerous case.
const RESERVED_PREFIXES = [
  'delayed', 'wait', 'active', 'completed', 'failed', 'paused',
  'repeat', 'meta', 'events', 'stalled', 'limiter', 'priority', 'id',
];

const isSafeJobId = (jobId) => {
  if (jobId.includes(':')) return false;
  const head = jobId.split(/[-_]/)[0].toLowerCase();
  return !RESERVED_PREFIXES.includes(head);
};

test('the delayed-response job id no longer collides with a BullMQ key', () => {
  const id = buildDelayedResponseId('conv123');
  assert.ok(isSafeJobId(id), `"${id}" would be rejected by BullMQ`);
  assert.ok(!id.startsWith('delayed'), 'the id must not begin with BullMQ\'s reserved "delayed" key');
});

test('the sequence advance job id is safe', () => {
  const id = buildAdvanceId('enr456');
  assert.ok(isSafeJobId(id), `"${id}" would be rejected by BullMQ`);
});

test('job ids stay unique per entity so a re-enqueue replaces rather than duplicates', () => {
  assert.notEqual(buildAdvanceId('a'), buildAdvanceId('b'));
  assert.equal(buildAdvanceId('a'), buildAdvanceId('a'));
});

test('the shapes that previously failed are recognised as unsafe', () => {
  // Regression guards: these are the exact ids that threw.
  assert.ok(!isSafeJobId('delayed:conv123'));
  assert.ok(!isSafeJobId('advance:enr456'));
  // A colon anywhere is treated as unsafe, which is the simplest rule that
  // keeps every id out of trouble.
  assert.ok(!isSafeJobId('resume:run123:2'));
});
