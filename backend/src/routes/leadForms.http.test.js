import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Public lead-form submissions through the real public router (validate(),
// rate limit bypassed): consent is copied onto the contact (CF-070) and the
// lead is held to the workspace's Customize Your Business rules (CF-154).

const state = {};

function reset() {
  state.form = {
    id: 'f1', workspaceId: 'ws1', slug: 'demo', name: 'Demo', isActive: true, successMessage: 'Thanks',
    consentText: 'I agree to receive WhatsApp messages', source: null, ownerUserId: null,
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: false },
      { key: 'phone', label: 'Phone', type: 'phone', required: true },
      { key: 'email', label: 'Email', type: 'email', required: false },
    ],
  };
  state.contacts = [];
  state.leads = [];
  state.submissions = [];
  state.sections = {};
}

const matches = (row, where) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && Array.isArray(v.in)) return v.in.includes(row[k]);
  return row[k] === v;
});

const fakePrisma = {
  workspace: { findUnique: async () => ({ defaultPhoneCountry: 'IN' }) },
  leadForm: { findFirst: async ({ where }) => (where.slug === state.form.slug ? state.form : null) },
  contact: {
    findMany: async ({ where }) => state.contacts.filter((c) => matches(c, where)),
    create: async ({ data }) => { const row = { id: `c${state.contacts.length + 1}`, optedOut: false, optInAt: null, ...data }; state.contacts.push(row); return row; },
    updateMany: async ({ where, data }) => {
      const rows = state.contacts.filter((c) => matches(c, where));
      for (const r of rows) Object.assign(r, data);
      return { count: rows.length };
    },
  },
  lead: {
    findUnique: async ({ where }) => state.leads.find((l) => l.contactId === where.contactId) ?? null,
    create: async ({ data }) => { const row = { id: `l${state.leads.length + 1}`, ...data }; state.leads.push(row); return row; },
  },
  leadFormSubmission: {
    create: async ({ data }) => { state.submissions.push(data); return data; },
    count: async () => 0,
  },
  // Customize Your Business sections are SavedView rows.
  savedView: {
    findFirst: async ({ where }) => {
      const key = where.name?.replace(/^__CRM_CUSTOMIZATION_|__$/g, '').toLowerCase();
      return state.sections[key] ? { filters: state.sections[key] } : null;
    },
  },
};

let baseUrl;
let server;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: fakePrisma } });
  mock.module('../middleware/rateLimit.js', { namedExports: { rateLimit: () => (_req, _res, next) => next() } });
  mock.module('../services/leadScoring.service.js', {
    namedExports: { computeLeadScore: async () => ({ score: 10, factors: [], computedAt: new Date() }) },
  });
  mock.module('../services/leadSegmentation.service.js', { namedExports: { computeLeadCategory: async () => ({}) } });
  mock.module('../services/workflowCrm.service.js', { namedExports: { emitCrmEvent: () => {} } });
  mock.module('../services/crmEvents.service.js', { namedExports: { emitCrmEvent: () => {}, emitCrmEvents: () => {}, applyLeadStatus: async () => ({ changed: false }), currentChainDepth: () => undefined } });
  mock.module('../services/leadDistribution.service.js', { namedExports: { evaluateAndAssignLead: async () => ({ assigned: false }) } });
  mock.module('../services/subscription.service.js', {
    namedExports: { hasContactCapacity: async () => true, assertContactCapacity: async () => {}, assertWithinLimit: async () => {} },
  });

  const { default: express } = await import('express');
  const { default: publicFormsRoutes } = await import('./publicForms.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/forms', publicFormsRoutes);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}/forms/ws1/demo`;
});

test.after(() => server?.close());
test.beforeEach(reset);

const submit = (body) => fetch(baseUrl, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('consent on a form becomes opt-in evidence on the new contact', async () => {
  const res = await submit({ answers: { name: 'Asha', phone: '98765 43210' }, consent: true });
  assert.equal(res.status, 200);
  const [contact] = state.contacts;
  assert.equal(contact.phoneNumber, '+919876543210');
  assert.ok(contact.optInAt instanceof Date);
  assert.equal(contact.optInSource, 'lead_form:demo');
  assert.equal(contact.optInText, state.form.consentText);
  assert.equal(contact.optedOut, false);
  assert.equal(state.submissions.at(-1).consentAt.getTime(), contact.optInAt.getTime());
});

test('a matching existing contact gets the consent too, even when it is already a lead', async () => {
  state.contacts.push({ id: 'old', workspaceId: 'ws1', name: 'Old', phoneNumber: '09876543210', optedOut: false, optInAt: null });
  state.leads.push({ id: 'l-old', contactId: 'old' });
  await submit({ answers: { phone: '+919876543210' }, consent: true });
  assert.equal(state.contacts.length, 1);
  assert.equal(state.contacts[0].optInSource, 'lead_form:demo');
  assert.equal(state.submissions.at(-1).outcome, 'DUPLICATE');
});

test('an opted-out contact is never opted back in by a form', async () => {
  state.contacts.push({ id: 'out', workspaceId: 'ws1', name: 'Out', phoneNumber: '+919876543210', optedOut: true, optInAt: null });
  await submit({ answers: { phone: '9876543210' }, consent: true });
  assert.equal(state.contacts[0].optedOut, true);
  assert.equal(state.contacts[0].optInAt, null);
  assert.equal(state.submissions.at(-1).outcome, 'OPTED_OUT');
  assert.equal(state.leads.length, 0);
});

test('a form without consent wording records no opt-in', async () => {
  state.form.consentText = null;
  await submit({ answers: { phone: '9876543210' } });
  assert.equal(state.contacts[0].optInAt ?? null, null);
  assert.equal(state.contacts[0].optInSource, undefined);
});

test('a form with consent wording refuses a submission without consent', async () => {
  const res = await submit({ answers: { phone: '9876543210' } });
  assert.equal(res.status, 400);
  assert.equal(state.contacts.length, 0);
});

// ─── CF-154: form leads are held to Customize Your Business ─────────────────

test('a form lead takes the default lifecycle stage and a configured source', async () => {
  state.form.consentText = null;
  state.sections.lead_lifecycle = { stages: [{ key: 'INBOUND', label: 'Inbound', isDefault: true }, { key: 'NEW', label: 'New' }] };
  state.sections.lead_sources = { sources: [{ key: 'WEBSITE', name: 'Website Form', isActive: true }, { key: 'LINKEDIN', name: 'LinkedIn', utmSource: 'linkedin', isActive: true }] };
  await submit({ answers: { phone: '9876543210' } });
  let lead = state.leads.at(-1);
  assert.equal(lead.status, 'NEW');
  assert.equal(lead.customFields.statusKey, 'INBOUND');
  assert.equal(lead.source, 'WEBSITE', 'no form source and no UTM: the Website source');
  assert.equal(lead.customFields.sourceDetail, 'Form: Demo');

  // A UTM source that matches a configured source's utmSource is used.
  await submit({ answers: { phone: '9811111111' }, attribution: { utm_source: 'LinkedIn' } });
  lead = state.leads.at(-1);
  assert.equal(lead.source, 'LINKEDIN');
});

test('a form lead missing a required prospecting detail is created but not qualified', async () => {
  state.form.consentText = null;
  state.sections.prospecting_criteria = { requireEmail: true };
  await submit({ answers: { phone: '9876543210' } });
  const lead = state.leads.at(-1);
  assert.ok(lead, 'an inbound lead is never lost over a configuration rule');
  assert.equal(lead.customFields.qualification.isQualified, false);
  assert.deepEqual(lead.customFields.qualification.missingRequired, ['email']);
});
