import { prisma } from '../lib/prisma.js';
import { computeLeadCategory } from './leadSegmentation.service.js';
import { emitCrmEvent } from './workflowCrm.service.js';

// Background upkeep for CRM values that depend on the passage of time.
//
// Lead score and HOT/WARM/COLD are both built from reply recency and contact
// age, so a stored value goes stale without any write to the lead. Quotes
// carry a validUntil that nothing else acts on.

// Leads whose category was computed longer ago than this are refreshed by the
// nightly sweep. Slightly under a day so a daily run always catches them.
const STALE_AFTER_MS = 20 * 60 * 60 * 1000;
const SWEEP_BATCH = 200;
// Upper bound per run so one huge tenant cannot keep the worker busy all day;
// whatever is left is picked up the next night (oldest first).
const SWEEP_MAX_LEADS = 20_000;

// Recomputes score and category for one lead, emitting the same events the
// manual "Recalculate" path does when the values move.
export async function refreshLeadScoring(workspaceId, leadId) {
  const before = await prisma.lead.findFirst({
    where: { id: leadId, workspaceId },
    select: { id: true, contactId: true, score: true },
  });
  if (!before) return null;
  const updated = await computeLeadCategory(workspaceId, leadId);
  if (updated.score !== before.score) {
    emitCrmEvent(workspaceId, 'lead_score_changed', {
      leadId, contactId: before.contactId, score: updated.score, previousScore: before.score,
    });
  }
  return updated;
}

// Called (debounced) after an inbound message: the contact's lead, if any,
// is rescored so a reply today is reflected today rather than on the next
// manual recalculation.
export async function refreshLeadScoringForContact(workspaceId, contactId) {
  const lead = await prisma.lead.findFirst({ where: { workspaceId, contactId }, select: { id: true } });
  if (!lead) return null;
  return refreshLeadScoring(workspaceId, lead.id);
}

export async function rescoreStaleLeads({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  let processed = 0;
  let failed = 0;
  // A successful refresh stamps categoryComputedAt, which drops the lead out of
  // the query; only failures need excluding explicitly.
  const failedIds = new Set();

  while (processed + failed < SWEEP_MAX_LEADS) {
    const batch = await prisma.lead.findMany({
      where: {
        status: { notIn: ['CONVERTED', 'LOST'] },
        OR: [{ categoryComputedAt: null }, { categoryComputedAt: { lt: cutoff } }],
        ...(failedIds.size ? { id: { notIn: [...failedIds] } } : {}),
      },
      select: { id: true, workspaceId: true },
      orderBy: { categoryComputedAt: { sort: 'asc', nulls: 'first' } },
      take: SWEEP_BATCH,
    });
    if (batch.length === 0) break;

    for (const lead of batch) {
      try {
        await refreshLeadScoring(lead.workspaceId, lead.id);
        processed += 1;
      } catch (err) {
        failed += 1;
        failedIds.add(lead.id);
        console.error(`[CrmMaintenance] Rescore failed for lead ${lead.id}:`, err.message);
      }
    }
  }

  return { processed, failed };
}

// DRAFT and SENT quotes past their validUntil become EXPIRED, which is a legal
// transition from both (see quotes.service.js ALLOWED_TRANSITIONS).
export async function expireOverdueQuotes({ now = new Date() } = {}) {
  const res = await prisma.quote.updateMany({
    where: { status: { in: ['DRAFT', 'SENT'] }, validUntil: { lt: now } },
    data: { status: 'EXPIRED' },
  });
  return { expired: res.count };
}

export async function runNightlyCrmSweep({ now = new Date() } = {}) {
  const quotes = await expireOverdueQuotes({ now });
  const leads = await rescoreStaleLeads({ now });
  return { ...quotes, ...leads };
}
