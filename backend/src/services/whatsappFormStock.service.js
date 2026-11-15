// Today's stock for an order form.
//
// Each quantity (Number) question can be given the amount available today.
// Completed orders count against it. From then on:
//
//   - a quantity larger than what is left is refused, with what is left;
//   - once everything that has a limit has run out, the form no longer
//     starts: the customer gets the sold-out message and is tagged
//     "waitlist", so they can be told when stock is back.
//
// "Today" is not a clock time. Entering the stock starts a fresh count from
// that moment, so the day turns over when the next day's stock is entered,
// whatever the cutoff is.
//
// Every read is guarded: a database without the WhatsappFormStock table, or a
// form with no stock entered, takes orders without limits exactly as before.

import { prisma } from '../lib/prisma.js';

export const WAITLIST_TAG = 'waitlist';
export const DEFAULT_SOLD_OUT_MESSAGE =
  "Today's stock is sold out. We will message you as soon as fresh stock is available.";

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const numberFields = (form) =>
  (Array.isArray(form?.schema) ? form.schema : []).filter((f) => f?.type === 'number');

const amount = (value) => {
  const n = Number(String(value ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// 12 → "12", 2.5 → "2.5"
const show = (n) => String(Math.round(n * 100) / 100);

async function findRow(formId) {
  try {
    return await prisma.whatsappFormStock.findUnique({ where: { formId } });
  } catch (err) {
    console.warn(`[FormStock] Could not read stock for form ${formId}: ${String(err.message).split('\n')[0]}`);
    return null;
  }
}

// How much of each question has been ordered since `since`.
async function orderedSince(formId, since, keys) {
  const used = Object.fromEntries(keys.map((k) => [k, 0]));
  if (keys.length === 0) return used;
  const rows = await prisma.whatsappFormSubmission.findMany({
    where: { formId, completed: true, completedAt: { gte: since } },
    select: { answers: true },
  });
  for (const row of rows) {
    for (const key of keys) used[key] += amount(row.answers?.[key]);
  }
  return used;
}

const NONE = Object.freeze({ active: false, items: {}, soldOut: false, message: DEFAULT_SOLD_OUT_MESSAGE, countFrom: null });

/**
 * The form's stock right now. Never throws.
 *   items    { questionKey: { label, limit, used, left } } for questions with a limit
 *   soldOut  every question that has a limit has nothing left
 */
export async function stockFor(form) {
  try {
    if (!form?.id) return NONE;
    const row = await findRow(form.id);
    const limits = row?.limits && typeof row.limits === 'object' ? row.limits : {};
    const limited = numberFields(form).filter((f) => Number.isFinite(Number(limits[f.key])) && limits[f.key] !== null && limits[f.key] !== '');
    if (!row || limited.length === 0) return { ...NONE, message: row?.soldOutMessage || DEFAULT_SOLD_OUT_MESSAGE };

    const used = await orderedSince(form.id, row.countFrom, limited.map((f) => f.key));
    const items = {};
    for (const f of limited) {
      const limit = Math.max(0, Number(limits[f.key]));
      items[f.key] = { label: f.label, limit, used: used[f.key], left: Math.max(0, limit - used[f.key]) };
    }
    return {
      active: true,
      items,
      soldOut: Object.values(items).every((i) => i.left <= 0),
      message: row.soldOutMessage || DEFAULT_SOLD_OUT_MESSAGE,
      countFrom: row.countFrom,
    };
  } catch (err) {
    console.error(`[FormStock] Stock check failed for form ${form?.id}: ${err.message}`);
    return NONE;
  }
}

// What is left of a question, when the answer asks for more than that; else null.
function shortfall(stock, field, value) {
  const item = stock?.active ? stock.items[field?.key] : null;
  if (!item) return null;
  return amount(value) > item.left ? item : null;
}

/**
 * In chat: the message to send instead of accepting a quantity that is more
 * than what is left (the question is asked again underneath), or null when
 * the quantity is fine.
 */
export function shortfallPrompt(stock, field, value) {
  const item = shortfall(stock, field, value);
  if (!item) return null;
  return item.left <= 0
    ? `Sorry, this is sold out for today. Reply 0 to carry on without it.\n\n${field.label}`
    : `Sorry, only ${show(item.left)} left today. Please send ${show(item.left)} or less.\n\n${field.label}`;
}

/**
 * On a submitted form screen: one line per question that asked for more than
 * is left. Empty when the whole order can be met.
 */
export function shortfallLines(stock, fields, answers) {
  return (Array.isArray(fields) ? fields : [])
    .map((field) => {
      const item = shortfall(stock, field, answers?.[field.key]);
      if (!item) return null;
      return item.left <= 0 ? `${field.label} Sold out today.` : `${field.label} Only ${show(item.left)} left today.`;
    })
    .filter(Boolean);
}

/** Tags the contact so they can be messaged when stock is back. Never throws. */
export async function addToWaitlist(contactId) {
  try {
    if (!contactId) return;
    const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { tags: true } });
    if (!contact || (contact.tags || []).includes(WAITLIST_TAG)) return;
    await prisma.contact.update({ where: { id: contactId }, data: { tags: { push: WAITLIST_TAG } } });
  } catch (err) {
    console.error(`[FormStock] Could not add contact ${contactId} to the waitlist: ${err.message}`);
  }
}

// ── For the form editor ────────────────────────────────────────────────────

async function loadForm(workspaceId, formId) {
  const form = await prisma.whatsappForm.findFirst({ where: { id: formId, workspaceId } });
  if (!form) throw fail(404, 'Form not found');
  return form;
}

/** Every quantity question with its limit (null = no limit), ordered and left. */
export async function getStock(workspaceId, formId) {
  const form = await loadForm(workspaceId, formId);
  const stock = await stockFor(form);
  return {
    items: numberFields(form).map((f) => {
      const item = stock.items[f.key];
      return { key: f.key, label: f.label, limit: item ? item.limit : null, used: item ? item.used : 0, left: item ? item.left : null };
    }),
    active: stock.active,
    soldOut: stock.soldOut,
    countFrom: stock.countFrom,
    soldOutMessage: stock.message,
  };
}

/**
 * Saves the stock. `limits` is { questionKey: quantity } — an empty or missing
 * value removes that question's limit. With `restart` (the default) the count
 * starts again from now: that is "entering today's stock". Without it the
 * numbers change but today's orders still count, for topping up mid-day.
 */
export async function setStock(workspaceId, formId, { limits, soldOutMessage, restart = true } = {}) {
  const form = await loadForm(workspaceId, formId);
  const known = new Set(numberFields(form).map((f) => f.key));
  const clean = {};
  for (const [key, raw] of Object.entries(limits && typeof limits === 'object' ? limits : {})) {
    if (!known.has(key)) continue;
    if (raw === null || raw === undefined || String(raw).trim() === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw fail(400, 'Stock must be a number, 0 or more.');
    clean[key] = n;
  }
  const message = typeof soldOutMessage === 'string' && soldOutMessage.trim()
    ? soldOutMessage.trim().slice(0, 1000)
    : null;

  try {
    await prisma.whatsappFormStock.upsert({
      where: { formId },
      create: { workspaceId, formId, limits: clean, soldOutMessage: message, countFrom: new Date() },
      update: { limits: clean, soldOutMessage: message, ...(restart ? { countFrom: new Date() } : {}) },
    });
  } catch (err) {
    console.error(`[FormStock] Could not save stock for form ${formId}: ${err.message}`);
    throw fail(500, 'Stock could not be saved. If this is a new deployment, the database update may not have run yet.');
  }
  return getStock(workspaceId, formId);
}
