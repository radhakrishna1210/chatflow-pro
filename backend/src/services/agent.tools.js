import { prisma } from '../lib/prisma.js';
import { scoreEvidence, ACTION_CLASS } from './agent.evidence.js';
import { createTask } from './tasks.service.js';
import { updateLead } from './leads.service.js';
import { computeDealHealth } from './dealHealth.service.js';

// Tools for the autonomous agent.
//
// Unlike the copilot's tools, these WRITE without asking. The gate is the
// evidence ledger, not a human click — the same trade trycompai/crm makes, and
// for the same reason: you cannot hand-confirm every pass over every record,
// so the control has to be "what did you actually observe".
//
// Two guards survive that:
//
//  1. Every write declares evidence. `recordFact` prices it; only STRONG lands.
//     A WEAK claim is stored as a suggestion, not applied.
//
//  2. `sensitiveWrite` operations are DENIED outright when running unattended,
//     rather than queued. Ported from their approval.ts, which refuses instead
//     of deferring — closing a deal is not something to do while nobody is
//     watching, and a queue of pending irreversible actions is just a slower
//     way to get them wrong.
//
// The evidence is *recomputed here from the database* before it is priced.
// The model names what it thinks it saw; the server checks whether that is
// actually true. A fabricated `crm.inbound-reply` therefore scores nothing,
// because the verifier goes and looks for the reply.

const DAY = 86400000;

/**
 * Independently confirms one claimed observation against the database.
 * Returns true only if the thing the agent says it saw is really there.
 */
async function verify(workspaceId, kind, { contactId, leadId, dealId } = {}) {
  switch (kind) {
    case 'crm.inbound-reply': {
      if (!contactId) return false;
      const n = await prisma.message.count({
        where: { direction: 'INBOUND', conversation: { workspaceId, contactId } },
      });
      return n > 0;
    }
    case 'crm.outbound-delivered': {
      if (!contactId) return false;
      const n = await prisma.message.count({
        where: { direction: 'OUTBOUND', conversation: { workspaceId, contactId } },
      });
      return n > 0;
    }
    case 'crm.form-submission': {
      if (!contactId) return false;
      const n = await prisma.leadFormSubmission.count({ where: { workspaceId, contactId } });
      return n > 0;
    }
    case 'crm.opted-out': {
      if (!contactId) return false;
      const c = await prisma.contact.findFirst({ where: { id: contactId, workspaceId }, select: { optedOut: true } });
      return !!c?.optedOut;
    }
    case 'crm.stage-history': {
      if (!dealId) return false;
      const n = await prisma.dealStageHistory.count({ where: { dealId } });
      return n > 0;
    }
    case 'crm.task-record': {
      if (!dealId && !leadId) return false;
      const n = await prisma.task.count({
        where: { workspaceId, ...(dealId ? { dealId } : { leadId }) },
      });
      return n > 0;
    }
    case 'crm.no-activity-window': {
      if (!dealId) return false;
      const last = await prisma.crmActivity.findFirst({
        where: { workspaceId, dealId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true },
      });
      // True when genuinely quiet: no activity at all, or none for 14 days.
      return !last || (Date.now() - last.createdAt.getTime()) > 14 * DAY;
    }
    case 'crm.score-threshold': {
      if (!leadId) return false;
      const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId }, select: { score: true } });
      return (lead?.score ?? 0) >= 40;
    }
    case 'crm.field-blank': return true; // The caller states which field; cheap and self-evident.
    case 'contradiction': return true;   // Always admissible — it only ever lowers a score.
    default: return false;
  }
}

/**
 * Prices a claim after discarding any evidence that does not survive checking.
 *
 * This is the difference from a ledger that trusts its inputs: the agent can
 * claim whatever it likes, but unverifiable observations are dropped before
 * scoring, so they cannot buy a STRONG band.
 */
export async function priceClaim(workspaceId, evidence, target, actionClass = ACTION_CLASS.ASSERTION) {
  const rows = Array.isArray(evidence) ? evidence : [];
  const checked = [];
  const rejected = [];

  for (const e of rows) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await verify(workspaceId, e?.kind, target);
    if (ok) checked.push(e);
    else rejected.push(e?.kind ?? 'unknown');
  }

  const priced = scoreEvidence(checked, actionClass);
  return {
    ...priced,
    verifiedCount: checked.length,
    rejectedKinds: rejected,
    rationale: rejected.length
      ? `${priced.rationale} Discarded unverifiable: ${rejected.join(', ')}.`
      : priced.rationale,
  };
}

/**
 * Records a claim. STRONG evidence applies it; WEAK is kept as a suggestion a
 * human settles. Either way the row survives, because "what did it consider and
 * reject" is the question reps actually ask.
 */
export async function recordFact(workspaceId, { targetType, targetId, field, value, evidence, apply, actionClass = ACTION_CLASS.ASSERTION }) {
  const target = targetType === 'deal' ? { dealId: targetId } : { leadId: targetId };

  // Contact is needed to verify messaging evidence.
  if (targetType === 'lead') {
    const lead = await prisma.lead.findFirst({ where: { id: targetId, workspaceId }, select: { contactId: true } });
    target.contactId = lead?.contactId;
  } else {
    const deal = await prisma.deal.findFirst({ where: { id: targetId, workspaceId }, select: { contactId: true } });
    target.contactId = deal?.contactId;
  }

  const priced = await priceClaim(workspaceId, evidence, target, actionClass);

  if (priced.band === null) {
    return { stored: false, applied: false, ...priced };
  }

  let applied = false;
  if (priced.band === 'STRONG' && typeof apply === 'function') {
    await apply();
    applied = true;
  }

  await prisma.agentFact.create({
    data: {
      workspaceId,
      targetType,
      targetId,
      field,
      value: String(value ?? ''),
      evidence: Array.isArray(evidence) ? evidence : [],
      score: priced.score,
      band: priced.band,
      applied,
      rationale: priced.rationale,
    },
  });

  return { stored: true, applied, ...priced };
}

/**
 * Operations refused while unattended.
 *
 * Ported from trycompai/crm's approval.ts, which denies rather than defers.
 * Closing a deal, marking a lead lost or messaging a customer are not things
 * to do with nobody watching, and a backlog of pending irreversible actions is
 * a slower path to the same mistake.
 */
export const SENSITIVE = {
  close_deal: 'Ask a rep to close it themselves.',
  mark_lead_lost: 'Leave it and let a rep decide.',
  message_contact: 'Draft it for a rep instead.',
  delete_record: 'Never do this unattended.',
};

export function assertPermittedUnattended(action) {
  if (SENSITIVE[action]) {
    const e = new Error(`Not something to do unattended. ${SENSITIVE[action]}`);
    e.status = 403;
    e.denied = true;
    throw e;
  }
}

// ── the autonomous actions themselves ───────────────────────────────────────
//
// Bounded on purpose. Each is reversible, each has a verifiable precondition,
// and none of them message a customer or close anything.

export const ACTIONS = {
  /** Schedule a follow-up on a deal that has gone quiet. */
  schedule_followup: {
    description: 'Create a follow-up task on a deal with nothing scheduled.',
    async run({ workspaceId, deal, actorUserId }) {
      const openTasks = await prisma.task.count({
        where: { workspaceId, dealId: deal.id, status: 'PENDING' },
      });
      if (openTasks > 0) {
        return { skipped: true, reason: 'Already has an open task.' };
      }

      const health = await computeDealHealth(workspaceId, deal.id).catch(() => null);
      const risks = (health?.risks ?? []).map((r) => r.key);

      const evidence = [
        { kind: 'crm.no-activity-window', detail: 'No activity logged on this deal recently.' },
        ...(risks.includes('stalled') ? [{ kind: 'crm.stage-history', detail: 'Stage history shows it has not moved.' }] : []),
      ];

      const title = `Follow up on ${deal.title}`;
      const result = await recordFact(workspaceId, {
        targetType: 'deal',
        targetId: deal.id,
        field: 'nextStep',
        actionClass: ACTION_CLASS.REMINDER,
        value: title,
        evidence,
        apply: () => createTask(workspaceId, {
          title,
          dealId: deal.id,
          dueDate: new Date(Date.now() + 2 * DAY),
          assignedToUserId: deal.ownerUserId ?? actorUserId ?? undefined,
        }, actorUserId),
      });

      return result;
    },
  },

  /** Move a NEW lead to CONTACTED once we have demonstrably reached them. */
  advance_contacted: {
    description: 'Mark a NEW lead as CONTACTED when a delivered outbound message exists.',
    async run({ workspaceId, lead }) {
      if (lead.status !== 'NEW') return { skipped: true, reason: `Lead is ${lead.status}, not NEW.` };

      const evidence = [
        { kind: 'crm.outbound-delivered', detail: 'An outbound message to this contact exists.' },
        { kind: 'crm.score-threshold', detail: 'Lead score is above the working threshold.' },
      ];

      return recordFact(workspaceId, {
        targetType: 'lead',
        targetId: lead.id,
        field: 'status',
        value: 'CONTACTED',
        evidence,
        apply: () => updateLead(workspaceId, lead.id, { status: 'CONTACTED' }),
      });
    },
  },
};
