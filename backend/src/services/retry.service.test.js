import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Prisma and the queue are mocked, so this needs neither a database nor Redis.

let recipients;
let jobs;
let added;
let removed;
let countWhere;

const NOW = new Date('2026-10-02T12:00:00Z');
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60_000);

const test1 = (row, cond) => Object.entries(cond).every(([k, v]) => {
  if (k === 'OR') return v.some((c) => test1(row, c));
  if (k === 'AND') return v.every((c) => test1(row, c));
  if (k === 'campaign') return v.status === undefined || row.campaignStatus === v.status;
  if (v === null) return row[k] == null;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('in' in v) return v.in.includes(row[k]);
    if ('not' in v) return row[k] != null && row[k] !== v.not;
    if ('lt' in v) return row[k] != null && row[k] < v.lt;
    return true;
  }
  return row[k] === v;
});

const prisma = {
  campaignRecipient: {
    updateMany: async ({ where, data }) => {
      const hit = recipients.filter((r) => test1(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    findMany: async ({ where }) => recipients.filter((r) => test1(r, where)).map((r) => ({
      id: r.id, retryCount: r.retryCount, nextRetryAt: r.nextRetryAt,
      campaign: { id: r.campaignId, workspaceId: 'w1' },
    })),
    count: async ({ where }) => { countWhere = where; return recipients.filter((r) => test1(r, where)).length; },
  },
  campaign: { updateMany: async () => ({ count: 0 }) },
};

const campaignQueue = {
  getJob: async (id) => (jobs[id] ? { getState: async () => jobs[id], remove: async () => { removed.push(id); delete jobs[id]; } } : null),
  add: async (name, data, opts) => { added.push({ name, data, opts }); jobs[opts.jobId] = 'delayed'; return { id: opts.jobId }; },
};

const here = (rel) => new URL(rel, import.meta.url).href;
mock.module(here('../lib/prisma.js'), { namedExports: { prisma } });
mock.module(here('../queues/campaign.queue.js'), { namedExports: { campaignQueue } });
mock.module(here('./email.service.js'), { namedExports: { queueCampaignCompletedEmail: async () => {} } });
mock.module(here('./fallback.service.js'), { namedExports: { runFallbackForRecipient: async () => null } });
mock.module(here('./notification.service.js'), { namedExports: { notifyWorkspace: async () => {}, notifyWorkspaceGrouped: async () => {} } });
mock.module(here('./campaignBilling.service.js'), { namedExports: { markRecipientNotCharged: async () => {} } });

const { recoverPendingRetries, enqueueRetryJob, checkAndCompleteCampaign, retryJobId } = await import('./retry.service.js');

beforeEach(() => {
  recipients = [];
  jobs = {};
  added = [];
  removed = [];
  countWhere = null;
});

const row = (id, extra = {}) => ({
  id, campaignId: 'c1', campaignStatus: 'RUNNING', status: 'RETRYING', retryStatus: 'SCHEDULED',
  retryCount: 1, nextRetryAt: minutesAgo(1), lastRetryAt: minutesAgo(60), ...extra,
});

test('a retry whose job is gone is re-queued with the id handleRecipientFailure used', async () => {
  recipients.push(row('r1'));
  const n = await recoverPendingRetries({ now: NOW });
  assert.equal(n, 1);
  assert.equal(added[0].opts.jobId, retryJobId('r1', 2));
  assert.equal(added[0].opts.delay, 0);
});

test('a retry whose job is still delayed is left alone', async () => {
  recipients.push(row('r1'));
  jobs[retryJobId('r1', 2)] = 'delayed';
  assert.equal(await recoverPendingRetries({ now: NOW }), 0);
  assert.equal(added.length, 0);
});

test('a finished job with the same id is replaced, not silently deduplicated', async () => {
  // The retry fired while the campaign was paused, skipped, and completed.
  recipients.push(row('r1'));
  jobs[retryJobId('r1', 2)] = 'completed';
  assert.equal(await recoverPendingRetries({ now: NOW }), 1);
  assert.deepEqual(removed, [retryJobId('r1', 2)]);
});

test('a fresh IN_PROGRESS claim is never stolen; a stale one is handed back and re-queued', async () => {
  recipients.push(
    row('fresh', { retryStatus: 'IN_PROGRESS', lastRetryAt: minutesAgo(1) }),
    row('stale', { retryStatus: 'IN_PROGRESS', lastRetryAt: minutesAgo(30) }),
  );
  await recoverPendingRetries({ now: NOW });
  assert.equal(recipients[0].retryStatus, 'IN_PROGRESS');
  assert.equal(recipients[1].retryStatus, 'SCHEDULED');
  assert.deepEqual(added.map((a) => a.data.recipientId), ['stale']);
});

test('the periodic pass skips PAUSED campaigns; a resume (campaignId) includes them', async () => {
  recipients.push(row('r1', { campaignStatus: 'PAUSED' }));
  assert.equal(await recoverPendingRetries({ now: NOW }), 0);
  assert.equal(await recoverPendingRetries({ now: NOW, campaignId: 'c1' }), 1);
});

test('retries due far in the future wait for a later pass, except on resume', async () => {
  recipients.push(row('r1', { nextRetryAt: new Date(NOW.getTime() + 6 * 60 * 60_000) }));
  assert.equal(await recoverPendingRetries({ now: NOW }), 0);
  assert.equal(await recoverPendingRetries({ now: NOW, campaignId: 'c1' }), 1);
  assert.ok(added[0].opts.delay > 0, 'the original delay is kept');
});

test('enqueueRetryJob is a no-op while the job is still waiting', async () => {
  jobs[retryJobId('r1', 3)] = 'waiting';
  const r = await enqueueRetryJob({ campaignId: 'c1', workspaceId: 'w1', recipientId: 'r1', attempt: 3 });
  assert.equal(r.queued, false);
  assert.equal(added.length, 0);
});

test('a campaign with a recipient mid-send is not completed', async () => {
  recipients.push(row('r1', { status: 'SENDING' }));
  assert.equal(await checkAndCompleteCampaign('c1'), false);
  assert.ok(countWhere.status.in.includes('SENDING'));
});
