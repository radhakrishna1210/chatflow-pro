import { Queue } from 'bullmq';
import { redis } from '../lib/redis.js';

// Number provisioning (Twilio -> Meta sub-WABA) can take minutes due to OTP polling,
// so it runs off the request thread on this queue. attempts:1 because re-running a
// partially-completed provision could create duplicate WABAs.
export const provisioningQueue = new Queue('provisioning', {
  connection: redis,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 50,
    removeOnFail: 50,
  },
});
