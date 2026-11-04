import { prisma } from '../lib/prisma.js';
import { stageProbabilities, CLOSED_STAGES } from './pipelineStages.service.js';
import { scopeFilter } from './recordScope.service.js';

// A bare YYYY-MM-DD as the period end means the whole of that day; read as
// midnight it silently dropped every deal expected to close on the last day.
function periodEndFrom(value) {
  const d = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value).trim()) && !Number.isNaN(d.getTime())) {
    d.setUTCHours(23, 59, 59, 999);
  }
  return d;
}

const toNumber = (v) => Number(v || 0);

// Forecast categories, derived from stage probability rather than stored on the
// deal. A separate editable "forecast category" field would immediately drift
// from the stage it is supposed to reflect.
//
//   commit    — high confidence (>= 75%)
//   bestCase  — plausible this period (40–74%)
//   pipeline  — everything else still open
//   closed    — already won
function categorise(probability) {
  if (probability >= 75) return 'commit';
  if (probability >= 40) return 'bestCase';
  return 'pipeline';
}

function emptyBucket() {
  return {
    commit: { count: 0, value: 0, weighted: 0 },
    bestCase: { count: 0, value: 0, weighted: 0 },
    pipeline: { count: 0, value: 0, weighted: 0 },
    closedWon: { count: 0, value: 0 },
    closedLost: { count: 0, value: 0 },
  };
}

/**
 * Weighted pipeline forecast for a period.
 *
 * Deliberately reports only what the data supports: every figure is a sum over
 * real deals with a stated probability. Nothing is extrapolated, and a deal
 * with no amount contributes nothing rather than an imputed average — §40
 * forbids inventing predictions where there is insufficient information.
 */
export async function getForecast(workspaceId, { from, to, ownerUserId } = {}, user = null) {
  const now = new Date();
  const periodStart = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = to ? periodEndFrom(to) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    const e = new Error('Invalid period'); e.status = 400; throw e;
  }
  if (periodStart > periodEnd) {
    const e = new Error('Period start must be before period end'); e.status = 400; throw e;
  }

  const probabilities = await stageProbabilities(workspaceId);

  // Same record visibility as the deal list: a forecast is a sum over deals,
  // and per-owner totals would otherwise expose colleagues' pipelines.
  const visibility = user ? await scopeFilter(workspaceId, user) : {};
  const scope = { workspaceId, ...visibility, ...(ownerUserId ? { ownerUserId } : {}) };

  const [open, closed] = await Promise.all([
    // Open deals expected to close in the period. A deal with no expected
    // close date cannot be forecast into a period and is reported separately
    // rather than being silently dropped or silently included.
    prisma.deal.findMany({
      where: { ...scope, stage: { notIn: CLOSED_STAGES }, expectedCloseDate: { gte: periodStart, lte: periodEnd } },
      select: { id: true, stage: true, customFields: true, value: true, ownerUserId: true, owner: { select: { id: true, name: true, email: true } } },
    }),
    prisma.deal.findMany({
      where: { ...scope, stage: { in: CLOSED_STAGES }, closedAt: { gte: periodStart, lte: periodEnd } },
      select: { id: true, stage: true, value: true, ownerUserId: true, owner: { select: { id: true, name: true, email: true } } },
    }),
  ]);

  const undated = await prisma.deal.count({
    where: { ...scope, stage: { notIn: CLOSED_STAGES }, expectedCloseDate: null },
  });

  const totals = emptyBucket();
  const byOwnerMap = new Map();

  const ownerBucket = (deal) => {
    const id = deal.ownerUserId ?? 'unassigned';
    if (!byOwnerMap.has(id)) {
      byOwnerMap.set(id, {
        ownerUserId: deal.ownerUserId ?? null,
        ownerName: deal.owner?.name || deal.owner?.email || 'Unassigned',
        ...emptyBucket(),
      });
    }
    return byOwnerMap.get(id);
  };

  for (const deal of open) {
    const value = toNumber(deal.value);
    // A deal on a custom pipeline stage stores QUALIFICATION in the enum and
    // its real stage in customFields.stageKey; weighting it by the enum gave
    // every custom-stage deal Qualification's probability.
    const effectiveStage = deal.customFields?.stageKey || deal.stage;
    const probability = probabilities.get(effectiveStage) ?? probabilities.get(deal.stage) ?? 0;
    const weighted = (value * probability) / 100;
    const bucket = categorise(probability);

    for (const target of [totals, ownerBucket(deal)]) {
      target[bucket].count += 1;
      target[bucket].value += value;
      target[bucket].weighted += weighted;
    }
  }

  for (const deal of closed) {
    const value = toNumber(deal.value);
    const key = deal.stage === 'CLOSED_WON' ? 'closedWon' : 'closedLost';
    for (const target of [totals, ownerBucket(deal)]) {
      target[key].count += 1;
      target[key].value += value;
    }
  }

  const round = (n) => Math.round(n * 100) / 100;
  const finalise = (b) => ({
    ...b,
    commit: { ...b.commit, weighted: round(b.commit.weighted) },
    bestCase: { ...b.bestCase, weighted: round(b.bestCase.weighted) },
    pipeline: { ...b.pipeline, weighted: round(b.pipeline.weighted) },
    // What the period is expected to land at: money already won, plus the
    // probability-weighted value of what is still open.
    projected: round(b.closedWon.value + b.commit.weighted + b.bestCase.weighted + b.pipeline.weighted),
  });

  const byOwner = [...byOwnerMap.values()]
    .map(finalise)
    .sort((a, b) => b.projected - a.projected);

  return {
    period: { from: periodStart, to: periodEnd },
    totals: finalise(totals),
    byOwner,
    // Surfaced so the number can be trusted: these deals are real but cannot
    // be placed in any period.
    excluded: { noCloseDate: undated },
    stageProbabilities: Object.fromEntries(probabilities),
  };
}
