import { Worker } from 'bullmq';
import { createBullConnection, logRedisError } from '../lib/redis.js';
import { env } from '../config/env.js';
import { runNightlyCrmSweep, refreshLeadScoringForContact } from '../services/crmMaintenance.service.js';

async function processJob(job) {
  if (job.name === 'contact-rescore') {
    const { workspaceId, contactId } = job.data || {};
    if (workspaceId && contactId) await refreshLeadScoringForContact(workspaceId, contactId);
    return;
  }
  if (job.name === 'nightly') {
    const result = await runNightlyCrmSweep();
    console.log(`[CrmMaintenance] Nightly: quotesExpired=${result.expired} leadsRescored=${result.processed} failed=${result.failed}`);
  }
}

export function startCrmMaintenanceWorker() {
  const worker = new Worker('crm-maintenance', processJob, {
    connection: createBullConnection('crm-maintenance-worker'),
    concurrency: 2,
    drainDelay: env.WORKER_DRAIN_DELAY_SEC,
    stalledInterval: env.WORKER_STALLED_INTERVAL_MS,
  });

  worker.on('error', (err) => logRedisError('crm-maintenance-worker', err));
  worker.on('failed', (job, err) => console.error(`[CrmMaintenance] Job ${job?.id} failed:`, err.message));

  return worker;
}
