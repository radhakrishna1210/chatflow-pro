import { Queue } from 'bullmq';
import { createBullConnection } from '../lib/redis.js';

// CRM upkeep that depends on time passing rather than on a user action:
//  - `nightly`: expire overdue quotes and refresh stale lead scores/categories
//  - `contact-rescore`: refresh one contact's lead after an inbound message
//  - `import-followup`: score, categorise and distribute leads from a CSV import
export const crmMaintenanceQueue = new Queue('crm-maintenance', {
  connection: createBullConnection('crm-maintenance-queue'),
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

crmMaintenanceQueue.on('error', () => {});

// A burst of messages from one contact collapses into a single rescore: while
// a delayed job with this id exists, BullMQ ignores further adds.
export const RESCORE_DEBOUNCE_MS = 60_000;

export async function enqueueContactRescore(workspaceId, contactId) {
  return crmMaintenanceQueue.add('contact-rescore', { workspaceId, contactId }, {
    jobId: `rescore-${workspaceId}-${contactId}`,
    delay: RESCORE_DEBOUNCE_MS,
    removeOnComplete: true,
    removeOnFail: true,
  });
}

export async function enqueueImportFollowUp(workspaceId, leadIds, { distribute = true } = {}) {
  return crmMaintenanceQueue.add('import-followup', { workspaceId, leadIds, distribute });
}

export async function scheduleCrmMaintenance() {
  // repeat + a fixed jobId keeps exactly one nightly run per deployment.
  return crmMaintenanceQueue.add('nightly', {}, {
    jobId: 'crm-nightly',
    repeat: { pattern: '30 3 * * *' },
    removeOnComplete: true,
    removeOnFail: true,
  });
}
