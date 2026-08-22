import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logToFile, logToFileSync } from './lib/logger.js';

process.on('uncaughtException', (err) => {
  logToFileSync('Uncaught Exception', err);
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logToFile('Unhandled Rejection', err);
  console.error('Unhandled Rejection:', err);
});

logToFile('Server starting up...');


import app from './app.js';
import { env } from './config/env.js';
import { startCampaignWorker } from './workers/campaign.worker.js';
import { startEmailWorker } from './workers/email.worker.js';
import { startBillingWorker } from './workers/billing.worker.js';
import { startWorkflowWorker } from './workers/workflow.worker.js';
import { recoverScheduledCampaigns } from './services/campaigns.service.js';
import { recoverPendingRetries } from './services/retry.service.js';
import { runBillingCycleSweep } from './services/subscription.service.js';
import { syncIndex as syncSiteKnowledge } from './services/siteKnowledge.service.js';
import { campaignQueue } from './queues/campaign.queue.js';
import { emailQueue } from './queues/email.queue.js';
import { billingQueue, scheduleBillingCycleJob } from './queues/billing.queue.js';
import { workflowQueue } from './queues/workflow.queue.js';
import { prisma } from './lib/prisma.js';
import { loadPlatformSettings } from './services/platformSettings.service.js';
import { redis, assertRedisHealthy } from './lib/redis.js';

let campaignWorker = null;
let emailWorker = null;
let billingWorker = null;
let workflowWorker = null;
let httpServer = null;

async function initializeSubscriptions() {
  const PLANS = [
    {
      key: 'FREE',
      name: 'Free',
      priceMonthly: 0,
      priceQuarterly: null,
      currency: 'INR',
      messageQuota: 100,
      contactLimit: 100,
      memberLimit: 1,
      campaignLimit: null,
      apiKeyLimit: 1,
      // Flat rate for a send with no template category (an inbox reply).
      overageRatePerMsg: 0.02,
      // Free pays a markup on over-quota template sends — 2x cost, mirroring
      // the 2x ratio Free already carried against the paid tiers. Basic and
      // Growth leave this null and are charged cost (lib/messagePricing.js).
      overageRates: { MARKETING: 2.18, UTILITY: 0.32, AUTHENTICATION: 0.26 },
      // Keep in sync with scripts/seed-plans.js — this list is upserted on
      // every boot, so a change made only there would be overwritten.
      features: { automation: true, workflows: true },
    },
    // Basic carries the former Pro limits and features; Growth carries the
    // former Enterprise ones. STARTER/PRO/ENTERPRISE are retired below.
    {
      key: 'BASIC',
      name: 'Basic',
      priceMonthly: 1500,
      priceQuarterly: 3500,
      currency: 'INR',
      messageQuota: 10000,
      contactLimit: null,
      memberLimit: 10,
      campaignLimit: null,
      apiKeyLimit: 10,
      overageRatePerMsg: 0.01,
      // null = charge cost: the shared per-category rates.
      overageRates: null,
      features: { automation: true, workflows: true, aiOnboarding: true, integrations: true },
    },
    {
      key: 'GROWTH',
      name: 'Growth',
      priceMonthly: 2500,
      priceQuarterly: 7500,
      currency: 'INR',
      messageQuota: -1,
      contactLimit: null,
      memberLimit: null,
      campaignLimit: null,
      apiKeyLimit: null,
      overageRatePerMsg: 0.008,
      overageRates: null,
      features: { automation: true, workflows: true, aiOnboarding: true, integrations: true },
    },
  ];

  // Plans the catalog no longer sells. They are deactivated rather than
  // deleted because Subscription.planId still references them, and any
  // workspace left on one is moved onto its successor so nobody is stranded
  // on a plan that can no longer be renewed or displayed. Each retired tier
  // maps to the plan that inherited its limits and features, so the move
  // costs no capability.
  const RETIRED_PLAN_SUCCESSOR = { STARTER: 'BASIC', PRO: 'BASIC', ENTERPRISE: 'GROWTH' };
  const RETIRED_PLAN_KEYS = Object.keys(RETIRED_PLAN_SUCCESSOR);

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

    // Retire the old paid tiers: move their subscribers onto the successor
    // plan first, so no subscription is left pointing at an inactive plan,
    // then deactivate.
    const retired = await prisma.plan.findMany({
      where: { key: { in: RETIRED_PLAN_KEYS } },
      select: { id: true, key: true },
    });
    if (retired.length > 0) {
      const movedPerPlan = [];
      for (const oldPlan of retired) {
        const successor = planByKey.get(RETIRED_PLAN_SUCCESSOR[oldPlan.key]);
        if (!successor) continue;
        const moved = await prisma.subscription.updateMany({
          where: { planId: oldPlan.id },
          data: { planId: successor.id },
        });
        if (moved.count > 0) movedPerPlan.push(`${moved.count} ${oldPlan.key}→${successor.key}`);
      }

      const retiredIds = retired.map((p) => p.id);
      // A scheduled change to a retired plan can never be applied either.
      const clearedPending = await prisma.subscription.updateMany({
        where: { pendingPlanId: { in: retiredIds } },
        data: { pendingPlanId: null },
      });
      await prisma.plan.updateMany({
        where: { id: { in: retiredIds }, isActive: true },
        data: { isActive: false },
      });
      if (movedPerPlan.length > 0 || clearedPending.count > 0) {
        console.log(`[Init] Retired ${retired.map((p) => p.key).join(', ')} — moved ${movedPerPlan.join(', ') || 'none'}, cleared ${clearedPending.count} pending change(s).`);
      }
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
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const prismaCliPath = path.resolve(__dirname, '../scripts/prisma-cli.js');
    console.log('[Migration] Running auto-migrations...');
    execFileSync(process.execPath, [prismaCliPath, 'migrate', 'deploy'], {
      stdio: 'inherit'
    });
    console.log('[Migration] Auto-migrations completed successfully.');
  } catch (err) {
    console.error('[Migration] Failed to run migration:', err);
  }

  try {
    await prisma.$connect();
    console.log('[DB] Connected to PostgreSQL');
    // Before anything reads a credential: platform keys stored in the database
    // override the environment, and every client below is built from `env`.
    await loadPlatformSettings();
    await initializeSubscriptions();
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  }

  // Website assistant knowledge index. Deliberately not awaited: it embeds
  // whatever content changed since the last boot, which is a network round
  // trip per batch, and no request needs it to have finished — the chatbot is
  // the only reader and it degrades to lexical search on a partial index.
  // Holding the listen() call behind it would delay every other route on a
  // slow or rate-limited embedding provider.
  syncSiteKnowledge().catch((err) => {
    console.error('[siteKnowledge] initial index sync failed:', err.message);
  });

  // Redis backs every queue, so production must not start without it — a
  // server that accepts campaign launches it can never process is worse than
  // one that refuses to boot. Locally it is routine not to have Redis running,
  // and hard-exiting there means the whole app is unusable for UI and API work
  // that needs no queue at all. So development degrades instead, loudly.
  let redisReady = false;
  try {
    await assertRedisHealthy();
    redisReady = true;
    console.log('[Redis] Connected');
  } catch (err) {
    console.error('[Redis] Health check failed:', err.message);
    if (env.NODE_ENV === 'production') {
      console.error('[Redis] Campaign and email queues will NOT work until Redis is reachable.');
      process.exit(1);
    }
    console.warn('');
    console.warn('  ┌─ DEGRADED START ────────────────────────────────────────────┐');
    console.warn('  │ Redis is unreachable, so no background workers are running.  │');
    console.warn('  │                                                              │');
    console.warn('  │ Disabled: campaign sending, retries, emails (incl. invites   │');
    console.warn('  │ and OTPs), workflow execution and billing-cycle sweeps.      │');
    console.warn('  │ Launching a campaign will queue nothing and send nothing.    │');
    console.warn('  │                                                              │');
    console.warn(`  │ REDIS_URL = ${String(env.REDIS_URL || '').replace(/:[^:@/]*@/, ':****@').padEnd(48).slice(0, 48)} │`);
    console.warn('  │ Start a Redis on that address to enable them.                │');
    console.warn('  └──────────────────────────────────────────────────────────────┘');
    console.warn('');
  }

  if (redisReady) {
    campaignWorker = startCampaignWorker();
    console.log('[Worker] Campaign worker started');
    emailWorker = startEmailWorker();
    console.log('[Worker] Email worker started');
    billingWorker = startBillingWorker();
    console.log('[Worker] Billing worker started');
    workflowWorker = startWorkflowWorker();
    console.log('[Worker] Workflow worker started');

    // Re-queue SCHEDULED campaigns whose jobs were lost (server/Redis restart).
    try {
      const recovered = await recoverScheduledCampaigns();
      if (recovered > 0) console.log(`[Recovery] Re-queued ${recovered} scheduled campaign(s)`);
    } catch (err) {
      console.error('[Recovery] Scheduled-campaign recovery failed:', err.message);
    }

    // Delayed retry jobs live only in Redis, which has no persistence on the
    // deployed plan — without this, every retry waiting at restart is lost and
    // its campaign hangs in RUNNING, unsettled, forever.
    try {
      const retries = await recoverPendingRetries();
      if (retries > 0) console.log(`[Recovery] Re-queued ${retries} pending retry job(s)`);
    } catch (err) {
      console.error('[Recovery] Pending-retry recovery failed:', err.message);
    }

    // Register the daily repeatable billing-cycle job (no-op if already registered).
    try {
      await scheduleBillingCycleJob();
    } catch (err) {
      console.error('[Billing] Failed to schedule the daily cycle-reset job:', err.message);
    }
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
  logToFileSync('Fatal Startup Error', err);
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
      workflowWorker?.close(),
    ]);
    await Promise.allSettled([campaignQueue.close(), emailQueue.close(), billingQueue.close(), workflowQueue.close()]);
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
