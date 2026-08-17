import { prisma } from '../lib/prisma.js';
import { keywordMatches } from './automation.service.js';
import { sendAutomatedReply } from './outbound.service.js';

// The Workflows tab used to be a drawing surface: workflows were saved,
// toggled active, and never executed by anything. This is the interpreter that
// makes them real. It runs the same node shape the builder produces —
// { id, type: 'trigger'|'action', subtype, value } — because that's what's
// already persisted in Workflow.nodes for every existing workspace.

const MAX_ACTIONS = 20;

// "5 min" / "1 hour" / "1 day" / "Immediate" — the exact strings the builder's
// delay dropdown emits, plus a tolerant numeric parse for AI-generated values.
export function parseDelayMs(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text || text === 'immediate' || text === '0') return 0;

  const match = text.match(/(\d+(?:\.\d+)?)\s*(second|sec|s|minute|min|m|hour|hr|h|day|d)/);
  if (!match) return 0;

  const amount = parseFloat(match[1]);
  const unit = match[2];
  const perUnit =
    /^(second|sec|s)$/.test(unit) ? 1000 :
    /^(minute|min|m)$/.test(unit) ? 60_000 :
    /^(hour|hr|h)$/.test(unit) ? 3_600_000 :
    86_400_000;

  // BullMQ delays are milliseconds in a 32-bit-ish range in practice; a week
  // is far beyond any sane automation delay and keeps jobs from being parked
  // effectively forever by a typo like "999 days".
  return Math.min(amount * perUnit, 7 * 86_400_000);
}

const triggerOf = (nodes) => (Array.isArray(nodes) ? nodes : []).find((n) => n?.type === 'trigger');
const actionsOf = (nodes) => (Array.isArray(nodes) ? nodes : []).filter((n) => n?.type === 'action').slice(0, MAX_ACTIONS);

// Decides whether a workflow's trigger fires for this inbound event. Mirrors
// the trigger subtypes the builder offers.
export function triggerFires(trigger, { messageBody = '', isNewContact = false, event = 'message' } = {}) {
  if (!trigger) return false;
  switch (trigger.subtype) {
    case 'keyword':
      return event === 'message' && keywordMatches(trigger.value, messageBody);
    case 'welcome':
      return event === 'message' && isNewContact === true;
    case 'missed':
      return event === 'missed_call';
    default:
      return false;
  }
}

// All active workflows in the workspace whose trigger fires. Keyword workflows
// are ordered longest-keyword-first so the most specific one is attempted
// before a catch-all, matching how keyword triggers resolve.
export async function findMatchingWorkflows(workspaceId, ctx) {
  const workflows = await prisma.workflow.findMany({
    where: { workspaceId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  return workflows
    .map((w) => ({ workflow: w, trigger: triggerOf(w.nodes) }))
    .filter(({ trigger }) => triggerFires(trigger, ctx))
    .sort((a, b) => String(b.trigger?.value || '').length - String(a.trigger?.value || '').length)
    .map(({ workflow }) => workflow);
}

// ── Action executors ───────────────────────────────────────────────────────

async function actionMessage(run, node) {
  if (!run.conversationId) return { result: 'skipped', detail: 'No conversation to reply to' };

  const conversation = await prisma.conversation.findUnique({
    where: { id: run.conversationId },
    include: { contact: true },
  });
  if (!conversation?.waNumberId) return { result: 'skipped', detail: 'Conversation has no connected number' };

  const sent = await sendAutomatedReply({
    conversationId: conversation.id,
    waNumberId: conversation.waNumberId,
    toPhone: conversation.contact.phoneNumber,
    body: node.value,
  });

  return sent
    ? { result: 'sent', detail: `Sent: "${node.value}"` }
    : { result: 'failed', detail: 'Meta rejected the send' };
}

async function actionTag(run, node) {
  const tag = String(node.value || '').trim();
  if (!tag) return { result: 'skipped', detail: 'No tag configured' };
  if (!run.contactId) return { result: 'skipped', detail: 'No contact on this run' };

  const contact = await prisma.contact.findUnique({ where: { id: run.contactId }, select: { tags: true } });
  if (!contact) return { result: 'skipped', detail: 'Contact no longer exists' };
  if (contact.tags.includes(tag)) return { result: 'ok', detail: `Already tagged "${tag}"` };

  await prisma.contact.update({ where: { id: run.contactId }, data: { tags: { push: tag } } });
  return { result: 'ok', detail: `Tagged contact "${tag}"` };
}

// The builder's "assign to agent" field is free text (a person's name). Resolve
// it against real workspace members by name or email; fall back to any ADMIN so
// the conversation still lands in a human's queue rather than nowhere.
async function actionAgent(run, node) {
  if (!run.conversationId) return { result: 'skipped', detail: 'No conversation to assign' };

  const wanted = String(node.value || '').trim().toLowerCase();
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: run.workspaceId },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (members.length === 0) return { result: 'skipped', detail: 'Workspace has no members' };

  const matched = wanted
    ? members.find((m) => m.user.name.toLowerCase() === wanted || m.user.email.toLowerCase() === wanted)
      || members.find((m) => m.user.name.toLowerCase().includes(wanted))
    : null;
  const assignee = matched || members.find((m) => m.role === 'ADMIN') || members[0];

  await prisma.conversation.update({
    where: { id: run.conversationId },
    data: { assignedToUserId: assignee.userId, status: 'OPEN' },
  });

  const exact = matched ? '' : ` (no member matched "${node.value}", used ${assignee.user.name})`;
  return { result: 'ok', detail: `Assigned to ${assignee.user.name}${exact}` };
}

// ── Run lifecycle ──────────────────────────────────────────────────────────

// `leadId`/`dealId` are set for CRM-triggered runs; conversation-triggered
// runs leave them null and behave exactly as before.
export async function startRun(workflow, { workspaceId, conversationId, contactId, leadId, dealId, triggerMessage }) {
  const run = await prisma.workflowRun.create({
    data: {
      workspaceId,
      workflowId: workflow.id,
      conversationId: conversationId || null,
      contactId: contactId || null,
      leadId: leadId || null,
      dealId: dealId || null,
      nodes: workflow.nodes,
      trace: [],
      triggerMessage: triggerMessage || null,
      status: 'RUNNING',
      cursor: 0,
    },
  });
  return advanceRun(run.id);
}

// Executes action steps from the run's cursor. A delay step parks the run
// (status WAITING) and schedules a resume; everything else runs inline. Called
// both on trigger and by the workflow worker after a delay elapses.
export async function advanceRun(runId) {
  const run = await prisma.workflowRun.findUnique({ where: { id: runId } });
  if (!run) return null;
  if (run.status === 'COMPLETED' || run.status === 'FAILED') return run;

  const actions = actionsOf(run.nodes);
  const trace = Array.isArray(run.trace) ? [...run.trace] : [];

  for (let i = run.cursor; i < actions.length; i += 1) {
    const node = actions[i];

    if (node.subtype === 'delay') {
      const ms = parseDelayMs(node.value);
      if (ms > 0) {
        trace.push({ step: i, subtype: 'delay', detail: `Waiting ${node.value}`, result: 'waiting', at: new Date().toISOString() });
        await prisma.workflowRun.update({
          where: { id: run.id },
          // Resume *after* this delay node, so a re-entrant worker can't
          // re-park on the same step and loop forever.
          data: { status: 'WAITING', cursor: i + 1, trace },
        });
        // Imported lazily: the queue opens a Redis connection at import time,
        // and the engine is also used by the request path, which must not
        // depend on Redis being reachable just to run a delay-free workflow.
        const { enqueueWorkflowResume } = await import('../queues/workflow.queue.js');
        await enqueueWorkflowResume(run.id, i + 1, ms);
        return prisma.workflowRun.findUnique({ where: { id: run.id } });
      }
      trace.push({ step: i, subtype: 'delay', detail: 'Immediate', result: 'ok', at: new Date().toISOString() });
      continue;
    }

    let outcome;
    try {
      if (node.subtype === 'message') outcome = await actionMessage(run, node);
      else if (node.subtype === 'tag') outcome = await actionTag(run, node);
      else if (node.subtype === 'agent') outcome = await actionAgent(run, node);
      else {
        // CRM actions (task, lead status, owner, sequence) live in their own
        // module so this engine keeps no knowledge of the CRM domain.
        const { runCrmAction } = await import('./workflowCrm.service.js');
        outcome = await runCrmAction(run, node)
          ?? { result: 'skipped', detail: `Unknown action "${node.subtype}"` };
      }
    } catch (err) {
      console.error(`[WorkflowEngine] step ${i} of run ${run.id} failed:`, err);
      trace.push({ step: i, subtype: node.subtype, detail: err.message, result: 'failed', at: new Date().toISOString() });
      return prisma.workflowRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', cursor: i, trace, error: err.message, finishedAt: new Date() },
      });
    }

    trace.push({ step: i, subtype: node.subtype, ...outcome, at: new Date().toISOString() });
  }

  return prisma.workflowRun.update({
    where: { id: run.id },
    data: { status: 'COMPLETED', cursor: actions.length, trace, finishedAt: new Date() },
  });
}

// Entry point from the inbound handler. Returns the runs it started so the
// caller knows whether a workflow already replied (and can skip its own
// welcome/OOO/AI-agent fallbacks).
export async function runWorkflowsForInbound(workspaceId, ctx) {
  const workflows = await findMatchingWorkflows(workspaceId, ctx);
  if (workflows.length === 0) return [];

  const runs = [];
  // Only the most specific matching workflow runs. Firing every match would
  // send a customer several unrelated replies to one message.
  const workflow = workflows[0];
  try {
    const run = await startRun(workflow, {
      workspaceId,
      conversationId: ctx.conversationId,
      contactId: ctx.contactId,
      triggerMessage: ctx.messageBody,
    });
    if (run) runs.push(run);
  } catch (err) {
    console.error(`[WorkflowEngine] Failed to start workflow ${workflow.id}:`, err);
  }
  return runs;
}

// True if the run actually sent something — lets the inbound handler decide
// whether a further auto-reply would be a duplicate.
export function runSentMessage(run) {
  const trace = Array.isArray(run?.trace) ? run.trace : [];
  return trace.some((t) => t.subtype === 'message' && t.result === 'sent');
}

// A workflow that is still WAITING on a delay before its first message will
// send later, so the inbound handler must not fill the silence with a welcome
// or AI-agent reply that the workflow is about to duplicate.
export function runWillSendMessage(run) {
  if (!run) return false;
  if (runSentMessage(run)) return true;
  if (run.status !== 'WAITING') return false;
  return actionsOf(run.nodes).slice(run.cursor).some((n) => n.subtype === 'message');
}

export async function listRuns(workspaceId, { workflowId, limit = 20 } = {}) {
  return prisma.workflowRun.findMany({
    where: { workspaceId, ...(workflowId ? { workflowId } : {}) },
    orderBy: { startedAt: 'desc' },
    take: Math.min(limit, 100),
  });
}
