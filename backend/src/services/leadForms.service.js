import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { isValidPhone, normalizePhone } from './contacts.service.js';
import { computeLeadScore } from './leadScoring.service.js';
import { emitCrmEvent } from './workflowCrm.service.js';

// Public lead-capture forms.
//
// The submit endpoint is the only unauthenticated write path in the CRM, so
// everything here assumes the caller is hostile until proven otherwise:
// nothing about the workspace is echoed back, every field is validated against
// the form's own definition, and the response is identical whether or not a
// lead was actually created.

export const FIELD_TYPES = ['text', 'email', 'phone', 'textarea', 'select'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Attribution keys worth keeping. An allow-list, not a passthrough — otherwise
// the hidden-field mechanism becomes arbitrary attacker-controlled storage.
const ATTRIBUTION_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'referrer', 'gclid', 'fbclid'];

export const slugify = (s) => String(s || '')
  .trim().toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60);

// IPs are hashed, never stored raw: enough to spot a flood, not enough to be a
// log of who visited.
const hashIp = (ip) => (ip ? createHash('sha256').update(String(ip)).digest('hex').slice(0, 32) : null);

export function validateFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    const e = new Error('A form needs at least one field'); e.status = 400; throw e;
  }
  if (fields.length > 25) {
    const e = new Error('A form cannot have more than 25 fields'); e.status = 400; throw e;
  }

  const keys = new Set();
  return fields.map((f, i) => {
    const at = `Field ${i + 1}`;
    const fail = (m) => { const e = new Error(`${at}: ${m}`); e.status = 400; throw e; };

    const label = String(f?.label ?? '').trim();
    if (!label) fail('needs a label');

    const key = slugify(f.key || label).replace(/-/g, '_');
    if (!key) fail('label does not produce a usable field key');
    if (keys.has(key)) fail(`duplicate field key "${key}"`);
    keys.add(key);

    const type = FIELD_TYPES.includes(f.type) ? f.type : 'text';
    const out = { key, label, type, required: !!f.required };

    if (type === 'select') {
      const options = Array.isArray(f.options) ? f.options.map((o) => String(o).trim()).filter(Boolean) : [];
      if (options.length === 0) fail('a select field needs at least one option');
      out.options = [...new Set(options)];
    }
    return out;
  });
}

// A form must be able to identify the person, or it cannot produce a lead.
function assertContactable(fields) {
  const hasPhone = fields.some((f) => f.type === 'phone');
  const hasEmail = fields.some((f) => f.type === 'email');
  if (!hasPhone && !hasEmail) {
    const e = new Error('A form needs a phone or email field, or it cannot create a lead');
    e.status = 400;
    throw e;
  }
}

export async function listForms(workspaceId) {
  const data = await prisma.leadForm.findMany({
    where: { workspaceId },
    include: { _count: { select: { submissions: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return { data, total: data.length };
}

export async function getForm(workspaceId, id) {
  const form = await prisma.leadForm.findFirst({
    where: { id, workspaceId },
    include: {
      submissions: { orderBy: { createdAt: 'desc' }, take: 50 },
      _count: { select: { submissions: true } },
    },
  });
  if (!form) { const e = new Error('Form not found'); e.status = 404; throw e; }
  return form;
}

export async function createForm(workspaceId, body) {
  const fields = validateFields(body.fields);
  assertContactable(fields);

  const slug = slugify(body.slug || body.name);
  if (!slug) { const e = new Error('That name does not produce a usable URL slug'); e.status = 400; throw e; }

  const clash = await prisma.leadForm.findFirst({ where: { workspaceId, slug }, select: { id: true } });
  if (clash) { const e = new Error('A form with that URL already exists'); e.status = 409; throw e; }

  return prisma.leadForm.create({
    data: {
      workspaceId, slug, name: body.name, description: body.description ?? null,
      fields,
      successMessage: body.successMessage || undefined,
      consentText: body.consentText ?? null,
      source: body.source ?? null,
      ownerUserId: body.ownerUserId ?? null,
      isActive: body.isActive ?? false,
    },
  });
}

export async function updateForm(workspaceId, id, updates) {
  const form = await prisma.leadForm.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!form) { const e = new Error('Form not found'); e.status = 404; throw e; }

  const data = { ...updates };
  if (updates.fields !== undefined) {
    data.fields = validateFields(updates.fields);
    assertContactable(data.fields);
  }
  // The slug is part of a URL that may already be published, so it is not
  // editable — a live form silently 404ing is worse than an ugly slug.
  delete data.slug;

  return prisma.leadForm.update({ where: { id }, data });
}

export async function deleteForm(workspaceId, id) {
  const form = await prisma.leadForm.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!form) { const e = new Error('Form not found'); e.status = 404; throw e; }
  await prisma.leadForm.delete({ where: { id } });
}

/**
 * The public shape of a form — what an unauthenticated visitor may see.
 *
 * Deliberately omits workspaceId, ownerUserId, submission counts and
 * everything else internal. An inactive or unknown form is indistinguishable:
 * both 404, so the endpoint cannot be used to discover which slugs exist.
 */
export async function getPublicForm(workspaceId, slug) {
  const form = await prisma.leadForm.findFirst({
    where: { workspaceId, slug, isActive: true },
    select: { id: true, name: true, description: true, fields: true, consentText: true, successMessage: true },
  });
  if (!form) { const e = new Error('Form not found'); e.status = 404; throw e; }
  return {
    name: form.name,
    description: form.description,
    fields: form.fields,
    consentText: form.consentText,
  };
}

// Validates submitted answers against the form's own field definitions.
function coerceAnswers(fields, submitted) {
  const answers = {};
  for (const field of fields) {
    const raw = submitted?.[field.key];
    const value = typeof raw === 'string' ? raw.trim() : raw;
    const empty = value === undefined || value === null || value === '';

    if (empty) {
      if (field.required) {
        const e = new Error(`${field.label} is required`); e.status = 400; throw e;
      }
      continue;
    }

    const str = String(value);
    if (str.length > 2000) { const e = new Error(`${field.label} is too long`); e.status = 400; throw e; }

    if (field.type === 'email' && !EMAIL_RE.test(str)) {
      const e = new Error(`${field.label} must be a valid email address`); e.status = 400; throw e;
    }
    if (field.type === 'phone' && !isValidPhone(str)) {
      const e = new Error(`${field.label} must be a valid phone number`); e.status = 400; throw e;
    }
    if (field.type === 'select' && !(field.options ?? []).includes(str)) {
      const e = new Error(`${field.label} is not one of the allowed choices`); e.status = 400; throw e;
    }
    answers[field.key] = str;
  }
  return answers;
}

function pickAttribution(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const key of ATTRIBUTION_KEYS) {
    const v = raw[key];
    if (typeof v === 'string' && v.trim()) out[key] = v.trim().slice(0, 300);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Handles a public submission.
 *
 * Every outcome is recorded — including the ones that produce no lead — so
 * "the form is live but nothing is arriving" is answerable. The caller always
 * receives the same success payload regardless of outcome: telling a stranger
 * "that number is already a lead" would leak the customer list.
 */
export async function submitForm(workspaceId, slug, body, { ip = null } = {}) {
  const form = await prisma.leadForm.findFirst({
    where: { workspaceId, slug, isActive: true },
  });
  if (!form) { const e = new Error('Form not found'); e.status = 404; throw e; }

  // Honeypot: a field no human sees. Anything in it is a bot, and the polite
  // response is to accept and discard rather than explain the trap.
  if (typeof body?._hp === 'string' && body._hp.trim() !== '') {
    await prisma.leadFormSubmission.create({
      data: {
        workspaceId, formId: form.id, answers: {}, outcome: 'REJECTED',
        reason: 'Honeypot triggered', ipHash: hashIp(ip),
      },
    });
    return { ok: true, message: form.successMessage };
  }

  const fields = Array.isArray(form.fields) ? form.fields : [];
  const answers = coerceAnswers(fields, body?.answers ?? {});
  const attribution = pickAttribution(body?.attribution);

  if (form.consentText && body?.consent !== true) {
    const e = new Error('Please agree before submitting'); e.status = 400; throw e;
  }

  const record = (outcome, reason, extra = {}) => prisma.leadFormSubmission.create({
    data: {
      workspaceId, formId: form.id, answers, outcome, reason,
      attribution: attribution ?? undefined,
      consentText: form.consentText ?? null,
      consentAt: form.consentText ? new Date() : null,
      ipHash: hashIp(ip),
      ...extra,
    },
  });

  const phoneField = fields.find((f) => f.type === 'phone');
  const emailField = fields.find((f) => f.type === 'email');
  const nameField = fields.find((f) => /name/i.test(f.key) || /name/i.test(f.label));

  const rawPhone = phoneField ? answers[phoneField.key] : null;
  const email = emailField ? answers[emailField.key] : null;
  const name = (nameField ? answers[nameField.key] : null) || null;

  if (!rawPhone && !email) {
    await record('REJECTED', 'No phone or email supplied');
    return { ok: true, message: form.successMessage };
  }

  // A contact is identified by phone in this platform; email-only submissions
  // are kept as submissions but cannot become a lead, because a lead needs a
  // contact and a contact needs a number.
  if (!rawPhone) {
    await record('REJECTED', 'Email-only submission — no phone number to create a contact');
    return { ok: true, message: form.successMessage };
  }

  const phoneNumber = normalizePhone(rawPhone);

  let contact = await prisma.contact.findFirst({ where: { workspaceId, phoneNumber } });
  if (contact?.optedOut) {
    await record('OPTED_OUT', 'Contact has opted out', { contactId: contact.id });
    return { ok: true, message: form.successMessage };
  }

  if (!contact) {
    contact = await prisma.contact.create({
      data: { workspaceId, name: name || phoneNumber, phoneNumber, email: email || null, tags: [] },
    });
  }

  const existingLead = await prisma.lead.findUnique({ where: { contactId: contact.id }, select: { id: true } });
  if (existingLead) {
    await record('DUPLICATE', 'This contact is already a lead', { contactId: contact.id, leadId: existingLead.id });
    return { ok: true, message: form.successMessage };
  }

  const { score, factors, computedAt } = await computeLeadScore(workspaceId, contact.id);

  const lead = await prisma.lead.create({
    data: {
      workspaceId,
      contactId: contact.id,
      status: 'NEW',
      source: form.source || `Form: ${form.name}`,
      ownerUserId: form.ownerUserId ?? null,
      score,
      scoreFactors: factors,
      scoreComputedAt: computedAt,
      notes: attribution ? `Attribution: ${JSON.stringify(attribution)}` : null,
    },
    select: { id: true },
  });

  await record('CREATED', null, { contactId: contact.id, leadId: lead.id });
  emitCrmEvent(workspaceId, 'lead_created', { leadId: lead.id, contactId: contact.id, score });

  return { ok: true, message: form.successMessage };
}
