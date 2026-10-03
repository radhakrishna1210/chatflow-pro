import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Boot recovery of SCHEDULED campaigns is batched (CF-153): one Redis pipeline
// to check the recorded jobs, one addBulk, one UPDATE — whatever the count.

let scheduled;
let liveJobKeys;
let calls;

const prisma = {
  campaignRecipient: { updateMany: async () => ({ count: 0 }) },
  campaign: {
    findMany: async () => scheduled,
    update: async () => { calls.update += 1; return {}; },
  },
  $executeRaw: async (strings, ...values) => { calls.raw.push({ sql: strings.join('?'), values }); return values[0].length; },
};

const campaignQueue = {
  client: Promise.resolve({
    pipeline: () => {
      const keys = [];
      return {
        exists: (key) => { keys.push(key); },
        exec: async () => { calls.pipelines += 1; return keys.map((k) => [null, liveJobKeys.has(k) ? 1 : 0]); },
      };
    },
  }),
  toKey: (id) => `bull:campaigns:${id}`,
  getJob: async () => { calls.getJob += 1; return null; },
  add: async () => { calls.add += 1; return { id: 'x' }; },
  addBulk: async (jobs) => { calls.addBulk.push(jobs); return jobs.map((_, i) => ({ id: `new${i}` })); },
};

const here = (rel) => new URL(rel, import.meta.url).href;
mock.module(here('../lib/prisma.js'), { namedExports: { prisma } });
mock.module(here('../queues/campaign.queue.js'), { namedExports: { campaignQueue } });

const { recoverScheduledCampaigns } = await import('./campaigns.service.js');

beforeEach(() => {
  liveJobKeys = new Set();
  calls = { pipelines: 0, getJob: 0, add: 0, update: 0, addBulk: [], raw: [] };
});

test('only campaigns whose job is gone are re-queued, in one batch each way', async () => {
  const future = new Date(Date.now() + 60_000);
  scheduled = [
    { id: 'c1', workspaceId: 'w1', scheduledAt: future, queueJobId: '11' }, // job survived
    { id: 'c2', workspaceId: 'w1', scheduledAt: future, queueJobId: '12' }, // job lost
    { id: 'c3', workspaceId: 'w2', scheduledAt: null, queueJobId: null },   // never queued
  ];
  liveJobKeys.add('bull:campaigns:11');

  const recovered = await recoverScheduledCampaigns();

  assert.equal(recovered, 2);
  assert.equal(calls.pipelines, 1);
  assert.equal(calls.getJob + calls.add + calls.update, 0, 'no per-campaign round trips');
  assert.equal(calls.addBulk.length, 1);
  assert.deepEqual(calls.addBulk[0].map((j) => j.data.campaignId), ['c2', 'c3']);
  assert.ok(calls.addBulk[0][0].opts.delay > 0);
  assert.equal(calls.addBulk[0][1].opts.delay, 0);
  assert.equal(calls.raw.length, 1);
  assert.deepEqual(calls.raw[0].values, [['c2', 'c3'], ['new0', 'new1']]);
});

test('nothing scheduled, nothing touched', async () => {
  scheduled = [];
  assert.equal(await recoverScheduledCampaigns(), 0);
  assert.equal(calls.pipelines + calls.addBulk.length + calls.raw.length, 0);
});
