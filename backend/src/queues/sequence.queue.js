import { Queue } from 'bullmq';
import { createBullConnection, logRedisError } from '../lib/redis.js';
import { sequenceAdvanceJobId, sequenceFollowUpJobId } from './jobIds.js';

// Drives sequence enrollments forward. Two job kinds:
//  - `sweep`: a repeating tick that finds enrollments whose next step is due
//  - `advance`: one enrollment, one step
//
// The sweep exists because a wait step can park an enrollment for days, and a
// delayed job lost to a Redis restart would strand it silently. The database
// holds `nextRunAt`, so the sweep can always recover.
export const sequenceQueue = new Queue('sequences', {
  connection: createBullConnection('sequence-queue'),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

sequenceQueue.on('error', (err) => logRedisError('sequence-queue', err));

export const SWEEP_INTERVAL_MS = 60_000;

// One enrollment advances at a time. The sweep uses a deterministic id so a
// duplicate enqueue (sweep racing a just-finished step) collapses into one job.
//
// `dueAtMs` is passed by a running advance job scheduling its own follow-up:
// that job holds the deterministic id and cannot be replaced while it runs, so
// re-using it made add() a no-op and short waits were only honoured by the next
// sweep. The engine's per-enrollment claim keeps the two ids from double-running.
export async function enqueueAdvance(enrollmentId, delayMs = 0, { dueAtMs } = {}) {
  const jobId = dueAtMs != null
    ? sequenceFollowUpJobId(enrollmentId, dueAtMs)
    : sequenceAdvanceJobId(enrollmentId);
  const existing = await sequenceQueue.getJob(jobId);
  if (existing) await existing.remove().catch(() => {});
  return sequenceQueue.add('advance', { enrollmentId }, {
    delay: delayMs, jobId, removeOnComplete: true, removeOnFail: true,
  });
}

export async function startSequenceSweep() {
  // repeat + a fixed jobId keeps exactly one sweep scheduled per deployment.
  return sequenceQueue.add('sweep', {}, {
    jobId: 'sequence-sweep',
    repeat: { every: SWEEP_INTERVAL_MS },
    removeOnComplete: true,
    removeOnFail: true,
  });
}
