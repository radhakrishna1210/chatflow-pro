import { prisma } from '../lib/prisma.js';

// WhatsApp opt-out ("STOP") handling. One rule, enforced in one place: if a
// number is on this workspace's OptOut list, nothing may be sent to it —
// campaigns, scheduled campaigns, automations, broadcasts, triggers, API
// sends, template sends, welcome messages and follow-ups all funnel through
// assertNotOptedOut()/isOptedOut() below.

// Bare digits, so "+91 98765 43210", "91 98765-43210" and "919876543210" all
// resolve to the same row. Mirrors the normalisation the campaign worker and
// the inbound webhook already use.
export const normalizePhone = (raw) => String(raw ?? '').replace(/\D/g, '');

// The accepted opt-out phrases. Stored normalised (lowercase, single-spaced)
// because that is exactly what normalizeMessage() produces.
const OPT_OUT_KEYWORDS = [
  'stop',
  'unsubscribe',
  'end',
  'quit',
  'cancel',
  'remove',
  'please stop',
  'no thanks',
];

// Longest first so "please stop" wins over "stop" when reporting which
// keyword matched.
const KEYWORDS_BY_LENGTH = [...OPT_OUT_KEYWORDS].sort((a, b) => b.length - a.length);

// Some of these words mean two different things depending on where the
// customer is in the conversation. Typed on their own, "cancel", "quit" and
// "end" almost always mean "get me out of this form", not "never message me
// again" — and QA found that answering a form question with "cancel"
// unsubscribed the contact from the workspace outright.
//
// "stop", "unsubscribe" and friends are deliberately NOT in this set: they are
// the phrases WhatsApp expects a business to honour as an opt-out, and a flow
// being open is not a good enough reason to ignore one.
const FLOW_CONTROL_KEYWORDS = new Set(['cancel', 'quit', 'end']);

// True when this opt-out keyword should be read as "leave the current flow"
// while a form or workflow is mid-question.
export function isFlowControlKeyword(keyword) {
  return FLOW_CONTROL_KEYWORDS.has(String(keyword || '').toLowerCase());
}

export function listOptOutKeywords() {
  return [...OPT_OUT_KEYWORDS];
}

// Case-insensitive, punctuation-insensitive, whitespace-insensitive.
// "STOP", " stop ", "Stop.", "STOP!", "**stop**" all reduce to "stop".
function normalizeMessage(text) {
  return String(text ?? '')
    .toLowerCase()
    // Strip everything that isn't a letter, digit or space (punctuation,
    // emoji, zero-width joiners) — Unicode-aware so non-Latin scripts survive.
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns the matched keyword, or null. A message counts as an opt-out when
// the whole message is the keyword — "stop" opts out, "don't stop sending me
// these" does not, which is the behaviour that avoids false positives on
// ordinary conversation.
export function matchOptOutKeyword(text) {
  const normalized = normalizeMessage(text);
  if (!normalized) return null;
  return KEYWORDS_BY_LENGTH.find((kw) => normalized === kw) ?? null;
}

function serialize(row) {
  return {
    id: row.id,
    phoneNumber: row.rawPhone || row.phoneNumber,
    normalizedPhone: row.phoneNumber,
    workspaceId: row.workspaceId,
    waPhone: row.waPhone,
    contactId: row.contactId,
    keyword: row.keyword,
    reason: row.reason,
    source: row.source,
    blockedBy: row.blockedByName || (row.blockedByUserId ? 'Workspace member' : 'Recipient'),
    active: row.active,
    blockedAt: row.createdAt,
    unblockedAt: row.unblockedAt,
  };
}

// Idempotent: a second STOP from the same number updates the existing row
// rather than creating a duplicate or throwing on the unique constraint.
export async function recordOptOut({
  workspaceId,
  phoneNumber,
  waNumberId = null,
  waPhone = null,
  contactId = null,
  keyword = null,
  reason = 'User Opted Out',
  source = 'Incoming WhatsApp Message',
  blockedByUserId = null,
  blockedByName = null,
}) {
  const digits = normalizePhone(phoneNumber);
  if (!workspaceId || !digits) return null;

  const data = {
    rawPhone: String(phoneNumber),
    waNumberId,
    waPhone,
    contactId,
    keyword,
    reason,
    source,
    blockedByUserId,
    blockedByName,
    active: true,
    unblockedAt: null,
    unblockedByUserId: null,
  };

  const row = await prisma.optOut.upsert({
    where: { workspaceId_phoneNumber: { workspaceId, phoneNumber: digits } },
    update: data,
    create: { workspaceId, phoneNumber: digits, ...data },
  });

  // Keep Contact.optedOut in step — the contacts UI and older code read that
  // flag. The OptOut row written above already blocks every send path (see
  // isOptedOut), so a failure here is logged rather than failing the opt-out.
  const flag = { optedOut: true, optedOutAt: new Date() };
  const sync = contactId
    ? prisma.contact.update({ where: { id: contactId }, data: flag })
    : prisma.contact.updateMany({ where: { workspaceId, phoneNumber: { in: phoneVariants(phoneNumber) } }, data: flag });
  await sync.catch((err) => console.error(`[OptOut] Could not flag contact for ${digits}:`, err.message));

  return row;
}

// Every stored spelling a contact's number may have for the same digits.
function phoneVariants(phoneNumber) {
  const digits = normalizePhone(phoneNumber);
  return [...new Set([String(phoneNumber), digits, `+${digits}`])];
}

/**
 * The single opt-out check every send path uses (inbox, automated replies,
 * campaigns, sequences, public API, OTP). A number is opted out when the
 * workspace's OptOut list has an active row for it OR a contact with that
 * number is flagged `optedOut`. The two are written together (recordOptOut,
 * unblockNumbers, setContactOptOut); reading both means any divergence fails
 * closed.
 *
 * Pass `contact` when the caller already loaded it ({ optedOut }) to skip the
 * contact lookup.
 */
export async function isOptedOut(workspaceId, phoneNumber, { contact } = {}) {
  const digits = normalizePhone(phoneNumber);
  if (!workspaceId || !digits) return contact?.optedOut === true;
  if (contact?.optedOut === true) return true;

  const row = await prisma.optOut.findUnique({
    where: { workspaceId_phoneNumber: { workspaceId, phoneNumber: digits } },
    select: { active: true },
  });
  if (row?.active) return true;
  if (contact) return false;

  const flagged = await prisma.contact.findFirst({
    where: { workspaceId, optedOut: true, phoneNumber: { in: phoneVariants(phoneNumber) } },
    select: { id: true },
  });
  return !!flagged;
}

// Throws a 403 the API layer can return verbatim. Used by every
// caller-facing send path (public API, playground, direct sends).
export async function assertNotOptedOut(workspaceId, phoneNumber, options) {
  if (await isOptedOut(workspaceId, phoneNumber, options)) {
    const e = new Error('Recipient opted out');
    e.status = 403;
    e.code = 'RECIPIENT_OPTED_OUT';
    throw e;
  }
}

// Bulk check for campaign launch / cost estimation. Returns a Set of the
// normalised numbers that are blocked, so callers can partition a recipient
// list in one query instead of N.
export async function getOptedOutPhoneSet(workspaceId, phoneNumbers = []) {
  const digits = [...new Set(phoneNumbers.map(normalizePhone).filter(Boolean))];
  if (!workspaceId || digits.length === 0) return new Set();
  const [rows, flagged] = await Promise.all([
    prisma.optOut.findMany({
      where: { workspaceId, active: true, phoneNumber: { in: digits } },
      select: { phoneNumber: true },
    }),
    prisma.contact.findMany({
      where: { workspaceId, optedOut: true, phoneNumber: { in: [...new Set(phoneNumbers.flatMap(phoneVariants))] } },
      select: { phoneNumber: true },
    }),
  ]);
  return new Set([...rows.map((r) => r.phoneNumber), ...flagged.map((c) => normalizePhone(c.phoneNumber))]);
}

// Splits contacts into those that may be messaged and those that must be
// skipped. Contact.optedOut is honoured too, so a contact flagged directly in
// the Contacts UI is blocked even without an OptOut row.
export async function partitionByOptOut(workspaceId, contacts = []) {
  const blockedSet = await getOptedOutPhoneSet(workspaceId, contacts.map((c) => c?.phoneNumber));
  const allowed = [];
  const blocked = [];
  for (const contact of contacts) {
    const isBlocked = contact?.optedOut === true || blockedSet.has(normalizePhone(contact?.phoneNumber));
    (isBlocked ? blocked : allowed).push(contact);
  }
  return { allowed, blocked };
}

export async function listOptOuts(workspaceId, { search = '', status = 'active', page = 1, limit = 50 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

  const where = { workspaceId };
  if (status === 'active') where.active = true;
  else if (status === 'unblocked') where.active = false;

  const term = String(search || '').trim();
  if (term) {
    const digits = normalizePhone(term);
    where.OR = [
      ...(digits ? [{ phoneNumber: { contains: digits } }] : []),
      { rawPhone: { contains: term, mode: 'insensitive' } },
      { keyword: { contains: term, mode: 'insensitive' } },
      { reason: { contains: term, mode: 'insensitive' } },
    ];
  }

  const [rows, total, activeCount] = await Promise.all([
    prisma.optOut.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
    prisma.optOut.count({ where }),
    prisma.optOut.count({ where: { workspaceId, active: true } }),
  ]);

  return { data: rows.map(serialize), total, page: Math.max(Number(page) || 1, 1), limit: take, activeCount };
}

// Unblocking clears both the OptOut row and the contact flag, so the number
// becomes messageable again everywhere at once.
export async function unblockNumbers(workspaceId, ids = [], userId = null) {
  const list = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean))];
  if (list.length === 0) { const e = new Error('Select at least one number to unblock'); e.status = 400; throw e; }

  const rows = await prisma.optOut.findMany({ where: { workspaceId, id: { in: list } } });
  if (rows.length === 0) { const e = new Error('No matching blocked numbers found'); e.status = 404; throw e; }

  const { count } = await prisma.optOut.updateMany({
    where: { workspaceId, id: { in: rows.map((r) => r.id) }, active: true },
    data: { active: false, unblockedAt: new Date(), unblockedByUserId: userId },
  });

  // Not swallowed: a contact left flagged keeps the number blocked (isOptedOut
  // reads both), so a failure here means the unblock did not take effect.
  const phones = rows.flatMap((r) => [r.phoneNumber, `+${r.phoneNumber}`, ...(r.rawPhone ? [r.rawPhone] : [])]);
  await prisma.contact
    .updateMany({ where: { workspaceId, phoneNumber: { in: [...new Set(phones)] } }, data: { optedOut: false, optedOutAt: null } });

  return { unblocked: count };
}

// A workspace member flipping a contact's opt-out flag (Contacts screen,
// segment editor). Routed through the OptOut list so both sources agree.
export async function setContactOptOut(workspaceId, contactId, optedOut, user = null) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId },
    select: { id: true, phoneNumber: true },
  });
  if (!contact) { const e = new Error('Contact not found'); e.status = 404; throw e; }

  if (optedOut) {
    await recordOptOut({
      workspaceId,
      phoneNumber: contact.phoneNumber,
      contactId: contact.id,
      reason: 'Marked as opted out by a workspace member',
      source: 'Contacts',
      blockedByUserId: user?.id ?? null,
      blockedByName: user?.name ?? null,
    });
    return;
  }

  const rows = await prisma.optOut.findMany({
    where: { workspaceId, phoneNumber: normalizePhone(contact.phoneNumber), active: true },
    select: { id: true },
  });
  if (rows.length > 0) await unblockNumbers(workspaceId, rows.map((r) => r.id), user?.id ?? null);
  await prisma.contact.update({ where: { id: contact.id }, data: { optedOut: false, optedOutAt: null } });
}

// Manual block from the admin UI — same row shape as a customer-initiated
// STOP, only the source and blockedBy differ.
export async function blockNumberManually(workspaceId, { phoneNumber, reason }, user = null) {
  const digits = normalizePhone(phoneNumber);
  if (digits.length < 6) { const e = new Error('Enter a valid phone number'); e.status = 400; throw e; }

  const contact = await prisma.contact.findFirst({
    where: { workspaceId, phoneNumber: { in: [String(phoneNumber), digits, `+${digits}`] } },
    select: { id: true },
  });

  const row = await recordOptOut({
    workspaceId,
    phoneNumber,
    contactId: contact?.id ?? null,
    keyword: null,
    reason: String(reason || '').trim() || 'Blocked by admin',
    source: 'Admin Panel',
    blockedByUserId: user?.id ?? null,
    blockedByName: user?.name ?? null,
  });

  return serialize(row);
}

const csvCell = (value) => {
  const text = value == null ? '' : String(value);
  // Prefix formula-triggering characters so a phone number like "+9198…"
  // can't be interpreted as a formula when the export is opened in Excel.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function exportOptOutsCsv(workspaceId, { status = 'active', search = '' } = {}) {
  // Every page, not just the first: the export used to stop silently at the
  // list's 200-row page size (CF-048).
  const data = [];
  for (let page = 1; ; page += 1) {
    const { data: rows } = await listOptOuts(workspaceId, { status, search, page, limit: 200 });
    data.push(...rows);
    if (rows.length < 200) break;
  }
  const header = ['Phone Number', 'Workspace', 'Blocked Date', 'Blocked Time', 'Reason', 'Blocked By', 'Keyword', 'Source', 'Status'];
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });

  const rows = data.map((row) => {
    const at = new Date(row.blockedAt);
    return [
      row.phoneNumber,
      workspace?.name || workspaceId,
      at.toLocaleDateString('en-IN'),
      at.toLocaleTimeString('en-IN'),
      row.reason,
      row.blockedBy,
      row.keyword || '—',
      row.source,
      row.active ? 'Blocked' : 'Unblocked',
    ].map(csvCell).join(',');
  });

  return [header.map(csvCell).join(','), ...rows].join('\n');
}
