import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// One price per message (CF-206): campaign quotes/launch, inbox overage and
// wallet health must agree for the same plan and category.

const plans = {
  free: { overageRatePerMsg: 0.02, overageRates: { MARKETING: 2.18, UTILITY: 0.32, AUTHENTICATION: 0.26 } },
  growth: { overageRatePerMsg: 0.008, overageRates: null },
};
let currentPlan;

const here = (rel) => new URL(rel, import.meta.url).href;
mock.module(here('./prisma.js'), {
  namedExports: { prisma: { subscription: { findUnique: async () => (currentPlan ? { plan: currentPlan } : null) } } },
});

const { messageRate, overageRateFor, MESSAGE_CATEGORY_RATES } = await import('./messagePricing.js');
const { campaignMessageRate, campaignRate } = await import('../services/campaignBilling.service.js');

test('a recognised category uses the plan override, else cost', () => {
  assert.equal(messageRate(plans.free, 'MARKETING'), 2.18);
  assert.equal(messageRate(plans.growth, 'utility'), MESSAGE_CATEGORY_RATES.UTILITY);
  assert.equal(messageRate(plans.growth, 'OTP'), MESSAGE_CATEGORY_RATES.AUTHENTICATION);
});

test('an unrecognised template category is priced as marketing, a missing one at the flat rate', () => {
  assert.equal(messageRate(plans.growth, 'TRANSACTIONAL'), MESSAGE_CATEGORY_RATES.MARKETING);
  assert.equal(messageRate(plans.free, 'TRANSACTIONAL'), 2.18);
  assert.equal(messageRate(plans.free, null), 0.02);
  assert.equal(messageRate(null, null), 0);
});

test('overage billing is the same function', () => {
  assert.equal(overageRateFor, messageRate);
});

test('a campaign is quoted what the inbox would charge for the same template on the same plan', async () => {
  for (const plan of Object.values(plans)) {
    currentPlan = plan;
    for (const category of ['MARKETING', 'UTILITY', 'AUTHENTICATION', 'SOMETHING_NEW']) {
      assert.equal(await campaignMessageRate('w1', category), overageRateFor(plan, category), `${category}`);
    }
  }
});

test('a launched campaign keeps its locked rate; a legacy one falls back to the shared table', () => {
  assert.equal(campaignRate({ costPerMessage: '0.5', template: { category: 'MARKETING' } }), 0.5);
  assert.equal(campaignRate({ costPerMessage: null, template: { category: 'UTILITY' } }), MESSAGE_CATEGORY_RATES.UTILITY);
});
