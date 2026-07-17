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

export async function listContacts(workspaceId, { search = '', page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit;
  const where = {
    workspaceId,
    ...(search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.contact.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.contact.count({ where }),
  ]);
  return { data, total };
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
    return { imported: 0, duplicates: 0, invalid, totalRows: records.length };
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
  return { imported, duplicates, invalid, totalRows: records.length };
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
