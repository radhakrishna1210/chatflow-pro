import { Queue } from 'bullmq';
import { createBullConnection } from '../lib/redis.js';

export const campaignQueue = new Queue('campaigns', {
  connection: createBullConnection('campaign-queue'),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});
