import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { unscopedRecordScope } from '../services/recordScope.testStub.js';

// CF-154 through the real leads router: lifecycle, lead sources, lead tags and
// prospecting rules from Customize Your Business are enforced on create, edit
// and bulk edit, not just shown in the UI.

const state = {};

function reset() {
  state.sections = {
    lead_lifecycle: { stages: [{ key: 'NEW', label: 'New Lead', isDefault: true }, { key: 'QUALIFIED', label: 'Qualified' }, { key: 'DEMO_BOOKED', label: 'Demo Booked' }] },
    lead_sources: { sources: [{ key: 'WEBSITE', name: 'Website Form', isActive: true }, { key: 'EVENT', name: 'Conference', isActive: false }, { key: 'OTHER', name: 'Other', isActive: true }] },
    lead_tags: { tags: [{ name: 'High Value' }, { name: 'Enterprise' }] },
    prospecting_criteria: { requirePhone: true, requireEmail: false, requireCompany: false },
  };
  state.contacts = [];
  state.leads = [];
}

const matches = (row, where) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && Array.isArray(v.in)) return v.in.includes(row[k]);
  return row[k] === v;
});

const fakePrisma = {
  workspace: { findUnique: async () => ({ defaultPhoneCountry: 'IN' }) },
  savedView: {
    findFirst: async ({ where }) => {
      const key = where.name?.replace(/^__CRM_CUSTOMIZATION_|__$/g, '').toLowerCase();
      return state.sections[key] ? { filters: state.sections[key] } : null;
    },
  },
  contact: {
    findMany: async ({ where }) => state.contacts.filter((c) => matches(c, where)),
    findFirst: async ({ where }) => state.contacts.find((c) => matches(c, where)) ?? null,
    create: async ({ data }) => { const row = { id: `c${state.contacts.length + 1}`, optedOut: false, ...data }; state.contacts.push(row); return row; },
    update: async ({ where, data }) => Object.assign(state.contacts.find((c) => c.id === where.id), data),
  },
  lead: {
    findUnique: async ({ where }) => state.leads.find((l) => l.contactId === where.contactId) ?? null,
    findFirst: async ({ where }) => state.leads.find((l) => l.id === where.id && l.workspaceId === where.workspaceId) ?? null,
    create: async ({ data }) => {
      const row = { id: `l${state.leads.length + 1}`, ...data };
      state.leads.push(row);
      return { ...row, contact: state.contacts.find((c) => c.id === data.contactId) };
    },
    update: async ({ where, data }) => {
      const row = Object.assign(state.leads.find((l) => l.id === where.id), data);
      return { ...row, contact: state.contacts.find((c) => c.id === row.contactId) };
    },
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
  mock.module('../services/recordScope.service.js', { namedExports: unscopedRecordScope });
  mock.module('../services/workflowCrm.service.js', { namedExports: { emitCrmEvent: () => {} } });
  mock.module('../services/leadScoring.service.js', {
    namedExports: { computeLeadScore: async () => ({ score: 10, factors: [], computedAt: new Date() }) },
  });
  mock.module('../services/leadSegmentation.service.js', { namedExports: { computeLeadCategory: async () => ({}) } });
  mock.module('../services/leadDistribution.service.js', { namedExports: { evaluateAndAssignLead: async () => ({ assigned: false }) } });
  mock.module('../services/gamification.service.js', {
    namedExports: { awardXp: async () => {}, unlockAchievement: async () => {}, earnsQualifiedLead: () => false },
  });
  mock.module('../services/subscription.service.js', {
    namedExports: { assertContactCapacity: async () => {}, assertWithinLimit: async () => {}, hasContactCapacity: async () => true },
  });

  const { default: express } = await import('express');
  const { default: leadsRoutes } = await import('./leads.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/w/:workspaceId/leads', leadsRoutes);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}/w/ws1/leads`;
});

test.after(() => server?.close());
test.beforeEach(reset);

const send = (method, path, body, role) => fetch(`${baseUrl}${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
  body: JSON.stringify(body),
});

test('a lead is created with the canonical source key, configured tags and lifecycle stage', async () => {
  const res = await send('POST', '', {
    name: 'Asha', phoneNumber: '9876543210', source: 'website form', tags: ['high value'], status: 'Demo Booked',
  });
  assert.equal(res.status, 201);
  const [lead] = state.leads;
  assert.equal(lead.source, 'WEBSITE');
  assert.equal(lead.status, 'NEW');
  assert.equal(lead.customFields.statusKey, 'DEMO_BOOKED');
  assert.deepEqual(state.contacts[0].tags, ['High Value']);
  assert.equal(state.contacts[0].phoneNumber, '+919876543210');
});

test('the default lifecycle stage is used when no status is given', async () => {
  state.sections.lead_lifecycle.stages = [{ key: 'DEMO_BOOKED', label: 'Demo', isDefault: true }, { key: 'NEW', label: 'New' }];
  await send('POST', '', { phoneNumber: '9876543210' });
  assert.equal(state.leads[0].customFields.statusKey, 'DEMO_BOOKED');
});

for (const [name, body, pattern] of [
  ['an unknown source', { source: 'Billboard' }, /Invalid lead source/],
  ['a disabled source', { source: 'EVENT' }, /disabled/],
  ['an unconfigured tag', { tags: ['Whale'] }, /Unknown lead tag/],
  ['a status outside the lifecycle', { status: 'NURTURING' }, /lead lifecycle/],
]) {
  test(`creating a lead with ${name} is a 400`, async () => {
    const res = await send('POST', '', { phoneNumber: '9876543210', ...body });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, pattern);
    assert.equal(state.leads.length, 0);
  });
}

test('required prospecting fields are enforced on create', async () => {
  state.sections.prospecting_criteria = { requireEmail: true, requireCompany: true };
  let res = await send('POST', '', { phoneNumber: '9876543210', company: 'Acme' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Email is required/);

  res = await send('POST', '', { phoneNumber: '9876543210', email: 'a@acme.test', company: 'Acme' });
  assert.equal(res.status, 201);
  assert.equal(state.leads[0].customFields.prospecting.company, 'Acme');
});

test('lead tags merge into the contact instead of wiping its other tags', async () => {
  state.contacts.push({ id: 'c-old', workspaceId: 'ws1', name: 'Old', phoneNumber: '+919876543210', tags: ['newsletter'] });
  const res = await send('POST', '', { contactId: 'c-old', tags: ['Enterprise'] });
  assert.equal(res.status, 201);
  assert.deepEqual(state.contacts[0].tags, ['newsletter', 'Enterprise']);
});

function seedLead() {
  state.contacts.push({ id: 'c1', workspaceId: 'ws1', name: 'A', phoneNumber: '+919811111111', tags: ['from-campaign'] });
  state.leads.push({ id: 'l1', workspaceId: 'ws1', contactId: 'c1', status: 'NEW', customFields: null, ownerUserId: null });
}

test('editing tags keeps tags the contact already had but refuses new unconfigured ones', async () => {
  seedLead();
  let res = await send('PATCH', '/l1', { tags: ['from-campaign', 'enterprise'] });
  assert.equal(res.status, 200);
  assert.deepEqual(state.contacts[0].tags, ['from-campaign', 'Enterprise']);

  res = await send('PATCH', '/l1', { tags: ['from-campaign', 'Whale'] });
  assert.equal(res.status, 400);
});

test('editing source and status is held to the configuration', async () => {
  seedLead();
  assert.equal((await send('PATCH', '/l1', { source: 'Billboard' })).status, 400);
  assert.equal((await send('PATCH', '/l1', { status: 'NURTURING' })).status, 400);

  const res = await send('PATCH', '/l1', { source: 'other', status: 'qualified' });
  assert.equal(res.status, 200);
  assert.equal(state.leads[0].source, 'OTHER');
  assert.equal(state.leads[0].status, 'QUALIFIED');
});

test('a company edit is stored with the prospecting details instead of 500ing on a missing column', async () => {
  seedLead();
  const res = await send('PATCH', '/l1', { company: 'Acme' });
  assert.equal(res.status, 200);
  assert.equal('company' in state.leads[0], false);
  assert.equal(state.leads[0].customFields.prospecting.company, 'Acme');

  state.sections.prospecting_criteria = { requireCompany: true };
  assert.equal((await send('PATCH', '/l1', { company: '' })).status, 400);
});

test('viewers cannot create leads at all', async () => {
  const res = await send('POST', '', { phoneNumber: '9876543210' }, 'VIEWER');
  assert.equal(res.status, 403);
});
