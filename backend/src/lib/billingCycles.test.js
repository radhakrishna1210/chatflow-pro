import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CYCLES, normalizeCycle, renewalCharge } from './billingCycles.js';
import { PLANS, PLAN_ALLOWANCES, planAllowance, RETIRED_PLAN_SUCCESSOR } from '../data/planCatalog.js';

const DAY = 86_400_000;
const period = (days) => {
  const currentPeriodStart = new Date('2026-01-01T00:00:00Z');
  return { currentPeriodStart, currentPeriodEnd: new Date(currentPeriodStart.getTime() + days * DAY) };
};
const plan = (key) => PLANS.find((p) => p.key === key);

test('the paid ladder carries Interakt\'s prices on all three cycles', () => {
  const prices = Object.fromEntries(PLANS.filter((p) => p.priceMonthly > 0)
    .map((p) => [p.name, [p.priceMonthly, p.priceQuarterly, p.priceYearly]]));
  assert.deepEqual(prices, {
    Starter:  [999, 3499, 11999],
    Growth:   [2799, 7699, 26399],
    Advanced: [3799, 10499, 35999],
  });
});

test('every paid plan has unlimited agents, messages and contacts', () => {
  for (const p of PLANS.filter((x) => x.priceMonthly > 0)) {
    assert.equal(p.messageQuota, -1, `${p.name} messages`);
    assert.equal(p.memberLimit, null, `${p.name} agents`);
    assert.equal(p.contactLimit, null, `${p.name} contacts`);
    // Message billing stays at the shared cost rates on purpose.
    assert.equal(p.overageRates, null, `${p.name} message rates`);
  }
});

test('the starter tier keeps its BASIC key, so existing subscriptions still join', () => {
  assert.equal(plan('BASIC').name, 'Starter');
  assert.equal(plan('STARTER'), undefined);
  assert.equal(RETIRED_PLAN_SUCCESSOR.STARTER, 'BASIC');
});

test('catalogue rows only use columns the Plan model has', () => {
  const columns = new Set(['key', 'name', 'priceMonthly', 'priceQuarterly', 'priceYearly', 'currency',
    'messageQuota', 'contactLimit', 'memberLimit', 'campaignLimit', 'apiKeyLimit',
    'overageRatePerMsg', 'overageRates', 'features']);
  for (const p of PLANS) {
    for (const k of Object.keys(p)) assert.ok(columns.has(k), `${p.key}.${k} is not a Plan column`);
  }
});

test('included custom fields and events step up by tier', () => {
  assert.deepEqual(['BASIC', 'GROWTH', 'ADVANCED'].map((k) => planAllowance(k, 'customFields')), [15, 25, 30]);
  assert.deepEqual(['BASIC', 'GROWTH', 'ADVANCED'].map((k) => planAllowance(k, 'customEvents')), [0, 5, 7]);
  // Free, unknown plans and unknown capabilities include nothing.
  assert.equal(planAllowance('FREE', 'customFields'), 0);
  assert.equal(planAllowance('SOMETHING_ELSE', 'customFields'), 0);
  assert.equal(planAllowance(undefined, 'customFields'), 0);
  assert.equal(planAllowance('GROWTH', 'nonsense'), 0);
  assert.ok(Object.isFrozen(PLAN_ALLOWANCES));
});

test('normalizeCycle falls back to monthly for anything it does not know', () => {
  assert.equal(normalizeCycle('yearly'), 'yearly');
  assert.equal(normalizeCycle('quarterly'), 'quarterly');
  assert.equal(normalizeCycle('monthly'), 'monthly');
  assert.equal(normalizeCycle(undefined), 'monthly');
  assert.equal(normalizeCycle('weekly'), 'monthly');
  // Not fooled by inherited object properties.
  assert.equal(normalizeCycle('constructor'), 'monthly');
  assert.equal(normalizeCycle('toString'), 'monthly');
});

test('a checkout buys 30, 90 or 365 days', () => {
  assert.deepEqual([CYCLES.monthly.days, CYCLES.quarterly.days, CYCLES.yearly.days], [30, 90, 365]);
});

test('renewal is charged on the cycle the subscription is actually on', () => {
  const growth = plan('GROWTH');
  assert.deepEqual(pick(renewalCharge(period(30), growth)), { cycle: 'monthly', amount: 2799 });
  assert.deepEqual(pick(renewalCharge(period(90), growth)), { cycle: 'quarterly', amount: 7699 });
  assert.deepEqual(pick(renewalCharge(period(365), growth)), { cycle: 'yearly', amount: 26399 });
  // Calendar wobble: an 89-day quarter and a 366-day leap year.
  assert.equal(renewalCharge(period(89), growth).cycle, 'quarterly');
  assert.equal(renewalCharge(period(366), growth).cycle, 'yearly');
  // A 31-day month is still monthly, not quarterly.
  assert.equal(renewalCharge(period(31), growth).cycle, 'monthly');
});

test('renewal rolls forward by the same length it was on', () => {
  assert.equal(renewalCharge(period(365), plan('ADVANCED')).cycleMs, 365 * DAY);
  assert.equal(renewalCharge(period(90), plan('ADVANCED')).cycleMs, 90 * DAY);
});

test('a cycle the plan no longer sells falls back instead of charging nothing', () => {
  const noYearly = { ...plan('GROWTH'), priceYearly: null };
  assert.deepEqual(pick(renewalCharge(period(365), noYearly)), { cycle: 'quarterly', amount: 7699 });
  const monthlyOnly = { ...noYearly, priceQuarterly: null };
  assert.deepEqual(pick(renewalCharge(period(365), monthlyOnly)), { cycle: 'monthly', amount: 2799 });
});

test('the free plan renews for nothing and a zero-length period cannot loop', () => {
  assert.equal(renewalCharge(period(30), plan('FREE')).amount, 0);
  assert.equal(renewalCharge(period(0), plan('FREE')).cycleMs, 30 * DAY);
});

test('prices stored as Prisma Decimal strings are read as numbers', () => {
  const fromDb = { priceMonthly: '999.00', priceQuarterly: '3499.00', priceYearly: '11999.00' };
  assert.equal(renewalCharge(period(365), fromDb).amount, 11999);
  assert.equal(renewalCharge(period(30), fromDb).amount, 999);
});

function pick({ cycle, amount }) { return { cycle, amount }; }
