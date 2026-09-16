import { Queue } from 'bullmq';
import { createBullConnection } from '../lib/redis.js';

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

sequenceQueue.on('error', () => {});

export const SWEEP_INTERVAL_MS = 60_000;

// One enrollment advances at a time. The id is deterministic so a duplicate
// enqueue (sweep racing a just-finished step) collapses into one job.
//
// No colons: BullMQ validates custom ids against its own key names and rejects
// several shapes outright. A hyphen is always safe.
export async function enqueueAdvance(enrollmentId, delayMs = 0) {
  const jobId = `advance-${enrollmentId}`;
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
