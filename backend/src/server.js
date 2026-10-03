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
import { startCampaignWorker, stopCampaignSends } from './workers/campaign.worker.js';
import { startEmailWorker } from './workers/email.worker.js';
import { startBillingWorker } from './workers/billing.worker.js';
import { startWorkflowWorker } from './workers/workflow.worker.js';
import { startSequenceWorker } from './workers/sequence.worker.js';
import { startSequenceSweep } from './queues/sequence.queue.js';
import { startAgentWorker } from './workers/agent.worker.js';
import { startWebhookWorker } from './workers/webhook.worker.js';
import { startOutgoingWebhookWorker } from './workers/outgoingWebhook.worker.js';
import { agentQueue, startAgentSchedules } from './queues/agent.queue.js';
import { startCrmMaintenanceWorker } from './workers/crmMaintenance.worker.js';
import { crmMaintenanceQueue, scheduleCrmMaintenance } from './queues/crmMaintenance.queue.js';
import { recoverScheduledCampaigns } from './services/campaigns.service.js';
import { recoverPendingRetries } from './services/retry.service.js';
import { recoverStrandedCampaigns, startCampaignRecoverySweep } from './services/campaignRecovery.service.js';
import { runBillingCycleSweep } from './services/subscription.service.js';
import { runAddonRenewalSweep } from './services/addons.service.js';
import { syncIndex as syncSiteKnowledge } from './services/siteKnowledge.service.js';
import { campaignQueue } from './queues/campaign.queue.js';
import { closeRealtimeStreams } from './services/realtime.service.js';
import { closeRealtimeBus } from './lib/realtimeBus.js';
import { emailQueue } from './queues/email.queue.js';
import { billingQueue, scheduleBillingCycleJob } from './queues/billing.queue.js';
import { startScheduleWatchdog, stopScheduleWatchdog } from './queues/scheduleWatchdog.js';
import { workflowQueue } from './queues/workflow.queue.js';
import { sequenceQueue } from './queues/sequence.queue.js';
import { webhookQueue } from './queues/webhook.queue.js';
import { outgoingWebhookQueue } from './queues/outgoingWebhook.queue.js';
import { prisma } from './lib/prisma.js';
import { loadPlatformSettings, startPlatformSettingsRefresh } from './services/platformSettings.service.js';
import { redis, assertRedisHealthy } from './lib/redis.js';
import { markReady, markNotReady } from './lib/readiness.js';
import { warnIfNoWebhookConsumer } from './lib/webhookConsumers.js';
import { storage, ephemeralDiskWarning } from './lib/storage/index.js';

let campaignWorker = null;
let emailWorker = null;
let billingWorker = null;
let workflowWorker = null;
let agentWorker = null;
let sequenceWorker = null;
let webhookWorker = null;
let outgoingWebhookWorker = null;
let crmMaintenanceWorker = null;
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
      // Keep in sync with scripts/seed-plans.js. Only used to create a plan
      // that is missing; existing rows (and super-admin edits) are left alone.
      features: { automation: true, workflows: true, fallback: true, voice: true },
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
      features: { automation: true, workflows: true, aiOnboarding: true, integrations: true, campaignAi: true, fallback: true, voice: true, autonomousAgent: true },
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
      features: { automation: true, workflows: true, aiOnboarding: true, integrations: true, campaignAi: true, fallback: true, voice: true, autonomousAgent: true },
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
      // Insert-if-missing: overwriting here reverted every super-admin plan
      // edit on each restart. Re-seed deliberately with seed-plans.js --force.
      const result = await prisma.plan.upsert({
        where: { key },
        update: {},
        create: { key, ...data },
      });
      planByKey.set(result.key, result);
      console.log(`[Init] Ensured plan: ${result.key}`);
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

    // Runs on every boot, so it reads only workspaces still missing a
    // subscription, only the two columns it uses, and in id-ordered pages —
    // never every tenant's full row (tokens, prompts) at once.
    const BACKFILL_PAGE = 500;
    let created = 0;
    const CYCLE_DAYS = 30;
    let afterId;
    for (;;) {
      const page = await prisma.workspace.findMany({
        where: { subscription: { is: null }, ...(afterId ? { id: { gt: afterId } } : {}) },
        select: { id: true, plan: true },
        orderBy: { id: 'asc' },
        take: BACKFILL_PAGE,
      });
      if (page.length === 0) break;
      afterId = page[page.length - 1].id;

      for (const ws of page) {
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
      if (page.length < BACKFILL_PAGE) break;
    }

    console.log(`[Init] Subscription initialization done. Created ${created} subscription(s).`);
  } catch (err) {
    console.error('[Init] Subscription initialization failed:', err);
  }
}

async function main() {
  // Unset, NODE_ENV falls back to development: boot migrations are skipped,
  // a missing Redis is tolerated and 500s carry internal error detail. A
  // server has to say which environment it is in.
  if (!process.env.NODE_ENV) {
    console.error('[Server] NODE_ENV is not set — refusing to start. Use NODE_ENV=production on servers, development locally.');
    process.exit(1);
  }
  if (!env.SERVE_HTTP && !env.RUN_WORKERS) {
    console.error('[Worker] RUN_WORKERS=false in a worker-only process — nothing to run, exiting.');
    process.exit(1);
  }

  // File storage. A half-configured bucket is refused outright (every media
  // write would fail later, one message at a time); local disk on Render is
  // allowed but announced loudly, since each deploy wipes it.
  try {
    console.log(`[Storage] Files are stored in ${storage.describe()}`);
  } catch (err) {
    console.error(`[Storage] ${err.message}`);
    if (env.NODE_ENV === 'production') process.exit(1);
  }
  const storageWarning = ephemeralDiskWarning(process.env);
  if (storageWarning) console.error(storageWarning);

  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const prismaCliPath = path.resolve(__dirname, '../scripts/prisma-cli.js');
    console.log('[Migration] Running auto-migrations...');
    if (process.env.NODE_ENV !== 'development') {
      execFileSync(process.execPath, [prismaCliPath, 'migrate', 'deploy'], {
        stdio: 'inherit'
      });
      console.log('[Migration] Auto-migrations completed successfully.');
    } else {
      console.log('[Migration] Skipped migrate deploy in development (use db push).');
    }
  } catch (err) {
    // Serving on a schema the code does not match turns every request that
    // touches a new column into a 500 behind a "healthy" process. Exit so the
    // orchestrator keeps the previous release instead.
    console.error('[Migration] Failed to run migration — refusing to start:', err.message);
    logToFileSync('Migration failed', err);
    process.exit(1);
  }

  let connected = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await prisma.$connect();
      connected = true;
      console.log('[DB] Connected to PostgreSQL');
      break;
    } catch (err) {
      console.warn(`[DB] Connection attempt ${attempt}/5 failed: ${err.message}`);
      if (attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  if (!connected) {
    console.error('[DB] Connection failed after 5 attempts.');
    process.exit(1);
  }

  try {
    // Before anything reads a credential: platform keys stored in the database
    // override the environment, and every client below is built from `env`.
    await loadPlatformSettings();
    startPlatformSettingsRefresh();
  } catch (err) {
    console.error('[DB] Post-connect initialization failed:', err.message);
  }

  // Listen as soon as the schema and credentials are in place. The rest of
  // boot (backfill, Redis, workers, recovery, sweeps) can take a while, and a
  // dark port made deploy health checks time out on a healthy release;
  // /health/ready answers 503 until markReady() below.
  if (env.SERVE_HTTP) {
    httpServer = app.listen(env.PORT, () => {
      console.log(`[Server] Spandan backend running on port ${env.PORT}`);
      console.log(`[Server] Environment: ${env.NODE_ENV}`);
    });
  } else {
    console.log(`[Worker] Worker-only process (no HTTP). Environment: ${env.NODE_ENV}`);
  }

  // The plan upsert and subscription backfill write to the shared database,
  // so only the process that owns background work runs them.
  if (env.RUN_WORKERS) await initializeSubscriptions();

  // Website assistant knowledge index. Deliberately not awaited: it embeds
  // whatever content changed since the last boot, which is a network round
  // trip per batch, and no request needs it to have finished — the chatbot is
  // the only reader and it degrades to lexical search on a partial index.
  // Holding the listen() call behind it would delay every other route on a
  // slow or rate-limited embedding provider.
  if (env.RUN_WORKERS) {
    syncSiteKnowledge().catch((err) => {
      console.error('[siteKnowledge] initial index sync failed:', err.message);
    });
  }

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
    console.warn('  │ Disabled: campaign sending, retries, queued emails (invites, │');
    console.warn('  │ notifications), workflow execution and billing-cycle sweeps. │');
    console.warn('  │ Launching a campaign will queue nothing and send nothing.    │');
    console.warn('  │                                                              │');
    console.warn(`  │ REDIS_URL = ${String(env.REDIS_URL || '').replace(/:[^:@/]*@/, ':****@').padEnd(48).slice(0, 48)} │`);
    console.warn('  │ Start a Redis on that address to enable them.                │');
    console.warn('  └──────────────────────────────────────────────────────────────┘');
    console.warn('');
  }

  if (!env.RUN_WORKERS) {
    console.log('[Worker] RUN_WORKERS=false — workers, schedules, recovery and sweeps are left to the owning deployment.');
  }

  if (redisReady && env.RUN_WORKERS) {
    campaignWorker = startCampaignWorker();
    console.log('[Worker] Campaign worker started');
    emailWorker = startEmailWorker();
    console.log('[Worker] Email worker started');
    billingWorker = startBillingWorker();
    console.log('[Worker] Billing worker started');
    workflowWorker = startWorkflowWorker();
    console.log('[Worker] Workflow worker started');
    sequenceWorker = startSequenceWorker();
    console.log('[Worker] Sequence worker started');
    agentWorker = startAgentWorker();
    webhookWorker = startWebhookWorker();
    outgoingWebhookWorker = startOutgoingWebhookWorker();
    console.log('[Worker] Webhook worker started');
    crmMaintenanceWorker = startCrmMaintenanceWorker();

    // The autonomous agent's tick and sweep. Failing to schedule them must not
    // stop the server — the rest of the product works without the agent.
    try {
      await startAgentSchedules();
    } catch (err) {
      console.error('[Agent] Could not schedule the agent:', err.message);
    }

    // The repeating sweep is what recovers enrollments whose delayed job was
    // lost with Redis — nextRunAt lives in the database, so nothing strands.
    try {
      await startSequenceSweep();
    } catch (err) {
      console.error('[Sequence] Could not schedule the sweep:', err.message);
    }

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

    // Nightly quote expiry and lead score/category refresh.
    try {
      await scheduleCrmMaintenance();
    } catch (err) {
      console.error('[CrmMaintenance] Could not schedule the nightly sweep:', err.message);
    }
    // RUNNING (and charged-but-unstarted) campaigns whose job died with the
    // previous process; the sweep then repeats while the server is up.
    try {
      const stranded = await recoverStrandedCampaigns();
      if (stranded.requeued || stranded.completed) console.log(`[Recovery] Stranded campaigns: requeued=${stranded.requeued} completed=${stranded.completed}`);
    } catch (err) {
      console.error('[Recovery] Stranded-campaign recovery failed:', err.message);
    }
    startCampaignRecoverySweep();

    // Register the daily repeatable billing-cycle job (no-op if already registered).
    try {
      await scheduleBillingCycleJob();
    } catch (err) {
      console.error('[Billing] Failed to schedule the daily cycle-reset job:', err.message);
    }

    // The schedules above live only in Redis. If Redis loses its data while
    // this process runs, the watchdog re-adds them within minutes and
    // re-queues campaign work from the database, instead of every recovery
    // sweep staying gone until the next deploy.
    startScheduleWatchdog({
      onRestore: async () => {
        const recovered = await recoverScheduledCampaigns();
        const retries = await recoverPendingRetries();
        if (recovered || retries) console.log(`[Recovery] After a Redis wipe: re-queued ${recovered} scheduled campaign(s), ${retries} pending retry job(s)`);
      },
    });
  }

  // A production web process that queues webhooks needs a worker somewhere to
  // consume them (WF-IN-13). Checked after a short delay so this process's own
  // worker, if it started one, has registered with Redis.
  if (redisReady && env.NODE_ENV === 'production') {
    setTimeout(() => { warnIfNoWebhookConsumer().catch(() => {}); }, 10_000).unref();
  }

  markReady();
  console.log('[Server] Ready');

  // Run the overdue-subscription sweep once immediately on boot, so cycles
  // missed while the server was down are caught up without waiting for the
  // next 02:00 tick — mirrors recoverScheduledCampaigns() above.
  if (env.RUN_WORKERS) {
    try {
      const result = await runBillingCycleSweep();
      if (result.processed > 0) {
        console.log(`[Recovery] Billing cycle sweep: processed=${result.processed} renewed=${result.renewed} cancelled=${result.cancelled} failed=${result.failed}`);
      }
    } catch (err) {
      console.error('[Recovery] Billing cycle sweep failed:', err.message);
    }
    try {
      const addons = await runAddonRenewalSweep();
      if (addons.processed > 0) {
        console.log(`[Recovery] Add-on renewal sweep: processed=${addons.processed} renewed=${addons.renewed} expired=${addons.expired} unpaid=${addons.unpaid} failed=${addons.failed}`);
      }
    } catch (err) {
      console.error('[Recovery] Add-on renewal sweep failed:', err.message);
    }
  }
}

main().catch((err) => {
  console.error('[Server] Fatal error:', err);
  logToFileSync('Fatal Startup Error', err);
  process.exit(1);
});

// Graceful shutdown — close workers first so in-flight jobs finish (or are
// released back to the queue) before connections are torn down. Prevents
// half-processed campaigns and double sends on redeploys. A campaign send loop
// is told to stop at once: it finishes the recipient in flight, releases its
// unsent claims and queues a resume job for the next worker (CF-099), so the
// active job ends in about one send rather than the whole recipient list.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Server] ${signal} received — shutting down gracefully`);
  markNotReady();
  stopCampaignSends();
  stopScheduleWatchdog();
  const timeout = setTimeout(() => {
    console.error('[Server] Shutdown timed out — forcing exit');
    process.exit(1);
  }, 25_000);

  try {
    // Open event streams never end by themselves, and close() waits for them.
    closeRealtimeStreams();
    if (httpServer) await new Promise((res) => httpServer.close(res));
    await Promise.allSettled([
      campaignWorker?.close(),
      emailWorker?.close(),
      billingWorker?.close(),
      workflowWorker?.close(),
      sequenceWorker?.close(),
      webhookWorker?.close(),
      outgoingWebhookWorker?.close(),
      crmMaintenanceWorker?.close(),
      agentWorker?.close(),
    ]);
    await Promise.allSettled([campaignQueue.close(), emailQueue.close(), billingQueue.close(), workflowQueue.close(), sequenceQueue.close(), webhookQueue.close(), outgoingWebhookQueue.close(), crmMaintenanceQueue.close(), agentQueue.close()]);
    await Promise.allSettled([closeRealtimeBus(), redis.quit()]);
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

