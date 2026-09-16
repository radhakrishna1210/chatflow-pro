import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import {
  createForm, updateForm, getPublicForm, submitForm, validateFields, slugify,
} from './leadForms.service.js';

let dbAvailable = false;
let workspaceId;
let formId;
let seq = 0;

const phone = () => `+9182${String(Date.now()).slice(-7)}${seq++}`;

const FIELDS = [
  { label: 'Full name', type: 'text', required: true },
  { label: 'Phone', type: 'phone', required: true },
  { label: 'Email', type: 'email' },
  { label: 'Budget', type: 'select', options: ['Under 1L', '1–5L', 'Over 5L'] },
];

test.before(async () => {
  try { await prisma.$connect(); dbAvailable = true; } catch { return; }
  workspaceId = (await prisma.workspace.create({ data: { name: `test-forms-${Date.now()}` } })).id;
  const form = await createForm(workspaceId, {
    name: 'Contact Us', fields: FIELDS, isActive: true,
    consentText: 'I agree to be contacted about my enquiry.',
    source: 'Website',
  });
  formId = form.id;
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

// ─── Definition validation (pure) ──────────────────────────────────────────

test('field keys are derived from labels and de-duplicated', () => {
  const fields = validateFields([
    { label: 'Full Name', type: 'text' },
    { label: 'Phone', type: 'phone' },
  ]);
  assert.equal(fields[0].key, 'full_name');
  assert.equal(fields[1].key, 'phone');

  assert.throws(
    () => validateFields([{ label: 'Phone', type: 'phone' }, { label: 'phone', type: 'text' }]),
    (e) => e.status === 400 && /duplicate/i.test(e.message),
  );
});

test('a select field must declare options', () => {
  assert.throws(
    () => validateFields([{ label: 'Budget', type: 'select', options: [] }]),
    (e) => e.status === 400,
  );
});

test('a form with no phone or email cannot be created', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await assert.rejects(
    () => createForm(workspaceId, { name: 'Useless', fields: [{ label: 'Comment', type: 'textarea' }] }),
    (e) => e.status === 400 && /cannot create a lead/.test(e.message),
    'a form that cannot identify anyone is not a lead form',
  );
});

test('slugs are generated and collisions refused', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  assert.equal(slugify('  Contact Us!  '), 'contact-us');

  await assert.rejects(
    () => createForm(workspaceId, { name: 'Contact Us', fields: FIELDS }),
    (e) => e.status === 409,
  );
});

test('the slug cannot be changed after publication', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  // A live form silently 404ing is worse than an ugly slug.
  const updated = await updateForm(workspaceId, formId, { name: 'Contact Us v2', slug: 'something-else' });
  assert.equal(updated.slug, 'contact-us');
  assert.equal(updated.name, 'Contact Us v2');
  await updateForm(workspaceId, formId, { name: 'Contact Us' });
});

// ─── The public surface ────────────────────────────────────────────────────

test('the public form exposes nothing internal', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const pub = await getPublicForm(workspaceId, 'contact-us');

  assert.deepEqual(Object.keys(pub).sort(), ['consentText', 'description', 'fields', 'name']);
  for (const leaked of ['id', 'workspaceId', 'ownerUserId', 'source', 'isActive', 'submissions']) {
    assert.equal(pub[leaked], undefined, `public payload must not expose ${leaked}`);
  }
});

test('an inactive form is indistinguishable from a missing one', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const hidden = await createForm(workspaceId, { name: 'Draft Form', fields: FIELDS, isActive: false });

  // Both 404, so the endpoint cannot be used to discover which slugs exist.
  await assert.rejects(() => getPublicForm(workspaceId, 'draft-form'), (e) => e.status === 404);
  await assert.rejects(() => getPublicForm(workspaceId, 'no-such-form'), (e) => e.status === 404);

  await prisma.leadForm.delete({ where: { id: hidden.id } });
});

test('a valid submission creates a scored, attributed lead', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const number = phone();

  const res = await submitForm(workspaceId, 'contact-us', {
    answers: { full_name: 'Priya Raman', phone: number, email: 'priya@example.test', budget: '1–5L' },
    attribution: { utm_source: 'google', utm_campaign: 'spring', ignored_key: 'dropped' },
    consent: true,
  }, { ip: '203.0.113.9' });

  assert.equal(res.ok, true);

  const contact = await prisma.contact.findFirst({ where: { workspaceId, phoneNumber: number } });
  assert.ok(contact, 'a contact should have been created');

  const lead = await prisma.lead.findUnique({ where: { contactId: contact.id } });
  assert.equal(lead.source, 'Website');
  assert.ok(lead.scoreComputedAt instanceof Date);

  const submission = await prisma.leadFormSubmission.findFirst({
    where: { workspaceId, leadId: lead.id },
  });
  assert.equal(submission.outcome, 'CREATED');
  // Only allow-listed attribution keys survive — the hidden-field mechanism
  // must not become arbitrary attacker-controlled storage.
  assert.deepEqual(submission.attribution, { utm_source: 'google', utm_campaign: 'spring' });
  assert.ok(submission.consentAt instanceof Date);
  assert.equal(submission.consentText, 'I agree to be contacted about my enquiry.');
  // The IP is hashed, never stored raw.
  assert.ok(submission.ipHash && !submission.ipHash.includes('203.0.113.9'));
});

test('answers are validated against the form definition', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const bad = [
    [{ full_name: 'X', phone: '123' }, /valid phone/i],
    [{ full_name: 'X', phone: phone(), email: 'not-an-email' }, /valid email/i],
    [{ full_name: 'X', phone: phone(), budget: 'Unlimited' }, /allowed choices/i],
    [{ phone: phone() }, /required/i],
  ];
  for (const [answers, pattern] of bad) {
    await assert.rejects(
      () => submitForm(workspaceId, 'contact-us', { answers, consent: true }),
      (e) => e.status === 400 && pattern.test(e.message),
      `expected rejection for ${JSON.stringify(answers)}`,
    );
  }
});

test('consent is required when the form asks for it', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await assert.rejects(
    () => submitForm(workspaceId, 'contact-us', {
      answers: { full_name: 'No Consent', phone: phone() },
    }),
    (e) => e.status === 400 && /agree/i.test(e.message),
  );
});

test('the honeypot silently discards bots', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const number = phone();

  const res = await submitForm(workspaceId, 'contact-us', {
    answers: { full_name: 'Bot', phone: number }, consent: true, _hp: 'filled by a script',
  });

  // Accepted-looking response: explaining the trap teaches the bot to avoid it.
  assert.equal(res.ok, true);
  assert.equal(await prisma.contact.count({ where: { workspaceId, phoneNumber: number } }), 0);

  const rejected = await prisma.leadFormSubmission.findFirst({
    where: { workspaceId, reason: 'Honeypot triggered' },
  });
  assert.ok(rejected, 'the attempt is still recorded');
});

test('a duplicate submission does not create a second lead, and does not say so', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const number = phone();
  const answers = { full_name: 'Twice', phone: number };

  const first = await submitForm(workspaceId, 'contact-us', { answers, consent: true });
  const second = await submitForm(workspaceId, 'contact-us', { answers, consent: true });

  // Identical responses: telling a stranger "already a lead" leaks the
  // customer list.
  assert.deepEqual(first, second);

  const contact = await prisma.contact.findFirst({ where: { workspaceId, phoneNumber: number } });
  assert.equal(await prisma.lead.count({ where: { contactId: contact.id } }), 1);

  const dupe = await prisma.leadFormSubmission.findFirst({
    where: { workspaceId, contactId: contact.id, outcome: 'DUPLICATE' },
  });
  assert.ok(dupe, 'the duplicate is recorded so the funnel is explainable');
});

test('an opted-out contact is recorded but never becomes a lead', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const number = phone();
  await prisma.contact.create({ data: { workspaceId, name: 'Gone', phoneNumber: number, optedOut: true } });

  const res = await submitForm(workspaceId, 'contact-us', {
    answers: { full_name: 'Gone', phone: number }, consent: true,
  });
  assert.equal(res.ok, true);

  const contact = await prisma.contact.findFirst({ where: { workspaceId, phoneNumber: number } });
  assert.equal(await prisma.lead.count({ where: { contactId: contact.id } }), 0);

  const rec = await prisma.leadFormSubmission.findFirst({
    where: { workspaceId, contactId: contact.id, outcome: 'OPTED_OUT' },
  });
  assert.ok(rec);
});

test('a form belonging to another workspace cannot be submitted through this one', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const other = await prisma.workspace.create({ data: { name: `test-forms-other-${Date.now()}` } });
  try {
    await createForm(other.id, { name: 'Foreign Form', fields: FIELDS, isActive: true });
    // Right slug, wrong workspace.
    await assert.rejects(() => getPublicForm(workspaceId, 'foreign-form'), (e) => e.status === 404);
    await assert.rejects(
      () => submitForm(workspaceId, 'foreign-form', { answers: { full_name: 'X', phone: phone() } }),
      (e) => e.status === 404,
    );
  } finally {
    await prisma.workspace.delete({ where: { id: other.id } }).catch(() => {});
  }
});
