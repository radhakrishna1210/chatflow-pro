import { Queue } from 'bullmq';
import { createBullConnection } from '../lib/redis.js';

export const emailQueue = new Queue('emails', {
  connection: createBullConnection('email-queue'),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});
