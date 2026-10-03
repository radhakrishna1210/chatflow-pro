import { prisma } from '../lib/prisma.js';
import { keywordMatches, matchedKeyword } from './automation.service.js';
// A namespace import: test doubles of the outbound module may provide only the
// legacy sendAutomatedReply, and deliver() below falls back to it.
import * as outbound from './outbound.service.js';
import { realtime } from '../lib/realtimeBus.js';
import { evaluateCondition, skipCount, renderTemplate, tidy, CONDITION_SUBTYPES } from './workflowConditions.js';
import * as meta from '../lib/meta.js';
import { countVariables } from '../lib/templateParams.js';
// One limit and one duration parser for the save-time validator and the runtime.
import { MAX_ACTIONS, parseDelayMs, CRM_TRIGGER_SUBTYPES } from './workflowGraph.js';

export { parseDelayMs };

// The Workflows tab used to be a drawing surface: workflows were saved,
// toggled active, and never executed by anything. This is the interpreter that
// makes them real. It runs the same node shape the builder produces —
// { id, type: 'trigger'|'action', subtype, value } — because that's what's
// already persisted in Workflow.nodes for every existing workspace.

const ACTIVE_STATUSES = ['RUNNING', 'WAITING'];

// How long a claimed run may go without writing before the sweep treats the
// worker running it as dead and resumes it from its last persisted step.
export const RUN_LEASE_MS = 10 * 60_000;
// After the sweep re-enqueues a run it pushes resumeAt out by this much, so a
// run whose resume keeps failing is retried every few minutes, not every tick.
const SWEEP_BACKOFF_MS = 5 * 60_000;

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
// Set (and persisted) immediately before a customer-facing send, cleared once
// the step has run. A pass that died — or whose lease expired while Meta was
// still answering — leaves it behind, and the pass that recovers the run must
// not send that step a second time (a duplicate OTP is worse than a lost one).
const INFLIGHT_KEY = '__inflight';

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

const BUTTON_TITLE_CHARS = meta.INTERACTIVE_LIMITS?.buttonTitleChars ?? 20;
const ROW_TITLE_CHARS = meta.INTERACTIVE_LIMITS?.rowTitleChars ?? 24;
const titlesAsShown = (labels, max) => (typeof meta.uniqueTitles === 'function'
  ? meta.uniqueTitles(labels, max)
  : labels.map((l) => l.slice(0, max).trimEnd()));

// Turns what the customer sent back into the option they meant. A tapped
// button arrives as its title as WhatsApp showed it — clipped to Meta's limit
// (20 chars for a button, 24 for a list row) and, where two options clipped
// alike, given the suffix lib/meta.js#uniqueTitles added — so "Talk to our
// support team" comes back truncated and a `Message is exactly` condition
// written against the full label would never match. Typing the option's
// number or its text in any case counts too — on WhatsApp people often answer
// a menu by typing rather than tapping.
export function resolveReply(reply, options = []) {
  const text = String(reply ?? '').trim();
  const labels = (Array.isArray(options) ? options : []).map((o) => String(o ?? '').trim()).filter(Boolean);
  if (!text || labels.length === 0) return text;

  const lower = text.toLowerCase();
  const exact = labels.find((o) => o.toLowerCase() === lower);
  if (exact) return exact;

  for (const max of [BUTTON_TITLE_CHARS, ROW_TITLE_CHARS]) {
    const shown = titlesAsShown(labels, max);
    const index = shown.findIndex((t) => t.trim().toLowerCase() === lower);
    if (index !== -1) return labels[index];
  }

  const number = text.match(/^(\d{1,2})[.)]?$/);
  if (number) {
    const picked = labels[Number(number[1]) - 1];
    if (picked) return picked;
  }
  return text;
}

// What webhook.service.js passes as the message body for media with no
// caption (inboundMessage.js PLACEHOLDER). It is a stand-in, not words the
// customer wrote.
const MEDIA_PLACEHOLDER = /^\[(photo|video|voice message|document|sticker|contact card|location|unsupported message[^\]]*)\]$/i;
const isMediaPlaceholder = (reply) => MEDIA_PLACEHOLDER.test(String(reply ?? '').trim());

const triggerOf = (nodes) => (Array.isArray(nodes) ? nodes : []).find((n) => n?.type === 'trigger');
// Conditions live in the same ordered list as actions: a skip count is measured
// in steps as the builder shows them, so filtering conditions out here would
// make "skip the next 2" point at the wrong places.
const actionsOf = (nodes) => (Array.isArray(nodes) ? nodes : [])
  .filter((n) => n?.type === 'action' || n?.type === 'condition')
  .slice(0, MAX_ACTIONS);

// Decides whether a workflow's trigger fires for this inbound event. Mirrors
// the trigger subtypes the builder offers.
export function triggerFires(trigger, {
  messageBody = '', isNewContact = false, event = 'message', mediaType = null,
} = {}) {
  if (!trigger) return false;
  switch (trigger.subtype) {
    case 'keyword':
      return event === 'message' && keywordMatches(trigger.value, messageBody);
    case 'welcome':
      return (event === 'message' || event === 'media') && isNewContact === true;
    // A photo, video, document, sticker or voice note arrived. The value
    // narrows it to one kind ('image', 'audio', ...); empty or 'any' takes all.
    // Fires for a transcribed voice note too, after any keyword workflow had
    // its chance at the transcript (see the ordering below).
    case 'media': {
      if (!mediaType) return false;
      const wanted = String(trigger.value || '').trim().toLowerCase();
      return !wanted || wanted === 'any' || wanted === mediaType;
    }
    // `missed` (missed inbound call) was offered by the builder but nothing
    // ever emits that event, so it is no longer accepted and never fires.
    default:
      return false;
  }
}

// How specific a firing trigger is for this message: the length of the
// keyword that actually matched (not of the whole keyword list — a long
// AI-written list "HELP, SUPPORT, PRICE, COST" used to outrank a hand-built
// "PRICE LIST"); a media trigger below every keyword and welcome trigger, so
// the words of a transcribed voice note win over "a voice note arrived".
const triggerRank = (trigger, ctx) => {
  if (trigger?.subtype === 'media') return -1;
  if (trigger?.subtype === 'keyword') return matchedKeyword(trigger.value, ctx?.messageBody)?.length ?? 0;
  return 0;
};
const recency = (workflow) => new Date(workflow?.updatedAt ?? workflow?.createdAt ?? 0).getTime() || 0;

// The workflows whose trigger fires, best first: the most specific matched
// keyword, then the most recently updated workflow — an edited "Order v2"
// takes over from "Order v1" instead of the oldest winning forever. The same
// ordering serves production and "Test this workflow".
export function rankMatches(workflows, ctx) {
  return (Array.isArray(workflows) ? workflows : [])
    .map((workflow) => ({ workflow, trigger: triggerOf(workflow.nodes) }))
    .filter(({ trigger }) => triggerFires(trigger, ctx))
    .map((m) => ({ ...m, rank: triggerRank(m.trigger, ctx) }))
    .sort((a, b) => b.rank - a.rank || recency(b.workflow) - recency(a.workflow))
    .map(({ workflow }) => workflow);
}

// All active workflows in the workspace whose trigger fires, best first.
export async function findMatchingWorkflows(workspaceId, ctx) {
  const workflows = await prisma.workflow.findMany({
    where: { workspaceId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  const matched = rankMatches(workflows, ctx);

  // "Why didn't my workflow reply?" is almost always a trigger that does not
  // match what the customer typed, so say which triggers were tried.
  if (matched.length === 0) {
    const tried = workflows.map((w) => {
      const t = triggerOf(w.nodes);
      return `"${w.name}" (${t?.subtype ?? 'no trigger'}${t?.value ? `: ${t.value}` : ''})`;
    });
    console.log(`[Automation] No active workflow matched "${String(ctx?.messageBody ?? '').slice(0, 80)}" `
      + `in workspace ${workspaceId} — checked ${workflows.length}${tried.length ? `: ${tried.join(', ')}` : ''}`);
  }
  return matched;
}

// ── Sending, and saying why a send did not happen ──────────────────────────

// outbound.service.js reports a refused send as { code, detail }. The engine
// used to keep only "it failed" and record every refusal as "Meta rejected the
// send or 24-hour customer window is closed" — an empty wallet, an opted-out
// contact and a missing number all looked like a WhatsApp problem.
const SEND_FAILURE_TEXT = {
  NO_CREDIT: 'Not sent: the message quota and wallet balance are exhausted — top up the wallet or upgrade the plan',
  QUOTA_AND_WALLET_EXHAUSTED: 'Not sent: the message quota and wallet balance are exhausted — top up the wallet or upgrade the plan',
  SUBSCRIPTION_INACTIVE: 'Not sent: the workspace subscription is not active',
  OPTED_OUT: 'Not sent: the contact has opted out of messages from this business',
  NO_NUMBER: 'Not sent: the conversation has no connected WhatsApp number',
  WINDOW_CLOSED: 'Not sent: the 24-hour customer service window is closed (the contact has not written in the last 24 hours) — only an approved template can reach them now',
  EMPTY: 'Not sent: the message was empty',
};

export function describeSendFailure(outcome) {
  const code = outcome?.code ?? 'META_REJECTED';
  if (SEND_FAILURE_TEXT[code]) return SEND_FAILURE_TEXT[code];
  const detail = String(outcome?.detail ?? '').trim();
  if (code === 'META_REJECTED') return `WhatsApp (Meta) rejected the send${detail ? `: ${detail}` : ''}`;
  return detail ? `Not sent (${code}): ${detail}` : `Not sent (${code})`;
}

async function deliver(args) {
  if (typeof outbound.deliverAutomatedReply === 'function') return outbound.deliverAutomatedReply(args);
  const message = await outbound.sendAutomatedReply(args);
  return message ? { ok: true, message } : { ok: false, code: 'META_REJECTED', detail: 'the send was refused' };
}

const failedSend = (outcome) => ({ result: 'failed', detail: describeSendFailure(outcome), code: outcome?.code ?? 'META_REJECTED' });

// ── Action executors ───────────────────────────────────────────────────────

// What a condition is allowed to ask about. Loaded once per advanceRun rather
// than per step, since a workflow can carry several conditions. A CRM-started
// run without a conversation still has a contact.
async function conditionContext(run) {
  const conversation = run.conversationId
    ? await prisma.conversation.findUnique({
        where: { id: run.conversationId },
        include: { contact: true },
      })
    : null;
  let contact = conversation?.contact ?? null;
  if (!contact && run.contactId) {
    contact = await prisma.contact.findUnique({ where: { id: run.contactId } }).catch(() => null);
  }
  return {
    messageBody: run.triggerMessage ?? '',
    contact,
    // A contact created within the last few minutes of this run starting is the
    // closest the engine can get to "new" once the run may have been resumed
    // from a delay hours later.
    isNewContact: Boolean(contact
      && contact.createdAt >= new Date(new Date(run.startedAt).getTime() - 60_000)),
  };
}

const describeCondition = (node) => {
  const spec = CONDITION_SUBTYPES.find((c) => c.id === node.subtype);
  const label = spec?.label ?? node.subtype;
  return spec?.needsValue ? `${label} "${node.value ?? ''}"` : label;
};

// The conversation a customer-facing step speaks on. A step that cannot reach
// the customer is a failure, not a skip: a run whose messages went nowhere was
// reported COMPLETED, and "the workflow ran but nobody got anything" looked
// exactly like success in the run history.
async function replyConversation(run) {
  if (!run.conversationId) {
    return {
      fail: {
        result: 'failed',
        detail: run.leadId || run.dealId
          ? 'No WhatsApp conversation with this contact, and no connected number to start one on'
          : 'No conversation to reply to',
      },
    };
  }
  const conversation = await prisma.conversation.findUnique({
    where: { id: run.conversationId },
    include: { contact: true },
  });
  if (!conversation) return { fail: { result: 'failed', detail: 'The conversation no longer exists' } };
  return { conversation };
}

const renderContext = (run, conversation) => ({
  contact: conversation?.contact ?? null,
  variables: run.variables && typeof run.variables === 'object' ? run.variables : {},
  messageBody: run.triggerMessage ?? '',
});

// A template step names its template by id (preferred — names are not unique
// across languages) or by name.
export async function findStepTemplate(workspaceId, node) {
  const id = String(node.templateId ?? '').trim();
  if (id) {
    const byId = await prisma.template.findFirst({ where: { id, workspaceId } });
    if (byId) return byId;
  }
  const name = String(node.value ?? '').trim();
  if (!name) return null;
  const byName = { workspaceId, OR: [{ name }, { name: { equals: name, mode: 'insensitive' } }] };
  return await prisma.template.findFirst({ where: { ...byName, status: 'APPROVED' } })
    ?? await prisma.template.findFirst({ where: byName });
}

// The values for the template's {{1}}…{{n}}: the step's `params`, rendered like
// a message step's text ({{name}}, {{custom.x}}, answers the run collected).
// A slot without a value fails the step — the template's approval samples are
// never sent in its place. {{1}} alone defaults to the contact's name when the
// step gives no values at all (how template steps behaved before params).
export function templateStepValues(template, node, context) {
  const components = Array.isArray(template?.components) ? template.components : [];
  const required = components.reduce((max, c) => Math.max(max, countVariables(c?.text)), 0);
  if (required === 0) return { values: [] };

  const params = Array.isArray(node?.params) ? node.params : [];
  if (params.length === 0) {
    if (required === 1) return { values: [(context.contact?.name || '').trim() || 'there'] };
    return {
      error: `Template "${template.name}" has ${required} placeholders ({{1}}–{{${required}}}) but the step gives no values for them. `
        + 'Add the values to the step — approval sample values are never sent to customers.',
    };
  }

  const values = [];
  for (let i = 0; i < required; i += 1) {
    const value = tidy(renderTemplate(String(params[i] ?? ''), context));
    if (!value) {
      return {
        error: i < params.length
          ? `Template "${template.name}": the value for {{${i + 1}}} ("${params[i]}") was empty after filling in variables`
          : `Template "${template.name}" needs ${required} values but the step gives ${params.length} — {{${i + 1}}} has none`,
      };
    }
    values.push(value);
  }
  return { values };
}

async function actionTemplate(run, node) {
  const target = await replyConversation(run);
  if (target.fail) return target.fail;
  const { conversation } = target;
  if (conversation.channel === 'INSTAGRAM') return { result: 'failed', detail: 'Templates can only be sent on WhatsApp' };
  if (!conversation.waNumberId) return { result: 'failed', detail: 'Conversation has no connected number' };

  const template = await findStepTemplate(run.workspaceId, node);
  if (!template) {
    return { result: 'failed', detail: `Template "${node.value || node.templateId}" was not found in this workspace` };
  }
  if (template.status !== 'APPROVED') {
    return { result: 'failed', detail: `Template "${template.name}" is ${String(template.status).toLowerCase()}, not approved, so it cannot be sent yet` };
  }

  const { values, error } = templateStepValues(template, node, renderContext(run, conversation));
  if (error) return { result: 'failed', detail: error };

  // A failed template send is a failed step, like a failed message step: it
  // used to throw out of the run and skip every step after it — including a
  // handoff to a person, which is exactly what a failed send needs.
  try {
    console.log(`[WorkflowEngine] Sending template "${template.name}" for run ${run.id}`);
    const { sendTemplateMessage } = await import('./conversations.service.js');
    const msg = await sendTemplateMessage(run.workspaceId, run.conversationId, null, {
      templateId: template.id,
      contactId: run.contactId || conversation.contactId,
      phoneNumber: conversation.contact?.phoneNumber,
      variables: values,
      strictVariables: true,
    });
    return {
      result: 'sent',
      detail: `Sent template: "${template.name}"`,
      metaMessageId: msg?.metaMessageId,
    };
  } catch (err) {
    const outOfCredit = err?.status === 403 && /quota|wallet/i.test(String(err?.message));
    if (outOfCredit && typeof outbound.noteAutomatedCreditRefusal === 'function') {
      await outbound.noteAutomatedCreditRefusal(run.workspaceId, err.code || 'QUOTA_AND_WALLET_EXHAUSTED');
    }
    const reason = outOfCredit
      ? SEND_FAILURE_TEXT.NO_CREDIT
      : /opted out/i.test(String(err?.message))
        ? SEND_FAILURE_TEXT.OPTED_OUT
        : `Not sent: ${err?.message || 'the template send failed'}`;
    console.error(`[WorkflowEngine] Template "${template.name}" for run ${run.id} failed:`, err?.message);
    return { result: 'failed', detail: `Template "${template.name}" — ${reason}` };
  }
}

// A "Send message" step sends its text. It used to be sent as a paid template
// instead whenever the text happened to equal an approved template's name;
// the builder now warns about that at save and suggests a template step.
async function actionMessage(run, node) {
  const target = await replyConversation(run);
  if (target.fail) return target.fail;
  const { conversation } = target;
  // An Instagram thread has no number; outbound.service sends it via Instagram.
  if (!conversation.waNumberId && conversation.channel !== 'INSTAGRAM') {
    return { result: 'failed', detail: 'Conversation has no connected number' };
  }

  // `{{name}}`, `{{customer_name}}`, `{{custom.order_number}}` and anything the run has collected.
  // Without this every automated message was identical for every recipient.
  const body = tidy(renderTemplate(node.value, renderContext(run, conversation)));
  if (!body) return { result: 'failed', detail: 'The message was empty after filling in variables' };

  console.log(`[WorkflowEngine] Sending automated reply for run ${run.id}: "${body.slice(0, 50)}..."`);
  const outcome = await deliver({
    conversationId: conversation.id,
    waNumberId: conversation.waNumberId,
    toPhone: conversation.contact.phoneNumber,
    body,
  });

  return outcome?.ok
    ? { result: 'sent', detail: `Sent: "${body}"` }
    : failedSend(outcome);
}

// Offer the customer tappable choices instead of asking them to type.
//
// Authored in the linear builder as "Question | Option A | Option B", the same
// single-field convention the conditions use, or as an explicit `options` array
// for anything built through the API. The reply arrives back as the option's own
// text, so the keyword triggers and `contains` conditions match it unchanged.
async function actionButtons(run, node) {
  const target = await replyConversation(run);
  if (target.fail) return target.fail;
  const { conversation } = target;
  // Instagram offers the options as quick replies.
  if (!conversation.waNumberId && conversation.channel !== 'INSTAGRAM') {
    return { result: 'failed', detail: 'Conversation has no connected number' };
  }

  const context = renderContext(run, conversation);
  const explicit = Array.isArray(node.options) ? node.options : null;
  const parts = String(node.value ?? '').split('|').map((p) => p.trim()).filter(Boolean);
  const body = tidy(renderTemplate(parts[0] ?? '', context));
  const options = (explicit ?? parts.slice(1))
    .map((o) => tidy(renderTemplate(String(typeof o === 'string' ? o : o?.title ?? ''), context)))
    .filter(Boolean);

  if (!body) return { result: 'failed', detail: 'No question to ask' };
  if (options.length === 0) {
    return { result: 'failed', detail: 'No options configured — write them as "Question | Option A | Option B"' };
  }

  const outcome = await deliver({
    conversationId: conversation.id,
    waNumberId: conversation.waNumberId,
    toPhone: conversation.contact.phoneNumber,
    body,
    options,
  });

  // `options` is not kept in the trace; advanceRun lifts it into the run's
  // variables so a following wait_reply step can map the reply back to it.
  return outcome?.ok
    ? { result: 'sent', detail: `Asked "${body}" with ${options.length} option(s)`, options }
    : failedSend(outcome);
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
  if (!run.conversationId) {
    return { result: 'failed', detail: 'No conversation to hand to a person' };
  }

  const wanted = String(node.value || '').trim().toLowerCase();
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: run.workspaceId },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (members.length === 0) return { result: 'failed', detail: 'The workspace has no members to hand the chat to' };

  const matched = wanted
    ? members.find((m) => m.user.name?.toLowerCase() === wanted || m.user.email?.toLowerCase() === wanted)
      || members.find((m) => m.user.name?.toLowerCase().includes(wanted))
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
      handoffReason: 'workflow_agent_step',
    },
  });
  realtime.conversationUpdated(run.workspaceId, run.conversationId, 'assigned');

  const exact = matched ? '' : ` (no member matched "${node.value}", used ${assignee.user.name})`;
  return { result: 'ok', detail: `Assigned to ${assignee.user.name}${exact}` };
}

// ── Run lifecycle ──────────────────────────────────────────────────────────

// The Workflows tab refreshes on these instead of polling for run history.
function emitRun(run, status = run?.status) {
  if (!run?.workspaceId) return;
  try {
    realtime.workflowRun?.(run.workspaceId, run.workflowId, { runId: run.id, status: status ?? null });
  } catch (err) {
    console.warn('[Workflow] Could not publish the run update:', err.message);
  }
}

// Steps that act on a lead. A run started by a customer's message used to
// carry no lead at all, so "CRM: Set lead status" / "Assign owner" in a
// keyword workflow always skipped.
const LEAD_STEP_SUBTYPES = new Set(['lead_status', 'owner', 'task']);

async function leadForContact(workspaceId, contactId) {
  try {
    const lead = await prisma.lead.findFirst({
      where: { workspaceId, contactId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return lead?.id ?? null;
  } catch (err) {
    console.warn(`[Workflow] Could not look up the lead for contact ${contactId}:`, err.message);
    return null;
  }
}

// `leadId`/`dealId` are set for CRM-triggered runs. A conversation-triggered
// run is given the contact's lead when one of its steps needs it.
export async function startRun(workflow, { workspaceId, conversationId, contactId, leadId, dealId, triggerMessage }) {
  let lead = leadId || null;
  if (!lead && contactId && actionsOf(workflow.nodes).some((n) => LEAD_STEP_SUBTYPES.has(n?.subtype))) {
    lead = await leadForContact(workspaceId, contactId);
  }
  const run = await prisma.workflowRun.create({
    data: {
      workspaceId,
      workflowId: workflow.id,
      conversationId: conversationId || null,
      contactId: contactId || null,
      leadId: lead,
      dealId: dealId || null,
      nodes: workflow.nodes,
      trace: [],
      triggerMessage: triggerMessage || null,
      status: 'RUNNING',
      cursor: 0,
    },
  });
  console.log(`[Workflow] Execution started: ${run.id} — workflow "${workflow.name}" (${workflow.id}), conversation ${conversationId ?? '—'}`);
  emitRun(run, 'RUNNING');
  return advanceRun(run.id);
}

// Has a person taken this conversation over since the run started? An `agent`
// step does exactly that, and so can someone in the inbox while a run sits on
// a delay. Either way the bot must stop talking: the inbound handler already
// suppresses automation on a handed-off thread, and a run that kept sending
// after its own handoff step answered a refund request with both "received"
// and "cannot be processed".
async function handedOffSince(run) {
  if (!run.conversationId) return false;
  const conversation = await prisma.conversation.findUnique({
    where: { id: run.conversationId },
    select: { humanHandoffAt: true },
  });
  const at = conversation?.humanHandoffAt;
  return Boolean(at && run.startedAt && new Date(at) >= new Date(run.startedAt));
}

const traceFailures = (trace) => trace.filter((t) => t?.result === 'failed');
const describeFailures = (failures) => failures
  .map((t) => `Step ${Number(t.step) + 1} (${t.subtype}): ${t.detail}`)
  .join('; ')
  .slice(0, 1000);

// Takes ownership of a run for one pass of advanceRun. The claim is a
// conditional update on the run's version, so of two concurrent callers — two
// inbound replies processed in parallel, a BullMQ retry, the recovery sweep —
// exactly one wins; the other sees count 0 and backs off. Returns the claimed
// version, or null when someone else holds the run or it is no longer active.
//
// A RUNNING run is claimable only before its first pass (no lease yet) or once
// its lease has expired — i.e. the pass that held it died.
export async function claimRun(run, now = new Date()) {
  const version = run.version ?? 0;
  const claimed = await prisma.workflowRun.updateMany({
    where: {
      id: run.id,
      version,
      OR: [
        { status: 'WAITING' },
        { status: 'RUNNING', resumeAt: null },
        { status: 'RUNNING', resumeAt: { lte: now } },
      ],
    },
    data: { status: 'RUNNING', version: { increment: 1 }, resumeAt: new Date(now.getTime() + RUN_LEASE_MS) },
  });
  return claimed.count > 0 ? version + 1 : null;
}

// Writes to a run this pass has claimed. False means the version moved on —
// the run was cancelled or claimed by someone else — and the caller must stop
// rather than overwrite (and resurrect) it.
async function writeClaimed(runId, version, data) {
  const res = await prisma.workflowRun.updateMany({ where: { id: runId, version }, data });
  return res.count > 0;
}

const leaseFromNow = () => new Date(Date.now() + RUN_LEASE_MS);

// Steps that put a message in front of the customer. A 'buttons' step is a
// message too, so a run that ends on one has replied and the inbound handler
// must not add a welcome or AI answer on top of it.
const REPLY_SUBTYPES = new Set(['message', 'buttons', 'template']);

// Executes action steps from the run's cursor. A delay step parks the run
// (status WAITING) and schedules a resume; everything else runs inline. Called
// both on trigger and by the workflow worker after a delay elapses.
//
// `reply` is passed only when the customer has answered a wait_reply step; a
// run parked on one is otherwise left alone, so a stray delay job or retry
// cannot march it past the question without an answer — and a reply handed to
// a run that is NOT waiting for one (it moved on to a delay in the meantime)
// is ignored rather than allowed to cut the delay short.
//
// The cursor is persisted before every step, so a pass that dies part-way (a
// pool timeout on a write, a crashed process) is resumed from the step it was
// on rather than re-sending everything since the last park.
export async function advanceRun(runId, { reply } = {}) {
  const current = () => prisma.workflowRun.findUnique({ where: { id: runId } });

  // A claim lost to a reminder marking the run (which bumps the version but
  // leaves it waiting) is worth re-reading for; one lost to another pass is not,
  // and the re-read then finds the run RUNNING under a live lease.
  let stored = null;
  let variables = null;
  let awaiting = null;
  let version = null;
  for (let attempt = 0; attempt < 3 && version === null; attempt += 1) {
    stored = await current();
    if (!stored) return null;
    // COMPLETED / FAILED / CANCELLED: a delayed resume that fires after the
    // customer said "stop" finds the run closed and does nothing.
    if (!ACTIVE_STATUSES.includes(stored.status)) return stored;

    variables = variablesOf(stored);
    awaiting = variables[AWAIT_KEY];
    if (awaiting && reply === undefined) return stored;
    if (!awaiting && reply !== undefined) return stored;

    version = await claimRun(stored);
  }
  if (version === null) {
    console.log(`[Workflow] Run ${runId} is already being advanced (or was closed) — leaving it to that pass`);
    return current();
  }
  let lastStatus = stored.status;
  const persist = async (data) => {
    const ok = await writeClaimed(runId, version, data);
    if (!ok) console.warn(`[Workflow] Run ${runId} was cancelled or taken over mid-pass — stopping`);
    else if (data.status && data.status !== lastStatus) {
      lastStatus = data.status;
      emitRun(stored, data.status);
      // A failed run is otherwise only visible in its history (one bell entry
      // per workflow per day). Lazy: tests that mock the engine's neighbours
      // need not mock notifications.
      if (data.status === 'FAILED') {
        import('./workflowAlerts.service.js')
          .then((m) => m.notifyWorkflowFailed(stored, data.error))
          .catch((err) => console.warn(`[Workflow] Failure alert for run ${runId} not sent:`, err.message));
      }
    }
    return ok;
  };

  const actions = actionsOf(stored.nodes);
  const trace = Array.isArray(stored.trace) ? [...stored.trace] : [];

  // The executors read the run's message and variables, so they are handed this
  // working copy rather than the stored row.
  const run = { ...stored, variables };
  let startAt = run.cursor;

  // A send that was in flight when the previous pass lost the run (it died, or
  // Meta was still answering when the lease ran out). It may well have reached
  // the customer, so it is not repeated.
  const inflight = variables[INFLIGHT_KEY];
  if (inflight) {
    delete variables[INFLIGHT_KEY];
    const node = actions[inflight.step];
    if (inflight.step === run.cursor && node && REPLY_SUBTYPES.has(node.subtype)) {
      trace.push({
        step: inflight.step,
        subtype: node.subtype,
        detail: 'Not repeated: the previous attempt at this step was interrupted mid-send and may already have reached the customer',
        result: 'skipped',
        at: new Date().toISOString(),
      });
      startAt = run.cursor + 1;
    }
  }

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
    // Recorded straight away: a pass that dies after this must resume as
    // answered, not wait for a reply the customer already gave.
    if (!(await persist({ trace, variables, triggerMessage: run.triggerMessage }))) return current();
  }

  let handedOff = await handedOffSince(run);
  // The last customer-facing step that failed since the customer last spoke.
  // Waiting for an answer to a question that never arrived would swallow their
  // next, unrelated message as the "answer".
  let undelivered = null;

  for (let i = startAt; i < actions.length; i += 1) {
    const node = actions[i];
    const sends = REPLY_SUBTYPES.has(node.subtype);

    // Checkpoint before each step after the first: it records progress and,
    // being conditional on the claimed version, notices a cancel before the
    // next message goes out. Before a send it also renews the lease and marks
    // the step in flight (see INFLIGHT_KEY).
    if (i > run.cursor || sends) {
      const checkpoint = { ...variables, ...(sends && !handedOff ? { [INFLIGHT_KEY]: { step: i, at: new Date().toISOString() } } : {}) };
      if (!(await persist({
        cursor: i, trace, variables: checkpoint, triggerMessage: run.triggerMessage, resumeAt: leaseFromNow(),
      }))) return current();
    }

    console.log(`[Workflow] Executing node ${i + 1}/${actions.length} (${node.type}:${node.subtype}) for run ${run.id}`);

    if (handedOff && (sends || node.subtype === 'wait_reply')) {
      trace.push({ step: i, subtype: node.subtype, detail: 'Skipped — the conversation was handed to a person', result: 'skipped', at: new Date().toISOString() });
      continue;
    }

    if (node.subtype === 'wait_reply') {
      const cannotWait = undelivered
        ? `Step ${Number(undelivered.step) + 1} (${undelivered.subtype}) was not delivered, so there is nothing to wait for: ${undelivered.detail}`
        : !run.conversationId
          ? 'There is no conversation with the customer, so no reply can arrive'
          : null;
      if (cannotWait) {
        trace.push({ step: i, subtype: 'wait_reply', detail: cannotWait, result: 'failed', at: new Date().toISOString() });
        const error = describeFailures(traceFailures(trace));
        console.error(`[Workflow] Run ${run.id} failed — ${error}`);
        await persist({
          status: 'FAILED', cursor: i, trace, variables, triggerMessage: run.triggerMessage, error, finishedAt: new Date(), resumeAt: null,
        });
        return current();
      }
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
      const remindMs = node.reminder ? parseDelayMs(node.remindAfter) : 0;
      trace.push({
        step: i,
        subtype: 'wait_reply',
        detail: `Waiting for the customer to reply${remindMs > 0 ? ` (reminder after ${node.remindAfter})` : ''}`,
        result: 'waiting',
        at: new Date().toISOString(),
      });
      // resumeAt is when the sweep must look again: the reminder, or else the
      // reply timeout that closes the run.
      const resumeAt = new Date(Date.now() + (remindMs > 0 ? remindMs : REPLY_TIMEOUT_MS));
      if (!(await persist({
        status: 'WAITING', cursor: i + 1, trace, variables, triggerMessage: run.triggerMessage, resumeAt,
      }))) return current();
      if (remindMs > 0) {
        // A reminder that cannot be queued is not lost: resumeAt is set, and
        // the sweep enqueues it once Redis is reachable again.
        try {
          const { enqueueReplyReminder } = await import('../queues/workflow.queue.js');
          await enqueueReplyReminder(run.id, i + 1, remindMs);
        } catch (queueErr) {
          console.error(`[WorkflowEngine] Could not schedule the reply reminder for run ${run.id} (the sweep will retry):`, queueErr.message);
        }
      }
      console.log(`[Workflow] Run ${run.id} waiting for the customer's reply at step ${i + 1}`);
      return current();
    }

    if (node.subtype === 'delay') {
      const ms = parseDelayMs(node.value);
      if (ms > 0) {
        trace.push({ step: i, subtype: 'delay', detail: `Waiting ${node.value}`, result: 'waiting', at: new Date().toISOString() });
        // Resume *after* this delay node, so a re-entrant worker can't
        // re-park on the same step and loop forever. resumeAt is the durable
        // copy of the schedule; the queued job is only the fast path.
        if (!(await persist({
          status: 'WAITING', cursor: i + 1, trace, variables, triggerMessage: run.triggerMessage, resumeAt: new Date(Date.now() + ms),
        }))) return current();
        try {
          const { enqueueWorkflowResume } = await import('../queues/workflow.queue.js');
          await enqueueWorkflowResume(run.id, i + 1, ms);
        } catch (queueErr) {
          console.error(`[WorkflowEngine] Could not enqueue the resume for run ${run.id} (the sweep will resume it):`, queueErr.message);
        }
        return current();
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
        // Workflows are validated on save, so an unknown step here is a run
        // snapshotted before validation existed; it is a failure, not a skip.
        outcome = await runCrmAction(run, node) ?? { result: 'failed', detail: `Unknown action "${node.subtype}"` };
      }
    } catch (err) {
      console.error(`[WorkflowEngine] step ${i} of run ${run.id} failed:`, err);
      delete variables[INFLIGHT_KEY];
      trace.push({ step: i, subtype: node.subtype, detail: err.message, result: 'failed', at: new Date().toISOString() });
      await persist({
        status: 'FAILED', cursor: i, trace, variables, error: describeFailures(traceFailures(trace)) || err.message, finishedAt: new Date(), resumeAt: null,
      });
      return current();
    }

    const { options: offered, ...recorded } = outcome;
    // A new question replaces the menu the customer is answering; any other
    // message sent after the buttons means the reply is to that, not to them.
    if (Array.isArray(offered)) variables[LAST_OPTIONS_KEY] = offered;
    else if (sends && recorded.result === 'sent') delete variables[LAST_OPTIONS_KEY];
    trace.push({ step: i, subtype: node.subtype, ...recorded, at: new Date().toISOString() });

    if (sends) {
      if (recorded.result === 'sent') undelivered = null;
      else if (recorded.result === 'failed') undelivered = { step: i, subtype: node.subtype, detail: recorded.detail };
    }
    if (recorded.result === 'failed') {
      console.error(`[Workflow] Run ${run.id} step ${i + 1} (${node.subtype}) failed: ${recorded.detail}`);
    } else if (sends) {
      console.log(`[Workflow] Run ${run.id} step ${i + 1} ${recorded.result}: ${recorded.detail}`);
    }
    if (node.subtype === 'agent' && recorded.result === 'ok') handedOff = true;
  }

  // A run whose message never reached the customer did not do its job, and
  // reporting it COMPLETED is what made "the workflow ran but nobody got
  // anything" impossible to tell apart from success in the run history. The
  // remaining steps still ran — a handoff after a failed send is exactly when a
  // person is needed — but the run is recorded as FAILED with the reason.
  const failures = traceFailures(trace);
  const status = failures.length ? 'FAILED' : 'COMPLETED';
  const error = failures.length ? describeFailures(failures) : null;
  console.log(`[Workflow] Execution ${status === 'FAILED' ? 'finished with errors' : 'completed'}: ${run.id}${error ? ` — ${error}` : ''}`);
  await persist({
    status, cursor: actions.length, trace, variables, triggerMessage: run.triggerMessage, finishedAt: new Date(), resumeAt: null, ...(error ? { error } : {}),
  });
  return current();
}

// Fired by the workflow worker `remindAfter` after a wait_reply parked (or by
// the recovery sweep when that job was lost). Sends the step's reminder only if
// the run is still parked on that same wait: an answer, a cancel, a handoff or
// a later wait all make it stale.
export async function sendReplyReminder(runId, cursor) {
  const run = await prisma.workflowRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== 'WAITING' || run.cursor !== cursor || !isAwaitingReply(run)) {
    return { sent: false, reason: 'The run is no longer waiting on this step' };
  }

  const node = actionsOf(run.nodes)[cursor - 1];
  if (node?.subtype !== 'wait_reply' || !node.reminder) {
    return { sent: false, reason: 'The step has no reminder configured' };
  }
  const variables = variablesOf(run);
  if (variables[AWAIT_KEY]?.reminded) return { sent: false, reason: 'Already reminded' };
  if (await handedOffSince(run)) return { sent: false, reason: 'The conversation was handed to a person' };

  const conversation = await prisma.conversation.findUnique({
    where: { id: run.conversationId },
    include: { contact: true },
  });
  if (!conversation?.waNumberId && conversation?.channel !== 'INSTAGRAM') {
    return { sent: false, reason: 'Conversation has no connected number' };
  }

  // Claimed before sending: the reminder job and a sweep-enqueued copy (or a
  // BullMQ retry) must not both nudge the customer. The claim moves resumeAt
  // to the reply timeout, which is when the sweep next needs this run.
  const since = Date.parse(variables[AWAIT_KEY]?.since);
  variables[AWAIT_KEY] = { ...variables[AWAIT_KEY], reminded: true };
  const version = (run.version ?? 0) + 1;
  const claimed = await prisma.workflowRun.updateMany({
    where: { id: runId, version: run.version ?? 0, status: 'WAITING', cursor },
    data: {
      variables,
      version: { increment: 1 },
      resumeAt: new Date((Number.isFinite(since) ? since : Date.now()) + REPLY_TIMEOUT_MS),
    },
  });
  if (claimed.count === 0) return { sent: false, reason: 'The run changed before the reminder went out' };

  const body = tidy(renderTemplate(node.reminder, {
    contact: conversation.contact,
    variables,
    messageBody: run.triggerMessage ?? '',
  }));
  const outcome = body
    ? await deliver({
        conversationId: conversation.id,
        waNumberId: conversation.waNumberId,
        toPhone: conversation.contact.phoneNumber,
        body,
      })
    : { ok: false, code: 'EMPTY', detail: 'Message was empty' };
  const sent = Boolean(outcome?.ok);

  // Re-read before writing: the customer may have answered while the send was
  // in flight, and that answer's advance must not be overwritten.
  const latest = await prisma.workflowRun.findUnique({ where: { id: runId } });
  if (!latest || latest.version !== version) return { sent };

  const trace = Array.isArray(latest.trace) ? [...latest.trace] : [];
  trace.push({
    step: cursor - 1,
    subtype: 'reminder',
    detail: sent ? `Sent reminder: "${body}"` : `Reminder not sent — ${describeSendFailure(outcome)}`,
    result: sent ? 'sent' : 'failed',
    at: new Date().toISOString(),
  });
  await writeClaimed(runId, version, { trace });
  console.log(`[Workflow] Reply reminder for run ${runId}: ${sent ? 'sent' : 'not sent'}`);
  return { sent, ...(sent ? {} : { reason: describeSendFailure(outcome) }) };
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
  console.log(`[Automation] Workflow matched: "${workflow.name}" (${workflow.id})`
    + (workflows.length > 1 ? ` — ${workflows.length - 1} other match(es) not run` : ''));

  // The customer repeating the trigger while this workflow is still running
  // for them (parked on a delay, say) must not start a second, parallel run:
  // every later step would then go out twice. The live run is returned so the
  // inbound handler still knows a workflow owns the conversation.
  if (ctx.conversationId) {
    const active = await prisma.workflowRun.findMany({
      where: { workspaceId, conversationId: ctx.conversationId, workflowId: workflow.id, status: { in: ACTIVE_STATUSES } },
      orderBy: { startedAt: 'desc' },
      take: 5,
    }).catch(() => []);
    const live = (active ?? []).find((r) => r.workflowId === workflow.id && ACTIVE_STATUSES.includes(r.status));
    if (live) {
      console.log(`[Automation] Workflow "${workflow.name}" is already running on conversation ${ctx.conversationId} (run ${live.id}, ${live.status}) — not starting it again`);
      return [live];
    }
  }

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

  const awaiting = variablesOf(run)[AWAIT_KEY];
  const since = Date.parse(awaiting?.since);
  if (Number.isFinite(since) && Date.now() - since > REPLY_TIMEOUT_MS) {
    await closeRun(run, 'No reply within 24 hours');
    return null;
  }

  // A photo or voice note with no caption arrives as a stand-in ("[photo]").
  // When the step saves the answer as a variable it is asking for words — an
  // order id, a name — so the stand-in is not stored as the answer; the run
  // keeps waiting for the text. A wait that saves nothing takes the media as
  // the reply (it may have asked for exactly that).
  if (awaiting?.saveAs && isMediaPlaceholder(reply)) {
    const trace = Array.isArray(run.trace) ? [...run.trace] : [];
    trace.push({
      step: Math.max(0, (run.cursor ?? 1) - 1),
      subtype: 'reply',
      detail: `Customer sent ${String(reply).trim()} instead of a text answer — still waiting for {{${awaiting.saveAs}}}`,
      result: 'waiting',
      at: new Date().toISOString(),
    });
    await prisma.workflowRun.updateMany({
      where: { id: run.id, version: run.version ?? 0, status: 'WAITING' },
      data: { trace, version: { increment: 1 } },
    }).catch((err) => console.warn(`[Workflow] Could not note the media reply on run ${run.id}:`, err.message));
    return prisma.workflowRun.findUnique({ where: { id: run.id } });
  }

  return advanceRun(run.id, { reply: String(reply ?? '') });
}

// Ends a run that will not continue (reply timeout, superseded by a newer
// wait). It did not finish its steps, so it is CANCELLED with the reason, not
// COMPLETED. Conditional on the version read, so a pass that claimed the run
// in the meantime is not overwritten.
async function closeRun(run, reason) {
  const trace = Array.isArray(run.trace) ? [...run.trace] : [];
  trace.push({ step: run.cursor, subtype: 'cancelled', detail: reason, result: 'cancelled', at: new Date().toISOString() });
  const variables = variablesOf(run);
  delete variables[AWAIT_KEY];
  try {
    const res = await prisma.workflowRun.updateMany({
      where: { id: run.id, version: run.version ?? 0, status: { in: ACTIVE_STATUSES } },
      data: { status: 'CANCELLED', error: reason, trace, variables, finishedAt: new Date(), resumeAt: null, version: { increment: 1 } },
    });
    if (res.count > 0) emitRun(run, 'CANCELLED');
    return res.count > 0;
  } catch (err) {
    console.error(`[WorkflowEngine] Could not close run ${run.id}:`, err.message);
    return false;
  }
}

// Marks runs CANCELLED. Unconditional on the version — a cancel must win — but
// it bumps the version, so a pass that is mid-flight fails its next write and
// stops instead of resurrecting the run.
async function cancelRuns(runs, reason) {
  let cancelled = 0;
  await Promise.all(runs.map(async (run) => {
    const trace = Array.isArray(run.trace) ? [...run.trace] : [];
    trace.push({ step: run.cursor, subtype: 'cancelled', detail: reason, result: 'cancelled', at: new Date().toISOString() });
    try {
      const res = await prisma.workflowRun.updateMany({
        where: { id: run.id, status: { in: ACTIVE_STATUSES } },
        data: { status: 'CANCELLED', trace, finishedAt: new Date(), resumeAt: null, version: { increment: 1 } },
      });
      cancelled += res.count;
      if (res.count > 0) emitRun(run, 'CANCELLED');
    } catch (err) {
      console.error(`[WorkflowEngine] Could not cancel run ${run.id}:`, err.message);
    }
  }));
  return cancelled;
}

// Stops every in-flight run on a conversation.
//
// A customer who types "cancel" or "bye" mid-flow must actually leave it
// (QA BUG-02). Runs parked on a delay would otherwise wake up later and carry
// on messaging someone who has already said they are done.
export async function cancelActiveRuns(workspaceId, conversationId, reason = 'Cancelled by the customer') {
  if (!conversationId) return 0;

  const runs = await prisma.workflowRun.findMany({
    where: { workspaceId, conversationId, status: { in: ACTIVE_STATUSES } },
  });
  if (runs.length === 0) return 0;

  await cancelRuns(runs, reason);
  console.log(`[WorkflowEngine] Cancelled ${runs.length} run(s) on conversation ${conversationId} — ${reason}`);
  return runs.length;
}

// Stops every in-flight run of one workflow. Called when the workflow is
// deactivated: switching it off must also stop the runs already parked on a
// delay or a question, not just prevent new ones.
export async function cancelRunsForWorkflow(workspaceId, workflowId, reason = 'The workflow was deactivated') {
  const runs = await prisma.workflowRun.findMany({
    where: { workspaceId, workflowId, status: { in: ACTIVE_STATUSES } },
  });
  if (runs.length === 0) return 0;
  const cancelled = await cancelRuns(runs, reason);
  console.log(`[WorkflowEngine] Cancelled ${cancelled} run(s) of workflow ${workflowId} — ${reason}`);
  return cancelled;
}

// Recovery sweep, run every minute by the workflow worker. Every parked or
// executing run records in `resumeAt` when the engine must next look at it;
// this finds the overdue ones and puts them back on the queue, so a delay,
// reminder or crashed pass is delayed by a Redis restart rather than lost.
//
// - a run waiting on a delay, or RUNNING with an expired lease, is resumed;
// - a run waiting for a reply gets its reminder if one is still owed, and is
//   closed once the 24-hour reply timeout has passed (the overall run TTL);
// - a run with no resumeAt at all — parked before the column existed, or
//   created and never claimed by a pass that died at once — is treated as due.
//   Migration 20261003160000 backfills the column; this keeps the sweep from
//   ignoring any row that still slips through.
//
// The queue helpers are injected so the sweep is testable without Redis.
export async function sweepDueRuns({ now = new Date(), limit = 100, enqueueResume, enqueueReminder } = {}) {
  if (!enqueueResume || !enqueueReminder) {
    const queue = await import('../queues/workflow.queue.js');
    enqueueResume ??= queue.enqueueWorkflowResume;
    enqueueReminder ??= queue.enqueueReplyReminder;
  }

  const due = await prisma.workflowRun.findMany({
    where: {
      OR: [
        { status: { in: ACTIVE_STATUSES }, resumeAt: { lte: now } },
        { status: 'WAITING', resumeAt: null },
        { status: 'RUNNING', resumeAt: null, startedAt: { lte: new Date(now.getTime() - RUN_LEASE_MS) } },
      ],
    },
    orderBy: { resumeAt: 'asc' },
    take: limit,
  });

  const summary = { resumed: 0, reminded: 0, expired: 0 };
  for (const run of due) {
    // A parked run has resumeAt pushed out first (conditional on nothing having
    // changed), so one whose resume keeps failing is retried every few minutes
    // and two overlapping sweeps do not both enqueue it. A RUNNING run is left
    // as is: its expired lease is exactly what lets the resume claim it.
    if (run.status === 'WAITING') {
      const bumped = await prisma.workflowRun.updateMany({
        where: { id: run.id, version: run.version ?? 0, status: 'WAITING', resumeAt: run.resumeAt ?? null },
        data: { resumeAt: new Date(now.getTime() + SWEEP_BACKOFF_MS) },
      });
      if (bumped.count === 0) continue;
    }

    try {
      if (run.status === 'WAITING' && isAwaitingReply(run)) {
        const awaiting = variablesOf(run)[AWAIT_KEY];
        const since = Date.parse(awaiting?.since);
        if (!Number.isFinite(since) || now.getTime() - since > REPLY_TIMEOUT_MS) {
          // closeRun is conditional on the version; the bump above did not
          // change it.
          if (await closeRun(run, 'No reply within 24 hours')) summary.expired += 1;
          continue;
        }
        const node = actionsOf(run.nodes)[run.cursor - 1];
        const owesReminder = node?.subtype === 'wait_reply' && node.reminder
          && parseDelayMs(node.remindAfter) > 0 && !awaiting.reminded;
        if (owesReminder) {
          await enqueueReminder(run.id, run.cursor, 0);
          summary.reminded += 1;
        } else {
          // Nothing to do until the reply timeout.
          await prisma.workflowRun.updateMany({
            where: { id: run.id, version: run.version ?? 0, status: 'WAITING' },
            data: { resumeAt: new Date(since + REPLY_TIMEOUT_MS) },
          });
        }
        continue;
      }

      await enqueueResume(run.id, run.cursor, 0);
      summary.resumed += 1;
    } catch (err) {
      console.error(`[WorkflowEngine] Sweep could not requeue run ${run.id}:`, err.message);
    }
  }

  if (due.length) {
    console.log(`[WorkflowEngine] Sweep: ${due.length} overdue run(s) — ${summary.resumed} resumed, ${summary.reminded} reminder(s), ${summary.expired} expired`);
  }
  return { due: due.length, ...summary };
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

const runPage = ({ limit, offset } = {}) => ({
  take: Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 100),
  skip: Math.max(Number.parseInt(offset, 10) || 0, 0),
});

// One page of run history, newest first. `limit` defaults to 20 (max 100).
export async function listRuns(workspaceId, { workflowId, limit = 20, offset = 0 } = {}) {
  const { take, skip } = runPage({ limit, offset });
  return prisma.workflowRun.findMany({
    where: { workspaceId, ...(workflowId ? { workflowId } : {}) },
    orderBy: { startedAt: 'desc' },
    take,
    ...(skip ? { skip } : {}),
  });
}

// How many runs listRuns can page through (the X-Total-Count header).
export async function countRuns(workspaceId, { workflowId } = {}) {
  return prisma.workflowRun.count({ where: { workspaceId, ...(workflowId ? { workflowId } : {}) } });
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

// For the CRM side: true for a trigger that a CRM change fires.
export const isCrmTrigger = (trigger) => CRM_TRIGGER_SUBTYPES.has(trigger?.subtype);
