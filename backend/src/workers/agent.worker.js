import { Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { createBullConnection } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import { tick, sweepWorkspace } from '../services/agent.service.js';

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

async function activeWorkspaceIds() {
  const rows = await prisma.workspace.findMany({ select: { id: true }, take: 500 });
  return rows.map((r) => r.id);
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
      let booked = 0;
      for (const workspaceId of await activeWorkspaceIds()) {
        // eslint-disable-next-line no-await-in-loop
        const r = await sweepWorkspace(workspaceId).catch(() => ({ booked: 0 }));
        booked += r.booked;
      }
      if (booked > 0) console.log(`[Agent] swept — booked ${booked} task(s)`);
      return { booked };
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
