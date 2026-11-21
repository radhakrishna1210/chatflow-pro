import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;

const { creditsForUsage, splitCharge, TOKENS_PER_CREDIT } = await import('./aiCredits.service.js');

// The arithmetic that decides what a customer is charged for AI work.

test('credits follow tokens used, rounded up, and a call is never free', () => {
  assert.equal(creditsForUsage({ inputTokens: 0, outputTokens: 0 }), 1);
  assert.equal(creditsForUsage({ inputTokens: 400, outputTokens: 100 }), 1);
  assert.equal(creditsForUsage({ inputTokens: TOKENS_PER_CREDIT, outputTokens: 1 }), 2);
  assert.equal(creditsForUsage({ inputTokens: 3200, outputTokens: 4100 }), 8);
  assert.equal(creditsForUsage(), 1);
});

test('the plan allowance is spent before the wallet', () => {
  assert.deepEqual(
    splitCharge({ credits: 5, included: 20, used: 3, rate: 1, walletBalance: 100 }),
    { fromPlan: 5, fromWallet: 0, walletAmount: 0, unpaid: 0 },
  );
});

test('what the allowance cannot cover is bought from the wallet at the plan rate', () => {
  assert.deepEqual(
    splitCharge({ credits: 8, included: 20, used: 17, rate: 0.75, walletBalance: 100 }),
    { fromPlan: 3, fromWallet: 5, walletAmount: 3.75, unpaid: 0 },
  );
});

test('the wallet is never taken below zero; the rest is recorded as unpaid', () => {
  assert.deepEqual(
    splitCharge({ credits: 10, included: 0, used: 0, rate: 0.5, walletBalance: 2.2 }),
    { fromPlan: 0, fromWallet: 4, walletAmount: 2, unpaid: 6 },
  );
});

test('a plan with no credit price cannot buy more', () => {
  assert.deepEqual(
    splitCharge({ credits: 4, included: 2, used: 2, rate: 0, walletBalance: 500 }),
    { fromPlan: 0, fromWallet: 0, walletAmount: 0, unpaid: 4 },
  );
});

test('overspent usage never yields a negative allowance', () => {
  assert.equal(splitCharge({ credits: 2, included: 10, used: 14, rate: 1, walletBalance: 10 }).fromPlan, 0);
});
