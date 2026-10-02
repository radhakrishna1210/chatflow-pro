import test from 'node:test';
import assert from 'node:assert/strict';
import { splitCampaignCharge, settleCampaignUnits } from './campaignCharge.js';

test('remaining quota covers the campaign first; the wallet pays nothing when it covers all of it', () => {
  // The audit's case: BASIC plan, 10,000 included and unused, 100 marketing messages.
  assert.deepEqual(
    splitCampaignCharge({ units: 100, remainingQuota: 10_000, rate: 1.09 }),
    { quotaUnits: 100, walletUnits: 0, totalCost: 0 },
  );
});

test('only the part beyond the remaining quota is charged to the wallet', () => {
  assert.deepEqual(
    splitCampaignCharge({ units: 100, remainingQuota: 40, rate: 1.09 }),
    { quotaUnits: 40, walletUnits: 60, totalCost: 65.4 },
  );
});

test('no quota left (or no subscription) charges everything', () => {
  assert.deepEqual(
    splitCampaignCharge({ units: 3, remainingQuota: 0, rate: 0.16 }),
    { quotaUnits: 0, walletUnits: 3, totalCost: 0.48 },
  );
  assert.equal(splitCampaignCharge({ units: 3, remainingQuota: -5, rate: 1 }).walletUnits, 3);
});

test('an unlimited plan covers every message', () => {
  assert.deepEqual(
    splitCampaignCharge({ units: 5000, remainingQuota: Infinity, rate: 1.09 }),
    { quotaUnits: 5000, walletUnits: 0, totalCost: 0 },
  );
});

test('money is rounded to paise', () => {
  assert.equal(splitCampaignCharge({ units: 3, remainingQuota: 0, rate: 0.13 }).totalCost, 0.39);
});

test('settlement: unsent messages come back as money before quota', () => {
  // 40 quota + 60 wallet reserved, 50 actually sent: the 50 sends use the 40
  // quota and 10 wallet units, so 50 wallet units are refunded and no quota.
  assert.deepEqual(
    settleCampaignUnits({ walletUnits: 60, quotaUnits: 40, billed: 50 }),
    { walletRefundUnits: 50, quotaReleaseUnits: 0 },
  );
});

test('settlement: fewer sends than the quota share releases the unused quota and the whole wallet share', () => {
  assert.deepEqual(
    settleCampaignUnits({ walletUnits: 60, quotaUnits: 40, billed: 10 }),
    { walletRefundUnits: 60, quotaReleaseUnits: 30 },
  );
});

test('settlement: everything sent returns nothing', () => {
  assert.deepEqual(
    settleCampaignUnits({ walletUnits: 60, quotaUnits: 40, billed: 100 }),
    { walletRefundUnits: 0, quotaReleaseUnits: 0 },
  );
});

test('settlement of a campaign launched before quota reservation (wallet only) is unchanged', () => {
  assert.deepEqual(
    settleCampaignUnits({ walletUnits: 100, quotaUnits: 0, billed: 70 }),
    { walletRefundUnits: 30, quotaReleaseUnits: 0 },
  );
});

test('settlement never goes negative even if billed exceeds what was reserved', () => {
  assert.deepEqual(
    settleCampaignUnits({ walletUnits: 5, quotaUnits: 5, billed: 50 }),
    { walletRefundUnits: 0, quotaReleaseUnits: 0 },
  );
});
