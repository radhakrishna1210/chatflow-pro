import { parse } from 'csv-parse/sync';
import { prisma } from '../lib/prisma.js';
import { normalizePhone, isValidPhone } from './contacts.service.js';
import { getSection } from './crmCustomization.service.js';
import { assertContactCapacity } from './subscription.service.js';

// CONVERTED is left out on purpose: a converted lead points at the deal it
// became, and an import cannot create that deal.
const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'LOST'];

// The import runs inside the request, so the file is capped at a size that
// finishes well within proxy timeouts. Writes are batched per chunk.
export const MAX_IMPORT_ROWS = 5000;
const CHUNK = 500;

const normaliseStatus = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, '_');

// Custom lifecycle stages configured under Customize, so an exported file
// re-imports into the same stages instead of collapsing to NEW.
export async function loadCustomStatuses(workspaceId) {
  const config = await getSection(workspaceId, 'lead_lifecycle').catch((err) => { console.warn(`[CrmImport] Lead lifecycle config unavailable for ${workspaceId}; using defaults:`, err.message); return null; });
  const stages = Array.isArray(config?.stages) ? config.stages : [];
  const map = new Map();
  for (const stage of stages) {
    if (!stage?.key || LEAD_STATUSES.includes(stage.key) || stage.key === 'CONVERTED') continue;
    map.set(normaliseStatus(stage.key), stage.key);
    if (stage.label) map.set(normaliseStatus(stage.label), stage.key);
  }
  return map;
}

// -> { status, statusKey, warning }
function resolveStatus(raw, customStatuses) {
  const normalised = normaliseStatus(raw);
  if (!normalised) return { status: 'NEW', statusKey: null, warning: null };
  if (LEAD_STATUSES.includes(normalised)) return { status: normalised, statusKey: null, warning: null };
  if (customStatuses?.has(normalised)) return { status: 'NEW', statusKey: customStatuses.get(normalised), warning: null };
  if (normalised === 'CONVERTED') {
    return { status: 'NEW', statusKey: null, warning: 'Converted leads cannot be imported without their deal — it will be imported as NEW' };
  }
  return { status: 'NEW', statusKey: null, warning: `Unknown status "${raw}" — it will be imported as NEW` };
}

// Header aliases, so a file exported from a spreadsheet or another CRM imports
// without the user having to rename columns first.
const FIELD_ALIASES = {
  name: ['name', 'full name', 'contact name', 'lead name'],
  phoneNumber: ['phone', 'phonenumber', 'phone number', 'mobile', 'contact number', 'whatsapp'],
  email: ['email', 'e-mail', 'email address'],
  status: ['status', 'lead status', 'stage'],
  source: ['source', 'lead source', 'channel'],
  notes: ['notes', 'note', 'comments', 'remarks'],
};

const normaliseHeader = (h) => String(h || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

// Aliases are normalised with the same rule as incoming headers, so a listed
// alias like "e-mail" still matches after hyphens become spaces on both sides.
const NORMALISED_ALIASES = Object.fromEntries(
  Object.entries(FIELD_ALIASES).map(([field, aliases]) => [field, aliases.map(normaliseHeader)]),
);

// Maps the file's headers onto lead fields. Returned so the UI can show what
// was detected before anything is written.
export function detectColumns(headers) {
  const mapping = {};
  const unmapped = [];

  for (const header of headers) {
    const key = normaliseHeader(header);
    const field = Object.keys(NORMALISED_ALIASES).find((f) => NORMALISED_ALIASES[f].includes(key));
    if (field && !mapping[field]) mapping[field] = header;
    else unmapped.push(header);
  }
  return { mapping, unmapped };
}

function parseCsv(buffer) {
  try {
    return parse(buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch (err) {
    const e = new Error(`Could not read that CSV: ${err.message}`);
    e.status = 400;
    throw e;
  }
}

/**
 * Validates a lead CSV without writing anything, so the user sees exactly what
 * will happen before committing. Returns per-row problems rather than failing
 * on the first bad line.
 */
export function previewLeadImport(buffer, { limit = 20, customStatuses = null } = {}) {
  const records = parseCsv(buffer);
  if (records.length === 0) {
    const e = new Error('That file has no rows'); e.status = 400; throw e;
  }
  if (records.length > MAX_IMPORT_ROWS) {
    const e = new Error(`That file has ${records.length} rows; split it into files of at most ${MAX_IMPORT_ROWS} rows.`);
    e.status = 400;
    throw e;
  }

  const headers = Object.keys(records[0]);
  const { mapping, unmapped } = detectColumns(headers);

  if (!mapping.phoneNumber) {
    const e = new Error('No phone number column found. Expected a column named "phone", "mobile" or similar.');
    e.status = 400;
    throw e;
  }

  const seen = new Set();
  const rows = [];
  let valid = 0;
  let invalid = 0;
  let duplicateInFile = 0;

  for (const [i, record] of records.entries()) {
    const rawPhone = record[mapping.phoneNumber];
    const issues = [];

    if (!isValidPhone(rawPhone)) {
      issues.push(String(rawPhone || '').trim() ? 'Phone number must contain 7–15 digits' : 'Missing phone number');
    }

    const phoneNumber = isValidPhone(rawPhone) ? normalizePhone(rawPhone) : null;
    if (phoneNumber && seen.has(phoneNumber)) {
      issues.push('Duplicate of an earlier row in this file');
      duplicateInFile += 1;
    }
    if (phoneNumber) seen.add(phoneNumber);

    const resolved = resolveStatus(mapping.status ? record[mapping.status] : '', customStatuses);
    if (resolved.warning) issues.push(resolved.warning);

    if (issues.some((m) => m.startsWith('Phone') || m.startsWith('Missing') || m.startsWith('Duplicate'))) invalid += 1;
    else valid += 1;

    if (rows.length < limit) {
      rows.push({
        line: i + 2, // +1 for zero-index, +1 for the header row
        name: mapping.name ? record[mapping.name] : phoneNumber,
        phoneNumber: phoneNumber ?? rawPhone,
        email: mapping.email ? record[mapping.email] : null,
        status: resolved.statusKey || resolved.status,
        issues,
      });
    }
  }

  return {
    totalRows: records.length,
    valid,
    invalid,
    duplicateInFile,
    mapping,
    unmapped,
    preview: rows,
  };
}

/**
 * Imports leads. Rows that fail validation are skipped and reported rather
 * than aborting the run, so one malformed line in a thousand does not cost the
 * user the whole file.
 *
 * A contact that already exists is reused rather than duplicated, and a contact
 * that is already a lead is left alone. Contacts and leads are written in
 * batches; scoring, HOT/WARM/COLD and distribution rules then run in the
 * background (crm-maintenance queue) so the request does not wait on them.
 * lead_created is deliberately not emitted per row: a bulk import must not
 * fire thousands of automations that may message customers.
 */
export async function importLeads(workspaceId, buffer, { ownerUserId = null } = {}) {
  if (ownerUserId) {
    const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId: ownerUserId }, select: { userId: true } });
    if (!member) { const e = new Error('Owner must be a member of this workspace'); e.status = 400; throw e; }
  }

  const customStatuses = await loadCustomStatuses(workspaceId);
  const { mapping } = previewLeadImport(buffer, { limit: 0, customStatuses });
  const records = parseCsv(buffer);

  const seen = new Set();
  const candidates = [];
  const errors = [];

  for (const [i, record] of records.entries()) {
    const line = i + 2;
    const rawPhone = record[mapping.phoneNumber];

    if (!isValidPhone(rawPhone)) {
      errors.push({ line, reason: 'Invalid or missing phone number', value: String(rawPhone || '') });
      continue;
    }
    const phoneNumber = normalizePhone(rawPhone);
    if (seen.has(phoneNumber)) {
      errors.push({ line, reason: 'Duplicate row in file', value: phoneNumber });
      continue;
    }
    seen.add(phoneNumber);

    const { status, statusKey } = resolveStatus(mapping.status ? record[mapping.status] : '', customStatuses);
    candidates.push({
      phoneNumber,
      name: (mapping.name ? String(record[mapping.name] || '').trim() : '') || phoneNumber,
      email: mapping.email ? String(record[mapping.email] || '').trim() || null : null,
      status,
      statusKey,
      source: mapping.source ? String(record[mapping.source] || '').trim() || null : null,
      notes: mapping.notes ? String(record[mapping.notes] || '').trim() || null : null,
    });
  }

  await assertContactCapacity(workspaceId, { phoneNumbers: candidates.map((c) => c.phoneNumber) });

  let contactsCreated = 0;
  let leadsCreated = 0;
  let alreadyLeads = 0;
  const createdLeadIds = [];

  for (let start = 0; start < candidates.length; start += CHUNK) {
    const chunk = candidates.slice(start, start + CHUNK);
    const phones = chunk.map((r) => r.phoneNumber);

    const existing = await prisma.contact.findMany({
      where: { workspaceId, phoneNumber: { in: phones } },
      select: { id: true, phoneNumber: true },
    });
    const contactIdByPhone = new Map(existing.map((c) => [c.phoneNumber, c.id]));

    const missing = chunk.filter((r) => !contactIdByPhone.has(r.phoneNumber));
    if (missing.length) {
      // skipDuplicates: a contact created concurrently (inbound message, form)
      // is simply picked up by the re-read below.
      const created = await prisma.contact.createMany({
        data: missing.map((r) => ({ workspaceId, name: r.name, phoneNumber: r.phoneNumber, email: r.email })),
        skipDuplicates: true,
      });
      contactsCreated += created.count;
      const fresh = await prisma.contact.findMany({
        where: { workspaceId, phoneNumber: { in: missing.map((r) => r.phoneNumber) } },
        select: { id: true, phoneNumber: true },
      });
      for (const c of fresh) contactIdByPhone.set(c.phoneNumber, c.id);
    }

    const leadsAlready = await prisma.lead.findMany({
      where: { contactId: { in: [...contactIdByPhone.values()] } },
      select: { contactId: true },
    });
    const isLead = new Set(leadsAlready.map((l) => l.contactId));

    const toCreate = chunk.filter((r) => contactIdByPhone.has(r.phoneNumber) && !isLead.has(contactIdByPhone.get(r.phoneNumber)));
    alreadyLeads += chunk.length - toCreate.length;
    if (toCreate.length === 0) continue;

    const leads = await prisma.lead.createManyAndReturn({
      data: toCreate.map((r) => ({
        workspaceId,
        contactId: contactIdByPhone.get(r.phoneNumber),
        status: r.status,
        source: r.source,
        notes: r.notes,
        ownerUserId,
        ...(r.statusKey ? { customFields: { statusKey: r.statusKey } } : {}),
      })),
      skipDuplicates: true,
      select: { id: true },
    });
    leadsCreated += leads.length;
    alreadyLeads += toCreate.length - leads.length;
    createdLeadIds.push(...leads.map((l) => l.id));
  }

  // Score, category and distribution need several queries per lead, so they
  // run after the response. If the queue is unavailable the nightly sweep
  // still scores them (uncategorised leads go first); distribution then needs
  // "Run on unassigned leads".
  let followUp = 'none';
  if (createdLeadIds.length) {
    try {
      const { enqueueImportFollowUp } = await import('../queues/crmMaintenance.queue.js');
      // Bounded wait: with Redis down, BullMQ would otherwise hold the request
      // open while it reconnects.
      const jobs = [];
      for (let start = 0; start < createdLeadIds.length; start += CHUNK) {
        jobs.push(enqueueImportFollowUp(workspaceId, createdLeadIds.slice(start, start + CHUNK), { distribute: !ownerUserId }));
      }
      await Promise.race([
        Promise.all(jobs),
        new Promise((_, reject) => setTimeout(() => reject(new Error('queue did not respond')), 5000).unref()),
      ]);
      followUp = 'queued';
    } catch (err) {
      console.error('[CrmImport] Could not queue scoring/distribution:', err.message);
      followUp = 'deferred';
    }
  }

  return {
    totalRows: records.length,
    imported: leadsCreated,
    contactsCreated,
    alreadyLeads,
    skipped: errors.length,
    errors: errors.slice(0, 100),
    followUp,
  };
}
