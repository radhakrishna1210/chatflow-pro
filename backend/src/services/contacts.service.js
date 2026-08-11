import { prisma } from '../lib/prisma.js';
import { parse } from 'csv-parse/sync';
import { assertWithinLimit } from './subscription.service.js';

// Normalize to E.164-ish: strip everything but digits, keep a leading '+'.
export function normalizePhone(raw) {
  const str = String(raw || '').trim();
  const digits = str.replace(/[^\d]/g, '');
  if (!digits) return '';
  return `+${digits}`;
}

// 7–15 digits per E.164. Rejects junk like "abc", "123", "N/A".
export function isValidPhone(raw) {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  return digits.length >= 7 && digits.length <= 15;
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
// this is the only way to enumerate them.
export async function listContactTags(workspaceId) {
  const rows = await prisma.contact.findMany({
    where: { workspaceId, tags: { isEmpty: false } },
    select: { tags: true },
  });
  const seen = new Map();
  for (const row of rows) {
    for (const tag of row.tags) {
      const key = tag.trim();
      if (key) seen.set(key, (seen.get(key) || 0) + 1);
    }
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
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

export async function createContact(workspaceId, { name, phoneNumber, email, tags = [] }) {
  if (!isValidPhone(phoneNumber)) {
    const e = new Error('phoneNumber must contain 7–15 digits'); e.status = 400; throw e;
  }
  const normalized = normalizePhone(phoneNumber);
  const existing = await prisma.contact.findFirst({ where: { workspaceId, phoneNumber: normalized } });
  if (existing) { const e = new Error('A contact with this phone number already exists'); e.status = 409; throw e; }
  await assertWithinLimit(workspaceId, 'contact');
  return prisma.contact.create({ data: { workspaceId, name: name || normalized, phoneNumber: normalized, email: email || null, tags } });
}

export async function importContacts(workspaceId, csvBuffer) {
  let records;
  try {
    records = parse(csvBuffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    const e = new Error(`Could not parse CSV: ${err.message}`); e.status = 400; throw e;
  }

  const seen = new Set();
  let invalid = 0;
  const data = [];
  for (const r of records) {
    const rawPhone = r.phoneNumber || r.phone || r.Phone || r.PhoneNumber || '';
    if (!isValidPhone(rawPhone)) { if (String(rawPhone).trim()) invalid++; continue; }
    const phoneNumber = normalizePhone(rawPhone);
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
  const existingPhones = await prisma.contact.findMany({
    where: { workspaceId, phoneNumber: { in: data.map((d) => d.phoneNumber) } },
    select: { phoneNumber: true },
  });
  const existingSet = new Set(existingPhones.map((c) => c.phoneNumber));
  const newCount = data.filter((d) => !existingSet.has(d.phoneNumber)).length;
  if (newCount > 0) {
    await assertWithinLimit(workspaceId, 'contact', {
      additional: newCount,
      message: `This import would add ${newCount} new contact(s), which exceeds your plan's contact limit. Upgrade your plan or reduce the import size.`,
    });
  }

  // createMany reports rows actually inserted; skipDuplicates relies on the
  // (workspaceId, phoneNumber) unique constraint to drop existing contacts.
  const { count: imported } = await prisma.contact.createMany({ data, skipDuplicates: true });
  const duplicates = data.length - imported;
  const matchedContacts = await prisma.contact.findMany({
    where: { workspaceId, phoneNumber: { in: data.map((d) => d.phoneNumber) } },
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
  const data = { ...updates };
  if (data.phoneNumber !== undefined) {
    if (!isValidPhone(data.phoneNumber)) { const e = new Error('phoneNumber must contain 7–15 digits'); e.status = 400; throw e; }
    data.phoneNumber = normalizePhone(data.phoneNumber);
  }
  return prisma.contact.update({ where: { id }, data });
}
