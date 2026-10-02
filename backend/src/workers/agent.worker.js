import { Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { createBullConnection } from '../lib/redis.js';
import { tick, sweepWorkspace, listAgentWorkspaceIds } from '../services/agent.service.js';

// Runs the autonomous agent.
//
// Three job kinds:
//   tick     — claim whatever is due and work it
//   sweep    — refill the queue from the state of the CRM
//   run-now  — one workspace, on demand, from the admin screen
//
// Each process identifies itself so a lease can be attributed and, if this
// worker dies mid-task, another can see the lease is stale and take over.
const WORKER_ID = `agent-${process.pid}-${randomUUID().slice(0, 8)}`;

// Per tick. Small on purpose: the agent is background hygiene and should never
// be the reason the database is busy.
const BATCH = 5;

const SWEEP_PAGE = 200;

// Every eligible workspace (switched on, not suspended, subscription not
// lapsed), walked by id so none is skipped however many there are.
export async function sweepAll({ listPage = listAgentWorkspaceIds, sweep = sweepWorkspace } = {}) {
  let booked = 0;
  let failed = 0;
  let after = null;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const ids = await listPage({ after, take: SWEEP_PAGE });
    for (const workspaceId of ids) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await sweep(workspaceId);
        booked += r.booked;
      } catch (err) {
        failed += 1;
        console.error(`[Agent] sweep failed for workspace ${workspaceId}:`, err.message);
      }
    }
    if (ids.length < SWEEP_PAGE) break;
    after = ids[ids.length - 1];
  }
  return { booked, failed };
}

export function startAgentWorker() {
  const worker = new Worker('agent', async (job) => {
    if (job.name === 'tick') {
      const result = await tick(WORKER_ID, { limit: BATCH });
      if (result.claimed > 0) {
        console.log(`[Agent] worked ${result.claimed} task(s)`);
      }
      return result;
    }

    if (job.name === 'sweep') {
      const result = await sweepAll();
      if (result.booked > 0) console.log(`[Agent] swept — booked ${result.booked} task(s)`);
      return result;
    }

    if (job.name === 'run-now') {
      const { workspaceId } = job.data;
      await sweepWorkspace(workspaceId);
      return tick(WORKER_ID, { limit: 20 });
    }

    return null;
  }, {
    connection: createBullConnection('agent-worker'),
    // One at a time. The lease makes concurrency safe, but there is no reason
    // for background hygiene to compete with request traffic for the pool.
    concurrency: 1,
  });

  worker.on('failed', (job, err) => {
    console.error(`[Agent] job ${job?.name} failed:`, err.message);
  });

  console.log('[Worker] Agent worker started');
  return worker;
}
