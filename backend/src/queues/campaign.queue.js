import { Queue } from 'bullmq';
import { redis } from '../lib/redis.js';

export const campaignQueue = new Queue('campaigns', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});
