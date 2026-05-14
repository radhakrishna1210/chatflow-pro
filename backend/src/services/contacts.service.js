import { prisma } from '../lib/prisma.js';
import { parse } from 'csv-parse/sync';

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
  return prisma.contact.create({ data: { workspaceId, name, phoneNumber, email, tags } });
}

export async function importContacts(workspaceId, csvBuffer) {
  const records = parse(csvBuffer, { columns: true, skip_empty_lines: true, trim: true });
  const data = records.map((r) => ({
    workspaceId,
    name: r.name || r.Name || '',
    phoneNumber: r.phoneNumber || r.phone || r.Phone || '',
    email: r.email || r.Email || null,
    tags: r.tags ? r.tags.split(',').map((t) => t.trim()) : [],
  })).filter((c) => c.phoneNumber);

  await prisma.contact.createMany({ data, skipDuplicates: true });
  return { imported: data.length };
}

export async function deleteContact(workspaceId, id) {
  const contact = await prisma.contact.findFirst({ where: { id, workspaceId } });
  if (!contact) { const e = new Error('Contact not found'); e.status = 404; throw e; }
  await prisma.contact.delete({ where: { id } });
}

export async function updateContact(workspaceId, id, updates) {
  const contact = await prisma.contact.findFirst({ where: { id, workspaceId } });
  if (!contact) { const e = new Error('Contact not found'); e.status = 404; throw e; }
  return prisma.contact.update({ where: { id }, data: updates });
}
