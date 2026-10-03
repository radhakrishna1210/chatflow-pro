import { parse } from 'csv-parse/sync';
import { prisma } from '../lib/prisma.js';
import { normalizePhone, isValidPhone } from './contacts.service.js';
import { phoneVariants, workspacePhoneCountry } from '../lib/phone.js';
import { loadLeadIntakeRules, prepareLeadIntake } from './leadIntake.service.js';
import { assertContactCapacity } from './subscription.service.js';

// The import runs inside the request, so the file is capped at a size that
// finishes well within proxy timeouts. Writes are batched per chunk.
export const MAX_IMPORT_ROWS = 5000;
const CHUNK = 500;

// Customize Your Business rules for an import (lifecycle, sources, lead tags,
// prospecting), read once and applied to every row.
export const loadImportRules = loadLeadIntakeRules;

const splitTags = (v) => String(v || '').split(/[;,|]/).map((t) => t.trim()).filter(Boolean);

/**
 * One row through the shared lead intake, leniently: nobody can correct a
 * row mid-import, so an unknown status takes the lifecycle default, an
 * unknown source falls back to a configured one, unconfigured tags are
 * dropped and a missing required detail marks the lead not qualified. Every
 * adjustment comes back as a warning for the preview and the result.
 *
 * CONVERTED is not importable: a converted lead points at the deal it became,
 * and an import cannot create that deal.
 */
function rowIntake(rules, record, mapping, phoneNumber) {
  const cell = (field) => (mapping[field] ? String(record[mapping[field]] ?? '').trim() : '');
  const rawStatus = cell('status');
  const converted = rawStatus.toUpperCase() === 'CONVERTED';
  const intake = prepareLeadIntake(rules, {
    status: converted ? null : rawStatus,
    source: cell('source') || null,
    tags: splitTags(cell('tags')),
    phone: phoneNumber,
    email: cell('email') || null,
    company: cell('company') || null,
  }, { strict: false });
  if (converted) intake.warnings.unshift(`Converted leads cannot be imported without their deal — imported as ${intake.statusKey || intake.status}`);
  return intake;
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
  tags: ['tags', 'tag', 'labels'],
  company: ['company', 'company name', 'organisation', 'organization', 'business'],
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
export function previewLeadImport(buffer, { limit = 20, rules = null, country } = {}) {
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

    const phoneNumber = isValidPhone(rawPhone, { country }) ? normalizePhone(rawPhone, { country }) : null;
    if (!phoneNumber) {
      issues.push(String(rawPhone || '').trim() ? 'Phone number must contain 7–15 digits' : 'Missing phone number');
    }

    if (phoneNumber && seen.has(phoneNumber)) {
      issues.push('Duplicate of an earlier row in this file');
      duplicateInFile += 1;
    }
    if (phoneNumber) seen.add(phoneNumber);


    // Only phone problems skip a row; the rest are adjustments it imports with.
    const skipped = issues.length > 0;
    const intake = rowIntake(rules, record, mapping, phoneNumber);
    issues.push(...intake.warnings);
    if (skipped) invalid += 1;
    else valid += 1;

    if (rows.length < limit) {
      rows.push({
        line: i + 2, // +1 for zero-index, +1 for the header row
        name: mapping.name ? record[mapping.name] : phoneNumber,
        phoneNumber: phoneNumber ?? rawPhone,
        email: mapping.email ? record[mapping.email] : null,
        status: intake.statusKey || intake.status,
        source: intake.source,
        tags: intake.tags,
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

  const rules = await loadImportRules(workspaceId);
  const country = await workspacePhoneCountry(workspaceId);
  const { mapping } = previewLeadImport(buffer, { limit: 0, rules, country });
  const records = parseCsv(buffer);

  const seen = new Set();
  const candidates = [];
  const errors = [];
  const warnings = [];

  for (const [i, record] of records.entries()) {
    const line = i + 2;
    const rawPhone = record[mapping.phoneNumber];

    const phoneNumber = isValidPhone(rawPhone, { country }) ? normalizePhone(rawPhone, { country }) : '';
    if (!phoneNumber) {
      errors.push({ line, reason: 'Invalid or missing phone number', value: String(rawPhone || '') });
      continue;
    }
    if (seen.has(phoneNumber)) {
      errors.push({ line, reason: 'Duplicate row in file', value: phoneNumber });
      continue;
    }
    seen.add(phoneNumber);

    const intake = rowIntake(rules, record, mapping, phoneNumber);
    for (const reason of intake.warnings) warnings.push({ line, reason });
    candidates.push({
      phoneNumber,
      name: (mapping.name ? String(record[mapping.name] || '').trim() : '') || phoneNumber,
      email: mapping.email ? String(record[mapping.email] || '').trim() || null : null,
      status: intake.status,
      source: intake.source,
      tags: intake.tags,
      customFields: intake.customFields,
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

    // Matched under every stored spelling, so a contact saved before numbers
    // were normalised ("09876543210") is reused rather than duplicated.
    const canonicalOf = new Map();
    for (const phone of phones) {
      for (const v of phoneVariants(phone, { country })) canonicalOf.set(v, phone);
    }
    const existing = await prisma.contact.findMany({
      where: { workspaceId, phoneNumber: { in: [...canonicalOf.keys()] } },
      select: { id: true, phoneNumber: true, tags: true },
    });
    const contactIdByPhone = new Map();
    const existingTags = new Map();
    for (const c of existing) {
      const phone = canonicalOf.get(c.phoneNumber);
      // The canonical row wins when a legacy duplicate also exists.
      if (!contactIdByPhone.has(phone) || c.phoneNumber === phone) {
        contactIdByPhone.set(phone, c.id);
        existingTags.set(c.id, c.tags || []);
      }
    }

    const missing = chunk.filter((r) => !contactIdByPhone.has(r.phoneNumber));
    if (missing.length) {
      // skipDuplicates: a contact created concurrently (inbound message, form)
      // is simply picked up by the re-read below.
      const created = await prisma.contact.createManyAndReturn({
        data: missing.map((r) => ({ workspaceId, name: r.name, phoneNumber: r.phoneNumber, email: r.email, tags: r.tags })),
        skipDuplicates: true,
        select: { id: true, name: true, phoneNumber: true, email: true, tags: true, createdAt: true },
      });
      contactsCreated += created.length;
      // contact.created for the rows this import inserted (not the ones a
      // concurrent inbound message created first).
      if (created.length) {
        import('./outgoingWebhook.service.js')
          .then((m) => m.emitContactsCreated(workspaceId, created, { source: 'lead_import' }))
          .catch((err) => console.warn('[Webhook:out] contact.created not sent:', err.message));
      }
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

    // An existing contact that becomes a lead gets the row's lead tags added
    // to its own (new contacts were created with them above).
    for (const r of toCreate) {
      const contactId = contactIdByPhone.get(r.phoneNumber);
      const had = existingTags.get(contactId);
      if (!had || r.tags.length === 0) continue;
      const merged = [...new Set([...had, ...r.tags])];
      if (merged.length !== had.length) await prisma.contact.update({ where: { id: contactId }, data: { tags: merged } });
    }

    const leads = await prisma.lead.createManyAndReturn({
      data: toCreate.map((r) => ({
        workspaceId,
        contactId: contactIdByPhone.get(r.phoneNumber),
        status: r.status,
        source: r.source,
        notes: r.notes,
        ownerUserId,
        customFields: r.customFields,
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
    // Rows imported with a value adjusted to the workspace's lead rules.
    warnings: warnings.slice(0, 100),
    followUp,
  };
}
