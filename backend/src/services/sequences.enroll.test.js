import test from 'node:test';
import assert from 'node:assert/strict';

// Enrolment without a database: a concurrent enrol of an overlapping set must
// not 500 half-way, blocked numbers match however they are formatted, unknown
// lead ids are reported, and unenroll honours the sequence in the URL.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';

const { prisma } = await import('../lib/prisma.js');
const { enrollContacts, unenroll } = await import('./sequences.service.js');

const contacts = [
  { id: 'c1', name: 'A', optedOut: false, phoneNumber: '+91 98765 00001' },
  { id: 'c2', name: 'B', optedOut: false, phoneNumber: '+919876500002' },
  { id: 'c3', name: 'C', optedOut: false, phoneNumber: '+919876500003' },
];
let createCall = null;
let raceWinner = null;

prisma.sequence.findFirst = async () => ({ id: 'seq_1', status: 'PUBLISHED', steps: [{ kind: 'MESSAGE', body: 'x' }] });
prisma.lead.findMany = async ({ where }) => [{ id: 'l1', contactId: 'c1' }].filter((l) => where.id.in.includes(l.id));
prisma.contact.findMany = async ({ where }) => contacts.filter((c) => where.id.in.includes(c.id));
prisma.sequenceEnrollment.findMany = async () => [];
prisma.optOut.findMany = async ({ where }) => {
  assert.equal(where.active, true, 'only active opt-outs block');
  return [{ phoneNumber: '919876500002' }];
};
prisma.sequenceEnrollment.createManyAndReturn = async (args) => {
  createCall = args;
  return args.data.filter((d) => d.contactId !== raceWinner).map((d) => ({ id: `e_${d.contactId}`, contactId: d.contactId }));
};

test('enrolment is one skip-duplicates insert, and a row lost to a concurrent enrol is reported', async () => {
  raceWinner = 'c3';
  const result = await enrollContacts('ws_1', 'seq_1', { contactIds: ['c1', 'c2', 'c3'] });
  assert.equal(createCall.skipDuplicates, true);
  assert.deepEqual(createCall.data.map((d) => d.contactId), ['c1', 'c3']);
  assert.equal(result.enrolled, 1);
  assert.deepEqual(result.enrollmentIds, ['e_c1']);
  const reasons = Object.fromEntries(result.skipped.map((s) => [s.contactId, s.reason]));
  assert.equal(reasons.c2, 'Number is blocked', 'a "+"-formatted number must match the digits-only OptOut row');
  assert.equal(reasons.c3, 'Already in this sequence');
});

test('lead ids that are not in the workspace are reported, not silently dropped', async () => {
  raceWinner = null;
  const result = await enrollContacts('ws_1', 'seq_1', { leadIds: ['l1', 'l_foreign'] });
  assert.equal(result.enrolled, 1);
  assert.ok(result.skipped.some((s) => s.leadId === 'l_foreign' && /not found/.test(s.reason)));
  assert.equal(createCall.data[0].leadId, 'l1');
});

test('unenroll only finds the enrollment inside the sequence named in the URL', async () => {
  let where = null;
  prisma.sequenceEnrollment.findFirst = async (args) => { where = args.where; return null; };
  await assert.rejects(() => unenroll('ws_1', 'e_1', undefined, { sequenceId: 'seq_other' }), (e) => e.status === 404);
  assert.deepEqual(where, { id: 'e_1', workspaceId: 'ws_1', sequenceId: 'seq_other' });
});
