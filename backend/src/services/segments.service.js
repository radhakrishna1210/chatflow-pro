import { prisma } from '../lib/prisma.js';
import { setContactOptOut } from './optout.service.js';
import { assertContactCapacity } from './subscription.service.js';
import { resolveContactPhone, findContactByPhone } from './contacts.service.js';

// List all segments for a workspace. Contacts are capped per segment and a
// _count is included, so a 10k-contact segment no longer ships 10k rows on
// every list call.
const SEGMENT_CONTACT_PREVIEW_LIMIT = 200;
export async function listSegments(workspaceId) {
  const segments = await prisma.segment.findMany({
    where: { workspaceId },
    include: {
      contacts: { take: SEGMENT_CONTACT_PREVIEW_LIMIT, orderBy: { createdAt: 'desc' } },
      _count: { select: { contacts: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return segments.map((s) => ({ ...s, contactCount: s._count.contacts }));
}

// Create a new segment (rejects duplicates by name within the workspace)
export async function createSegment(workspaceId, { name, desc, color }) {
  const existing = await prisma.segment.findFirst({
    where: {
      workspaceId,
      name: { equals: name, mode: 'insensitive' },
    },
  });
  if (existing) {
    const e = new Error('A Smart List with this name already exists');
    e.status = 409;
    throw e;
  }
  return prisma.segment.create({ data: { workspaceId, name, desc, color } });
}

// Update an existing segment
export async function updateSegment(workspaceId, segmentId, updates) {
  const segment = await prisma.segment.findFirst({ where: { id: segmentId, workspaceId } });
  if (!segment) { const e = new Error('Segment not found'); e.status = 404; throw e; }
  // Explicit whitelist — never spread raw request bodies into Prisma.
  const data = {};
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.desc !== undefined) data.desc = updates.desc;
  if (updates.color !== undefined) data.color = updates.color;
  return prisma.segment.update({ where: { id: segmentId }, data });
}

// Delete a segment (also disconnect contacts)
export async function deleteSegment(workspaceId, segmentId) {
  const segment = await prisma.segment.findFirst({ where: { id: segmentId, workspaceId } });
  if (!segment) { const e = new Error('Segment not found'); e.status = 404; throw e; }
  // Disconnect all contacts first (optional, Prisma will handle cascade if set)
  await prisma.segment.update({ where: { id: segmentId }, data: { contacts: { set: [] } } });
  await prisma.segment.delete({ where: { id: segmentId } });
}

// Add a contact to a segment. If contactId provided, link existing contact; otherwise, create new contact.
export async function addContactToSegment(workspaceId, segmentId, contactData) {
  const segment = await prisma.segment.findFirst({ where: { id: segmentId, workspaceId } });
  if (!segment) { const e = new Error('Segment not found'); e.status = 404; throw e; }
  let contactId = contactData.contactId;
  if (!contactId) {
    // Accept phoneNumber (canonical) or the legacy `phone` alias the UI used to send.
    const rawPhone = contactData.phoneNumber ?? contactData.phone;
    if (!String(rawPhone ?? '').trim()) { const e = new Error('Phone number is required'); e.status = 400; throw e; }
    const { phoneNumber, country } = await resolveContactPhone(workspaceId, rawPhone);
    // Re-use an existing contact with the same number instead of creating a duplicate.
    const existing = await findContactByPhone(workspaceId, phoneNumber, { country });
    if (existing) {
      contactId = existing.id;
      if (contactData.name && !existing.name) {
        await prisma.contact.update({ where: { id: existing.id }, data: { name: contactData.name } });
      }
    } else {
      await assertContactCapacity(workspaceId);
      // Contact.name is required; the number stands in, as on every other path.
      const newContact = await prisma.contact.create({ data: { workspaceId, name: contactData.name || phoneNumber, phoneNumber, email: contactData.email || null, tags: contactData.tags || [] } });
      contactId = newContact.id;
    }
  } else {
    // Ensure contact belongs to workspace
    const existing = await prisma.contact.findFirst({ where: { id: contactId, workspaceId } });
    if (!existing) { const e = new Error('Contact not found'); e.status = 404; throw e; }
  }
  // Connect contact to segment via many-to-many relation
  await prisma.segment.update({ where: { id: segmentId }, data: { contacts: { connect: { id: contactId } } } });
  return { segmentId, contactId };
}

// Update contact details within a segment (delegates to contacts service logic)
export async function updateContactInSegment(workspaceId, segmentId, contactId, updates) {
  // Verify association
  const association = await prisma.segment.findFirst({ where: { id: segmentId, workspaceId }, include: { contacts: { where: { id: contactId } } } });
  if (!association || association.contacts.length === 0) { const e = new Error('Contact not linked to segment'); e.status = 404; throw e; }
  // Whitelist contact fields — blocks workspaceId/id/createdAt overwrite.
  const data = {};
  for (const key of ['name', 'phoneNumber', 'email', 'tags']) {
    if (updates[key] !== undefined) data[key] = updates[key];
  }
  // Legacy alias: older clients send `phone` instead of `phoneNumber`.
  if (data.phoneNumber === undefined && updates.phone !== undefined) data.phoneNumber = updates.phone;
  if (data.phoneNumber !== undefined) {
    if (!String(data.phoneNumber ?? '').trim()) { const e = new Error('Phone number is required'); e.status = 400; throw e; }
    const { phoneNumber, country } = await resolveContactPhone(workspaceId, data.phoneNumber);
    const clash = await findContactByPhone(workspaceId, phoneNumber, { country });
    if (clash && clash.id !== contactId) { const e = new Error('A contact with this phone number already exists'); e.status = 409; throw e; }
    data.phoneNumber = phoneNumber;
  }
  const updated = await prisma.contact.update({ where: { id: contactId }, data });
  if (typeof updates.optedOut !== 'boolean' || updates.optedOut === updated.optedOut) return updated;
  // Through the OptOut list, so the flag and the blocked-numbers list agree.
  await setContactOptOut(workspaceId, contactId, updates.optedOut);
  return prisma.contact.findUnique({ where: { id: contactId } });
}

// Remove contact from segment (does not delete contact entirely)
export async function removeContactFromSegment(workspaceId, segmentId, contactId) {
  const segment = await prisma.segment.findFirst({ where: { id: segmentId, workspaceId } });
  if (!segment) { const e = new Error('Segment not found'); e.status = 404; throw e; }
  await prisma.segment.update({ where: { id: segmentId }, data: { contacts: { disconnect: { id: contactId } } } });
  return { segmentId, contactId };
}
