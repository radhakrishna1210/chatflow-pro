import { prisma } from '../lib/prisma.js';

// Tasks and CRM activities both accept lead/deal/contact ids and an assignee
// straight from the client. A Zod schema can only prove those are strings —
// it cannot prove they belong to the caller's workspace, and Prisma will
// happily write a foreign id because the FK constraint only checks the row
// exists, not who owns it. Every such reference is resolved here first.
async function assertOwned(model, id, workspaceId, label) {
  const row = await prisma[model].findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!row) {
    const e = new Error(`${label} not found in this workspace`);
    e.status = 404;
    throw e;
  }
}

// A user id is only a valid owner/assignee if that user is a member of this
// workspace. The FK alone accepts a removed member or someone from another
// workspace, whose name and email the record's include would then disclose.
export async function assertWorkspaceMember(workspaceId, userId, label = 'Owner') {
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { userId: true },
  });
  if (!member) {
    const e = new Error(`${label} is not a member of this workspace`);
    e.status = 404;
    throw e;
  }
}

const OWNED_REFERENCES = [
  ['teamId', 'team', 'Team'],
  ['contactId', 'contact', 'Contact'],
  ['conversationId', 'conversation', 'Conversation'],
];

// Checks the owner/team (and, where present, contact/conversation) ids on a
// lead, deal or ticket payload. Absent or null ids are left alone: null is how
// a caller clears an owner.
export async function assertRecordReferences(workspaceId, body = {}) {
  const checks = [];
  if (body.ownerUserId) checks.push(assertWorkspaceMember(workspaceId, body.ownerUserId, 'Owner'));
  for (const [field, model, label] of OWNED_REFERENCES) {
    if (body[field]) checks.push(assertOwned(model, body[field], workspaceId, label));
  }
  await Promise.all(checks);
}

// Resolves the shared lead/deal/contact/assignee references on a task or
// activity payload. Returns only the keys that were supplied, so callers can
// spread the result over an update without resurrecting absent fields.
export async function resolveCrmReferences(workspaceId, body, { includeAssignee = false } = {}) {
  const checks = [];
  const resolved = {};

  if (body.leadId !== undefined) {
    resolved.leadId = body.leadId;
    if (body.leadId) checks.push(assertOwned('lead', body.leadId, workspaceId, 'Lead'));
  }
  if (body.dealId !== undefined) {
    resolved.dealId = body.dealId;
    if (body.dealId) checks.push(assertOwned('deal', body.dealId, workspaceId, 'Deal'));
  }
  if (body.contactId !== undefined) {
    resolved.contactId = body.contactId;
    if (body.contactId) checks.push(assertOwned('contact', body.contactId, workspaceId, 'Contact'));
  }

  if (includeAssignee && body.assignedToUserId !== undefined) {
    resolved.assignedToUserId = body.assignedToUserId;
    if (body.assignedToUserId) {
      checks.push(assertWorkspaceMember(workspaceId, body.assignedToUserId, 'Assignee'));
    }
  }

  await Promise.all(checks);
  return resolved;
}
