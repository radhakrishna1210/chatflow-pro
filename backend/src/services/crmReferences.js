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
      checks.push(
        (async () => {
          const member = await prisma.workspaceMember.findUnique({
            where: { userId_workspaceId: { userId: body.assignedToUserId, workspaceId } },
            select: { userId: true },
          });
          if (!member) {
            const e = new Error('Assignee is not a member of this workspace');
            e.status = 404;
            throw e;
          }
        })(),
      );
    }
  }

  await Promise.all(checks);
  return resolved;
}
