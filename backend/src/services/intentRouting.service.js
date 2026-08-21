import { prisma } from '../lib/prisma.js';
import { matchIntent as scoreIntent, recordMatch } from './intent.service.js';
import { sendAutomatedReply } from './outbound.service.js';
import { notifyWorkspace } from './notification.service.js';

// Running intent rules against a real inbound message.
//
// intent.service.js has always been able to score a message against a
// workspace's rules — the Intent Matching screen creates them, lists them,
// tests them and charts their accuracy. Nothing ever called it from the inbound
// path: the only importer was its own controller. So intents could be created
// and tuned, and routed absolutely nothing.
//
// This sits between the exact keyword triggers and the AI agent, which is where
// the screen has always said it sits.

// Below this, a match is a guess. The workspace's own threshold is used when
// set; this is the floor for a rule with nothing configured.
const DEFAULT_THRESHOLD = 0.6;

/**
 * @returns {Promise<null | { handled: boolean, replyText?: string, rule, confidence }>}
 *   null when no rule matched above the threshold — the caller carries on to
 *   its own fallbacks. `handled: true` means this layer has fully dealt with
 *   the message and nothing else should reply.
 */
export async function routeByIntent({ workspaceId, conversationId, contact, waNumber, messageBody }) {
  const rules = await prisma.intentRule.findMany({ where: { workspaceId, isActive: true } });
  if (rules.length === 0) return null;

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { intentMatchThreshold: true },
  });
  const threshold = workspace?.intentMatchThreshold ?? DEFAULT_THRESHOLD;

  const best = scoreIntent(messageBody, rules);
  if (!best || best.confidence < threshold) {
    // Recorded either way: "what did my rules miss?" is the question the
    // accuracy chart exists to answer, and it cannot answer it from hits alone.
    if (best) {
      recordMatch(workspaceId, {
        intentRuleId: best.rule.id, outcome: 'below_threshold',
        confidence: best.confidence, sample: messageBody,
      }).catch(() => {});
    }
    return null;
  }

  const { rule, confidence } = best;
  recordMatch(workspaceId, {
    intentRuleId: rule.id, outcome: 'matched', confidence, sample: messageBody,
  }).catch(() => {});

  switch (rule.actionType) {
    // Hand the thread to a person and stop automating it.
    case 'human':
      await escalateToHuman({
        workspaceId, conversationId, contact,
        reason: `Matched the "${rule.name}" intent`,
        team: rule.actionTarget || null,
      });
      return { handled: true, rule, confidence };

    // Reply with the rule's own text.
    case 'trigger': {
      const trigger = rule.actionTarget
        ? await prisma.automationTrigger.findFirst({
            where: { id: rule.actionTarget, workspaceId, isActive: true },
          })
        : null;
      // A rule pointing at a trigger that has since been deleted or switched
      // off must not silently answer with nothing — fall through to the AI
      // agent instead, which is the better of the two available outcomes.
      if (!trigger?.responseTemplate) return null;
      return { handled: false, replyText: trigger.responseTemplate, rule, confidence };
    }

    case 'workflow': {
      if (!rule.actionTarget) return null;
      const { startRunForWorkflowId } = await import('./workflowEngine.service.js');
      const started = await startRunForWorkflowId(workspaceId, rule.actionTarget, {
        conversationId, contactId: contact.id, triggerMessage: messageBody,
      }).catch((err) => {
        console.error(`[Intent] Workflow ${rule.actionTarget} failed to start:`, err.message);
        return null;
      });
      // The workflow owns the reply from here if it started; otherwise carry on.
      return started ? { handled: true, rule, confidence } : null;
    }

    // 'ai' — let the agent answer, but say what it is answering about. The
    // rule's actionTarget is guidance for the model, not a canned reply.
    case 'ai':
    default:
      return {
        handled: false,
        rule,
        confidence,
        intentHint: rule.actionTarget || rule.name,
      };
  }
}

// ─── Human handoff ───────────────────────────────────────────────────────────
//
// `escalationRules` and `escalationThreshold` have been stored on Workspace,
// edited on the AI Agent screen and scored in its readiness meter for a long
// time, and nothing ever read them at runtime: the agent answered every message
// itself and there was no path from automation to a person at all.

export async function escalateToHuman({ workspaceId, conversationId, contact, reason, team = null }) {
  // OPEN and unassigned is what the inbox filters treat as "needs a human".
  // Clearing any assignee is deliberate: a thread the AI was handling may have
  // been auto-assigned, and escalation means it is up for grabs again.
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'OPEN', assignedToUserId: null, ...(team ? { label: String(team).slice(0, 60) } : {}) },
  }).catch((err) => console.error('[Escalation] Could not flag the conversation:', err.message));

  await notifyWorkspace(workspaceId, {
    type: 'HANDOFF_REQUESTED',
    title: `${contact?.name || contact?.phoneNumber || 'A customer'} needs a person`,
    body: reason,
    link: 'inbox',
    meta: { conversationId, contactId: contact?.id, team },
  }).catch(() => {});

  console.log(`[Escalation] Conversation ${conversationId} handed to a human — ${reason}`);
}

// Does this message meet the workspace's own conditions for handing over?
//
// Deliberately lexical, like intent matching: an operator ticking "customer asks
// for a human" needs to be able to predict what that does. The AI agent's own
// uncertainty is handled separately, by escalationThreshold.
const ESCALATION_PATTERNS = {
  asksForHuman: /\b(human|agent|representative|real person|speak to (someone|a person)|talk to (someone|a person)|customer (care|service|support)|operator)\b/i,
  refund: /\b(refund|money back|return it|cancel my order|chargeback|complaint|complain)\b/i,
  negativeSentiment: /\b(terrible|awful|worst|useless|rubbish|angry|furious|disgusted|unacceptable|never again|scam|cheated|fraud)\b/i,
  highIntent: /\b(buy now|place (an )?order|purchase|checkout|payment link|invoice me|how do i pay)\b/i,
};

export function escalationReason(messageBody, escalationRules) {
  const rules = escalationRules && typeof escalationRules === 'object' ? escalationRules : {};
  const labels = {
    asksForHuman: 'The customer asked to speak to a person',
    refund: 'The customer raised a refund or complaint',
    negativeSentiment: 'The message reads as strongly negative',
    highIntent: 'The customer is ready to buy',
  };
  for (const [id, pattern] of Object.entries(ESCALATION_PATTERNS)) {
    if (rules[id] === true && pattern.test(messageBody)) return labels[id];
  }
  return null;
}
