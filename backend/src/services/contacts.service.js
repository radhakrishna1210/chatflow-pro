import { prisma } from '../lib/prisma.js';
import { parse } from 'csv-parse/sync';
import { assertWithinLimit } from './subscription.service.js';
import { setContactOptOut } from './optout.service.js';
import { toE164, phoneVariants, workspacePhoneCountry } from '../lib/phone.js';

// Every Contact.phoneNumber is E.164 ("+919876543210"), whichever path wrote
// it — see lib/phone.js. `country` is the workspace default used for numbers
// typed without a country code; returns '' when the input cannot be a number.
export function normalizePhone(raw, { country, international } = {}) {
  return toE164(raw, { country, international }) || '';
}

// 7–15 digits per E.164 once normalised. Rejects junk like "abc", "123", "N/A".
export function isValidPhone(raw, { country } = {}) {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  return digits.length >= 7 && digits.length <= 15 && toE164(raw, { country }) !== null;
}

/**
 * The E.164 form of `raw` for this workspace plus the country used, or a 400
 * when it cannot be a phone number. Every contact write goes through this.
 */
export async function resolveContactPhone(workspaceId, raw, { international = false } = {}) {
  const country = await workspacePhoneCountry(workspaceId);
  const phoneNumber = toE164(raw, { country, international });
  if (!phoneNumber) { const e = new Error('phoneNumber must contain 7–15 digits'); e.status = 400; throw e; }
  return { phoneNumber, country };
}

/**
 * The contact with this number, however it was spelled when it was stored.
 * Rows written before numbers were normalised ("09876543210") are found
 * rather than duplicated. The canonical spelling wins when both exist.
 */
export async function findContactByPhone(workspaceId, phoneNumber, { country, client = prisma } = {}) {
  if (!phoneNumber) return null;
  const rows = await client.contact.findMany({
    where: { workspaceId, phoneNumber: { in: phoneVariants(phoneNumber, { country }) } },
    take: 5,
  });
  return rows.find((c) => c.phoneNumber === phoneNumber) || rows[0] || null;
}

// Sort options the contact list offers, mapped to the order Prisma needs.
// A whitelist rather than passing the client's string through, so a query
// parameter can never name an arbitrary column.
export const CONTACT_SORTS = {
  newest:       { createdAt: 'desc' },
  oldest:       { createdAt: 'asc' },
  name_asc:     { name: 'asc' },
  name_desc:    { name: 'desc' },
  recently_updated: { updatedAt: 'desc' },
  phone:        { phoneNumber: 'asc' },
};
export const DEFAULT_CONTACT_SORT = 'newest';

// Parses a YYYY-MM-DD (or full ISO) bound into a Date, or null when absent or
// unparseable — a bad date narrows nothing rather than erroring the whole list.
function dateBound(value, { endOfDay = false } = {}) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // A bare date means the whole of that day when used as an upper bound,
  // otherwise "created up to today" excludes everything created today.
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim())) d.setHours(23, 59, 59, 999);
  return d;
}

// Builds the `where` for a contact list. Every filter is a database term
// rather than a post-fetch array filter, so it composes correctly with
// pagination — filtering a single page in the client would silently drop
// matches that live on other pages.
export function buildContactWhere(workspaceId, {
  search = '', clusterId = '', segmentId = '', tags = [], status = '',
  createdFrom = '', createdTo = '', updatedFrom = '', updatedTo = '',
} = {}) {
  const tagList = (Array.isArray(tags) ? tags : String(tags || '').split(','))
    .map((t) => String(t).trim())
    .filter(Boolean);

  const createdGte = dateBound(createdFrom);
  const createdLte = dateBound(createdTo, { endOfDay: true });
  const updatedGte = dateBound(updatedFrom);
  const updatedLte = dateBound(updatedTo, { endOfDay: true });

  return {
    workspaceId,
    ...(clusterId ? { clusterContacts: { some: { clusterId } } } : {}),
    ...(segmentId ? { segments: { some: { id: segmentId } } } : {}),
    // hasSome, not hasEvery: picking two tags asks for contacts in either,
    // which is what a multi-select filter is understood to mean.
    ...(tagList.length ? { tags: { hasSome: tagList } } : {}),
    ...(status === 'active' ? { optedOut: false } : {}),
    ...(status === 'opted_out' ? { optedOut: true } : {}),
    ...(createdGte || createdLte ? {
      createdAt: { ...(createdGte ? { gte: createdGte } : {}), ...(createdLte ? { lte: createdLte } : {}) },
    } : {}),
    ...(updatedGte || updatedLte ? {
      updatedAt: { ...(updatedGte ? { gte: updatedGte } : {}), ...(updatedLte ? { lte: updatedLte } : {}) },
    } : {}),
    ...(search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };
}

export async function listContacts(workspaceId, { page = 1, limit = 20, sort = DEFAULT_CONTACT_SORT, ...filters } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const skip = (safePage - 1) * limit;
  const where = buildContactWhere(workspaceId, filters);
  // `id` breaks ties so a contact can't appear on two pages (or on none) when
  // many rows share a timestamp — which is exactly what a CSV import produces.
  // The tiebreak follows the primary direction, so flipping Newest/Oldest (or
  // A-Z/Z-A) really does reverse the list instead of leaving tied rows in the
  // same order in both.
  const primary = CONTACT_SORTS[sort] || CONTACT_SORTS[DEFAULT_CONTACT_SORT];
  const orderBy = [primary, { id: Object.values(primary)[0] === 'desc' ? 'desc' : 'asc' }];

  const [data, total] = await Promise.all([
    prisma.contact.findMany({
      where, skip, take: limit, orderBy,
      include: { segments: { select: { id: true, name: true, color: true } } },
    }),
    prisma.contact.count({ where }),
  ]);
  return { data, total, page: safePage, limit, sort: CONTACT_SORTS[sort] ? sort : DEFAULT_CONTACT_SORT };
}

// The distinct tags in use across a workspace, for the filter panel's tag
// picker. Tags live in a String[] on Contact rather than their own table, so
// this is the only way to enumerate them. Aggregated in SQL: loading every
// tagged contact to count tags in JS cost O(contacts) per filter-panel open.
export async function listContactTags(workspaceId) {
  const rows = await prisma.$queryRaw`
    SELECT btrim(t) AS name, COUNT(*)::int AS count
    FROM "Contact" c, unnest(c."tags") AS t
    WHERE c."workspaceId" = ${workspaceId} AND btrim(t) <> ''
    GROUP BY btrim(t)
    ORDER BY count DESC, name ASC`;
  return rows.map((r) => ({ name: r.name, count: Number(r.count) }));
}

// One contact with everything the details panel shows. The inbox reads this
// rather than carrying its own copy of contact data, so an edit made there and
// an edit made in Contacts are the same record.
export async function getContact(workspaceId, id) {
  const contact = await prisma.contact.findFirst({
    where: { id, workspaceId },
    include: {
      segments: { select: { id: true, name: true, color: true } },
      clusterContacts: { select: { cluster: { select: { id: true, name: true } } } },
    },
  });
  if (!contact) { const e = new Error('Contact not found'); e.status = 404; throw e; }

  // "Last interaction" is the most recent message either way on any of this
  // contact's threads — the conversation's own lastMessageAt is the same fact
  // and cheaper to read than scanning messages.
  const lastConversation = await prisma.conversation.findFirst({
    where: { workspaceId, contactId: id },
    orderBy: { lastMessageAt: 'desc' },
    select: { id: true, lastMessageAt: true, status: true },
  });

  const { clusterContacts, ...rest } = contact;
  return {
    ...rest,
    clusters: clusterContacts.map((cc) => cc.cluster),
    lastInteractionAt: lastConversation?.lastMessageAt ?? null,
    conversationId: lastConversation?.id ?? null,
    conversationStatus: lastConversation?.status ?? null,
  };
}

export async function createContact(workspaceId, { name, phoneNumber, email, tags = [], customFields }) {
  const { phoneNumber: normalized, country } = await resolveContactPhone(workspaceId, phoneNumber);
  const existing = await findContactByPhone(workspaceId, normalized, { country });
  if (existing) { const e = new Error('A contact with this phone number already exists'); e.status = 409; throw e; }
  await assertWithinLimit(workspaceId, 'contact');
  // Values are checked against the workspace's own field definitions, so an
  // unknown key is refused rather than quietly stored and never displayed.
  const { validateCustomFields } = await import('./workspaceCustomFields.service.js');
  const custom = await validateCustomFields(workspaceId, customFields);
  return prisma.contact.create({
    data: {
      workspaceId, name: name || normalized, phoneNumber: normalized,
      email: email || null, tags,
      ...(custom === undefined ? {} : { customFields: custom }),
    },
  });
}

export async function importContacts(workspaceId, csvBuffer) {
  let records;
  try {
    records = parse(csvBuffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    const e = new Error(`Could not parse CSV: ${err.message}`); e.status = 400; throw e;
  }

  const country = await workspacePhoneCountry(workspaceId);
  const seen = new Set();
  let invalid = 0;
  const data = [];
  for (const r of records) {
    const rawPhone = r.phoneNumber || r.phone || r.Phone || r.PhoneNumber || '';
    const phoneNumber = isValidPhone(rawPhone, { country }) ? normalizePhone(rawPhone, { country }) : '';
    if (!phoneNumber) { if (String(rawPhone).trim()) invalid++; continue; }
    if (seen.has(phoneNumber)) continue; // in-file duplicate
    seen.add(phoneNumber);
    data.push({
      workspaceId,
      name: r.name || r.Name || phoneNumber,
      phoneNumber,
      email: (r.email || r.Email || '').trim() || null,
      tags: r.tags ? String(r.tags).split(',').map((t) => t.trim()).filter(Boolean) : [],
    });
  }

  if (data.length === 0) {
    return { imported: 0, duplicates: 0, invalid, totalRows: records.length, contacts: [] };
  }

  // Plan limit check (README §12.4): reject the whole import rather than
  // partially importing up to the limit, so the user gets one clear,
  // predictable outcome instead of having to figure out which rows landed.
  // Only phone numbers not already in this workspace actually count against
  // the limit — re-importing existing contacts (skipDuplicates below) is a
  // no-op either way.
  //
  // Existing contacts are matched under every spelling they may have been
  // stored with, so a legacy "09876543210" row is not re-imported as a second
  // "+919876543210" contact.
  const canonicalOf = new Map();
  for (const d of data) {
    for (const v of phoneVariants(d.phoneNumber, { country })) canonicalOf.set(v, d.phoneNumber);
  }
  const existingPhones = await prisma.contact.findMany({
    where: { workspaceId, phoneNumber: { in: [...canonicalOf.keys()] } },
    select: { phoneNumber: true },
  });
  const existingSet = new Set(existingPhones.map((c) => canonicalOf.get(c.phoneNumber)));
  const fresh = data.filter((d) => !existingSet.has(d.phoneNumber));
  const newCount = fresh.length;
  if (newCount > 0) {
    await assertWithinLimit(workspaceId, 'contact', {
      additional: newCount,
      message: `This import would add ${newCount} new contact(s), which exceeds your plan's contact limit. Upgrade your plan or reduce the import size.`,
    });
  }

  // createMany reports rows actually inserted; skipDuplicates relies on the
  // (workspaceId, phoneNumber) unique constraint to drop existing contacts.
  const { count: imported } = fresh.length
    ? await prisma.contact.createMany({ data: fresh, skipDuplicates: true })
    : { count: 0 };
  const duplicates = data.length - imported;
  const matchedContacts = await prisma.contact.findMany({
    where: { workspaceId, phoneNumber: { in: [...canonicalOf.keys()] } },
    select: { id: true, name: true, phoneNumber: true },
  });
  return { imported, duplicates, invalid, totalRows: records.length, contacts: matchedContacts };
}

export async function deleteContact(workspaceId, id) {
  const contact = await prisma.contact.findFirst({ where: { id, workspaceId } });
  if (!contact) { const e = new Error('Contact not found'); e.status = 404; throw e; }
  await prisma.contact.delete({ where: { id } });
}

// `updates` arrives pre-whitelisted by the contact update validator, so no
// mass-assignment of workspaceId/id/createdAt is possible.
export async function updateContact(workspaceId, id, updates) {
  const contact = await prisma.contact.findFirst({ where: { id, workspaceId } });
  if (!contact) { const e = new Error('Contact not found'); e.status = 404; throw e; }
  // The opt-out flag goes through the OptOut list so both sources agree.
  const { optedOut, ...data } = updates;
  if (data.phoneNumber !== undefined) {
    const { phoneNumber, country } = await resolveContactPhone(workspaceId, data.phoneNumber);
    // Another contact under any spelling of the new number would become a
    // duplicate the unique key cannot see.
    const clash = await findContactByPhone(workspaceId, phoneNumber, { country });
    if (clash && clash.id !== id) { const e = new Error('A contact with this phone number already exists'); e.status = 409; throw e; }
    data.phoneNumber = phoneNumber;
  }
  if (data.customFields !== undefined) {
    const { validateCustomFields } = await import('./workspaceCustomFields.service.js');
    // Merged, not replaced: a form that edits one field must not wipe the rest.
    const patch = await validateCustomFields(workspaceId, data.customFields);
    data.customFields = { ...(contact.customFields || {}), ...(patch || {}) };
  }
  const updated = await prisma.contact.update({ where: { id }, data });
  if (optedOut === undefined || optedOut === contact.optedOut) return updated;
  await setContactOptOut(workspaceId, id, optedOut);
  return prisma.contact.findUnique({ where: { id } });
}

// ─── Export ──────────────────────────────────────────────────────────────────
//
// There was no export at all — contacts could be imported from CSV and never
// got back out, which makes the data feel like a one-way door. This deliberately
// reuses buildContactWhere, so whatever the Contacts screen is currently showing
// (search, tags, segment, cluster, status, date ranges) is exactly what comes
// out. An export that silently ignored the filters would be worse than none.

const CSV_COLUMNS = [
  ['name', (c) => c.name],
  ['phoneNumber', (c) => c.phoneNumber],
  ['email', (c) => c.email],
  ['tags', (c) => (c.tags || []).join('; ')],
  ['segments', (c) => (c.segments || []).map((s) => s.name).join('; ')],
  ['optedOut', (c) => (c.optedOut ? 'yes' : 'no')],
  ['createdAt', (c) => c.createdAt?.toISOString() ?? ''],
  ['updatedAt', (c) => c.updatedAt?.toISOString() ?? ''],
];

// A leading =, +, -, @, tab or CR makes a spreadsheet treat the cell as a
// formula, and contact names are attacker-supplied — so the export is a way to
// get a payload in front of whoever opens it. An apostrophe keeps it text.
//
// An international phone number legitimately starts with '+' and is not a
// formula, so it is exempted: guarding it would put an apostrophe in front of
// every number in the file and break re-importing what was just exported.
const PHONE_LIKE = /^\+[\d\s()-]+$/;

function csvCell(value) {
  const raw = String(value ?? '');
  const risky = /^[=+\-@\t\r]/.test(raw) && !PHONE_LIKE.test(raw);
  return `"${(risky ? `'${raw}` : raw).replace(/"/g, '""')}"`;
}

// Capped so one request cannot try to hold an unbounded workspace in memory.
const EXPORT_LIMIT = 50_000;

export async function exportContactsCsv(workspaceId, filters = {}) {
  const where = buildContactWhere(workspaceId, filters);
  const [contacts, customDefs] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: EXPORT_LIMIT,
      include: { segments: { select: { name: true } } },
    }),
    prisma.workspaceCustomField.findMany({
      where: { workspaceId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);

  // Custom fields become their own columns. An export that silently dropped
  // them would not be the customer's data.
  const columns = [
    ...CSV_COLUMNS,
    ...customDefs.map((d) => [d.label, (c) => (c.customFields || {})[d.key] ?? '']),
  ];

  const lines = [columns.map(([header]) => csvCell(header)).join(',')];
  for (const c of contacts) {
    lines.push(columns.map(([, read]) => csvCell(read(c))).join(','));
  }

  return {
    csv: lines.join('\r\n'),
    count: contacts.length,
    truncated: contacts.length === EXPORT_LIMIT,
    filename: `contacts-${new Date().toISOString().slice(0, 10)}.csv`,
  };
}
