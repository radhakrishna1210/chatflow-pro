import { prisma } from '../lib/prisma.js';

export const MAX_HEALTH = 100;

const CLOSED_STAGES = ['CLOSED_WON', 'CLOSED_LOST'];

// How long a deal may sit in one stage before it reads as stalled. Later
// stages are meant to move faster — a deal parked in Negotiation is a worse
// sign than one still being qualified.
const STAGE_AGE_BUDGET_DAYS = {
  QUALIFICATION: 21,
  NEEDS_ANALYSIS: 21,
  PROPOSAL: 14,
  NEGOTIATION: 10,
};

const DAY_MS = 86400000;
export const daysBetween = (from, to) => Math.floor((to.getTime() - from.getTime()) / DAY_MS);

// Pure: plain signals in, an explained health verdict out. Mirrors
// leadScoring.scoreLead — no I/O, so the weighting is unit testable, and every
// deduction states why. A risk flag a rep cannot act on is just decoration.
//
// Deliberately NOT a prediction. This reports observable facts about the deal
// record (age, activity, missing fields), never a probability of winning —
// §40 of the spec forbids fabricating forecasts from insufficient data.
export function scoreDealHealth(signals) {
  const {
    stage = 'QUALIFICATION',
    daysInCurrentStage = 0,
    daysSinceLastActivity = null,
    daysUntilExpectedClose = null,
    hasValue = false,
    hasOwner = false,
    hasExpectedCloseDate = false,
    openTaskCount = 0,
  } = signals ?? {};

  // A closed deal has no health to assess — it has an outcome instead.
  if (CLOSED_STAGES.includes(stage)) {
    return {
      score: null,
      band: 'CLOSED',
      maxScore: MAX_HEALTH,
      factors: [{
        key: 'closed',
        label: 'Closed',
        points: 0,
        maxPoints: 0,
        severity: 'info',
        detail: stage === 'CLOSED_WON' ? 'Deal is won.' : 'Deal is lost.',
      }],
      risks: [],
    };
  }

  const factors = [];
  const risks = [];

  // 1. Stage age — up to 30
  const budget = STAGE_AGE_BUDGET_DAYS[stage] ?? 21;
  let stagePts = 30;
  let stageDetail = `${daysInCurrentStage} day${daysInCurrentStage === 1 ? '' : 's'} in this stage (typical: under ${budget})`;
  let stageSeverity = 'ok';
  if (daysInCurrentStage > budget * 2) {
    stagePts = 0;
    stageSeverity = 'critical';
    stageDetail = `Stalled: ${daysInCurrentStage} days in this stage, more than double the ${budget}-day norm`;
    risks.push({ key: 'stalled', severity: 'critical', message: `Stalled in ${stage.replace(/_/g, ' ').toLowerCase()} for ${daysInCurrentStage} days.` });
  } else if (daysInCurrentStage > budget) {
    stagePts = 15;
    stageSeverity = 'warn';
    stageDetail = `Ageing: ${daysInCurrentStage} days in this stage, past the ${budget}-day norm`;
    risks.push({ key: 'ageing', severity: 'warn', message: `Past the ${budget}-day norm for this stage.` });
  }
  factors.push({ key: 'stageAge', label: 'Stage age', points: stagePts, maxPoints: 30, severity: stageSeverity, detail: stageDetail });

  // 2. Recent activity — up to 30
  let activityPts = 0;
  let activityDetail = 'No activity logged yet';
  let activitySeverity = 'critical';
  if (daysSinceLastActivity != null) {
    if (daysSinceLastActivity <= 3) { activityPts = 30; activitySeverity = 'ok'; activityDetail = 'Active within the last 3 days'; }
    else if (daysSinceLastActivity <= 7) { activityPts = 22; activitySeverity = 'ok'; activityDetail = 'Active within the last week'; }
    else if (daysSinceLastActivity <= 14) { activityPts = 12; activitySeverity = 'warn'; activityDetail = `Last activity ${daysSinceLastActivity} days ago`; }
    else { activitySeverity = 'critical'; activityDetail = `No activity for ${daysSinceLastActivity} days`; }
  }
  if (activitySeverity === 'critical') {
    risks.push({
      key: 'noActivity',
      severity: 'critical',
      message: daysSinceLastActivity == null ? 'Nothing has been logged against this deal.' : `No activity recorded for ${daysSinceLastActivity} days.`,
    });
  } else if (activitySeverity === 'warn') {
    risks.push({ key: 'quiet', severity: 'warn', message: `Going quiet — last activity ${daysSinceLastActivity} days ago.` });
  }
  factors.push({ key: 'activity', label: 'Recent activity', points: activityPts, maxPoints: 30, severity: activitySeverity, detail: activityDetail });

  // 3. Close date credibility — up to 20
  let closePts = 0;
  let closeDetail = 'No expected close date set';
  let closeSeverity = 'warn';
  if (!hasExpectedCloseDate) {
    risks.push({ key: 'noCloseDate', severity: 'warn', message: 'No expected close date, so this deal cannot be forecast.' });
  } else if (daysUntilExpectedClose != null) {
    if (daysUntilExpectedClose < 0) {
      closePts = 0;
      closeSeverity = 'critical';
      closeDetail = `Expected close date passed ${Math.abs(daysUntilExpectedClose)} day${Math.abs(daysUntilExpectedClose) === 1 ? '' : 's'} ago`;
      const late = Math.abs(daysUntilExpectedClose);
      risks.push({ key: 'closeDateExpired', severity: 'critical', message: `Close date slipped ${late} day${late === 1 ? '' : 's'} ago and has not been updated.` });
    } else if (daysUntilExpectedClose <= 7) {
      closePts = 20;
      closeSeverity = 'ok';
      closeDetail = `Closing in ${daysUntilExpectedClose} day${daysUntilExpectedClose === 1 ? '' : 's'}`;
    } else {
      closePts = 20;
      closeSeverity = 'ok';
      closeDetail = `Expected to close in ${daysUntilExpectedClose} days`;
    }
  }
  factors.push({ key: 'closeDate', label: 'Close date', points: closePts, maxPoints: 20, severity: closeSeverity, detail: closeDetail });

  // 4. Record completeness — up to 20
  const completenessPts = (hasValue ? 10 : 0) + (hasOwner ? 10 : 0);
  const missing = [];
  if (!hasValue) missing.push('amount');
  if (!hasOwner) missing.push('owner');
  factors.push({
    key: 'completeness',
    label: 'Record completeness',
    points: completenessPts,
    maxPoints: 20,
    severity: completenessPts === 20 ? 'ok' : completenessPts === 10 ? 'warn' : 'critical',
    detail: missing.length ? `Missing ${missing.join(' and ')}` : 'Amount and owner are set',
  });
  if (!hasValue) risks.push({ key: 'noValue', severity: 'warn', message: 'No amount set, so this deal contributes nothing to pipeline value.' });
  if (!hasOwner) risks.push({ key: 'noOwner', severity: 'warn', message: 'Nobody owns this deal.' });

  // Not scored, but worth surfacing: an open deal with nothing planned next.
  if (openTaskCount === 0) {
    risks.push({ key: 'noNextStep', severity: 'warn', message: 'No open task — there is no agreed next step.' });
  }

  const score = factors.reduce((sum, f) => sum + f.points, 0);

  // A deal can score well on paper while carrying something disqualifying —
  // strong on stage age, amount and close date, but nobody has touched it in a
  // month. Calling that "Healthy" is the kind of green light that loses deals,
  // so an unresolved critical risk caps the band regardless of the total.
  const hasCriticalRisk = risks.some((r) => r.severity === 'critical');
  let band = score >= 70 ? 'HEALTHY' : score >= 40 ? 'AT_RISK' : 'CRITICAL';
  if (hasCriticalRisk && band === 'HEALTHY') band = 'AT_RISK';

  const severityRank = { critical: 0, warn: 1, info: 2 };
  risks.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  return { score: Math.min(MAX_HEALTH, score), band, maxScore: MAX_HEALTH, factors, risks };
}

// Gathers the signals for one already-loaded deal. `now` is injected so a
// batch scores every deal against a single clock rather than drifting.
export function buildSignals(deal, { lastActivityAt, openTaskCount = 0, now = new Date() }) {
  const stageEnteredAt = deal.stageHistory?.length
    ? deal.stageHistory[deal.stageHistory.length - 1].changedAt
    : deal.createdAt;

  return {
    stage: deal.stage,
    daysInCurrentStage: daysBetween(stageEnteredAt, now),
    daysSinceLastActivity: lastActivityAt ? daysBetween(lastActivityAt, now) : null,
    // Positive means the date is still ahead; negative means it has slipped.
    daysUntilExpectedClose: deal.expectedCloseDate ? daysBetween(now, deal.expectedCloseDate) : null,
    hasValue: deal.value != null && Number(deal.value) > 0,
    hasOwner: !!deal.ownerUserId,
    hasExpectedCloseDate: !!deal.expectedCloseDate,
    openTaskCount,
  };
}

// Scores every open deal in the workspace in a fixed number of queries,
// regardless of how many deals there are — the board renders health on every
// card, so a per-deal query here would be a page-load N+1.
export async function computeWorkspaceDealHealth(workspaceId, { ownerUserId } = {}) {
  const where = {
    workspaceId,
    stage: { notIn: CLOSED_STAGES },
    ...(ownerUserId ? { ownerUserId } : {}),
  };

  const deals = await prisma.deal.findMany({
    where,
    select: {
      id: true, stage: true, value: true, ownerUserId: true,
      expectedCloseDate: true, createdAt: true,
      stageHistory: { orderBy: { changedAt: 'asc' }, select: { changedAt: true } },
    },
  });
  if (deals.length === 0) return new Map();

  const dealIds = deals.map((d) => d.id);

  const [activityGroups, stageGroups, taskGroups] = await Promise.all([
    prisma.crmActivity.groupBy({
      by: ['dealId'],
      where: { workspaceId, dealId: { in: dealIds } },
      _max: { createdAt: true },
    }),
    prisma.dealStageHistory.groupBy({
      by: ['dealId'],
      where: { workspaceId, dealId: { in: dealIds } },
      _max: { changedAt: true },
    }),
    prisma.task.groupBy({
      by: ['dealId'],
      where: { workspaceId, dealId: { in: dealIds }, status: 'PENDING' },
      _count: { _all: true },
    }),
  ]);

  const lastActivity = new Map(activityGroups.map((g) => [g.dealId, g._max.createdAt]));
  const lastStageMove = new Map(stageGroups.map((g) => [g.dealId, g._max.changedAt]));
  const openTasks = new Map(taskGroups.map((g) => [g.dealId, g._count._all]));

  const now = new Date();
  const result = new Map();
  for (const deal of deals) {
    // A stage move is itself activity on the deal — a rep advancing a deal
    // yesterday has clearly not gone quiet, even with no note logged.
    const candidates = [lastActivity.get(deal.id), lastStageMove.get(deal.id)].filter(Boolean);
    const lastActivityAt = candidates.length ? new Date(Math.max(...candidates.map((d) => d.getTime()))) : null;

    const signals = buildSignals(deal, { lastActivityAt, openTaskCount: openTasks.get(deal.id) ?? 0, now });
    result.set(deal.id, scoreDealHealth(signals));
  }
  return result;
}

// Health for a single deal, used by the detail view.
export async function computeDealHealth(workspaceId, dealId) {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, workspaceId },
    select: {
      id: true, stage: true, value: true, ownerUserId: true,
      expectedCloseDate: true, createdAt: true,
      stageHistory: { orderBy: { changedAt: 'asc' }, select: { changedAt: true } },
    },
  });
  if (!deal) { const e = new Error('Deal not found'); e.status = 404; throw e; }

  const [lastActivityRow, openTaskCount] = await Promise.all([
    prisma.crmActivity.findFirst({
      where: { workspaceId, dealId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.task.count({ where: { workspaceId, dealId, status: 'PENDING' } }),
  ]);

  const lastStageMove = deal.stageHistory.at(-1)?.changedAt ?? null;
  const candidates = [lastActivityRow?.createdAt, lastStageMove].filter(Boolean);
  const lastActivityAt = candidates.length ? new Date(Math.max(...candidates.map((d) => d.getTime()))) : null;

  return scoreDealHealth(buildSignals(deal, { lastActivityAt, openTaskCount }));
}
