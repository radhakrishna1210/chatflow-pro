import { Queue } from 'bullmq';
import { createBullConnection } from '../lib/redis.js';

// Drives the autonomous agent's schedule.
//
// BullMQ provides the tick only. The work itself lives in Postgres
// (`AgentTask`), because the queue doubles as the audit trail — "why has
// nothing happened to this deal" must still be answerable next week, and a
// completed Redis job is gone.
export const agentQueue = new Queue('agent', {
  connection: createBullConnection('agent-queue'),
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: 50,
    removeOnFail: 25,
  },
});

agentQueue.on('error', () => {});

// How often the agent wakes. Slow on purpose: this is background hygiene, not
// a response to a user action, and a tighter loop mostly buys contention.
export const TICK_INTERVAL_MS = 5 * 60_000;

// Refills the queue from the state of the CRM. Hourly is plenty — the things it
// looks for are measured in days.
export const SWEEP_INTERVAL_MS = 60 * 60_000;

export async function startAgentSchedules() {
  // Fixed job ids keep exactly one of each scheduled per deployment; BullMQ
  // dedupes identical repeat configs rather than stacking them.
  await agentQueue.add('tick', {}, {
    jobId: 'agent-tick',
    repeat: { every: TICK_INTERVAL_MS },
    removeOnComplete: true,
    removeOnFail: true,
  });

  await agentQueue.add('sweep', {}, {
    jobId: 'agent-sweep',
    repeat: { every: SWEEP_INTERVAL_MS },
    removeOnComplete: true,
    removeOnFail: true,
  });
}

// Ad-hoc: run one workspace now, from the admin screen.
export async function enqueueRunNow(workspaceId) {
  return agentQueue.add('run-now', { workspaceId }, {
    jobId: `agent-now-${workspaceId}`,
    removeOnComplete: true,
    removeOnFail: true,
  });
}
