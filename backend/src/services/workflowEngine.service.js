import { prisma } from '../lib/prisma.js';
import { keywordMatches } from './automation.service.js';
import { sendAutomatedReply } from './outbound.service.js';
import { evaluateCondition, skipCount, renderTemplate, tidy, CONDITION_SUBTYPES } from './workflowConditions.js';

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
// Conditions live in the same ordered list as actions: a skip count is measured
// in steps as the builder shows them, so filtering conditions out here would
// make "skip the next 2" point at the wrong places.
const actionsOf = (nodes) => (Array.isArray(nodes) ? nodes : [])
  .filter((n) => n?.type === 'action' || n?.type === 'condition')
  .slice(0, MAX_ACTIONS);

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


// What a condition is allowed to ask about. Loaded once per advanceRun rather
// than per step, since a workflow can carry several conditions.
async function conditionContext(run) {
  const conversation = run.conversationId
    ? await prisma.conversation.findUnique({
        where: { id: run.conversationId },
        include: { contact: true },
      })
    : null;
  return {
    messageBody: run.triggerMessage ?? '',
    contact: conversation?.contact ?? null,
    // A contact created within the last few minutes of this run starting is the
    // closest the engine can get to "new" once the run may have been resumed
    // from a delay hours later.
    isNewContact: Boolean(conversation?.contact
      && conversation.contact.createdAt >= new Date(run.startedAt.getTime() - 60_000)),
  };
}

const describeCondition = (node) => {
  const spec = CONDITION_SUBTYPES.find((c) => c.id === node.subtype);
  const label = spec?.label ?? node.subtype;
  return spec?.needsValue ? `${label} "${node.value ?? ''}"` : label;
};

async function actionMessage(run, node) {
  if (!run.conversationId) return { result: 'skipped', detail: 'No conversation to reply to' };

  const conversation = await prisma.conversation.findUnique({
    where: { id: run.conversationId },
    include: { contact: true },
  });
  if (!conversation?.waNumberId) return { result: 'skipped', detail: 'Conversation has no connected number' };

  // `{{name}}`, `{{custom.order_number}}` and anything the run has collected.
  // Without this every automated message was identical for every recipient.
  const body = tidy(renderTemplate(node.value, {
    contact: conversation.contact,
    variables: run.variables && typeof run.variables === 'object' ? run.variables : {},
    messageBody: run.triggerMessage ?? '',
  }));
  if (!body) return { result: 'skipped', detail: 'Message was empty after filling in variables' };

  const sent = await sendAutomatedReply({
    conversationId: conversation.id,
    waNumberId: conversation.waNumberId,
    toPhone: conversation.contact.phoneNumber,
    body,
  });

  return sent
    ? { result: 'sent', detail: `Sent: "${node.value}"` }
    : { result: 'failed', detail: 'Meta rejected the send' };
}

// Offer the customer tappable choices instead of asking them to type.
//
// Authored in the linear builder as "Question | Option A | Option B", the same
// single-field convention the conditions use, or as an explicit `options` array
// for anything built through the API. The reply arrives back as the option's own
// text, so the keyword triggers and `contains` conditions match it unchanged.
async function actionButtons(run, node) {
  if (!run.conversationId) return { result: 'skipped', detail: 'No conversation to reply to' };

  const conversation = await prisma.conversation.findUnique({
    where: { id: run.conversationId },
    include: { contact: true },
  });
  if (!conversation?.waNumberId) return { result: 'skipped', detail: 'Conversation has no connected number' };

  const context = {
    contact: conversation.contact,
    variables: run.variables && typeof run.variables === 'object' ? run.variables : {},
    messageBody: run.triggerMessage ?? '',
  };

  const explicit = Array.isArray(node.options) ? node.options : null;
  const parts = String(node.value ?? '').split('|').map((p) => p.trim()).filter(Boolean);
  const body = tidy(renderTemplate(parts[0] ?? '', context));
  const options = (explicit ?? parts.slice(1))
    .map((o) => tidy(renderTemplate(String(typeof o === 'string' ? o : o?.title ?? ''), context)))
    .filter(Boolean);

  if (!body) return { result: 'skipped', detail: 'No question to ask' };
  if (options.length === 0) {
    return { result: 'skipped', detail: 'No options configured — write them as "Question | Option A | Option B"' };
  }

  const sent = await sendAutomatedReply({
    conversationId: conversation.id,
    waNumberId: conversation.waNumberId,
    toPhone: conversation.contact.phoneNumber,
    body,
    options,
  });

  return sent
    ? { result: 'sent', detail: `Asked "${body}" with ${options.length} option(s)` }
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
    data: {
      assignedToUserId: assignee.userId,
      status: 'OPEN',
      // Assigning to a person is a handoff. Without this the automation kept
      // answering the thread it had just put in someone's queue.
      humanHandoffAt: new Date(),
    },
  });

  const exact = matched ? '' : ` (no member matched "${node.value}", used ${assignee.user.name})`;
  return { result: 'ok', detail: `Assigned to ${assignee.user.name}${exact}` };
}

// ── Run lifecycle ──────────────────────────────────────────────────────────

export async function startRun(workflow, { workspaceId, conversationId, contactId, triggerMessage }) {
  const run = await prisma.workflowRun.create({
    data: {
      workspaceId,
      workflowId: workflow.id,
      conversationId: conversationId || null,
      contactId: contactId || null,
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

    // A condition asks something about the conversation and, when the answer is
    // no, skips the steps it guards. Expressed as a skip count rather than a
    // nested branch because the runtime is a flat array with an integer cursor
    // that is persisted across delays and restarts — nesting would need a stack
    // to serialise and resume, while a skip survives that for free.
    // Keyed on `type`, not `subtype`: a condition step is
    // { type: 'condition', subtype: 'contains' }, so matching on subtype here
    // never fired — every condition fell through to the action dispatch, was
    // recorded as an unknown action, and guarded nothing.
    if (node.type === 'condition') {
      const context = await conditionContext(run);
      const held = evaluateCondition(node, context);
      const skip = skipCount(node);
      trace.push({
        step: i,
        subtype: 'condition',
        detail: `${describeCondition(node)} → ${held ? 'yes' : `no, skipping ${skip} step(s)`}`,
        result: held ? 'ok' : 'skipped',
        at: new Date().toISOString(),
      });
      if (!held) i += skip;
      continue;
    }

    let outcome;
    try {
      if (node.subtype === 'message') outcome = await actionMessage(run, node);
      else if (node.subtype === 'tag') outcome = await actionTag(run, node);
      else if (node.subtype === 'agent') outcome = await actionAgent(run, node);
      else if (node.subtype === 'buttons') outcome = await actionButtons(run, node);
      else outcome = { result: 'skipped', detail: `Unknown action "${node.subtype}"` };
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

// Steps that put a message in front of the customer. A 'buttons' step is a
// message too, so a run that ends on one has replied and the inbound handler
// must not add a welcome or AI answer on top of it.
const REPLY_SUBTYPES = new Set(['message', 'buttons']);

// True if the run actually sent something — lets the inbound handler decide
// whether a further auto-reply would be a duplicate.
export function runSentMessage(run) {
  const trace = Array.isArray(run?.trace) ? run.trace : [];
  return trace.some((t) => REPLY_SUBTYPES.has(t.subtype) && t.result === 'sent');
}

// A workflow that is still WAITING on a delay before its first message will
// send later, so the inbound handler must not fill the silence with a welcome
// or AI-agent reply that the workflow is about to duplicate.
export function runWillSendMessage(run) {
  if (!run) return false;
  if (runSentMessage(run)) return true;
  if (run.status !== 'WAITING') return false;
  return actionsOf(run.nodes).slice(run.cursor).some((n) => REPLY_SUBTYPES.has(n.subtype));
}

export async function listRuns(workspaceId, { workflowId, limit = 20 } = {}) {
  return prisma.workflowRun.findMany({
    where: { workspaceId, ...(workflowId ? { workflowId } : {}) },
    orderBy: { startedAt: 'desc' },
    take: Math.min(limit, 100),
  });
}

// Starts a named workflow directly, rather than by matching its trigger.
//
// Used by intent routing: a rule whose action is "run this workflow" names the
// workflow by id, so the trigger-matching path in findMatchingWorkflows() does
// not apply. Returns null when the workflow is missing or inactive, so the
// caller can fall through instead of silently doing nothing.
export async function startRunForWorkflowId(workspaceId, workflowId, { conversationId, contactId, triggerMessage }) {
  const workflow = await prisma.workflow.findFirst({
    where: { id: workflowId, workspaceId, isActive: true },
  });
  if (!workflow) {
    console.warn(`[WorkflowEngine] Workflow ${workflowId} not found or inactive — nothing started.`);
    return null;
  }
  return startRun(workflow, { workspaceId, conversationId, contactId, triggerMessage });
}
