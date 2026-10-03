import { AsyncLocalStorage } from 'node:async_hooks';
import { prisma } from '../lib/prisma.js';
// A namespace import: tests that stub workflowCrm with only some of its exports
// still load this module.
import * as workflowCrm from './workflowCrm.service.js';

// The CRM event bus: the one place a CRM write tells the workflow engine what
// happened.
//
// It used to be a fire-and-forget call per record, each doing its own
// "which workflows are active?" query and possibly starting runs. A 500-lead
// bulk edit therefore queued ~500 concurrent workflow look-ups against a pool
// of 5 connections; past pool_timeout they failed with P2024 and those leads'
// automations were silently dropped. Events no trigger listens to
// (lead_deleted, lead_assigned, lead_category_changed) paid the same query
// for nothing.
//
// Now:
//  - an event no CRM trigger can match returns immediately, with no query;
//  - the workspace's CRM-triggered workflows are loaded once per burst (a
//    short-lived per-workspace cache shared by concurrent emits, and once per
//    call for a batch) and only records that match one of them go on;
//  - everything that touches the database runs through one small
//    concurrency limiter, so a burst queues instead of exhausting the pool.

// Event name -> the trigger subtype that listens to it (workflowCrm.CRM_TRIGGERS).
export const LISTENED_EVENTS = Object.freeze({
  lead_created: 'lead_created',
  lead_status_changed: 'lead_status',
  deal_stage_changed: 'deal_stage',
  lead_score_changed: 'score_above',
});

// Kept below the default pool size (DATABASE_POOL_SIZE=5), so a burst of CRM
// automation always leaves connections for the requests being served.
export const CRM_EVENT_CONCURRENCY = 3;

// How long one workspace's trigger list is reused. Long enough to collapse a
// bulk edit or a nightly rescore into one query, short enough that a workflow
// switched on a moment ago is seen by the next change.
const TRIGGER_CACHE_MS = 2_000;

// ── Chain depth ────────────────────────────────────────────────────────────
// A workflow that changes a lead's status can trigger another workflow that
// changes it back. Each event carries how deep in such a chain it is; runs
// started for it execute inside that context (and the depth is stored on the
// run, so a step resumed after a delay still knows it), and a status write
// they make is emitted one level deeper. runWorkflowsForCrmEvent refuses at
// MAX_CHAIN_DEPTH.
const chain = new AsyncLocalStorage();
const maxChainDepth = () => workflowCrm.MAX_CHAIN_DEPTH ?? 3;

/** The chain depth of the CRM event whose workflow is running now, or undefined. */
export const currentChainDepth = () => chain.getStore()?.depth;

// ── Concurrency limiter ────────────────────────────────────────────────────
let active = 0;
const waiting = [];

function limited(task) {
  return new Promise((resolve, reject) => {
    const start = () => {
      active += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          const next = waiting.shift();
          if (next) next();
        });
    };
    if (active < CRM_EVENT_CONCURRENCY) start();
    else waiting.push(start);
  });
}

// ── Trigger look-up ────────────────────────────────────────────────────────
const triggerCache = new Map();

function triggerOf(workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  return nodes.find((n) => n?.type === 'trigger') ?? null;
}

const CRM_SUBTYPES = new Set(Object.values(LISTENED_EVENTS));

// The triggers of the workspace's active, CRM-triggered workflows.
export function loadCrmTriggers(workspaceId) {
  const hit = triggerCache.get(workspaceId);
  if (hit && Date.now() - hit.at < TRIGGER_CACHE_MS) return hit.promise;
  const promise = limited(() => prisma.workflow.findMany({
    where: { workspaceId, isActive: true },
    select: { id: true, nodes: true },
  })).then((rows) => (rows ?? []).map(triggerOf).filter((t) => t && CRM_SUBTYPES.has(t.subtype)));
  triggerCache.set(workspaceId, { at: Date.now(), promise });
  promise.catch(() => triggerCache.delete(workspaceId));
  return promise;
}

/** Forgets a workspace's cached triggers (after a workflow is saved, or in tests). */
export function invalidateCrmTriggers(workspaceId) {
  if (workspaceId) triggerCache.delete(workspaceId);
  else triggerCache.clear();
}

// Remembers on each run the depth of the event that started it, so a run
// resumed later (after a delay, outside this call's context) is still held to
// the chain limit. Best-effort: a failure only loosens the limit for that run.
async function stampDepth(runs, depth) {
  if (!(depth > 0)) return;
  const ids = (Array.isArray(runs) ? runs : []).map((r) => r?.id).filter(Boolean);
  if (ids.length === 0) return;
  await prisma.workflowRun.updateMany({ where: { id: { in: ids } }, data: { chainDepth: depth } })
    .catch((err) => console.warn('[CrmEvents] Could not record the chain depth of new runs:', err.message));
}

/**
 * Runs the workflows that match one event for each payload. Resolves once
 * every matching payload has been handed to the engine; never rejects.
 * Returns how many payloads matched a workflow.
 */
export async function dispatchCrmEvents(workspaceId, event, payloads = [], { depth = 0 } = {}) {
  if (!workspaceId || !LISTENED_EVENTS[event]) return { matched: 0 };
  const list = (Array.isArray(payloads) ? payloads : [payloads]).filter(Boolean);
  if (list.length === 0) return { matched: 0 };
  if (depth >= maxChainDepth()) {
    console.warn(`[CrmEvents] Chain depth ${depth} reached for "${event}" in ${workspaceId} — not starting further workflows.`);
    return { matched: 0, stopped: true };
  }

  let triggers;
  try {
    triggers = await loadCrmTriggers(workspaceId);
  } catch (err) {
    console.error(`[CrmEvents] Could not load workflows for "${event}" in ${workspaceId}:`, err.message);
    return { matched: 0, error: err.message };
  }
  const wanted = list.filter((payload) => triggers.some((t) => workflowCrm.crmTriggerFires(t, { event, payload })));
  if (wanted.length === 0) return { matched: 0 };

  await Promise.all(wanted.map((payload) => limited(
    () => chain.run({ depth }, () => workflowCrm.runWorkflowsForCrmEvent(workspaceId, event, payload, { depth })),
  ).then((runs) => stampDepth(runs, depth)).catch((err) => {
    console.error(`[CrmEvents] Workflows for "${event}" (lead ${payload.leadId ?? '—'}, deal ${payload.dealId ?? '—'}) failed:`, err.message);
  })));
  return { matched: wanted.length };
}

// Fire-and-forget: an automation must never delay or fail the CRM write that
// triggered it.
export function emitCrmEvent(workspaceId, event, payload = {}, options = {}) {
  if (!LISTENED_EVENTS[event]) return;
  dispatchCrmEvents(workspaceId, event, [payload], options).catch((err) => {
    console.error(`[CrmEvents] Could not run workflows for "${event}":`, err.message);
  });
}

// The same for many records at once (bulk edits, imports): one workflow
// look-up for the whole batch.
export function emitCrmEvents(workspaceId, event, payloads = [], options = {}) {
  if (!LISTENED_EVENTS[event] || !payloads?.length) return;
  dispatchCrmEvents(workspaceId, event, payloads, options).catch((err) => {
    console.error(`[CrmEvents] Could not run workflows for "${event}":`, err.message);
  });
}

/**
 * Sets a lead's status on behalf of an automation (a workflow step, a sequence
 * step), under the workspace's lead lifecycle like any other status write, and
 * raises lead_status_changed one level deeper than the caller so a chain of
 * workflows stops at MAX_CHAIN_DEPTH.
 *
 * -> { changed, status, previousStatus } or { changed: false, reason }.
 * A stage the lifecycle refuses throws a 400, as leadStatusWrite does.
 */
export async function applyLeadStatus(workspaceId, leadId, requested, { depth = 0 } = {}) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, workspaceId },
    select: { id: true, status: true, customFields: true, contactId: true },
  });
  if (!lead) return { changed: false, reason: 'Lead no longer exists' };

  const { loadLeadIntakeRules, leadStatusWrite } = await import('./leadIntake.service.js');
  const { resolved, data } = leadStatusWrite(await loadLeadIntakeRules(workspaceId), requested, lead.customFields, { strict: true });
  const previousStatus = lead.customFields?.statusKey || lead.status;
  const status = resolved?.key ?? data.customFields?.statusKey ?? data.status;
  if (status === previousStatus) return { changed: false, already: true, status, previousStatus, reason: `Already ${status}` };

  await prisma.lead.update({ where: { id: lead.id }, data });
  emitCrmEvent(workspaceId, 'lead_status_changed', {
    leadId: lead.id, contactId: lead.contactId, status, previousStatus,
  }, { depth: depth + 1 });
  return { changed: true, status, previousStatus };
}
