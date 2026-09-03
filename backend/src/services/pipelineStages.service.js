import { prisma } from '../lib/prisma.js';

// The built-in stages, in pipeline order, with the default win probability
// used for weighted forecasting until a workspace sets its own.
//
// `key` matches the DealStage enum. Deals still store the enum; this table
// only supplies presentation and weighting, so nothing here can orphan a deal.
export const DEFAULT_STAGES = [
  { key: 'QUALIFICATION',  label: 'Qualification',  probability: 10, sortOrder: 0 },
  { key: 'NEEDS_ANALYSIS', label: 'Needs Analysis', probability: 25, sortOrder: 1 },
  { key: 'PROPOSAL',       label: 'Proposal',       probability: 50, sortOrder: 2 },
  { key: 'NEGOTIATION',    label: 'Negotiation',    probability: 75, sortOrder: 3 },
  { key: 'CLOSED_WON',     label: 'Closed Won',     probability: 100, sortOrder: 4 },
  { key: 'CLOSED_LOST',    label: 'Closed Lost',    probability: 0,  sortOrder: 5 },
];

export const STAGE_KEYS = DEFAULT_STAGES.map((s) => s.key);
export const CLOSED_STAGES = ['CLOSED_WON', 'CLOSED_LOST'];

// Terminal stages are not configurable weights — a won deal is 100% and a lost
// one is 0% by definition. Letting an admin set "Closed Won: 80%" would make
// every forecast wrong in a way that is very hard to notice.
const FIXED_PROBABILITY = { CLOSED_WON: 100, CLOSED_LOST: 0 };

// Workspaces created before this table existed have no rows, and seeding on
// signup would not help them. Defaults are therefore created on first read,
// which makes the endpoint self-healing for every existing workspace.
export async function ensureStages(workspaceId) {
  const existing = await prisma.pipelineStage.findMany({ where: { workspaceId }, select: { key: true } });
  const have = new Set(existing.map((s) => s.key));
  const missing = DEFAULT_STAGES.filter((s) => !have.has(s.key));

  if (missing.length) {
    await prisma.pipelineStage.createMany({
      data: missing.map((s) => ({ ...s, workspaceId })),
      skipDuplicates: true,
    });
  }
}

export async function listStages(workspaceId) {
  await ensureStages(workspaceId);
  const data = await prisma.pipelineStage.findMany({
    where: { workspaceId },
    orderBy: { sortOrder: 'asc' },
  });
  return { data, total: data.length };
}

// A map of key -> probability, used by the forecast. Terminal stages always
// report their fixed value regardless of what is stored.
export async function stageProbabilities(workspaceId) {
  const { data } = await listStages(workspaceId);
  return new Map(data.map((s) => [s.key, FIXED_PROBABILITY[s.key] ?? s.probability]));
}

export async function updateStage(workspaceId, key, updates) {
  if (!STAGE_KEYS.includes(key)) {
    const e = new Error('Unknown pipeline stage'); e.status = 404; throw e;
  }
  await ensureStages(workspaceId);

  const data = { ...updates };

  // Terminal stages keep their meaning: they can be relabelled, but not
  // reweighted and not hidden — a board with nowhere to drop a won deal is
  // broken, and the analytics treat these two keys as terminal by name.
  if (CLOSED_STAGES.includes(key)) {
    delete data.probability;
    if (data.isActive === false) {
      const e = new Error('Closed stages cannot be hidden'); e.status = 400; throw e;
    }
  }

  const stage = await prisma.pipelineStage.findFirst({ where: { workspaceId, key }, select: { id: true } });
  return prisma.pipelineStage.update({ where: { id: stage.id }, data });
}

// Reorder is a whole-list operation: sending one stage's position invites
// duplicate sortOrders, so callers submit the full ordering and it is written
// in one transaction.
export async function reorderStages(workspaceId, keys) {
  const unknown = keys.filter((k) => !STAGE_KEYS.includes(k));
  if (unknown.length) {
    const e = new Error(`Unknown stage(s): ${unknown.join(', ')}`); e.status = 400; throw e;
  }
  if (new Set(keys).size !== keys.length) {
    const e = new Error('Duplicate stages in ordering'); e.status = 400; throw e;
  }
  if (keys.length !== STAGE_KEYS.length) {
    const e = new Error(`Ordering must list all ${STAGE_KEYS.length} stages`); e.status = 400; throw e;
  }

  await ensureStages(workspaceId);
  await prisma.$transaction(
    keys.map((key, i) =>
      prisma.pipelineStage.updateMany({ where: { workspaceId, key }, data: { sortOrder: i } })),
  );
  return listStages(workspaceId);
}
