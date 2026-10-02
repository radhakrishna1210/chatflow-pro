import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Prisma and the queue are mocked, so this needs neither a database nor Redis.

let campaigns;
let recipients;
let jobs;
let added;
let completed;
let findManyArgs;

const matches = (row, where) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('in' in v) return v.in.includes(row[k]);
    if ('not' in v) return row[k] !== v.not;
    if ('lt' in v) return row[k] < v.lt;
    return true;
  }
  return row[k] === v;
});

const prisma = {
  campaign: {
    findMany: async (args) => {
      findManyArgs = args;
      return campaigns
        .filter((c) => args.where.OR.some((branch) => matches(c, branch)))
        .map(({ id, workspaceId, status, queueJobId }) => ({ id, workspaceId, status, queueJobId }));
    },
    updateMany: async ({ where, data }) => {
      const hit = campaigns.filter((c) => matches(c, where));
      hit.forEach((c) => Object.assign(c, data));
      return { count: hit.length };
    },
  },
  campaignRecipient: {
    groupBy: async ({ where }) => {
      const out = new Map();
      for (const r of recipients.filter((x) => matches(x, where))) {
        const key = `${r.campaignId}|${r.status}`;
        out.set(key, (out.get(key) || 0) + 1);
      }
      return [...out].map(([key, n]) => {
        const [campaignId, status] = key.split('|');
        return { campaignId, status, _count: { _all: n } };
      });
    },
    updateMany: async ({ where, data }) => {
      const hit = recipients.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
  },
};

const campaignQueue = {
  getJob: async (id) => (jobs[id] ? { getState: async () => jobs[id] } : null),
  add: async (name, data, opts) => { added.push({ name, data, opts }); return { id: opts.jobId }; },
};

mock.module(new URL('../lib/prisma.js', import.meta.url).href, { namedExports: { prisma } });
mock.module(new URL('../queues/campaign.queue.js', import.meta.url).href, { namedExports: { campaignQueue } });
mock.module(new URL('./retry.service.js', import.meta.url).href, {
  namedExports: { checkAndCompleteCampaign: async (id) => { completed.push(id); return true; } },
});

const { planCampaignRecovery, recoverStrandedCampaigns, RECOVERY_GRACE_MS } = await import('./campaignRecovery.service.js');

const NOW = new Date('2026-10-02T12:00:00Z');
const stale = new Date(NOW.getTime() - RECOVERY_GRACE_MS - 1000);
const fresh = new Date(NOW.getTime() - 1000);

beforeEach(() => {
  campaigns = [];
  recipients = [];
  jobs = {};
  added = [];
  completed = [];
});

test('plan: a live job always wins', () => {
  assert.equal(planCampaignRecovery({ status: 'RUNNING', jobAlive: true, pending: 10 }), 'skip');
});

test('plan: pending or orphaned sending rows with no job are re-queued', () => {
  assert.equal(planCampaignRecovery({ status: 'RUNNING', jobAlive: false, pending: 3 }), 'requeue');
  assert.equal(planCampaignRecovery({ status: 'RUNNING', jobAlive: false, sending: 1 }), 'requeue');
  assert.equal(planCampaignRecovery({ status: 'DRAFT', jobAlive: false, pending: 3 }), 'requeue');
});

test('plan: retries still owed finish the campaign themselves', () => {
  assert.equal(planCampaignRecovery({ status: 'RUNNING', jobAlive: false, retrying: 2 }), 'skip');
});

test('plan: a RUNNING campaign with nothing left only missed its completion', () => {
  assert.equal(planCampaignRecovery({ status: 'RUNNING', jobAlive: false }), 'complete');
  assert.equal(planCampaignRecovery({ status: 'DRAFT', jobAlive: false }), 'skip');
});

test('a RUNNING campaign whose job is gone is re-queued as a resume, and its orphaned SENDING rows released', async () => {
  campaigns.push({ id: 'c1', workspaceId: 'w1', status: 'RUNNING', queueJobId: 'old', updatedAt: stale });
  jobs.old = 'completed';
  recipients.push(
    { id: 'r1', campaignId: 'c1', status: 'PENDING', sentAt: null },
    { id: 'r2', campaignId: 'c1', status: 'SENDING', sentAt: null },
    { id: 'r3', campaignId: 'c1', status: 'SENDING', sentAt: new Date() },
  );

  const result = await recoverStrandedCampaigns({ now: NOW });

  assert.equal(result.requeued, 1);
  assert.equal(added.length, 1);
  assert.equal(added[0].data.resume, true);
  assert.equal(added[0].opts.jobId, campaigns[0].queueJobId, 'the new job id is recorded on the campaign');
  assert.equal(recipients[1].status, 'PENDING');
  assert.equal(recipients[2].status, 'SENDING', 'a row that reached Meta is never released for a resend');
});

test('a campaign whose job is still queued or running is left alone', async () => {
  campaigns.push({ id: 'c1', workspaceId: 'w1', status: 'RUNNING', queueJobId: 'j1', updatedAt: stale });
  jobs.j1 = 'active';
  recipients.push({ id: 'r1', campaignId: 'c1', status: 'PENDING' });

  const result = await recoverStrandedCampaigns({ now: NOW });
  assert.equal(result.requeued, 0);
  assert.equal(added.length, 0);
});

test('recently touched campaigns are not candidates (grace period)', async () => {
  campaigns.push({ id: 'c1', workspaceId: 'w1', status: 'RUNNING', queueJobId: null, updatedAt: fresh });
  recipients.push({ id: 'r1', campaignId: 'c1', status: 'PENDING' });

  await recoverStrandedCampaigns({ now: NOW });
  assert.equal(added.length, 0);
});

test('a charged DRAFT whose job vanished is re-queued as a fresh launch', async () => {
  campaigns.push({ id: 'c1', workspaceId: 'w1', status: 'DRAFT', chargedAt: stale, queueJobId: 'gone', updatedAt: stale });
  recipients.push({ id: 'r1', campaignId: 'c1', status: 'PENDING' });

  await recoverStrandedCampaigns({ now: NOW });
  assert.equal(added.length, 1);
  assert.equal(added[0].data.resume, false);
});

test('an uncharged DRAFT or a charged one never queued is not touched', async () => {
  campaigns.push(
    { id: 'c1', workspaceId: 'w1', status: 'DRAFT', chargedAt: null, queueJobId: null, updatedAt: stale },
    { id: 'c2', workspaceId: 'w1', status: 'DRAFT', chargedAt: stale, queueJobId: null, updatedAt: stale },
  );
  recipients.push({ id: 'r1', campaignId: 'c1', status: 'PENDING' }, { id: 'r2', campaignId: 'c2', status: 'PENDING' });

  await recoverStrandedCampaigns({ now: NOW });
  assert.equal(added.length, 0);
  assert.ok(findManyArgs.where.OR.some((b) => b.status === 'DRAFT' && b.queueJobId), 'DRAFT branch requires a queued job');
});

test('a RUNNING campaign with nothing outstanding is completed, not re-queued', async () => {
  campaigns.push({ id: 'c1', workspaceId: 'w1', status: 'RUNNING', queueJobId: null, updatedAt: stale });
  recipients.push({ id: 'r1', campaignId: 'c1', status: 'SENT' });

  const result = await recoverStrandedCampaigns({ now: NOW });
  assert.deepEqual(completed, ['c1']);
  assert.equal(result.completed, 1);
  assert.equal(added.length, 0);
});

test('two sweeps racing on the same campaign enqueue exactly once', async () => {
  campaigns.push({ id: 'c1', workspaceId: 'w1', status: 'RUNNING', queueJobId: 'old', updatedAt: stale });
  recipients.push({ id: 'r1', campaignId: 'c1', status: 'PENDING' });

  await Promise.all([
    recoverStrandedCampaigns({ now: NOW }),
    recoverStrandedCampaigns({ now: new Date(NOW.getTime() + 1) }),
  ]);
  assert.equal(added.length, 1);
});
