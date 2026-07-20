

import app from './app.js';
import { env } from './config/env.js';
import { startCampaignWorker } from './workers/campaign.worker.js';
import { startEmailWorker } from './workers/email.worker.js';
import { startBillingWorker } from './workers/billing.worker.js';
import { recoverScheduledCampaigns } from './services/campaigns.service.js';
import { runBillingCycleSweep } from './services/subscription.service.js';
import { campaignQueue } from './queues/campaign.queue.js';
import { emailQueue } from './queues/email.queue.js';
import { billingQueue, scheduleBillingCycleJob } from './queues/billing.queue.js';
import { prisma } from './lib/prisma.js';
import { redis, assertRedisHealthy } from './lib/redis.js';

let campaignWorker = null;
let emailWorker = null;
let billingWorker = null;
let httpServer = null;

async function initializeSubscriptions() {
  const PLANS = [
    {
      key: 'FREE',
      name: 'Free',
      priceMonthly: 0,
      messageQuota: 100,
      contactLimit: 100,
      memberLimit: 1,
      campaignLimit: null,
      apiKeyLimit: 1,
      overageRatePerMsg: 0.02,
      features: {},
    },
    {
      key: 'STARTER',
      name: 'Starter',
      priceMonthly: 29,
      messageQuota: 2000,
      contactLimit: 2000,
      memberLimit: 3,
      campaignLimit: null,
      apiKeyLimit: 3,
      overageRatePerMsg: 0.015,
      features: { automation: true },
    },
    {
      key: 'PRO',
      name: 'Pro',
      priceMonthly: 99,
      messageQuota: 10000,
      contactLimit: null,
      memberLimit: 10,
      campaignLimit: null,
      apiKeyLimit: 10,
      overageRatePerMsg: 0.01,
      features: { automation: true, workflows: true, aiOnboarding: true, integrations: true },
    },
    {
      key: 'ENTERPRISE',
      name: 'Enterprise',
      priceMonthly: 299,
      messageQuota: -1,
      contactLimit: null,
      memberLimit: null,
      campaignLimit: null,
      apiKeyLimit: null,
      overageRatePerMsg: 0.008,
      features: { automation: true, workflows: true, aiOnboarding: true, integrations: true },
    },
  ];

  try {
    const planByKey = new Map();
    for (const plan of PLANS) {
      const { key, ...data } = plan;
      const result = await prisma.plan.upsert({
        where: { key },
        update: data,
        create: { key, ...data },
      });
      planByKey.set(result.key, result);
      console.log(`[Init] Upserted plan: ${result.key}`);
    }

    const freePlan = planByKey.get('FREE');
    if (!freePlan) {
      console.error('[Init] FREE plan not found.');
      return;
    }

    const workspaces = await prisma.workspace.findMany({
      include: { subscription: true }
    });

    let created = 0;
    const CYCLE_DAYS = 30;
    for (const ws of workspaces) {
      if (ws.subscription) continue;

      const plan = planByKey.get(ws.plan) || freePlan;
      const currentPeriodStart = new Date();
      const currentPeriodEnd = new Date(currentPeriodStart.getTime() + CYCLE_DAYS * 24 * 60 * 60 * 1000);

      await prisma.subscription.create({
        data: {
          workspaceId: ws.id,
          planId: plan.id,
          status: 'ACTIVE',
          currentPeriodStart,
          currentPeriodEnd,
        },
      });

      await prisma.usageCounter.upsert({
        where: { workspaceId_periodStart: { workspaceId: ws.id, periodStart: currentPeriodStart } },
        update: {},
        create: {
          workspaceId: ws.id,
          periodStart: currentPeriodStart,
          periodEnd: currentPeriodEnd,
          messagesUsed: 0,
        },
      });

      created += 1;
      console.log(`[Init] Backfilled subscription for workspace ${ws.id} -> plan ${plan.key}`);
    }

    console.log(`[Init] Subscription initialization done. Created ${created} subscription(s).`);
  } catch (err) {
    console.error('[Init] Subscription initialization failed:', err);
  }
}

async function main() {
  try {
    await prisma.$connect();
    console.log('[DB] Connected to PostgreSQL');
    await initializeSubscriptions();
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
  billingWorker = startBillingWorker();
  console.log('[Worker] Billing worker started');

  // Re-queue SCHEDULED campaigns whose jobs were lost (server/Redis restart).
  try {
    const recovered = await recoverScheduledCampaigns();
    if (recovered > 0) console.log(`[Recovery] Re-queued ${recovered} scheduled campaign(s)`);
  } catch (err) {
    console.error('[Recovery] Scheduled-campaign recovery failed:', err.message);
  }

  // Register the daily repeatable billing-cycle job (no-op if already registered).
  try {
    await scheduleBillingCycleJob();
  } catch (err) {
    console.error('[Billing] Failed to schedule the daily cycle-reset job:', err.message);
  }

  // Run the overdue-subscription sweep once immediately on boot, so cycles
  // missed while the server was down are caught up without waiting for the
  // next 02:00 tick — mirrors recoverScheduledCampaigns() above.
  try {
    const result = await runBillingCycleSweep();
    if (result.processed > 0) {
      console.log(`[Recovery] Billing cycle sweep: processed=${result.processed} renewed=${result.renewed} cancelled=${result.cancelled} failed=${result.failed}`);
    }
  } catch (err) {
    console.error('[Recovery] Billing cycle sweep failed:', err.message);
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
      billingWorker?.close(),
    ]);
    await Promise.allSettled([campaignQueue.close(), emailQueue.close(), billingQueue.close()]);
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
