import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Prisma is mocked, so this needs no database.

const PERIOD = new Date('2026-10-01T00:00:00Z');
let subscription;
let counter;
let interleave;

const prisma = {
  subscription: { findUnique: async () => subscription },
  usageCounter: {
    upsert: async () => ({ ...counter }),
    updateMany: async ({ where, data }) => {
      if (interleave) { counter.messagesUsed += interleave; interleave = 0; }
      const m = where.messagesUsed;
      const ok = typeof m === 'number' ? counter.messagesUsed === m
        : m?.gte !== undefined ? counter.messagesUsed >= m.gte
          : m?.lt !== undefined ? counter.messagesUsed < m.lt
            : true;
      if (!ok) return { count: 0 };
      if (data.messagesUsed?.increment !== undefined) counter.messagesUsed += data.messagesUsed.increment;
      else if (data.messagesUsed?.decrement !== undefined) counter.messagesUsed -= data.messagesUsed.decrement;
      else counter.messagesUsed = data.messagesUsed;
      return { count: 1 };
    },
  },
};

mock.module(new URL('../lib/prisma.js', import.meta.url).href, { namedExports: { prisma } });

const { getRemainingQuota, reserveCampaignQuota, releaseCampaignQuota } = await import('./campaignBilling.service.js');

beforeEach(() => {
  subscription = {
    status: 'ACTIVE', currentPeriodStart: PERIOD, currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
    plan: { messageQuota: 10_000 },
  };
  counter = { messagesUsed: 0 };
  interleave = 0;
});

test('remaining quota is the plan allowance less this cycle’s usage', async () => {
  counter.messagesUsed = 9_990;
  assert.deepEqual(await getRemainingQuota('w1'), { remaining: 10, periodStart: PERIOD });
});

test('an inactive subscription contributes no quota', async () => {
  subscription.status = 'CANCELLED';
  assert.equal((await getRemainingQuota('w1')).remaining, 0);
  assert.equal((await reserveCampaignQuota('w1', 50)).reserved, 0);
});

test('reservation takes at most what is left and counts it as used immediately', async () => {
  counter.messagesUsed = 9_960;
  const r = await reserveCampaignQuota('w1', 100);
  assert.equal(r.reserved, 40);
  assert.equal(counter.messagesUsed, 10_000);
});

test('a send landing between read and write makes the reservation re-read instead of overspending', async () => {
  counter.messagesUsed = 9_960;
  interleave = 5; // an inbox reply consumes 5 just before the compare-and-set
  const r = await reserveCampaignQuota('w1', 100);
  assert.equal(r.reserved, 35);
  assert.equal(counter.messagesUsed, 10_000);
});

test('an unlimited plan reserves everything', async () => {
  subscription.plan.messageQuota = -1;
  const r = await reserveCampaignQuota('w1', 5_000);
  assert.equal(r.reserved, 5_000);
});

test('release gives quota back and never drives usage below zero', async () => {
  counter.messagesUsed = 30;
  await releaseCampaignQuota('w1', PERIOD, 20);
  assert.equal(counter.messagesUsed, 10);
  await releaseCampaignQuota('w1', PERIOD, 20);
  assert.equal(counter.messagesUsed, 0);
});
