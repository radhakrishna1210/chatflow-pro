// WhatsApp Forms service
import { prisma } from '../lib/prisma.js';
import { keywordMatches } from './automation.service.js';
import { matchOption, detectControlCommand, interruptsFlow, CONTROL_REPLIES } from './conversationControl.service.js';
import { sendAutomatedReply } from './outbound.service.js';
import { renderFormMessage, closingTotal } from '../lib/formMessage.js';
import { csvCell } from './contacts.service.js';
import { isOrderingEnabled, setOrderingEnabled } from '../lib/ordering.js';
import { parseMulti, advance, normalizeShowIf, MULTI_SEPARATOR } from '../lib/formFlow.js';

// Where a submission's order total is kept inside `answers`. Question keys are
// built from labels with leading underscores stripped, so none can collide.
const TOTAL_KEY = '__total';

// Set on a submission while it waits for the customer to submit the form
// screen (services/whatsappFormScreen.service.js) rather than for a typed
// answer to question one. Replaced by the real answers when the form finishes.
export const SCREEN_KEY = '__screen';

// 'multi' is "Pick several": see lib/formFlow.js.
const FIELD_TYPES = new Set(['text', 'email', 'phone', 'number', 'choice', 'multi']);
const HAS_OPTIONS = new Set(['choice', 'multi']);

// A form used to be just a name and an integer "number of fields" — nothing
// described what it actually asked, and `submissions` was never incremented by
// anything. Forms now carry real field definitions and are filled in over
// WhatsApp, one question per inbound message.
export function normalizeSchema(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();

  const fields = list.slice(0, 50).map((field, index) => {
    const label = String(field?.label || '').trim() || `Question ${index + 1}`;
    const type = FIELD_TYPES.has(field?.type) ? field.type : 'text';

    // Keys address answers in the submission JSON, so they must be stable and
    // unique even when two questions share a label.
    let key = String(field?.key || '').trim()
      || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!key) key = `field_${index + 1}`;
    while (seen.has(key)) key = `${key}_${index + 1}`;
    seen.add(key);

    const options = HAS_OPTIONS.has(type)
      ? (Array.isArray(field.options) ? field.options : []).map((o) => String(o).trim()).filter(Boolean).slice(0, 10)
      : [];

    return {
      key,
      label,
      // A choice field with no options can never be answered — degrade to text.
      type: HAS_OPTIONS.has(type) && options.length === 0 ? 'text' : type,
      required: field?.required !== false,
      options,
      rawShowIf: field?.showIf,
    };
  });

  // "Ask only if" can only point at an earlier choice / pick-several question
  // and one of its options; anything else is dropped rather than hiding the
  // question for good.
  return fields.map(({ rawShowIf, ...field }, index) => {
    const showIf = normalizeShowIf(rawShowIf, index, fields);
    return showIf ? { ...field, showIf } : field;
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
  const rows = await prisma.whatsappFormSubmission.findMany({
    where: { workspaceId, formId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return withCustomer(workspaceId, rows, form, { ordering: await isOrderingEnabled(workspaceId) });
}

export const getFormSettings = async (workspaceId) => ({ orderingEnabled: await isOrderingEnabled(workspaceId) });
export const updateFormSettings = (workspaceId, { orderingEnabled }) => setOrderingEnabled(workspaceId, orderingEnabled);

// Adds who filled the form (name, phone) and the order total to each
// submission. Submissions keep only a contactId, so contacts are looked up in
// one query, scoped to the workspace.
//
// The total is the one saved when the form finished. A completed submission
// without one (finished before totals were saved, or before the closing
// message had a calculation) gets it worked out now from the closing message
// and the customer's current prices, flagged as `totalEstimated`.
//
// Totals only exist in workspaces with ordering turned on (lib/ordering.js).
async function withCustomer(workspaceId, rows, form = null, { ordering = false } = {}) {
  const ids = [...new Set(rows.map((r) => r.contactId).filter(Boolean))];
  const contacts = ids.length
    ? await prisma.contact.findMany({
      where: { workspaceId, id: { in: ids } },
      select: { id: true, name: true, phoneNumber: true, email: true, customFields: true, attributes: true },
    })
    : [];
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const fields = form ? schemaOf(form) : [];
  return rows.map((r) => {
    const contact = byId.get(r.contactId);
    const saved = r.answers?.[TOTAL_KEY];
    let total = ordering && typeof saved === 'number' ? saved : null;
    let totalEstimated = false;
    if (ordering && total === null && r.completed && form) {
      total = closingTotal(form.completionMessage, { contact, fields, answers: r.answers || {} });
      totalEstimated = total !== null;
    }
    return {
      ...r,
      contactName: contact?.name ?? null,
      contactPhone: contact?.phoneNumber ?? null,
      total,
      totalEstimated,
    };
  });
}

const SUBMISSION_EXPORT_LIMIT = 50_000;

// Optional ISO date bound from the query string; a bad value is refused rather
// than silently exporting everything.
function parseBound(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) { const e = new Error(`${label} must be a date`); e.status = 400; throw e; }
  return d;
}

// Submissions of a form as CSV: When, Customer, Phone, one column per question,
// Total, Status. `from`/`to` narrow it to a time window, e.g. today: the browser
// sends its own local midnight so "today" means the viewer's day, not the
// server's.
export async function exportSubmissionsCsv(workspaceId, formId, { from, to, label } = {}) {
  const form = await prisma.whatsappForm.findFirst({ where: { id: formId, workspaceId } });
  if (!form) { const e = new Error('Form not found'); e.status = 404; throw e; }
  const fields = schemaOf(form);
  const gte = parseBound(from, 'from');
  const lt = parseBound(to, 'to');
  const createdAt = gte || lt ? { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) } : undefined;
  const ordering = await isOrderingEnabled(workspaceId);
  const rows = await withCustomer(workspaceId, await prisma.whatsappFormSubmission.findMany({
    where: { workspaceId, formId, ...(createdAt ? { createdAt } : {}) },
    orderBy: { createdAt: 'desc' },
    take: SUBMISSION_EXPORT_LIMIT,
  }), form, { ordering });

  const header = ['When', 'Customer', 'Phone', ...fields.map((f) => f.label), ...(ordering ? ['Total'] : []), 'Status'];
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([
      new Date(r.createdAt).toISOString(),
      r.contactName ?? '',
      r.contactPhone ?? '',
      ...fields.map((f) => r.answers?.[f.key] ?? ''),
      ...(ordering ? [r.total ?? ''] : []),
      r.completed ? 'Complete' : `Stopped at Q${r.cursor + 1}`,
    ].map(csvCell).join(','));
  }
  const safeName = String(form.name || 'form').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'form';
  const suffix = typeof label === 'string' && /^[a-z0-9-]{1,20}$/i.test(label) ? `_${label}` : '';
  return { csv: lines.join('\r\n'), filename: `${safeName}_submissions${suffix}.csv`, count: rows.length };
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
  if (field.type === 'multi') {
    const { picked, error } = parseMulti(value, field.options);
    if (error || picked.length === 0) {
      return `Please reply with the numbers of the ones you want, e.g. 1,3\n${field.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`;
    }
  }
  return null;
}

// Customers answer choice questions in prose. Exact-match-only rejected
// "urgently", "very urgent" and the typo "Urrget" (QA BUG-04), so the answer is
// resolved through the same tolerant matcher the rest of the inbound path uses.
const isChoiceAnswer = (field, value) => matchOption(value, field.options) !== null;

function promptFor(field) {
  if (field.type === 'multi' && field.options.length) {
    return `${field.label}\nReply with the numbers, e.g. 1,3\n${field.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`;
  }
  if (field.type === 'choice' && field.options.length) {
    return `${field.label}\n${field.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`;
  }
  return field.label;
}

// A numeric reply to a choice question is a selection, not the literal text.
function resolveChoice(field, answer) {
  const value = String(answer || '').trim();
  if (field.type === 'multi') return parseMulti(value, field.options).picked?.join(MULTI_SEPARATOR) || value;
  if (field.type !== 'choice') return value;
  // Store the configured option, not what the customer typed, so reports and
  // later automations see "Urgent" whether they wrote "urgently" or "2".
  return matchOption(value, field.options)?.option ?? value;
}

const schemaOf = (form) => (Array.isArray(form.schema) ? form.schema : []);

// Today's stock. Loaded on demand, like the form screen, so forms that never
// use it do not depend on that module; every call site treats a failure as
// "no stock limits".
const stockModule = () => import('./whatsappFormStock.service.js');

// Owner approval of orders, loaded on demand for the same reason.
const orderModule = () => import('./formOrder.service.js');

// Where a submission going through owner approval keeps its state:
// PENDING, CONFIRMED or CANCELLED.
const STATUS_KEY = '__status';

// Closes any in-flight submission on a conversation. Used when a control word
// or an escalation ends the flow from outside this module.
export async function cancelOpenSubmission(conversationId) {
  if (!conversationId) return false;
  const open = await prisma.whatsappFormSubmission.findFirst({
    where: { conversationId, completed: false },
    orderBy: { createdAt: 'desc' },
  });
  if (!open) return false;
  await prisma.whatsappFormSubmission.update({
    where: { id: open.id },
    data: { completed: true, completedAt: new Date() },
  });
  return true;
}

// Is the customer part-way through a form right now?
export async function hasOpenSubmission(conversationId) {
  if (!conversationId) return false;
  const count = await prisma.whatsappFormSubmission.count({
    where: { conversationId, completed: false },
  });
  return count > 0;
}

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
  let open = await prisma.whatsappFormSubmission.findFirst({
    where: { conversationId: conversation.id, completed: false },
    orderBy: { createdAt: 'desc' },
    include: { form: true },
  });

  // The form was sent as a screen and the customer typed something instead of
  // submitting it. No question was ever asked in chat, so the message is not
  // an answer: the submission is closed and the message carries on as an
  // ordinary one (it may well be the keyword again, which sends a fresh
  // screen). Control words are left to the block below, which already knows
  // how to cancel or restart.
  if (open?.answers?.[SCREEN_KEY]) {
    const control = detectControlCommand(body);
    if (!(control && interruptsFlow(control.command))) {
      await prisma.whatsappFormSubmission.update({
        where: { id: open.id },
        data: { completed: true, completedAt: new Date() },
      });
      open = null;
    }
  }

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

    // Global control words beat the question on screen (QA BUG-02). Without
    // this, "bye" and "done" were filed as answers and the form kept asking.
    const control = detectControlCommand(body);
    if (control && interruptsFlow(control.command)) {
      if (control.command === 'restart') {
        await prisma.whatsappFormSubmission.update({
          where: { id: open.id },
          data: { answers: {}, cursor: 0 },
        });
        await reply(`Starting over.\n\n${promptFor(fields[0])}`);
        return true;
      }
      // 'human' is left to the inbound handler, which closes the form and then
      // hands the thread to a person; everything else ends here.
      await prisma.whatsappFormSubmission.update({
        where: { id: open.id },
        data: { completed: true, completedAt: new Date() },
      });
      if (control.command === 'human') return false;
      await reply(CONTROL_REPLIES[control.command] || CONTROL_REPLIES.cancel);
      return true;
    }

    const field = fields[Math.min(open.cursor, fields.length - 1)];
    const error = validateAnswer(field, body);
    if (error) {
      await reply(error);
      return true;
    }

    // Today's stock: a quantity larger than what is left is not accepted, and
    // the customer is told how much there is (services/whatsappFormStock).
    if (field.type === 'number') {
      const short = await stockModule()
        .then(async (m) => m.shortfallPrompt(await m.stockFor(open.form), field, body))
        .catch(() => null);
      if (short) {
        await reply(short);
        return true;
      }
    }

    // Questions whose "Ask only if" is not met are skipped (and a skipped
    // Number question recorded as 0). Forms without such rules move on by one.
    const { cursor: nextCursor, answers } = advance(
      fields, open.cursor + 1, { ...(open.answers || {}), [field.key]: resolveChoice(field, body) },
    );
    const done = nextCursor >= fields.length;

    if (done) {
      await completeSubmission({ workspaceId, submission: open, form: open.form, fields, contact, answers, reply });
    } else {
      await prisma.whatsappFormSubmission.update({
        where: { id: open.id },
        data: { answers, cursor: nextCursor, completed: false },
      });
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

  await startForm({ workspaceId, form: started, conversation, contact, reply });
  return true;
}

// Opens `form` for a customer: the checks that can stop it (order cutoff, sold
// out), then the submission and the first question or the form screen.
//
// Shared by the keyword start above and the workflow engine's "start a form"
// step, so a form opened from a workflow behaves exactly like one opened by
// its keyword. Returns 'started', or the reason it did not start ('closed',
// 'sold_out'); in both of those the customer has been told why.
export async function startForm({ workspaceId, form: started, conversation, contact, reply: replyWith }) {
  const reply = replyWith || ((text) => sendAutomatedReply({
    conversationId: conversation.id,
    waNumberId: conversation.waNumberId,
    toPhone: contact.phoneNumber,
    body: text,
  }));

  // Past the day's order cutoff (owner approval settings): the form does not
  // start, and the customer is told when they can order again.
  const closed = await orderModule().then((m) => m.ordersClosedMessage(started)).catch(() => null);
  if (closed) {
    await reply(closed);
    return 'closed';
  }

  // Everything with a stock limit has run out: the form does not start. The
  // customer is told, and tagged so they can be messaged when stock is back.
  const stock = await stockModule().then((m) => m.stockFor(started)).catch(() => null);
  if (stock?.soldOut) {
    await reply(stock.message);
    await stockModule().then((m) => m.addToWaitlist(contact.id)).catch(() => {});
    return 'sold_out';
  }

  const submission = await prisma.whatsappFormSubmission.create({
    data: {
      workspaceId,
      formId: started.id,
      contactId: contact.id,
      conversationId: conversation.id,
      answers: {},
      cursor: 0,
    },
  });

  // A form published as a screen opens as one (tick, fill in, Submit). Any
  // reason it cannot — not published, out of date, the send fails — and the
  // first question is asked in chat, as it always was. Loaded on demand so
  // forms that never use a screen do not depend on that module.
  const onScreen = await import('./whatsappFormScreen.service.js')
    .then((m) => m.startOnScreen({ form: started, submission, conversation, contact }))
    .catch((err) => {
      console.error('[Forms] Form screen unavailable, asking in chat:', err.message);
      return false;
    });
  if (!onScreen) await reply(promptFor(schemaOf(started)[0]));
  return 'started';
}

// Finishes a submission: saves the answers (and the order total), writes them
// through to the contact, counts the response and sends the closing message.
// Shared by the chat version (the last question was just answered) and the
// form screen (everything arrived at once).
export async function completeSubmission({ workspaceId, submission, form, fields, contact, answers, reply }) {
  // The order total is saved with the submission when the form finishes, so
  // a later price upload does not change what an old order cost.
  // Only in workspaces with ordering turned on; elsewhere the closing message
  // is sent exactly as written, as it always was.
  const ordering = await isOrderingEnabled(workspaceId);
  const total = ordering ? closingTotal(form.completionMessage, { contact, fields, answers }) : null;

  // Owner approval (services/formOrder.service.js): the order is not final
  // yet. It is marked pending, so it takes no stock, and instead of the
  // closing message the customer is told it is being checked.
  const approval = await orderModule().then((m) => m.activeFlow(form)).catch(() => null);
  const saved = {
    ...answers,
    ...(total === null ? {} : { [TOTAL_KEY]: total }),
    ...(approval ? { [STATUS_KEY]: 'PENDING' } : {}),
  };

  await prisma.whatsappFormSubmission.update({
    where: { id: submission.id },
    data: { answers: saved, cursor: fields.length, completed: true, completedAt: new Date() },
  });

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
    where: { id: form.id },
    data: { submissions: { increment: 1 } },
  });

  if (approval) {
    const placed = await orderModule()
      .then((m) => m.placeOrder({ workspaceId, form, submission, contact, answers: saved }))
      .then(() => true)
      .catch((err) => {
        console.error('[Forms] Could not send the order for approval:', err.message);
        return false;
      });
    if (placed) return;
    // The order could not be opened for approval. Rather than leave the
    // customer with silence, fall through to the ordinary closing message.
  }

  // {{q1}}, {{name}}, sheet columns and {{= q1 * price}} totals; a message
  // without "{{" is sent exactly as written.
  await reply(ordering
    ? renderFormMessage(form.completionMessage, { contact, fields, answers })
    : form.completionMessage);
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
