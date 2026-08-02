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
  // flag, and the two must never disagree.
  if (contactId) {
    await prisma.contact
      .update({ where: { id: contactId }, data: { optedOut: true, optedOutAt: new Date() } })
      .catch(() => {});
  } else {
    await prisma.contact
      .updateMany({
        where: { workspaceId, phoneNumber: { in: [String(phoneNumber), digits, `+${digits}`] } },
        data: { optedOut: true, optedOutAt: new Date() },
      })
      .catch(() => {});
  }

  return row;
}

export async function isOptedOut(workspaceId, phoneNumber) {
  const digits = normalizePhone(phoneNumber);
  if (!workspaceId || !digits) return false;
  const row = await prisma.optOut.findUnique({
    where: { workspaceId_phoneNumber: { workspaceId, phoneNumber: digits } },
    select: { active: true },
  });
  return !!row?.active;
}

// Throws a 403 the API layer can return verbatim. Used by every
// caller-facing send path (public API, playground, direct sends).
export async function assertNotOptedOut(workspaceId, phoneNumber) {
  if (await isOptedOut(workspaceId, phoneNumber)) {
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
  const rows = await prisma.optOut.findMany({
    where: { workspaceId, active: true, phoneNumber: { in: digits } },
    select: { phoneNumber: true },
  });
  return new Set(rows.map((r) => r.phoneNumber));
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
    prisma.optOut.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
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

  const phones = rows.flatMap((r) => [r.phoneNumber, `+${r.phoneNumber}`, ...(r.rawPhone ? [r.rawPhone] : [])]);
  await prisma.contact
    .updateMany({ where: { workspaceId, phoneNumber: { in: [...new Set(phones)] } }, data: { optedOut: false, optedOutAt: null } })
    .catch(() => {});

  return { unblocked: count };
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
  const { data } = await listOptOuts(workspaceId, { status, search, page: 1, limit: 200 });
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
