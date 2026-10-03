import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// CF-162 through the real sequences router and the real record-scope helper
// (recordScope.service.js, the one the lead and deal lists use): under OWN
// visibility a lead the caller cannot see is reported, never enrolled —
// whether it is picked by lead id or reached through its contact.

const state = {};

function reset() {
  state.visibility = 'OWN';
  state.leads = [
    { id: 'l-mine', workspaceId: 'ws1', contactId: 'c-mine', ownerUserId: 'u1' },
    { id: 'l-theirs', workspaceId: 'ws1', contactId: 'c-theirs', ownerUserId: 'u2' },
    { id: 'l-unowned', workspaceId: 'ws1', contactId: 'c-unowned', ownerUserId: null },
    { id: 'l-foreign', workspaceId: 'ws2', contactId: 'c-foreign', ownerUserId: 'u1' },
  ];
  state.contacts = ['c-mine', 'c-theirs', 'c-unowned', 'c-plain'].map((id, i) => ({
    id, workspaceId: 'ws1', name: id, optedOut: false, phoneNumber: `+91980000000${i}`,
  }));
  state.enrollments = [];
}

// Just enough of Prisma's where-clause semantics for the scope fragment:
// equality, { in }, OR and AND.
function matches(row, where = {}) {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'AND') return (Array.isArray(v) ? v : [v]).every((w) => matches(row, w));
    if (k === 'OR') return v.some((w) => matches(row, w));
    if (v && typeof v === 'object' && Array.isArray(v.in)) return v.in.includes(row[k]);
    return row[k] === v;
  });
}

const fakePrisma = {
  workspace: { findUnique: async () => ({ recordVisibility: state.visibility }) },
  teamMember: { findMany: async () => [] },
  sequence: { findFirst: async () => ({ id: 'seq1', workspaceId: 'ws1', status: 'PUBLISHED', steps: [{ kind: 'EXIT' }] }) },
  lead: { findMany: async ({ where }) => state.leads.filter((l) => matches(l, where)) },
  contact: { findMany: async ({ where }) => state.contacts.filter((c) => matches(c, where)) },
  optOut: { findMany: async () => [] },
  sequenceEnrollment: {
    findMany: async () => [],
    createManyAndReturn: async ({ data }) => data.map((d) => {
      const row = { id: `e-${d.contactId}`, ...d };
      state.enrollments.push(row);
      return { id: row.id, contactId: row.contactId };
    }),
  },
};

let baseUrl;
let server;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: fakePrisma } });
  mock.module('../config/env.js', { namedExports: { env: { ADMIN_EMAIL: 'admin@example.test' } } });
  mock.module('../middleware/authenticate.js', {
    namedExports: {
      authenticate: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
      authenticateOptional: (_req, _res, next) => next(),
    },
  });
  mock.module('../middleware/workspaceContext.js', {
    namedExports: {
      workspaceContext: (req, _res, next) => {
        req.user.workspaceId = req.params.workspaceId;
        req.user.role = req.get('x-test-role') || 'CLIENT';
        req.user.workspaceRoleVerified = true;
        next();
      },
    },
  });
  mock.module('../queues/sequence.queue.js', { namedExports: { enqueueAdvance: async () => {} } });

  const { default: express } = await import('express');
  const { default: sequencesRoutes } = await import('./sequences.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/w/:workspaceId/sequences', sequencesRoutes);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}/w/ws1/sequences`;
});

test.after(() => server?.close());
test.beforeEach(reset);

const enroll = (body, role) => fetch(`${baseUrl}/seq1/enroll`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
  body: JSON.stringify(body),
});

const enrolledContacts = () => state.enrollments.map((e) => e.contactId).sort();

test('an OWN-scoped member enrols their own and unowned leads; a colleague\'s lead is reported', async () => {
  const res = await enroll({ leadIds: ['l-mine', 'l-theirs', 'l-unowned', 'l-foreign'] });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.enrolled, 2);
  assert.deepEqual(enrolledContacts(), ['c-mine', 'c-unowned']);
  const skipped = Object.fromEntries(body.skipped.filter((s) => s.leadId).map((s) => [s.leadId, s.reason]));
  // Out of scope and foreign read the same, so the reply cannot map other leads.
  assert.match(skipped['l-theirs'], /not visible to you/);
  assert.equal(skipped['l-theirs'], skipped['l-foreign']);
});

test('picking the contact does not get round the lead scope', async () => {
  const res = await enroll({ contactIds: ['c-theirs', 'c-plain', 'c-mine'] });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.deepEqual(enrolledContacts(), ['c-mine', 'c-plain']);
  assert.ok(body.skipped.some((s) => s.contactId === 'c-theirs' && /not visible/.test(s.reason)));
});

test('nothing is enrolled when every pick is out of scope', async () => {
  const res = await enroll({ leadIds: ['l-theirs'] });
  const body = await res.json();
  assert.equal(body.enrolled, 0);
  assert.equal(state.enrollments.length, 0);
});

test('admins and ALL-visibility workspaces enrol every lead in the workspace', async () => {
  let body = await (await enroll({ leadIds: ['l-mine', 'l-theirs', 'l-unowned'] }, 'ADMIN')).json();
  assert.equal(body.enrolled, 3);

  reset();
  state.visibility = 'ALL';
  body = await (await enroll({ leadIds: ['l-mine', 'l-theirs', 'l-unowned'] })).json();
  assert.equal(body.enrolled, 3);
});

test('viewers cannot enrol at all', async () => {
  const res = await enroll({ leadIds: ['l-mine'] }, 'VIEWER');
  assert.equal(res.status, 403);
  assert.equal(state.enrollments.length, 0);
});
