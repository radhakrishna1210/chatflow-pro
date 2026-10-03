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

// The plan feature flag that unlocks the autonomous agent. Paid plans carry it
// (migration 20261003130000_plan_feature_autonomous_agent); Free does not. The
// HTTP routes check it with requireFeature like every other plan feature; the
// worker checks it in AGENT_ELIGIBLE_WHERE below, since it has no request.
export const AUTONOMOUS_AGENT_FEATURE = 'autonomousAgent';

// Workspaces the agent may write to: switched on, not suspended, on a plan
// that includes the agent, and without a cancelled or expired subscription —
// the same states workspaceContext blocks for people. A workspace with no
// subscription row is on the free default, which does not include it.
//
// The plan check is part of the query rather than a per-workspace lookup so
// the sweep's id cursor pages over eligible workspaces only.
export const AGENT_ELIGIBLE_WHERE = {
  autonomousAgentEnabled: true,
  suspended: false,
  subscription: {
    is: {
      status: { notIn: ['CANCELLED', 'EXPIRED'] },
      plan: { is: { features: { path: [AUTONOMOUS_AGENT_FEATURE], equals: true } } },
    },
  },
};

export async function agentAllowed(workspaceId) {
  const ws = await prisma.workspace.findFirst({
    where: { id: workspaceId, ...AGENT_ELIGIBLE_WHERE },
    select: { id: true },
  });
  return !!ws;
}

/**
 * One page of workspaces the sweep should visit, in a stable order (by id) so
 * a cursor can walk all of them. The old sweep took an arbitrary first 500
 * and never reached the rest.
 */
export async function listAgentWorkspaceIds({ after = null, take = 200 } = {}) {
  const rows = await prisma.workspace.findMany({
    where: { ...AGENT_ELIGIBLE_WHERE, ...(after ? { id: { gt: after } } : {}) },
    select: { id: true },
    orderBy: { id: 'asc' },
    take,
  });
  return rows.map((r) => r.id);
}

export async function getAgentSettings(workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { autonomousAgentEnabled: true },
  });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  return { enabled: ws.autonomousAgentEnabled };
}

/**
 * Switches the agent on or off for a workspace. Turning it off also retires
 * work already queued, so nothing booked before the switch still runs.
 */
export async function setAgentEnabled(workspaceId, enabled) {
  await prisma.workspace.update({ where: { id: workspaceId }, data: { autonomousAgentEnabled: !!enabled } });
  if (!enabled) {
    await prisma.agentTask.updateMany({
      where: { workspaceId, status: 'PENDING' },
      data: { status: 'SKIPPED', activeKey: null, lastError: 'Autonomous agent switched off for this workspace' },
    });
  }
  return getAgentSettings(workspaceId);
}

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
  }, { timeout: 15000, maxWait: 10000 });
}

// Live work carries this key; finished work carries NULL. The unique index on
// (workspaceId, activeKey) is what actually prevents queueing the same job
// twice — the read-then-write below would otherwise race two dispatchers.
const activeKeyFor = (kind, targetType, targetId) => `${kind}:${targetType}:${targetId}`;

/** Books work, collapsing duplicates onto the existing live row. */
export async function enqueue(workspaceId, { kind, targetType, targetId, reason = null, runAfter = new Date() }) {
  const activeKey = activeKeyFor(kind, targetType, targetId);

  // Check if task already exists with activeKey to avoid triggering unique constraint errors on sweeps
  const existing = await prisma.agentTask.findFirst({
    where: { workspaceId, activeKey },
    select: { id: true },
  });
  if (existing) {
    return existing;
  }

  try {
    return await prisma.agentTask.create({
      data: { workspaceId, kind, targetType, targetId, reason, runAfter, activeKey },
    });
  } catch (err) {
    // P2002 means this record already has this work queued (concurrent race),
    // which is the desired outcome rather than an unhandled error.
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
  if (!(await agentAllowed(workspaceId))) return { booked: 0, deals: 0, leads: 0, skipped: true };

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

    // Work booked before the workspace was switched off, suspended or lapsed
    // is retired rather than run.
    if (!(await agentAllowed(task.workspaceId))) {
      const e = new Error('The autonomous agent is off for this workspace, or the workspace is inactive');
      e.denied = true;
      throw e;
    }

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
    }).catch((err) => console.error(`[Agent] Could not release task ${task.id} after failure:`, err.message));
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

const TASK_LIST_SELECT = {
  id: true, kind: true, targetType: true, targetId: true, status: true, runAfter: true,
  attempts: true, lastError: true, reason: true, lockedAt: true, createdAt: true, updatedAt: true,
};

// Names for the records a list of tasks, suggestions or runs points at, so the
// admin view can say "Deal: Acme renewal" instead of a cuid. One query per
// record type, scoped to the workspace.
async function labelTargets(workspaceId, rows) {
  const ids = (type) => [...new Set(rows.filter((r) => r.targetType === type).map((r) => r.targetId))];
  const dealIds = ids('deal');
  const leadIds = ids('lead');
  const [deals, leads] = await Promise.all([
    dealIds.length
      ? prisma.deal.findMany({ where: { workspaceId, id: { in: dealIds } }, select: { id: true, title: true } })
      : [],
    leadIds.length
      ? prisma.lead.findMany({
        where: { workspaceId, id: { in: leadIds } },
        select: { id: true, contact: { select: { name: true, phoneNumber: true } } },
      })
      : [],
  ]);
  const names = new Map([
    ...deals.map((d) => [`deal:${d.id}`, d.title]),
    ...leads.map((l) => [`lead:${l.id}`, l.contact?.name || l.contact?.phoneNumber || null]),
  ]);
  return rows.map((r) => ({ ...r, targetLabel: names.get(`${r.targetType}:${r.targetId}`) ?? null }));
}

/**
 * The admin view of the agent's work for one workspace: queue depth and
 * unsettled suggestion count (the original summary), plus the rows behind
 * them — queued and running tasks, recent failures, suggestions waiting for a
 * human, and the latest runs.
 */
export async function pendingWork(workspaceId) {
  const suggestionWhere = { workspaceId, band: 'WEAK', applied: false, settledAt: null };
  const [queued, suggestions, recent, tasks, failed, suggestionItems] = await Promise.all([
    prisma.agentTask.count({ where: { workspaceId, status: { in: ['PENDING', 'RUNNING'] } } }),
    prisma.agentFact.count({ where: suggestionWhere }),
    prisma.agentRun.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, targetType: true, targetId: true, summary: true, applied: true, withheld: true, createdAt: true },
    }),
    prisma.agentTask.findMany({
      where: { workspaceId, status: { in: ['PENDING', 'RUNNING'] } },
      orderBy: { runAfter: 'asc' },
      take: 50,
      select: TASK_LIST_SELECT,
    }),
    prisma.agentTask.findMany({
      where: { workspaceId, status: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: TASK_LIST_SELECT,
    }),
    prisma.agentFact.findMany({
      where: suggestionWhere,
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, targetType: true, targetId: true, field: true, value: true, score: true, rationale: true, createdAt: true },
    }),
  ]);
  // One lookup for every row shown, so a deal in both lists is fetched once.
  const labelled = await labelTargets(workspaceId, [...tasks, ...failed, ...suggestionItems, ...recent]);
  const take = (from, n) => labelled.slice(from, from + n);
  let at = 0;
  const taskRows = take(at, tasks.length); at += tasks.length;
  const failedRows = take(at, failed.length); at += failed.length;
  const suggestionRows = take(at, suggestionItems.length); at += suggestionItems.length;
  const recentRows = take(at, recent.length);
  return {
    queued, suggestions, recent: recentRows,
    tasks: taskRows, failed: failedRows, suggestionItems: suggestionRows,
  };
}

const httpError = (status, message) => Object.assign(new Error(message), { status });

async function taskStatusConflict(workspaceId, taskId, verb) {
  const exists = await prisma.agentTask.findFirst({ where: { id: taskId, workspaceId }, select: { status: true } });
  if (!exists) return httpError(404, 'Task not found');
  return httpError(409, `Only queued tasks can be ${verb}; this one is ${String(exists.status).toLowerCase()}.`);
}

/**
 * Withdraws a task that has not started. Only PENDING work can be cancelled:
 * a RUNNING task is mid-write, and stopping it halfway would leave the record
 * in a state nobody chose. The status is part of the update's filter so a
 * dispatcher claiming the row at the same moment wins cleanly.
 */
export async function cancelTask(workspaceId, taskId) {
  const { count } = await prisma.agentTask.updateMany({
    where: { id: taskId, workspaceId, status: 'PENDING' },
    data: {
      status: 'SKIPPED',
      activeKey: null,
      lockedAt: null,
      lockedBy: null,
      lastError: 'Cancelled by a workspace admin',
    },
  });
  if (count === 0) throw await taskStatusConflict(workspaceId, taskId, 'cancelled');
  return prisma.agentTask.findFirst({ where: { id: taskId, workspaceId }, select: TASK_LIST_SELECT });
}

/** Approves a queued task to run on the next tick instead of at its booked time. */
export async function expediteTask(workspaceId, taskId) {
  const { count } = await prisma.agentTask.updateMany({
    where: { id: taskId, workspaceId, status: 'PENDING' },
    data: { runAfter: new Date() },
  });
  if (count === 0) throw await taskStatusConflict(workspaceId, taskId, 'run early');
  return prisma.agentTask.findFirst({ where: { id: taskId, workspaceId }, select: TASK_LIST_SELECT });
}

/**
 * Puts a FAILED (or SKIPPED) task back in the queue with a fresh attempt
 * budget, due now. It takes the record's live key again, so if the sweep has
 * already queued the same work the retry is refused rather than duplicated.
 */
export async function retryTask(workspaceId, taskId) {
  const task = await prisma.agentTask.findFirst({ where: { id: taskId, workspaceId } });
  if (!task) throw httpError(404, 'Task not found');
  if (task.status !== 'FAILED' && task.status !== 'SKIPPED') {
    throw httpError(409, `Only failed or skipped tasks can be retried; this one is ${String(task.status).toLowerCase()}.`);
  }
  if (!(await agentAllowed(workspaceId))) {
    throw httpError(409, 'The autonomous agent is switched off for this workspace, or the workspace is inactive.');
  }
  try {
    await prisma.agentTask.update({
      where: { id: task.id },
      data: {
        status: 'PENDING',
        attempts: 0,
        runAfter: new Date(),
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        activeKey: activeKeyFor(task.kind, task.targetType, task.targetId),
      },
    });
  } catch (err) {
    if (err.code === 'P2002') throw httpError(409, 'The same work is already queued for this record.');
    throw err;
  }
  return prisma.agentTask.findFirst({ where: { id: taskId, workspaceId }, select: TASK_LIST_SELECT });
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
