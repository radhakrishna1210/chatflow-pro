import { parse } from 'csv-parse/sync';
import { prisma } from '../lib/prisma.js';
import { normalizePhone, isValidPhone } from './contacts.service.js';
import { computeLeadScore } from './leadScoring.service.js';

const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED', 'LOST'];

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
export function previewLeadImport(buffer, { limit = 20 } = {}) {
  const records = parseCsv(buffer);
  if (records.length === 0) {
    const e = new Error('That file has no rows'); e.status = 400; throw e;
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

    const status = mapping.status ? String(record[mapping.status] || '').trim().toUpperCase().replace(/\s+/g, '_') : '';
    if (status && !LEAD_STATUSES.includes(status)) {
      issues.push(`Unknown status "${record[mapping.status]}" — it will be imported as NEW`);
    }

    if (issues.some((m) => m.startsWith('Phone') || m.startsWith('Missing') || m.startsWith('Duplicate'))) invalid += 1;
    else valid += 1;

    if (rows.length < limit) {
      rows.push({
        line: i + 2, // +1 for zero-index, +1 for the header row
        name: mapping.name ? record[mapping.name] : phoneNumber,
        phoneNumber: phoneNumber ?? rawPhone,
        email: mapping.email ? record[mapping.email] : null,
        status: LEAD_STATUSES.includes(status) ? status : 'NEW',
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
 * that is already a lead is left alone.
 */
export async function importLeads(workspaceId, buffer, { ownerUserId = null } = {}) {
  const { mapping } = previewLeadImport(buffer, { limit: 0 });
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

    const status = mapping.status ? String(record[mapping.status] || '').trim().toUpperCase().replace(/\s+/g, '_') : '';
    candidates.push({
      phoneNumber,
      name: (mapping.name ? String(record[mapping.name] || '').trim() : '') || phoneNumber,
      email: mapping.email ? String(record[mapping.email] || '').trim() || null : null,
      status: LEAD_STATUSES.includes(status) ? status : 'NEW',
      source: mapping.source ? String(record[mapping.source] || '').trim() || null : null,
      notes: mapping.notes ? String(record[mapping.notes] || '').trim() || null : null,
    });
  }

  let contactsCreated = 0;
  let leadsCreated = 0;
  let alreadyLeads = 0;

  for (const row of candidates) {
    let contact = await prisma.contact.findFirst({
      where: { workspaceId, phoneNumber: row.phoneNumber },
      select: { id: true },
    });

    if (!contact) {
      contact = await prisma.contact.create({
        data: { workspaceId, name: row.name, phoneNumber: row.phoneNumber, email: row.email },
        select: { id: true },
      });
      contactsCreated += 1;
    }

    const existingLead = await prisma.lead.findUnique({ where: { contactId: contact.id }, select: { id: true } });
    if (existingLead) { alreadyLeads += 1; continue; }

    // Score on import so the list is immediately sortable rather than showing
    // a wall of zeroes until someone recalculates.
    const score = await computeLeadScore(workspaceId, contact.id).catch(() => null);

    await prisma.lead.create({
      data: {
        workspaceId,
        contactId: contact.id,
        status: row.status,
        source: row.source,
        notes: row.notes,
        ownerUserId,
        score: score?.score ?? 0,
        scoreFactors: score?.factors ?? undefined,
        scoreComputedAt: score ? new Date() : null,
      },
    });
    leadsCreated += 1;
  }

  return {
    totalRows: records.length,
    imported: leadsCreated,
    contactsCreated,
    alreadyLeads,
    skipped: errors.length,
    errors: errors.slice(0, 100),
  };
}
