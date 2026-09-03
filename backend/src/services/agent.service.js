import { prisma } from '../lib/prisma.js';
import { ACTIONS, assertPermittedUnattended } from './agent.tools.js';

// The autonomous agent runner.
//
// Shape borrowed from trycompai/crm (MIT, Copyright (c) 2026 Comp AI): the
// agent owns a work queue and a schedule rather than waiting to be asked. It
// wakes, claims whatever is due, works each record, writes down what it did,
// and books its own next look.
//
// The queue lives in Postgres rather than Redis even though BullMQ is already
// here, because the queue *is* the audit trail — "why did nothing happen to
// this deal" has to be answerable next week, and a completed Redis job is gone.
// BullMQ still drives the tick; it just does not hold the work.

const DAY = 86400000;

// How long a claim is honoured before another dispatcher may steal the row.
// Long enough for a slow LLM turn, short enough that a crashed worker does not
// park a record for hours.
const LEASE_MS = 5 * 60_000;

const MAX_ATTEMPTS = 3;

/**
 * Claims up to `limit` due tasks for this worker.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes two dispatchers take disjoint work
 * instead of fighting over the same head of the queue — the same reason
 * trycompai/crm's claimDue uses it.
 */
export async function claimDue(workerId, { limit = 5, now = new Date() } = {}) {
  const staleBefore = new Date(now.getTime() - LEASE_MS);

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT id FROM "AgentTask"
      WHERE "runAfter" <= ${now}
        AND "attempts" < ${MAX_ATTEMPTS}
        AND (
          "status" = 'PENDING'
          OR ("status" = 'RUNNING' AND ("lockedAt" IS NULL OR "lockedAt" < ${staleBefore}))
        )
      ORDER BY "runAfter" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;

    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return [];

    await tx.agentTask.updateMany({
      where: { id: { in: ids } },
      data: { status: 'RUNNING', lockedAt: now, lockedBy: workerId, attempts: { increment: 1 } },
    });

    return tx.agentTask.findMany({ where: { id: { in: ids } } });
  });
}

// Live work carries this key; finished work carries NULL. The unique index on
// (workspaceId, activeKey) is what actually prevents queueing the same job
// twice — the read-then-write below would otherwise race two dispatchers.
const activeKeyFor = (kind, targetType, targetId) => `${kind}:${targetType}:${targetId}`;

/** Books work, collapsing duplicates onto the existing live row. */
export async function enqueue(workspaceId, { kind, targetType, targetId, reason = null, runAfter = new Date() }) {
  const activeKey = activeKeyFor(kind, targetType, targetId);
  try {
    return await prisma.agentTask.create({
      data: { workspaceId, kind, targetType, targetId, reason, runAfter, activeKey },
    });
  } catch (err) {
    // P2002 means this record already has this work queued, which is the
    // desired outcome rather than an error.
    if (err.code === 'P2002') {
      return prisma.agentTask.findFirst({ where: { workspaceId, activeKey }, select: { id: true } });
    }
    throw err;
  }
}

/**
 * Books the agent's own next look at a record, with the reason shown to the
 * rep. Their `schedule_recheck`, same idea: the agent deciding when to come
 * back is what makes it a worker rather than a request handler.
 */
export async function scheduleRecheck(workspaceId, { kind, targetType, targetId, days = 7, reason }) {
  return enqueue(workspaceId, {
    kind, targetType, targetId, reason,
    runAfter: new Date(Date.now() + days * DAY),
  });
}

/**
 * Fills the queue from records that look like they need a look.
 *
 * Deliberately derived from the deterministic side of the product rather than
 * from a model's opinion: open deals and new leads are facts, and letting the
 * LLM choose what to work on would put an unverifiable step ahead of every
 * verifiable one.
 */
export async function sweepWorkspace(workspaceId, { now = new Date() } = {}) {
  const quietSince = new Date(now.getTime() - 14 * DAY);

  const [quietDeals, freshLeads] = await Promise.all([
    prisma.deal.findMany({
      where: {
        workspaceId,
        stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
        tasks: { none: { status: 'PENDING' } },
        updatedAt: { lt: quietSince },
      },
      select: { id: true },
      take: 50,
    }),
    prisma.lead.findMany({
      where: { workspaceId, status: 'NEW' },
      select: { id: true },
      take: 50,
    }),
  ]);

  let booked = 0;
  for (const deal of quietDeals) {
    // eslint-disable-next-line no-await-in-loop
    await enqueue(workspaceId, {
      kind: 'schedule_followup', targetType: 'deal', targetId: deal.id,
      reason: 'Open deal with nothing scheduled and no recent change.',
    });
    booked += 1;
  }
  for (const lead of freshLeads) {
    // eslint-disable-next-line no-await-in-loop
    await enqueue(workspaceId, {
      kind: 'advance_contacted', targetType: 'lead', targetId: lead.id,
      reason: 'Lead still marked New.',
    });
    booked += 1;
  }

  return { booked, deals: quietDeals.length, leads: freshLeads.length };
}

/** Works one claimed task. Never throws — a bad record must not stop the queue. */
export async function runTask(task, { actorUserId = null } = {}) {
  const steps = [];
  const started = Date.now();
  let summary = '';
  let applied = 0;
  let withheld = 0;

  try {
    // The refusal happens before anything is loaded, so a sensitive kind cannot
    // do work on its way to being denied.
    assertPermittedUnattended(task.kind);

    const action = ACTIONS[task.kind];
    if (!action) throw new Error(`No autonomous action named "${task.kind}"`);

    let result;
    if (task.targetType === 'deal') {
      const deal = await prisma.deal.findFirst({
        where: { id: task.targetId, workspaceId: task.workspaceId },
        select: { id: true, title: true, ownerUserId: true, stage: true },
      });
      if (!deal) throw new Error('Deal no longer exists');
      steps.push({ tool: 'load_deal', ok: true });
      result = await action.run({ workspaceId: task.workspaceId, deal, actorUserId });
    } else {
      const lead = await prisma.lead.findFirst({
        where: { id: task.targetId, workspaceId: task.workspaceId },
        select: { id: true, status: true, score: true, contactId: true },
      });
      if (!lead) throw new Error('Lead no longer exists');
      steps.push({ tool: 'load_lead', ok: true });
      result = await action.run({ workspaceId: task.workspaceId, lead, actorUserId });
    }

    steps.push({ tool: task.kind, ok: true, result: result.rationale ?? result.reason ?? null });

    if (result.skipped) {
      summary = `Looked and left it alone — ${result.reason}`;
    } else if (result.applied) {
      applied = 1;
      summary = result.rationale;
    } else {
      withheld = 1;
      summary = result.rationale ?? 'Nothing was applied.';
    }

    await prisma.agentTask.update({
      where: { id: task.id },
      // activeKey cleared so this record can be queued again on a later pass.
      data: { status: result.skipped ? 'SKIPPED' : 'DONE', lockedAt: null, lockedBy: null, activeKey: null },
    });
  } catch (err) {
    steps.push({ tool: task.kind, ok: false, error: err.message });
    summary = err.denied ? `Refused: ${err.message}` : `Failed: ${err.message}`;

    const exhausted = task.attempts >= MAX_ATTEMPTS;
    await prisma.agentTask.update({
      where: { id: task.id },
      data: {
        // A denial is a decision, not a failure — retrying it would just deny
        // it again on every tick until the attempt budget ran out.
        status: err.denied ? 'SKIPPED' : (exhausted ? 'FAILED' : 'PENDING'),
        lastError: err.message,
        lockedAt: null,
        lockedBy: null,
        // Only a task that is finished for good releases its key; one going
        // back to PENDING keeps it, or the sweep would queue a duplicate.
        ...(err.denied || exhausted ? { activeKey: null } : {}),
        runAfter: new Date(Date.now() + 30 * 60_000),
      },
    }).catch(() => {});
  }

  const run = await prisma.agentRun.create({
    data: {
      workspaceId: task.workspaceId,
      taskId: task.id,
      targetType: task.targetType,
      targetId: task.targetId,
      summary,
      steps,
      applied,
      withheld,
    },
  });

  return { ...run, ms: Date.now() - started };
}

/** One tick: claim what is due and work it. */
export async function tick(workerId, { limit = 5, actorUserId = null } = {}) {
  const tasks = await claimDue(workerId, { limit });
  const runs = [];
  for (const task of tasks) {
    // eslint-disable-next-line no-await-in-loop
    runs.push(await runTask(task, { actorUserId }));
  }
  return { claimed: tasks.length, runs };
}

/** What the Agent tab renders for one record. */
export async function historyFor(workspaceId, targetType, targetId) {
  const [runs, facts, pending] = await Promise.all([
    prisma.agentRun.findMany({
      where: { workspaceId, targetType, targetId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.agentFact.findMany({
      where: { workspaceId, targetType, targetId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.agentTask.findMany({
      where: { workspaceId, targetType, targetId, status: { in: ['PENDING', 'RUNNING'] } },
      select: { id: true, kind: true, runAfter: true, reason: true, status: true },
    }),
  ]);
  return { runs, facts, pending };
}

/** Queue depth and unsettled suggestions, for the admin view. */
export async function pendingWork(workspaceId) {
  const [queued, suggestions, recent] = await Promise.all([
    prisma.agentTask.count({ where: { workspaceId, status: { in: ['PENDING', 'RUNNING'] } } }),
    prisma.agentFact.count({ where: { workspaceId, band: 'WEAK', applied: false, settledAt: null } }),
    prisma.agentRun.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, targetType: true, targetId: true, summary: true, applied: true, withheld: true, createdAt: true },
    }),
  ]);
  return { queued, suggestions, recent };
}

/** Accepts or rejects a suggestion the agent held back. */
export async function settleFact(workspaceId, factId, { accepted, userId }) {
  const fact = await prisma.agentFact.findFirst({ where: { id: factId, workspaceId } });
  if (!fact) { const e = new Error('Suggestion not found'); e.status = 404; throw e; }
  if (fact.settledAt) { const e = new Error('Already settled'); e.status = 409; throw e; }

  return prisma.agentFact.update({
    where: { id: factId },
    data: { settledAt: new Date(), settledBy: userId, accepted: !!accepted },
  });
}

export const __testing = { LEASE_MS, MAX_ATTEMPTS };
