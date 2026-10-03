import { Worker } from 'bullmq';
import { createBullConnection, logRedisError } from '../lib/redis.js';
import { env } from '../config/env.js';
import { advanceEnrollment, findDueEnrollments } from '../services/sequenceEngine.service.js';
import { sendSequenceMessage } from '../services/sequenceSender.js';
import { enqueueAdvance } from '../queues/sequence.queue.js';

export function startSequenceWorker() {
  const worker = new Worker(
    'sequences',
    async (job) => {
      if (job.name === 'sweep') {
        const due = await findDueEnrollments({ limit: 100 });
        for (const row of due) await enqueueAdvance(row.id).catch((err) => console.warn(`[SequenceWorker] Could not enqueue enrollment ${row.id}:`, err.message));
        return { swept: due.length };
      }

      const { enrollmentId } = job.data;

      // Instant steps (message, task, field update) chain inside this one job
      // rather than re-queueing.
      //
      // Bounded so a pathological sequence cannot spin a worker forever; the
      // remainder is picked up by the next sweep.
      const MAX_STEPS_PER_JOB = 20;
      let result;
      for (let i = 0; i < MAX_STEPS_PER_JOB; i += 1) {
        result = await advanceEnrollment(enrollmentId, { send: sendSequenceMessage });
        if (result.status !== 'ACTIVE') break;
      }

      // A wait short enough to be worth its own job gets one; anything longer
      // is left to the sweep, which survives a Redis restart because
      // `nextRunAt` lives in the database. The follow-up gets its own id —
      // this job still holds the enrollment's sweep id.
      if (result?.status === 'WAITING' && result.nextRunAt) {
        const dueAtMs = new Date(result.nextRunAt).getTime();
        const delay = Math.max(0, dueAtMs - Date.now());
        if (delay < 5 * 60_000) {
          await enqueueAdvance(enrollmentId, delay, { dueAtMs }).catch((err) => {
            console.error(`[Sequence] Could not schedule the next step for ${enrollmentId}:`, err.message);
          });
        }
      }

      return result;
    },
    {
      connection: createBullConnection('sequence-worker'),
      concurrency: 5,
      drainDelay: env.WORKER_DRAIN_DELAY_SEC,
      stalledInterval: env.WORKER_STALLED_INTERVAL_MS,
    },
  );

  worker.on('error', (err) => logRedisError('sequence-worker', err));
  worker.on('failed', (job, err) => {
    console.error(`[Sequence] job ${job?.id} failed:`, err?.message);
  });

  return worker;
}
