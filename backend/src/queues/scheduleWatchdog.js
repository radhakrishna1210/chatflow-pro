// Keeps the repeatable BullMQ schedules registered (WF-EV-6).
//
// The recovery sweeps — the workflow and sequence sweeps that resume parked
// runs from the database, the nightly CRM rescore, the agent tick and sweep,
// the daily billing cycle — are repeatable jobs, and they were only ever
// registered at boot. Redis on the deployed plan has no persistence: a Redis
// restart or eviction while the app keeps running wiped them, and with them
// every recovery path, until the next deploy. Workflows and sequences then
// silently stopped resuming.
//
// The watchdog runs in the process that owns the workers (RUN_WORKERS) and,
// every few minutes, checks each expected schedule is still registered and
// re-adds any that are missing. Re-adding is idempotent: every schedule uses
// a fixed job id and repeat options, which BullMQ dedupes.
//
// Redis-only state the schedules cannot bring back, and what covers it:
//  - campaign scheduled sends and retries: `onRestore` re-queues them from the
//    database (recoverScheduledCampaigns / recoverPendingRetries), and the
//    in-process campaign recovery sweep keeps checking;
//  - workflow delays / reply reminders and sequence waits: WorkflowRun.resumeAt
//    and SequenceEnrollment.nextRunAt, picked up by the restored sweeps;
//  - the debounced post-reply lead rescore: the nightly rescore of stale leads;
//  - outgoing-webhook and email retries in flight: not recovered (logged when
//    they fail; the event or email is not replayed).

export const WATCHDOG_INTERVAL_MS = 5 * 60_000;

// What must always be scheduled. Loaded lazily so importing this module does
// not open queue connections (and so tests can pass their own list).
export function expectedSchedules() {
  return [
    {
      label: 'workflow sweep',
      jobName: 'sweep',
      queue: async () => (await import('./workflow.queue.js')).workflowQueue,
      register: async () => (await import('./workflow.queue.js')).startWorkflowSweep(),
    },
    {
      label: 'sequence sweep',
      jobName: 'sweep',
      queue: async () => (await import('./sequence.queue.js')).sequenceQueue,
      register: async () => (await import('./sequence.queue.js')).startSequenceSweep(),
    },
    {
      label: 'CRM nightly maintenance',
      jobName: 'nightly',
      queue: async () => (await import('./crmMaintenance.queue.js')).crmMaintenanceQueue,
      register: async () => (await import('./crmMaintenance.queue.js')).scheduleCrmMaintenance(),
    },
    {
      label: 'agent tick',
      group: 'agent',
      jobName: 'tick',
      queue: async () => (await import('./agent.queue.js')).agentQueue,
      register: async () => (await import('./agent.queue.js')).startAgentSchedules(),
    },
    {
      label: 'agent sweep',
      group: 'agent',
      jobName: 'sweep',
      queue: async () => (await import('./agent.queue.js')).agentQueue,
      register: async () => (await import('./agent.queue.js')).startAgentSchedules(),
    },
    {
      label: 'billing cycle',
      jobName: 'cycle-reset',
      queue: async () => (await import('./billing.queue.js')).billingQueue,
      register: async () => (await import('./billing.queue.js')).scheduleBillingCycleJob(),
    },
  ];
}

// The names of the repeatable jobs a queue currently has. Schedules added with
// `add(..., { repeat })` and with upsertJobScheduler both live in the queue's
// repeat set; getRepeatableJobs reads it on every BullMQ 5.x release, and
// getJobSchedulers on newer ones.
async function scheduledNames(queue) {
  const read = typeof queue.getRepeatableJobs === 'function'
    ? () => queue.getRepeatableJobs()
    : () => queue.getJobSchedulers();
  const jobs = await read();
  const names = new Set();
  for (const job of jobs ?? []) {
    if (job?.name) names.add(job.name);
    // Older repeat keys are "name:jobId:endDate:tz:pattern".
    else if (typeof job?.key === 'string') names.add(job.key.split(':')[0]);
  }
  return names;
}

/**
 * Re-adds every expected schedule that is missing. Never throws; returns the
 * labels it restored and the ones it could not check or restore.
 */
export async function ensureSchedules(entries = expectedSchedules()) {
  const restored = [];
  const failed = [];
  const namesByQueue = new Map();
  const registered = new Set();

  for (const entry of entries) {
    try {
      const queue = await entry.queue();
      if (!namesByQueue.has(queue)) namesByQueue.set(queue, await scheduledNames(queue));
      if (namesByQueue.get(queue).has(entry.jobName)) continue;

      // Two entries can share one registration (the agent's tick and sweep).
      const key = entry.group ?? entry.label;
      if (!registered.has(key)) {
        await entry.register();
        registered.add(key);
      }
      restored.push(entry.label);
    } catch (err) {
      failed.push(entry.label);
      console.error(`[Watchdog] Could not check or restore the ${entry.label} schedule:`, err.message);
    }
  }

  if (restored.length) {
    console.warn(`[Watchdog] Re-registered missing schedule(s): ${restored.join(', ')} — Redis lost its data since they were added.`);
  }
  return { restored, failed };
}

let timer = null;
let running = false;

/**
 * Starts the periodic check. `onRestore` runs after any schedule had to be
 * re-added — the sign that Redis was wiped — to bring back other Redis-only
 * work from the database (see the server's campaign recovery).
 */
export function startScheduleWatchdog({ intervalMs = WATCHDOG_INTERVAL_MS, entries, onRestore } = {}) {
  if (timer) return timer;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const { restored } = await ensureSchedules(entries ?? expectedSchedules());
      if (restored.length && onRestore) {
        await Promise.resolve(onRestore(restored)).catch((err) => console.error('[Watchdog] Recovery after a Redis wipe failed:', err.message));
      }
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}

export function stopScheduleWatchdog() {
  if (timer) clearInterval(timer);
  timer = null;
}
