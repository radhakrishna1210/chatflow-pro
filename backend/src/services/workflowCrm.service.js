import { prisma } from '../lib/prisma.js';

// CRM events a workflow can be triggered by, and the actions it can take on a
// lead or deal. These extend the existing conversation-driven engine rather
// than forming a second one: the same Workflow rows, the same WorkflowRun
// lifecycle, the same delay/resume machinery.

export const CRM_TRIGGERS = ['lead_created', 'lead_status', 'deal_stage', 'score_above'];
export const CRM_ACTIONS = ['task', 'lead_status', 'owner', 'sequence'];

// A workflow that changes a lead's status can trigger another workflow that
// changes it back. Runs carry how deep they are, and the chain stops here.
export const MAX_CHAIN_DEPTH = 3;

const norm = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '_');

/**
 * Whether a CRM trigger node fires for a given event.
 *
 * `event` is the event name; `payload` carries what changed. A trigger with no
 * configured value matches any change of that kind, which is the intuitive
 * reading of an empty field in the builder.
 */
export function crmTriggerFires(trigger, { event, payload = {} } = {}) {
  if (!trigger || !CRM_TRIGGERS.includes(trigger.subtype)) return false;

  switch (trigger.subtype) {
    case 'lead_created':
      return event === 'lead_created';

    case 'lead_status':
      if (event !== 'lead_status_changed') return false;
      return !trigger.value || norm(trigger.value) === norm(payload.status);

    case 'deal_stage':
      if (event !== 'deal_stage_changed') return false;
      return !trigger.value || norm(trigger.value) === norm(payload.stage);

    case 'score_above': {
      if (event !== 'lead_score_changed') return false;
      const threshold = Number(trigger.value);
      if (!Number.isFinite(threshold)) return false;
      // Fires on the crossing, not on every save above the line — otherwise a
      // nightly rescore would re-fire for every already-hot lead.
      return Number(payload.score) >= threshold && Number(payload.previousScore ?? 0) < threshold;
    }

    default:
      return false;
  }
}

// ── CRM action executors ───────────────────────────────────────────────────
// Each returns { result, detail } in the same shape the existing executors use,
// so the trace format stays uniform.

async function actionTask(run, node) {
  const title = String(node.value || '').trim();
  if (!title) return { result: 'skipped', detail: 'No task title configured' };
  if (!run.leadId && !run.dealId && !run.contactId) {
    return { result: 'skipped', detail: 'Nothing to attach the task to' };
  }

  if (!run.workspaceId) {
    return { result: 'skipped', detail: 'No workspace attached to run' };
  }

  const ws = await prisma.workspace.findUnique({
    where: { id: run.workspaceId },
    select: { id: true },
  });
  if (!ws) {
    return { result: 'skipped', detail: 'Workspace does not exist' };
  }

  await prisma.task.create({
    data: {
      workspaceId: run.workspaceId,
      title,
      description: 'Created by a workflow',
      leadId: run.leadId ?? null,
      dealId: run.dealId ?? null,
      contactId: run.contactId ?? null,
    },
  });
  return { result: 'ok', detail: `Created task "${title}"` };
}

async function actionLeadStatus(run, node) {
  if (!run.leadId) return { result: 'skipped', detail: 'This run has no lead' };
  const status = norm(node.value);
  // CONVERTED is reached only through the conversion flow. Any other key —
  // built-in or one of the workspace's own lifecycle stages — is checked
  // against the lifecycle by leadStatusWrite below.
  if (!status || status === 'CONVERTED') {
    return { result: 'skipped', detail: `"${node.value}" is not a settable lead status` };
  }

  // Same lifecycle rules as a status set in the CRM (a stage the workspace has
  // removed is not written; a built-in status clears a custom stage key), and
  // the change raises lead_status_changed like any other status write — one
  // level deeper than the event that started this run, so workflows that set
  // each other's statuses stop at MAX_CHAIN_DEPTH instead of looping.
  const { applyLeadStatus, currentChainDepth } = await import('./crmEvents.service.js');
  const depth = currentChainDepth() ?? Number(run.chainDepth ?? 0);
  let outcome;
  try {
    outcome = await applyLeadStatus(run.workspaceId, run.leadId, status, { depth });
  } catch (err) {
    if (err.status !== 400) throw err;
    return { result: 'skipped', detail: err.message };
  }
  if (!outcome.changed) {
    return outcome.already
      ? { result: 'ok', detail: `Already ${status}` }
      : { result: 'skipped', detail: outcome.reason };
  }
  return { result: 'ok', detail: `Lead status set to ${status}` };
}

async function actionOwner(run, node) {
  if (!run.leadId && !run.dealId) return { result: 'skipped', detail: 'This run has no lead or deal' };

  const wanted = String(node.value || '').trim().toLowerCase();
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: run.workspaceId },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (members.length === 0) return { result: 'skipped', detail: 'Workspace has no members' };

  // Same resolution rule as the existing conversation-assign action: match on
  // name or email, fall back to an admin so ownership lands somewhere real.
  const matched = wanted
    ? members.find((m) => m.user.name?.toLowerCase() === wanted || m.user.email.toLowerCase() === wanted)
      || members.find((m) => m.user.name?.toLowerCase().includes(wanted))
    : null;
  const owner = matched || members.find((m) => m.role === 'ADMIN') || members[0];

  if (run.leadId) await prisma.lead.update({ where: { id: run.leadId }, data: { ownerUserId: owner.userId } });
  if (run.dealId) await prisma.deal.update({ where: { id: run.dealId }, data: { ownerUserId: owner.userId } });

  const note = matched ? '' : ` (no member matched "${node.value}", used ${owner.user.name})`;
  return { result: 'ok', detail: `Assigned to ${owner.user.name}${note}` };
}

async function actionSequence(run, node) {
  if (!run.contactId) return { result: 'skipped', detail: 'This run has no contact' };

  const name = String(node.value || '').trim();
  if (!name) return { result: 'skipped', detail: 'No sequence configured' };

  const sequence = await prisma.sequence.findFirst({
    where: { workspaceId: run.workspaceId, name, status: 'PUBLISHED' },
    select: { id: true, steps: true },
  });
  if (!sequence) return { result: 'skipped', detail: `No published sequence named "${name}"` };

  // Reuse the sequence service so every enrolment goes through the same
  // opt-out and duplicate checks, rather than inserting an enrollment directly.
  const { enrollContacts } = await import('./sequences.service.js');
  const result = await enrollContacts(run.workspaceId, sequence.id, { contactIds: [run.contactId] });

  if (result.enrolled === 0) {
    return { result: 'skipped', detail: result.skipped[0]?.reason || 'Not enrolled' };
  }
  return { result: 'ok', detail: `Enrolled in "${name}"` };
}

export async function runCrmAction(run, node) {
  switch (node.subtype) {
    case 'task': return actionTask(run, node);
    case 'lead_status': return actionLeadStatus(run, node);
    case 'owner': return actionOwner(run, node);
    case 'sequence': return actionSequence(run, node);
    default: return null;
  }
}

// Steps that need a conversation with the customer.
const CUSTOMER_FACING = new Set(['message', 'buttons', 'template', 'wait_reply', 'agent']);

// The contact's most recent WhatsApp conversation, or a new one on the
// workspace's primary active number. A template step then reaches the contact
// whenever it runs; a free-form step only inside the 24-hour window, and fails
// with that reason outside it. Null when the contact has no phone number or the
// workspace has no number to start a thread on.
export async function crmConversation(workspaceId, contactId) {
  if (!workspaceId || !contactId) return null;
  const existing = await prisma.conversation.findFirst({
    where: { workspaceId, contactId, channel: 'WHATSAPP', waNumberId: { not: null } },
    orderBy: { lastMessageAt: 'desc' },
    select: { id: true },
  });
  if (existing) return existing.id;

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId },
    select: { id: true, phoneNumber: true },
  });
  if (!contact?.phoneNumber) return null;

  // The number new threads start on: a connected one Meta still accepts,
  // oldest first (the workspace's first number is its primary).
  const number = await prisma.waNumber.findFirst({
    where: { workspaceId, status: { in: ['ACTIVE', 'CONNECTED'] }, unreachableSince: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  }) ?? await prisma.waNumber.findFirst({
    where: { workspaceId, status: { in: ['ACTIVE', 'CONNECTED'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!number) return null;

  const where = { workspaceId, contactId, waNumberId: number.id };
  try {
    const created = await prisma.conversation.create({ data: { ...where, status: 'OPEN' }, select: { id: true } });
    console.log(`[Workflow] Started WhatsApp conversation ${created.id} for contact ${contactId} (CRM workflow)`);
    return created.id;
  } catch (err) {
    // Another writer (an inbound message, a parallel event) created it first.
    const raced = await prisma.conversation.findFirst({ where, select: { id: true } });
    if (raced) return raced.id;
    throw err;
  }
}

/**
 * Fires CRM workflows for an event.
 *
 * Errors are contained: a broken workflow must never take down the CRM write
 * that triggered it, so every failure is logged and the caller continues.
 */
export async function runWorkflowsForCrmEvent(workspaceId, event, payload = {}, { depth = 0 } = {}) {
  if (depth >= MAX_CHAIN_DEPTH) {
    console.warn(`[Workflow] CRM chain depth ${depth} reached for "${event}", not cascading further`);
    return [];
  }

  const workflows = await prisma.workflow.findMany({ where: { workspaceId, isActive: true } });
  const matching = workflows.filter((w) => {
    const nodes = Array.isArray(w.nodes) ? w.nodes : [];
    const trigger = nodes.find((n) => n.type === 'trigger');
    return crmTriggerFires(trigger, { event, payload });
  });
  if (matching.length === 0) return [];

  const { startRun } = await import('./workflowEngine.service.js');
  const runs = [];

  // A CRM change has no conversation of its own, and a run without one used to
  // "skip" every message, template, buttons and handoff step and still report
  // COMPLETED — nothing ever reached the lead. The contact's WhatsApp thread is
  // found (or started on the workspace's number) once per event, and only for
  // workflows that talk to the customer.
  let conversationId;
  const conversationFor = async () => {
    if (conversationId === undefined) {
      conversationId = await crmConversation(workspaceId, payload.contactId).catch((err) => {
        console.warn(`[Workflow] Could not resolve a WhatsApp conversation for contact ${payload.contactId}:`, err.message);
        return null;
      });
    }
    return conversationId;
  };

  for (const workflow of matching) {
    try {
      const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
      const talks = payload.contactId && nodes.some((n) => CUSTOMER_FACING.has(n?.subtype));
      const run = await startRun(workflow, {
        workspaceId,
        conversationId: talks ? await conversationFor() : null,
        contactId: payload.contactId ?? null,
        leadId: payload.leadId ?? null,
        dealId: payload.dealId ?? null,
        triggerMessage: `CRM event: ${event}`,
      });
      if (run) runs.push(run);
    } catch (err) {
      console.error(`[Workflow] CRM workflow ${workflow.id} failed on "${event}":`, err.message);
    }
  }

  return runs;
}

// Fire-and-forget wrapper for use inside request handlers: a workflow must
// never delay or fail the CRM write that triggered it.
export function emitCrmEvent(workspaceId, event, payload = {}) {
  runWorkflowsForCrmEvent(workspaceId, event, payload).catch((err) => {
    console.error(`[Workflow] Could not run workflows for "${event}":`, err.message);
  });
}
