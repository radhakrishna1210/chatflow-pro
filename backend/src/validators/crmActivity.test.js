import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crmActivitySchemas } from './index.js';

// The Engagements screen posts engagementType/status/duration/notes and the
// lead touchpoint modal posts outcome/sentiment. z.object() strips undeclared
// keys, so these used to vanish before createActivity could read them.
test('crmActivity.create keeps the structured engagement fields', () => {
  const parsed = crmActivitySchemas.create.parse({
    type: 'MEETING',
    content: 'Visited the showroom',
    engagementType: 'Visit',
    status: 'Scheduled',
    duration: 30,
    notes: 'Visited the showroom',
    outcome: 'Demo scheduled',
    sentiment: 'POSITIVE',
  });
  assert.equal(parsed.engagementType, 'Visit');
  assert.equal(parsed.status, 'Scheduled');
  assert.equal(parsed.duration, 30);
  assert.equal(parsed.notes, 'Visited the showroom');
  assert.equal(parsed.outcome, 'Demo scheduled');
  assert.equal(parsed.sentiment, 'POSITIVE');
});

test('crmActivity.create accepts a MM:SS duration and still rejects junk', () => {
  assert.equal(crmActivitySchemas.create.parse({ content: 'x', duration: '02:30' }).duration, '02:30');
  assert.throws(() => crmActivitySchemas.create.parse({ content: 'x', engagementType: 'Telepathy' }));
  assert.throws(() => crmActivitySchemas.create.parse({ content: 'x', status: 'Whatever' }));
});
