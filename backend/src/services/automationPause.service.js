import { prisma } from '../lib/prisma.js';
import { realtime } from '../lib/realtimeBus.js';

// Human handoff: when automation stays out of a conversation, why, and until
// when (WF-IN-1).
//
// `Conversation.humanHandoffAt` stops every automation on a thread — forms,
// workflows, keyword triggers, the welcome message and the AI agent. It was
// set by many things (an inbox reply, a workflow's "assign to agent" step, a
// customer typing "agent", an escalation rule, the AI agent having nothing to
// say) and cleared only by resolving the thread or the inbox bot switch, so a
// contact who once tripped any of them was silently out of every workflow for
// good. Now:
//
//   * a handoff lapses once no person has written in the thread for
//     HANDOFF_TTL_HOURS (default 24), counted from the later of the handoff
//     and the last message a person sent;
//   * a CLOSED (or RESOLVED) thread that the customer writes to again starts
//     afresh, automation included;
//   * the reason is recorded (Conversation.handoffReason) and shown in the
//     inbox, so "why is the bot not answering?" has an answer.

export const HANDOFF_REASONS = Object.freeze({
  MANUAL_REPLY: 'manual_reply',
  WORKFLOW_AGENT_STEP: 'workflow_agent_step',
  CUSTOMER_ASKED_HUMAN: 'customer_asked_human',
  ESCALATION_RULE: 'escalation_rule', // stored as escalation_rule:<rule id>
  INTENT_RULE: 'intent_rule', // stored as intent_rule:<rule name>
  AI_NO_REPLY: 'ai_no_reply',
  BOT_SWITCHED_OFF: 'bot_switched_off',
});

const DEFAULT_TTL_HOURS = 24;

export function handoffTtlMs(env = process.env) {
  const hours = Number(env.HANDOFF_TTL_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TTL_HOURS) * 3_600_000;
}

const RULE_LABELS = {
  refund: 'refund or complaint',
  negativeSentiment: 'negative sentiment',
  asksForHuman: 'customer asked for a human',
  highIntent: 'high purchase intent',
};

/** A sentence for the inbox banner. */
export function describeHandoffReason(reason) {
  const value = String(reason || '');
  const [code, detail] = [value.split(':')[0], value.slice(value.indexOf(':') + 1)];
  switch (code) {
    case HANDOFF_REASONS.MANUAL_REPLY: return 'a team member replied';
    case HANDOFF_REASONS.WORKFLOW_AGENT_STEP: return 'a workflow assigned it to an agent';
    case HANDOFF_REASONS.CUSTOMER_ASKED_HUMAN: return 'the customer asked for a person';
    case HANDOFF_REASONS.ESCALATION_RULE: return `AI agent escalation rule (${RULE_LABELS[detail] || detail})`;
    case HANDOFF_REASONS.INTENT_RULE: return `intent rule "${detail}" hands to a person`;
    case HANDOFF_REASONS.AI_NO_REPLY: return 'the AI agent could not answer';
    case HANDOFF_REASONS.BOT_SWITCHED_OFF: return 'the bot was switched off in the inbox';
    default: return 'a person took over this chat';
  }
}

// The reason in force. The columns are written by several services, and the
// ones outside this package (an inbox reply, the bot switch, a workflow's
// agent step) set only the timestamp, so the reason is inferred where it was
// not recorded — and a person's reply after the handoff always explains it.
function effectiveReason(conversation, lastHumanAt) {
  const at = conversation.humanHandoffAt ? new Date(conversation.humanHandoffAt).getTime() : null;
  if (at != null && lastHumanAt && new Date(lastHumanAt).getTime() >= at - 5_000) return HANDOFF_REASONS.MANUAL_REPLY;
  if (conversation.handoffReason) return conversation.handoffReason;
  return conversation.assignedToUserId ? HANDOFF_REASONS.WORKFLOW_AGENT_STEP : HANDOFF_REASONS.BOT_SWITCHED_OFF;
}

async function lastHumanMessageAt(conversationId, client = prisma) {
  const row = await client.message.findFirst({
    where: { conversationId, direction: 'OUTBOUND', senderUserId: { not: null } },
    orderBy: { sentAt: 'desc' },
    select: { sentAt: true },
  });
  return row?.sentAt ?? null;
}

/**
 * The pause on a conversation as it stands, without changing anything.
 * @returns {{ paused: boolean, reason: string|null, reasonText: string|null,
 *   pausedAt: Date|null, resumesAt: Date|null }}
 */
export function handoffState(conversation, { lastHumanAt = null, now = Date.now(), ttlMs = handoffTtlMs() } = {}) {
  if (!conversation?.humanHandoffAt) {
    return { paused: false, reason: null, reasonText: null, pausedAt: null, resumesAt: null };
  }
  const pausedAt = new Date(conversation.humanHandoffAt);
  const anchor = Math.max(pausedAt.getTime(), lastHumanAt ? new Date(lastHumanAt).getTime() : 0);
  const resumesAt = new Date(anchor + ttlMs);
  const reason = effectiveReason(conversation, lastHumanAt);
  return {
    paused: resumesAt.getTime() > now,
    reason,
    reasonText: describeHandoffReason(reason),
    pausedAt,
    resumesAt,
  };
}

/**
 * Called by the inbound pipelines before anything else looks at the handoff.
 * Lifts a handoff that has lapsed, or that belongs to a thread the customer has
 * reopened after it was closed, and says whether automation must stay out.
 *
 * @param {object} conversation  the row as read before this message reopened it
 * @param {object} [opts]
 * @param {string} [opts.previousStatus]  the status before this inbound message
 * @returns {Promise<{ paused: boolean, reason?: string, reasonText?: string, resumesAt?: Date, cleared?: string }>}
 */
export async function resolveHandoff(conversation, { previousStatus = null, workspaceId = conversation?.workspaceId, now = Date.now() } = {}) {
  if (!conversation?.humanHandoffAt) {
    // A reason left behind by a handoff something else lifted (RESOLVED, the
    // bot switch) must not explain the next, unrelated one.
    if (conversation?.handoffReason) {
      await prisma.conversation.update({ where: { id: conversation.id }, data: { handoffReason: null } })
        .catch((err) => console.warn(`[Handoff] Could not clear a stale reason on ${conversation.id}:`, err.message));
      conversation.handoffReason = null;
    }
    return { paused: false };
  }

  const closedBefore = previousStatus === 'CLOSED' || previousStatus === 'RESOLVED';
  const lastHumanAt = await lastHumanMessageAt(conversation.id).catch((err) => {
    console.warn(`[Handoff] Could not read the last human reply on ${conversation.id}:`, err.message);
    return null;
  });
  const state = handoffState(conversation, { lastHumanAt, now });

  if (state.paused && !closedBefore) {
    return { paused: true, reason: state.reason, reasonText: state.reasonText, resumesAt: state.resumesAt };
  }

  const cleared = closedBefore ? `the conversation was ${previousStatus.toLowerCase()}` : 'no one has replied since';
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { humanHandoffAt: null, handoffReason: null },
  });
  conversation.humanHandoffAt = null;
  conversation.handoffReason = null;
  if (workspaceId) realtime.conversationUpdated(workspaceId, conversation.id, 'bot');
  console.log(`[Handoff] Automation resumed on ${conversation.id} — handoff (${state.reason}) lifted because ${cleared}.`);
  return { paused: false, cleared };
}

/** For the inbox banner: GET /conversations/:id/automation. */
export async function getAutomationPause(workspaceId, conversationId) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    select: { id: true, humanHandoffAt: true, handoffReason: true, assignedToUserId: true },
  });
  if (!conversation) { const e = new Error('Conversation not found'); e.status = 404; throw e; }
  const lastHumanAt = conversation.humanHandoffAt ? await lastHumanMessageAt(conversation.id) : null;
  const state = handoffState(conversation, { lastHumanAt });
  return {
    // Still flagged but past its expiry: the next inbound message lifts it.
    paused: Boolean(conversation.humanHandoffAt),
    expired: Boolean(conversation.humanHandoffAt) && !state.paused,
    reason: state.reason,
    reasonText: state.reasonText,
    pausedAt: state.pausedAt,
    resumesAt: state.resumesAt,
    ttlHours: handoffTtlMs() / 3_600_000,
  };
}
