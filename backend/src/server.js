

import app from './app.js';
import { env } from './config/env.js';
import { startCampaignWorker } from './workers/campaign.worker.js';
import { startEmailWorker } from './workers/email.worker.js';
import { recoverScheduledCampaigns } from './services/campaigns.service.js';
import { campaignQueue } from './queues/campaign.queue.js';
import { emailQueue } from './queues/email.queue.js';
import { prisma } from './lib/prisma.js';
import { redis, assertRedisHealthy } from './lib/redis.js';

let campaignWorker = null;
let emailWorker = null;
let httpServer = null;

async function main() {
  try {
    await prisma.$connect();
    console.log('[DB] Connected to PostgreSQL');
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  }

  try {
    await assertRedisHealthy();
    console.log('[Redis] Connected');
  } catch (err) {
    console.error('[Redis] Health check failed:', err.message);
    console.error('[Redis] Campaign and email queues will NOT work until Redis is reachable.');
    process.exit(1);
  }

  campaignWorker = startCampaignWorker();
  console.log('[Worker] Campaign worker started');
  emailWorker = startEmailWorker();
  console.log('[Worker] Email worker started');

  // Re-queue SCHEDULED campaigns whose jobs were lost (server/Redis restart).
  try {
    const recovered = await recoverScheduledCampaigns();
    if (recovered > 0) console.log(`[Recovery] Re-queued ${recovered} scheduled campaign(s)`);
  } catch (err) {
    console.error('[Recovery] Scheduled-campaign recovery failed:', err.message);
  }

  httpServer = app.listen(env.PORT, () => {
    console.log(`[Server] ChatFlow Pro backend running on port ${env.PORT}`);
    console.log(`[Server] Environment: ${env.NODE_ENV}`);
  });
}

main().catch((err) => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});

// Graceful shutdown — close workers first so in-flight jobs finish (or are
// released back to the queue) before connections are torn down. Prevents
// half-processed campaigns and double sends on redeploys.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Server] ${signal} received — shutting down gracefully`);
  const timeout = setTimeout(() => {
    console.error('[Server] Shutdown timed out — forcing exit');
    process.exit(1);
  }, 25_000);

  try {
    if (httpServer) await new Promise((res) => httpServer.close(res));
    await Promise.allSettled([
      campaignWorker?.close(),
      emailWorker?.close(),
    ]);
    await Promise.allSettled([campaignQueue.close(), emailQueue.close()]);
    await Promise.allSettled([redis.quit()]);
    await prisma.$disconnect();
    clearTimeout(timeout);
    console.log('[Server] Shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('[Server] Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
