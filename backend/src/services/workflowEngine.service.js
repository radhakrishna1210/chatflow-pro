import { prisma } from '../lib/prisma.js';
import { keywordMatches } from './automation.service.js';
import { sendAutomatedReply } from './outbound.service.js';
import { evaluateCondition, skipCount, renderTemplate, tidy, CONDITION_SUBTYPES } from './workflowConditions.js';
import { INTERACTIVE_LIMITS } from '../lib/meta.js';

// The Workflows tab used to be a drawing surface: workflows were saved,
// toggled active, and never executed by anything. This is the interpreter that
// makes them real. It runs the same node shape the builder produces —
// { id, type: 'trigger'|'action', subtype, value } — because that's what's
// already persisted in Workflow.nodes for every existing workspace.

const MAX_ACTIONS = 20;

// "5 min" / "1 hour" / "1 day" / "10" / "10s" / "Immediate" — the strings the
// builder emits or numeric inputs, defaulting to seconds for bare numbers.
export function parseDelayMs(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text || text === 'immediate' || text === '0') return 0;

  const match = text.match(/^(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)?$/);
  if (!match) return 0;

  const amount = parseFloat(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return 0;

  const unit = match[2] || 's';
  const perUnit =
    /^(seconds?|secs?|s)$/.test(unit) ? 1000 :
    /^(minutes?|mins?|m)$/.test(unit) ? 60_000 :
    /^(hours?|hrs?|h)$/.test(unit) ? 3_600_000 :
    86_400_000;

  // BullMQ delays are milliseconds in a 32-bit-ish range in practice; a week
  // is far beyond any sane automation delay and keeps jobs from being parked
  // effectively forever by a typo like "999 days".
  return Math.min(amount * perUnit, 7 * 86_400_000);
}

// ── Waiting for the customer's reply ───────────────────────────────────────
//
// A workflow could send a question or a set of buttons, but had no way to hear
// the answer: the run finished the moment the question went out, and the tap
// came back as an unrelated inbound message. A `wait_reply` step parks the run
// until the customer's next message, which then becomes the message the
// following conditions test and — when the step names one — a {{variable}}.
//
// The marker lives in `variables` rather than a new status so the existing
// WAITING lifecycle (cancel, hasActiveRun, the delay worker) covers it without
// a schema migration.

const AWAIT_KEY = '__awaitingReply';
const LAST_OPTIONS_KEY = '__lastOptions';

// Past WhatsApp's 24-hour window no free-form follow-up could be sent anyway,
// so a reply after that starts afresh instead of resuming a stale flow.
export const REPLY_TIMEOUT_MS = 24 * 3_600_000;

const variablesOf = (run) => (run?.variables && typeof run.variables === 'object' && !Array.isArray(run.variables)
  ? { ...run.variables }
  : {});

export const isAwaitingReply = (run) => Boolean(variablesOf(run)[AWAIT_KEY]);

// "Save reply as: Order ID" → "order_id", usable as {{order_id}}.
const variableName = (raw) => String(raw ?? '').trim().toLowerCase()
  .replace(/^\{\{\s*|\s*\}\}$/g, '')
  .replace(/[^a-z0-9_.]+/g, '_')
  .replace(/^_+|_+$/g, '');

// Turns what the customer sent back into the option they meant. A tapped
// button arrives as its title clipped to Meta's limit (20 chars for a button,
// 24 for a list row), so "Talk to our support team" comes back truncated and a
// `Message is exactly` condition written against the full label would never
// match. Typing the option's number or its text in any case counts too — on
// WhatsApp people often answer a menu by typing rather than tapping.
export function resolveReply(reply, options = []) {
  const text = String(reply ?? '').trim();
  const labels = (Array.isArray(options) ? options : []).map((o) => String(o ?? '').trim()).filter(Boolean);
  if (!text || labels.length === 0) return text;

  const lower = text.toLowerCase();
  const exact = labels.find((o) => o.toLowerCase() === lower);
  if (exact) return exact;

  const clipped = labels.find((o) => [INTERACTIVE_LIMITS.buttonTitleChars, INTERACTIVE_LIMITS.rowTitleChars]
    .some((max) => o.slice(0, max).trim().toLowerCase() === lower));
  if (clipped) return clipped;

  const number = text.match(/^(\d{1,2})[.)]?$/);
  if (number) {
    const picked = labels[Number(number[1]) - 1];
    if (picked) return picked;
  }
  return text;
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

async function actionTemplate(run, node, preloadedTemplate = null) {
  if (!run.conversationId) return { result: 'skipped', detail: 'No conversation to reply to' };

  const conversation = await prisma.conversation.findUnique({
    where: { id: run.conversationId },
    include: { contact: true },
  });
  if (!conversation?.waNumberId) return { result: 'skipped', detail: 'Conversation has no connected number' };

  let template = preloadedTemplate;
  if (!template) {
    const val = String(node.value || '').trim();
    template = await prisma.template.findFirst({
      where: {
        workspaceId: run.workspaceId,
        status: 'APPROVED',
        OR: [
          { id: val },
          { name: val },
          { name: { equals: val, mode: 'insensitive' } },
        ],
      },
    });
  }

  if (!template) {
    return { result: 'failed', detail: `Template "${node.value}" not found or not approved` };
  }

  console.log(`[WorkflowEngine] Sending template "${template.name}" for run ${run.id} to ${conversation.contact?.phoneNumber}`);
  const { sendTemplateMessage } = await import('./conversations.service.js');
  const msg = await sendTemplateMessage(run.workspaceId, run.conversationId, null, {
    templateId: template.id,
    contactId: run.contactId || conversation.contactId,
    phoneNumber: conversation.contact?.phoneNumber,
  });

  return {
    result: 'sent',
    detail: `Sent template: "${template.name}"`,
    metaMessageId: msg?.metaMessageId,
  };
}

async function actionMessage(run, node) {
  if (!run.conversationId) return { result: 'skipped', detail: 'No conversation to reply to' };

  // Check if node.value refers to an approved template in this workspace
  const val = String(node.value || '').trim();
  if (val && !val.includes('\n') && val.length <= 100) {
    const template = await prisma.template.findFirst({
      where: {
        workspaceId: run.workspaceId,
        status: 'APPROVED',
        OR: [
          { id: val },
          { name: val },
          { name: { equals: val, mode: 'insensitive' } },
        ],
      },
    });
    if (template) {
      console.log(`[WorkflowEngine] Message step "${node.value}" matched approved template "${template.name}" (${template.id}); dispatching as template send.`);
      return actionTemplate(run, node, template);
    }
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: run.conversationId },
    include: { contact: true },
  });
  if (!conversation?.waNumberId) return { result: 'skipped', detail: 'Conversation has no connected number' };

  // `{{name}}`, `{{customer_name}}`, `{{custom.order_number}}` and anything the run has collected.
  // Without this every automated message was identical for every recipient.
  const body = tidy(renderTemplate(node.value, {
    contact: conversation.contact,
    variables: run.variables && typeof run.variables === 'object' ? run.variables : {},
    messageBody: run.triggerMessage ?? '',
  }));
  if (!body) return { result: 'skipped', detail: 'Message was empty after filling in variables' };

  console.log(`[WorkflowEngine] Sending automated reply for run ${run.id} to ${conversation.contact?.phoneNumber}: "${body.slice(0, 50)}..."`);
  const sent = await sendAutomatedReply({
    conversationId: conversation.id,
    waNumberId: conversation.waNumberId,
    toPhone: conversation.contact.phoneNumber,
    body,
  });

  return sent
    ? { result: 'sent', detail: `Sent: "${body}"` }
    : { result: 'failed', detail: 'Meta rejected the send or 24-hour customer window is closed' };
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

  // `options` is not kept in the trace; advanceRun lifts it into the run's
  // variables so a following wait_reply step can map the reply back to it.
  return sent
    ? { result: 'sent', detail: `Asked "${body}" with ${options.length} option(s)`, options }
    : { result: 'failed', detail: 'Meta rejected the send or 24-hour customer window is closed' };
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
//
// `reply` is passed only when the customer has answered a wait_reply step; a
// run parked on one is otherwise left alone, so a stray delay job or retry
// cannot march it past the question without an answer.
export async function advanceRun(runId, { reply } = {}) {
  const stored = await prisma.workflowRun.findUnique({ where: { id: runId } });
  if (!stored) return null;
  // COMPLETED also covers a run cancelled mid-flight, so a delayed resume that
  // fires after the customer said "stop" finds the run closed and does nothing.
  if (stored.status === 'COMPLETED' || stored.status === 'FAILED') return stored;

  const variables = variablesOf(stored);
  const awaiting = variables[AWAIT_KEY];
  if (awaiting && reply === undefined) return stored;

  const actions = actionsOf(stored.nodes);
  const trace = Array.isArray(stored.trace) ? [...stored.trace] : [];

  // The executors read the run's message and variables, so they are handed this
  // working copy rather than the stored row.
  const run = { ...stored, variables };
  if (awaiting) {
    const answer = resolveReply(reply, awaiting.options);
    delete variables[AWAIT_KEY];
    variables.last_reply = answer;
    if (awaiting.saveAs) variables[awaiting.saveAs] = answer;
    run.triggerMessage = answer;
    trace.push({
      step: stored.cursor - 1,
      subtype: 'reply',
      detail: `Customer replied "${answer}"${awaiting.saveAs ? ` (saved as {{${awaiting.saveAs}}})` : ''}`,
      result: 'ok',
      at: new Date().toISOString(),
    });
  }

  for (let i = run.cursor; i < actions.length; i += 1) {
    const node = actions[i];

    if (node.subtype === 'wait_reply') {
      const saveAs = variableName(node.value);
      // The options answer only this wait. Left in place, a later "How many
      // people?" answered with "2" would be read as option 2 of the menu.
      const options = Array.isArray(variables[LAST_OPTIONS_KEY]) ? variables[LAST_OPTIONS_KEY] : [];
      delete variables[LAST_OPTIONS_KEY];
      variables[AWAIT_KEY] = {
        since: new Date().toISOString(),
        ...(saveAs ? { saveAs } : {}),
        options,
      };
      trace.push({ step: i, subtype: 'wait_reply', detail: 'Waiting for the customer to reply', result: 'waiting', at: new Date().toISOString() });
      return prisma.workflowRun.update({
        where: { id: run.id },
        data: { status: 'WAITING', cursor: i + 1, trace, variables, triggerMessage: run.triggerMessage },
      });
    }

    if (node.subtype === 'delay') {
      const ms = parseDelayMs(node.value);
      if (ms > 0) {
        trace.push({ step: i, subtype: 'delay', detail: `Waiting ${node.value}`, result: 'waiting', at: new Date().toISOString() });
        await prisma.workflowRun.update({
          where: { id: run.id },
          // Resume *after* this delay node, so a re-entrant worker can't
          // re-park on the same step and loop forever.
          data: { status: 'WAITING', cursor: i + 1, trace, variables, triggerMessage: run.triggerMessage },
        });
        try {
          const { enqueueWorkflowResume } = await import('../queues/workflow.queue.js');
          await enqueueWorkflowResume(run.id, i + 1, ms);
        } catch (queueErr) {
          console.error(`[WorkflowEngine] Failed to enqueue resume for run ${run.id}:`, queueErr);
          trace.push({ step: i, subtype: 'delay', detail: `Queue failed: ${queueErr.message}`, result: 'failed', at: new Date().toISOString() });
          return prisma.workflowRun.update({
            where: { id: run.id },
            data: { status: 'FAILED', cursor: i, trace, variables, error: queueErr.message, finishedAt: new Date() },
          });
        }
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
      else if (node.subtype === 'template') outcome = await actionTemplate(run, node);
      else if (node.subtype === 'tag') outcome = await actionTag(run, node);
      else if (node.subtype === 'agent') outcome = await actionAgent(run, node);
      else if (node.subtype === 'buttons') outcome = await actionButtons(run, node);
      else {
          const { runCrmAction } = await import('./workflowCrm.service.js');
          outcome = await runCrmAction(run, node) ?? { result: 'skipped', detail: `Unknown action "${node.subtype}"` };
        }
    } catch (err) {
      console.error(`[WorkflowEngine] step ${i} of run ${run.id} failed:`, err);
      trace.push({ step: i, subtype: node.subtype, detail: err.message, result: 'failed', at: new Date().toISOString() });
      return prisma.workflowRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', cursor: i, trace, variables, error: err.message, finishedAt: new Date() },
      });
    }

    const { options: offered, ...recorded } = outcome;
    // A new question replaces the menu the customer is answering; any other
    // message sent after the buttons means the reply is to that, not to them.
    if (Array.isArray(offered)) variables[LAST_OPTIONS_KEY] = offered;
    else if (REPLY_SUBTYPES.has(node.subtype) && recorded.result === 'sent') delete variables[LAST_OPTIONS_KEY];
    trace.push({ step: i, subtype: node.subtype, ...recorded, at: new Date().toISOString() });
  }

  return prisma.workflowRun.update({
    where: { id: run.id },
    data: { status: 'COMPLETED', cursor: actions.length, trace, variables, triggerMessage: run.triggerMessage, finishedAt: new Date() },
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
const REPLY_SUBTYPES = new Set(['message', 'buttons', 'template']);

// True if the run actually sent something — lets the inbound handler decide
// whether a further auto-reply would be a duplicate.
//
// Only what was sent since the customer's latest reply counts: a resumed run's
// trace still holds the question it asked before waiting, and counting that
// would suppress the fallbacks for a reply the run then says nothing to.
export function runSentMessage(run) {
  const trace = Array.isArray(run?.trace) ? run.trace : [];
  const lastReply = trace.map((t) => t.subtype).lastIndexOf('reply');
  return trace.slice(lastReply + 1).some((t) => REPLY_SUBTYPES.has(t.subtype) && t.result === 'sent');
}

// A workflow that is still WAITING on a delay before its first message will
// send later, so the inbound handler must not fill the silence with a welcome
// or AI-agent reply that the workflow is about to duplicate.
export function runWillSendMessage(run) {
  if (!run) return false;
  if (runSentMessage(run)) return true;
  if (run.status !== 'WAITING') return false;
  // Parked on the customer: nothing further is sent until they answer.
  if (isAwaitingReply(run)) return false;
  return actionsOf(run.nodes).slice(run.cursor).some((n) => REPLY_SUBTYPES.has(n.subtype));
}

// Hands an inbound message to a run on this conversation that is waiting for
// the customer's reply. Called before trigger matching: someone answering a
// workflow's question is continuing that conversation, not starting a new one,
// even when the answer happens to contain another workflow's keyword.
//
// Returns the advanced run, or null when nothing was waiting (or the wait had
// expired, in which case the run is closed and the message is treated as new).
export async function resumeAwaitingRun(workspaceId, conversationId, reply) {
  if (!conversationId) return null;

  const waiting = await prisma.workflowRun.findMany({
    where: { workspaceId, conversationId, status: 'WAITING' },
    orderBy: { startedAt: 'desc' },
  });
  const [run, ...stale] = waiting.filter(isAwaitingReply);
  if (!run) return null;

  // Only one run can own the conversation's next message; an older one still
  // waiting would otherwise pick up the reply after this one is done.
  for (const old of stale) {
    await closeRun(old, 'Superseded by a newer workflow waiting on this conversation');
  }

  const since = Date.parse(variablesOf(run)[AWAIT_KEY]?.since);
  if (Number.isFinite(since) && Date.now() - since > REPLY_TIMEOUT_MS) {
    await closeRun(run, 'No reply within 24 hours');
    return null;
  }

  return advanceRun(run.id, { reply: String(reply ?? '') });
}

async function closeRun(run, reason) {
  const trace = Array.isArray(run.trace) ? [...run.trace] : [];
  trace.push({ step: run.cursor, subtype: 'cancelled', detail: reason, result: 'cancelled', at: new Date().toISOString() });
  const variables = variablesOf(run);
  delete variables[AWAIT_KEY];
  await prisma.workflowRun.update({
    where: { id: run.id },
    data: { status: 'COMPLETED', trace, variables, finishedAt: new Date() },
  }).catch((err) => console.error(`[WorkflowEngine] Could not close run ${run.id}:`, err.message));
}

// Stops every in-flight run on a conversation.
//
// A customer who types "cancel" or "bye" mid-flow must actually leave it
// (QA BUG-02). Runs parked on a delay would otherwise wake up later and carry
// on messaging someone who has already said they are done.
//
// Recorded as COMPLETED with a `cancelled` trace entry rather than a new status
// value: WorkflowRunStatus has no CANCELLED member, and adding one would need a
// schema migration to deploy before this fix could ship.
export async function cancelActiveRuns(workspaceId, conversationId, reason = 'Cancelled by the customer') {
  if (!conversationId) return 0;

  const runs = await prisma.workflowRun.findMany({
    where: { workspaceId, conversationId, status: { in: ['RUNNING', 'WAITING'] } },
  });
  if (runs.length === 0) return 0;

  await Promise.all(runs.map((run) => {
    const trace = Array.isArray(run.trace) ? [...run.trace] : [];
    trace.push({ step: run.cursor, subtype: 'cancelled', detail: reason, result: 'cancelled', at: new Date().toISOString() });
    return prisma.workflowRun.update({
      where: { id: run.id },
      data: { status: 'COMPLETED', trace, finishedAt: new Date() },
    }).catch((err) => console.error(`[WorkflowEngine] Could not cancel run ${run.id}:`, err.message));
  }));

  console.log(`[WorkflowEngine] Cancelled ${runs.length} run(s) on conversation ${conversationId} — ${reason}`);
  return runs.length;
}

// True if a run parked on a delay is still due to send something. Used to decide
// whether a control word actually interrupted anything worth acknowledging.
export async function hasActiveRun(workspaceId, conversationId) {
  if (!conversationId) return false;
  const count = await prisma.workflowRun.count({
    where: { workspaceId, conversationId, status: { in: ['RUNNING', 'WAITING'] } },
  });
  return count > 0;
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
// workflow by id or name, so the trigger-matching path in findMatchingWorkflows() does
// not apply. Returns null when the workflow is missing or inactive, so the
// caller can fall through instead of silently doing nothing.
export async function startRunForWorkflowId(workspaceId, workflowIdOrName, { conversationId, contactId, triggerMessage }) {
  const target = String(workflowIdOrName || '').trim();
  if (!target) return null;

  const workflow = await prisma.workflow.findFirst({
    where: {
      workspaceId,
      isActive: true,
      OR: [
        { id: target },
        { name: target },
        { name: { equals: target, mode: 'insensitive' } },
      ],
    },
  });
  if (!workflow) {
    console.warn(`[WorkflowEngine] Workflow "${target}" not found or inactive in workspace ${workspaceId} — nothing started.`);
    return null;
  }
  console.log(`[WorkflowEngine] Starting run for workflow "${workflow.name}" (${workflow.id}) in workspace ${workspaceId}`);
  return startRun(workflow, { workspaceId, conversationId, contactId, triggerMessage });
}
