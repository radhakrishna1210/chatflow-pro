// WhatsApp Forms service
import { prisma } from '../lib/prisma.js';
import { keywordMatches } from './automation.service.js';
import { sendAutomatedReply } from './outbound.service.js';

const FIELD_TYPES = new Set(['text', 'email', 'phone', 'number', 'choice']);

// A form used to be just a name and an integer "number of fields" — nothing
// described what it actually asked, and `submissions` was never incremented by
// anything. Forms now carry real field definitions and are filled in over
// WhatsApp, one question per inbound message.
export function normalizeSchema(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();

  return list.slice(0, 50).map((field, index) => {
    const label = String(field?.label || '').trim() || `Question ${index + 1}`;
    const type = FIELD_TYPES.has(field?.type) ? field.type : 'text';

    // Keys address answers in the submission JSON, so they must be stable and
    // unique even when two questions share a label.
    let key = String(field?.key || '').trim()
      || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!key) key = `field_${index + 1}`;
    while (seen.has(key)) key = `${key}_${index + 1}`;
    seen.add(key);

    const options = type === 'choice'
      ? (Array.isArray(field.options) ? field.options : []).map((o) => String(o).trim()).filter(Boolean).slice(0, 10)
      : [];

    return {
      key,
      label,
      // A choice field with no options can never be answered — degrade to text.
      type: type === 'choice' && options.length === 0 ? 'text' : type,
      required: field?.required !== false,
      options,
    };
  });
}

const normalizeKeyword = (k) => {
  const trimmed = String(k || '').trim().toUpperCase();
  return trimmed || null;
};

// Categories are display-only tags. Deduplicated and capped so the list UI
// can't be broken by a caller sending hundreds of them.
export function normalizeCategories(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  for (const entry of list) {
    const value = String(entry || '').trim().slice(0, 40);
    if (value) seen.add(value);
    if (seen.size >= 10) break;
  }
  return [...seen];
}

async function assertKeywordAvailable(workspaceId, keyword, excludeId) {
  if (!keyword) return;
  const existing = await prisma.whatsappForm.findFirst({
    where: { workspaceId, keyword, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (existing) {
    const e = new Error('Another form already uses this keyword');
    e.status = 409;
    throw e;
  }
}

export async function listForms(workspaceId) {
  return prisma.whatsappForm.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
}

export async function createForm(workspaceId, { name, schema, keyword, completionMessage, status, categories }) {
  const fields = normalizeSchema(schema);
  const kw = normalizeKeyword(keyword);
  await assertKeywordAvailable(workspaceId, kw);

  return prisma.whatsappForm.create({
    data: {
      workspaceId,
      name,
      schema: fields,
      categories: normalizeCategories(categories),
      // Kept in sync with the schema so the list UI's "N Fields" column can't
      // disagree with what the form actually asks.
      fields: Math.max(fields.length, 1),
      keyword: kw,
      status: status === 'Active' ? 'Active' : 'Draft',
      ...(completionMessage ? { completionMessage } : {}),
    },
  });
}

export async function updateForm(workspaceId, formId, updates) {
  const form = await prisma.whatsappForm.findFirst({ where: { id: formId, workspaceId } });
  if (!form) { const e = new Error('Form not found'); e.status = 404; throw e; }

  const data = {};
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.categories !== undefined) data.categories = normalizeCategories(updates.categories);
  if (updates.status !== undefined) data.status = updates.status === 'Active' ? 'Active' : 'Draft';
  if (updates.completionMessage !== undefined) data.completionMessage = updates.completionMessage;
  if (updates.schema !== undefined) {
    const fields = normalizeSchema(updates.schema);
    data.schema = fields;
    data.fields = Math.max(fields.length, 1);
  }
  if (updates.keyword !== undefined) {
    data.keyword = normalizeKeyword(updates.keyword);
    await assertKeywordAvailable(workspaceId, data.keyword, formId);
  }

  // An Active form with no questions would ask nothing and never complete.
  const effectiveSchema = data.schema ?? form.schema;
  if (data.status === 'Active' && (!Array.isArray(effectiveSchema) || effectiveSchema.length === 0)) {
    const e = new Error('Add at least one question before activating this form');
    e.status = 400;
    throw e;
  }

  return prisma.whatsappForm.update({ where: { id: formId }, data });
}

export async function deleteForm(workspaceId, formId) {
  const form = await prisma.whatsappForm.findFirst({ where: { id: formId, workspaceId } });
  if (!form) { const e = new Error('Form not found'); e.status = 404; throw e; }
  await prisma.whatsappForm.delete({ where: { id: formId } });
}

export async function listSubmissions(workspaceId, formId) {
  const form = await prisma.whatsappForm.findFirst({ where: { id: formId, workspaceId } });
  if (!form) { const e = new Error('Form not found'); e.status = 404; throw e; }
  return prisma.whatsappFormSubmission.findMany({
    where: { workspaceId, formId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

// ── Runtime: filling a form over WhatsApp ──────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Returns an error string when the answer doesn't fit the field, else null.
function validateAnswer(field, answer) {
  const value = String(answer || '').trim();
  if (!value) return field.required ? 'That looks empty — please send a value.' : null;

  if (field.type === 'email' && !EMAIL_RE.test(value)) return "That doesn't look like an email address. Please try again.";
  if (field.type === 'number' && !/^-?\d+(\.\d+)?$/.test(value)) return 'Please reply with a number.';
  if (field.type === 'phone' && value.replace(/[^\d]/g, '').length < 7) return "That doesn't look like a phone number. Please try again.";
  if (field.type === 'choice' && !isChoiceAnswer(field, value)) {
    return `Please reply with one of: ${field.options.join(', ')}`;
  }
  return null;
}

const isChoiceAnswer = (field, value) => {
  const index = parseInt(value, 10);
  if (Number.isInteger(index) && index >= 1 && index <= field.options.length) return true;
  return field.options.some((o) => o.toLowerCase() === value.toLowerCase());
};

function promptFor(field) {
  if (field.type === 'choice' && field.options.length) {
    return `${field.label}\n${field.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`;
  }
  return field.label;
}

// A numeric reply to a choice question is a selection, not the literal text.
function resolveChoice(field, answer) {
  const value = String(answer || '').trim();
  if (field.type !== 'choice') return value;
  const index = parseInt(value, 10);
  if (Number.isInteger(index) && index >= 1 && index <= field.options.length) return field.options[index - 1];
  return field.options.find((o) => o.toLowerCase() === value.toLowerCase()) || value;
}

const schemaOf = (form) => (Array.isArray(form.schema) ? form.schema : []);

// Called by the inbound handler before any other automation. Returns true when
// the message was consumed by a form (either continuing one or starting one),
// so the caller skips triggers/workflows/AI for this message.
export async function handleFormInbound({ workspaceId, conversation, contact, messageBody }) {
  const body = String(messageBody || '').trim();
  if (!body || !conversation?.waNumberId) return false;

  const reply = (text) => sendAutomatedReply({
    conversationId: conversation.id,
    waNumberId: conversation.waNumberId,
    toPhone: contact.phoneNumber,
    body: text,
  });

  // 1. An in-flight submission takes priority — the customer is mid-form.
  const open = await prisma.whatsappFormSubmission.findFirst({
    where: { conversationId: conversation.id, completed: false },
    orderBy: { createdAt: 'desc' },
    include: { form: true },
  });

  if (open) {
    const fields = schemaOf(open.form);

    // The form was emptied or its questions removed under an in-flight
    // submission — close it out rather than trapping the customer.
    if (fields.length === 0) {
      await prisma.whatsappFormSubmission.update({
        where: { id: open.id },
        data: { completed: true, completedAt: new Date() },
      });
      return false;
    }

    if (/^(cancel|stop|quit)$/i.test(body)) {
      await prisma.whatsappFormSubmission.update({
        where: { id: open.id },
        data: { completed: true, completedAt: new Date() },
      });
      await reply('No problem — cancelled.');
      return true;
    }

    const field = fields[Math.min(open.cursor, fields.length - 1)];
    const error = validateAnswer(field, body);
    if (error) {
      await reply(error);
      return true;
    }

    const answers = { ...(open.answers || {}), [field.key]: resolveChoice(field, body) };
    const nextCursor = open.cursor + 1;
    const done = nextCursor >= fields.length;

    await prisma.whatsappFormSubmission.update({
      where: { id: open.id },
      data: { answers, cursor: nextCursor, completed: done, ...(done ? { completedAt: new Date() } : {}) },
    });

    if (done) {
      // Answers land on the contact, not only on the submission row.
      //
      // A form that asks for an email captured it into WhatsappFormSubmission
      // and stopped there, so the person's record still showed nothing and no
      // later automation could use what they had just told us. Anything whose
      // key matches a built-in column or one of the workspace's custom fields
      // is written through; the rest stays on the submission, as before.
      await applyAnswersToContact(workspaceId, contact.id, answers).catch((err) =>
        console.error('[Forms] Could not apply answers to the contact:', err.message));

      await prisma.whatsappForm.update({
        where: { id: open.formId },
        data: { submissions: { increment: 1 } },
      });
      await reply(open.form.completionMessage);
    } else {
      await reply(promptFor(fields[nextCursor]));
    }
    return true;
  }

  // 2. No submission in flight — does this message start one?
  const forms = await prisma.whatsappForm.findMany({
    where: { workspaceId, status: 'Active', keyword: { not: null } },
  });
  const started = forms
    .filter((f) => schemaOf(f).length > 0 && keywordMatches(f.keyword, body))
    .sort((a, b) => (b.keyword?.length || 0) - (a.keyword?.length || 0))[0];
  if (!started) return false;

  await prisma.whatsappFormSubmission.create({
    data: {
      workspaceId,
      formId: started.id,
      contactId: contact.id,
      conversationId: conversation.id,
      answers: {},
      cursor: 0,
    },
  });
  await reply(promptFor(schemaOf(started)[0]));
  return true;
}

// Writes a completed form's answers onto the contact record.
//
// Built-in columns (name, email) are set when they are empty — a form must not
// silently overwrite a name someone has already curated. Everything else is
// matched against the workspace's custom field definitions, so a form field
// called "order_number" fills the custom field of the same name and becomes
// available to later automations as {{custom.order_number}}.
async function applyAnswersToContact(workspaceId, contactId, answers) {
  const values = answers && typeof answers === 'object' ? answers : {};
  if (Object.keys(values).length === 0) return;

  const [contact, definitions] = await Promise.all([
    prisma.contact.findUnique({ where: { id: contactId } }),
    prisma.workspaceCustomField.findMany({ where: { workspaceId } }),
  ]);
  if (!contact) return;

  const byKey = new Map(definitions.map((d) => [d.key.toLowerCase(), d]));
  const data = {};
  const custom = { ...(contact.customFields && typeof contact.customFields === 'object' ? contact.customFields : {}) };
  let touchedCustom = false;

  for (const [rawKey, rawValue] of Object.entries(values)) {
    const key = String(rawKey).toLowerCase();
    const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
    if (value === '' || value === null || value === undefined) continue;

    if (key === 'email' && !contact.email) { data.email = String(value).slice(0, 254); continue; }
    // Only when the stored name is still the placeholder the webhook created
    // from the phone number, never over a real one.
    if (key === 'name' && (!contact.name || contact.name === contact.phoneNumber)) {
      data.name = String(value).slice(0, 120);
      continue;
    }

    const definition = byKey.get(key);
    if (definition) { custom[definition.key] = value; touchedCustom = true; }
  }

  if (touchedCustom) data.customFields = custom;
  if (Object.keys(data).length === 0) return;
  await prisma.contact.update({ where: { id: contactId }, data });
}
