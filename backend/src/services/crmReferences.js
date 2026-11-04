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

// An owner/assignee id arrives straight from the client. Without this check a
// lead, deal or ticket could be "owned" by a user of another workspace — whose
// name and email the record's `owner` include then reads back — and record
// scoping (which keys off the owner) would hide it from everyone here.
export async function assertWorkspaceMember(workspaceId, userId, label = 'Owner') {
  if (!userId) return;
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { userId: true },
  });
  if (!member) {
    const e = new Error(`${label} is not a member of this workspace`);
    e.status = 400;
    throw e;
  }
}

// AND-combines Prisma `where` fragments. Record scope is itself an `OR`, so it
// can never be spread next to another `OR` (a status or stage filter, a search)
// — the later key silently replaces the earlier one and the scope disappears.
export function andWhere(...parts) {
  const real = parts.filter((p) => p && Object.keys(p).length > 0);
  return real.length ? { AND: real } : {};
}

// Runs a create that takes the next sequential number (Q-0042, T-0042). Two
// concurrent creates both read the same "last" number inside their own
// transactions — read committed does not serialise them — and the loser hit
// the (workspaceId, number) unique constraint as a bare 500. The unique index
// is the real arbiter, so on a collision the whole create is simply retried.
export async function withSequentialNumber(run, { attempts = 5 } = {}) {
  for (let i = 1; ; i += 1) {
    try {
      return await run();
    } catch (err) {
      const target = String(err?.meta?.target ?? '');
      const numberClash = err?.code === 'P2002' && /number/i.test(target);
      if (!numberClash || i >= attempts) throw err;
    }
  }
}
