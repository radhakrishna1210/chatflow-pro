import { Queue } from 'bullmq';
import { createQueueConnection, logRedisError } from '../lib/redis.js';

export const campaignQueue = new Queue('campaigns', {
  connection: createQueueConnection('campaign-queue'),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

campaignQueue.on('error', (err) => logRedisError('campaign-queue', err));
