import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, mockIdentity, startApp } from './crmHttp.testutil.js';

// CF-162, the read side: GET /sequences/:id lists the sequence's enrolments
// under the same record visibility as enrolment itself. Under OWN/TEAM a
// member sees enrolments whose contact has no lead or has a lead they may
// see; a colleague's lead stays hidden whether it was enrolled by lead id or
// by picking its contact.

const store = createStore({
  relations: {
    sequenceEnrollment: { contact: { model: 'contact', from: 'contactId' } },
    contact: { lead: { model: 'lead', to: 'contactId' } },
  },
});
let app;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: store.prisma } });
  mockIdentity(mock, { defaultRole: 'CLIENT' });
  mock.module('../queues/sequence.queue.js', { namedExports: { enqueueAdvance: async () => {} } });
  const { default: sequencesRoutes } = await import('./sequences.routes.js');
  app = await startApp({ '/sequences': sequencesRoutes });
});
test.after(() => app?.server.close());

function seed(visibility) {
  store.reset();
  store.seed('workspace', { id: 'ws1', recordVisibility: visibility });
  store.seed('sequence', { id: 'seq1', workspaceId: 'ws1', name: 'Follow-up', status: 'PUBLISHED', steps: [] });
  store.seed('contact',
    { id: 'c-mine', workspaceId: 'ws1' },
    { id: 'c-theirs', workspaceId: 'ws1' },
    { id: 'c-theirs-direct', workspaceId: 'ws1' },
    { id: 'c-unowned', workspaceId: 'ws1' },
    { id: 'c-plain', workspaceId: 'ws1' });
  store.seed('lead',
    { id: 'l-mine', workspaceId: 'ws1', contactId: 'c-mine', ownerUserId: 'u1' },
    { id: 'l-theirs', workspaceId: 'ws1', contactId: 'c-theirs', ownerUserId: 'u2' },
    { id: 'l-theirs-direct', workspaceId: 'ws1', contactId: 'c-theirs-direct', ownerUserId: 'u2' },
    { id: 'l-unowned', workspaceId: 'ws1', contactId: 'c-unowned', ownerUserId: null });
  store.seed('sequenceEnrollment',
    { id: 'e-mine', workspaceId: 'ws1', sequenceId: 'seq1', contactId: 'c-mine', leadId: 'l-mine' },
    { id: 'e-theirs', workspaceId: 'ws1', sequenceId: 'seq1', contactId: 'c-theirs', leadId: 'l-theirs' },
    // Enrolled by picking the contact: no leadId on the enrolment, but the
    // contact is still a colleague's lead.
    { id: 'e-theirs-direct', workspaceId: 'ws1', sequenceId: 'seq1', contactId: 'c-theirs-direct', leadId: null },
    { id: 'e-unowned', workspaceId: 'ws1', sequenceId: 'seq1', contactId: 'c-unowned', leadId: 'l-unowned' },
    { id: 'e-plain', workspaceId: 'ws1', sequenceId: 'seq1', contactId: 'c-plain', leadId: null },
    // Another sequence's enrolment never shows up here.
    { id: 'e-other', workspaceId: 'ws1', sequenceId: 'seq2', contactId: 'c-mine', leadId: 'l-mine' });
}

async function enrolmentIds(opts) {
  const res = await app.call('GET', '/sequences/seq1', undefined, opts);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.id, 'seq1');
  return body.enrollments.map((e) => e.id).sort();
}

test('an OWN-scoped member sees enrolments for their own, unowned and lead-less contacts only', async () => {
  seed('OWN');
  assert.deepEqual(await enrolmentIds({ user: 'u1' }), ['e-mine', 'e-plain', 'e-unowned']);
  assert.deepEqual(await enrolmentIds({ user: 'u2' }), ['e-plain', 'e-theirs', 'e-theirs-direct', 'e-unowned']);
});

test('an agent or viewer reading the sequence is scoped the same way', async () => {
  seed('OWN');
  assert.deepEqual(await enrolmentIds({ user: 'u1', role: 'VIEWER' }), ['e-mine', 'e-plain', 'e-unowned']);
  assert.deepEqual(await enrolmentIds({ user: 'u1', role: 'AGENT' }), ['e-mine', 'e-plain', 'e-unowned']);
});

test('admins and ALL-visibility workspaces see every enrolment of the sequence', async () => {
  const all = ['e-mine', 'e-plain', 'e-theirs', 'e-theirs-direct', 'e-unowned'];
  seed('OWN');
  assert.deepEqual(await enrolmentIds({ user: 'u1', role: 'ADMIN' }), all);
  seed('ALL');
  assert.deepEqual(await enrolmentIds({ user: 'u1' }), all);
});

test('a sequence from another workspace is still a 404', async () => {
  seed('OWN');
  const res = await app.call('GET', '/sequences/seq1', undefined, { workspace: 'ws2' });
  assert.equal(res.status, 404);
});
