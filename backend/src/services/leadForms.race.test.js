import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Concurrent public submissions of the same phone number: whichever request
// loses the unique-constraint race must still get the normal success payload,
// not a 500. Runs against an in-memory prisma stand-in.

const FORM = {
  id: 'f1', workspaceId: 'ws1', slug: 'demo', isActive: true, successMessage: 'Thanks',
  consentText: null, source: null, ownerUserId: null, name: 'Demo',
  fields: [{ key: 'phone', label: 'Phone', type: 'phone', required: true }],
};

const p2002 = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

let contactRows;
let contactCreateFails;
let leadCreateFails;
let submissions;
let distributed;
let unproductiveCount;
let leadLookups;

const fakePrisma = {
  leadForm: { findFirst: async () => FORM },
  contact: {
    findFirst: async () => contactRows.shift() ?? null,
    create: async ({ data }) => {
      if (contactCreateFails) throw p2002();
      return { id: 'c-new', ...data };
    },
  },
  lead: {
    // Before the create nothing exists; after a lost race the winner does.
    findUnique: async () => (leadCreateFails && ++leadLookups > 1 ? { id: 'l-winner' } : null),
    create: async () => {
      if (leadCreateFails) throw p2002();
      return { id: 'l-new' };
    },
  },
  leadFormSubmission: {
    create: async ({ data }) => { submissions.push(data); return data; },
    count: async () => unproductiveCount,
  },
};

let submitForm;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: fakePrisma } });
  mock.module('./contacts.service.js', {
    namedExports: {
      isValidPhone: (v) => /^\+?\d{7,15}$/.test(String(v).replace(/[\s-]/g, '')),
      normalizePhone: (v) => String(v).replace(/[^\d+]/g, ''),
    },
  });
  mock.module('./leadScoring.service.js', {
    namedExports: { computeLeadScore: async () => ({ score: 10, factors: [], computedAt: new Date() }) },
  });
  mock.module('./leadSegmentation.service.js', { namedExports: { computeLeadCategory: async () => ({}) } });
  mock.module('./workflowCrm.service.js', { namedExports: { emitCrmEvent: () => {} } });
  mock.module('./leadDistribution.service.js', {
    namedExports: { evaluateAndAssignLead: async (_ws, leadId) => { distributed.push(leadId); return { assigned: false }; } },
  });
  ({ submitForm } = await import('./leadForms.service.js'));
});

test.beforeEach(() => {
  contactRows = [];
  contactCreateFails = false;
  leadCreateFails = false;
  submissions = [];
  distributed = [];
  unproductiveCount = 0;
  leadLookups = 0;
});

test('a contact unique-constraint race re-reads the winner instead of failing', async () => {
  contactCreateFails = true;
  // First lookup: no contact yet. After the failed create: the winner's row.
  contactRows = [null, { id: 'c-winner', optedOut: false }];
  const res = await submitForm('ws1', 'demo', { answers: { phone: '+919999999999' } });
  assert.deepEqual(res, { ok: true, message: 'Thanks' });
  assert.equal(submissions.at(-1).outcome, 'CREATED');
  assert.equal(submissions.at(-1).contactId, 'c-winner');
});

test('a lead unique-constraint race is recorded as a duplicate, not a 500', async () => {
  leadCreateFails = true;
  const res = await submitForm('ws1', 'demo', { answers: { phone: '+919999999999' } });
  assert.deepEqual(res, { ok: true, message: 'Thanks' });
  assert.equal(submissions.at(-1).outcome, 'DUPLICATE');
  assert.equal(submissions.at(-1).leadId, 'l-winner');
});

test('web-form leads without a form owner go through distribution', async () => {
  await submitForm('ws1', 'demo', { answers: { phone: '+919999999999' } });
  assert.deepEqual(distributed, ['l-new']);
});

test('honeypot hits stop being stored once the hourly cap is reached', async () => {
  unproductiveCount = 10_000;
  const res = await submitForm('ws1', 'demo', { _hp: 'bot', answers: {} });
  assert.deepEqual(res, { ok: true, message: 'Thanks' });
  assert.equal(submissions.length, 0);
});
