import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Plan feature gates (CF-051): one helper, one 403 shape, a message that names
// the plan to upgrade to.

const plans = [
  { name: 'Free', priceMonthly: 0, isActive: true, features: { automation: true, workflows: true, fallback: true, voice: true } },
  { name: 'Basic', priceMonthly: 1500, isActive: true, features: { automation: true, workflows: true, campaignAi: true, integrations: true, aiOnboarding: true, fallback: true, voice: true } },
];
let current;
let lookupFails;

const prisma = {
  subscription: {
    findUnique: async () => {
      if (lookupFails) throw new Error('db down');
      return current ? { plan: current } : null;
    },
  },
  plan: { findMany: async () => plans },
};
const here = (rel) => new URL(rel, import.meta.url).href;
mock.module(here('../lib/prisma.js'), { namedExports: { prisma } });

const { assertPlanFeature, planAllows, planFeatureMap, PLAN_FEATURE_KEYS } = await import('./planFeatures.service.js');
const { requireFeature } = await import('../middleware/requireFeature.js');
const { KNOWN_FEATURE_FLAGS } = await import('./admin.service.js').catch(() => ({ KNOWN_FEATURE_FLAGS: null }));

beforeEach(() => { current = plans[0]; lookupFails = false; });

test('a locked feature is a 403 naming the cheapest plan that has it', async () => {
  await assert.rejects(() => assertPlanFeature('w1', 'campaignAi'), (err) => {
    assert.equal(err.status, 403);
    assert.equal(err.code, 'PLAN_FEATURE_LOCKED');
    assert.deepEqual(err.details, { feature: 'campaignAi', upgradeTo: 'Basic' });
    assert.match(err.message, /^Your Free plan does not include the Campaign AI Agent.*Upgrade to Basic/);
    return true;
  });
  await assert.doesNotReject(() => assertPlanFeature('w1', 'fallback'));
});

test('the middleware answers with the same message, code and upgrade target', async () => {
  let status; let body; let nexted = false;
  const res = { status: (s) => { status = s; return { json: (b) => { body = b; } }; } };
  await requireFeature('workflows')({ user: { workspaceId: 'w1' } }, res, () => { nexted = true; });
  assert.equal(nexted, true);

  current = { name: 'Free', features: {} };
  await requireFeature('workflows')({ user: { workspaceId: 'w1' } }, res, () => { nexted = 'again'; });
  assert.equal(status, 403);
  assert.equal(body.code, 'PLAN_FEATURE_LOCKED');
  assert.equal(body.feature, 'workflows');
  assert.equal(body.upgradeTo, 'Free');
});

test('runtime checks fail closed and never throw', async () => {
  assert.equal(await planAllows('w1', 'voice'), true);
  assert.equal(await planAllows('w1', 'campaignAi'), false);
  lookupFails = true;
  assert.equal(await planAllows('w1', 'voice'), false);
});

test('the feature map lists every known flag', async () => {
  const map = await planFeatureMap('w1');
  assert.deepEqual(Object.keys(map), PLAN_FEATURE_KEYS);
  assert.equal(map.fallback, true);
  assert.equal(map.integrations, false);
});

test('every seeded plan carries every flag explicitly (no implicit "on all plans")', async () => {
  const { readFile } = await import('node:fs/promises');
  const seed = await readFile(new URL('../../scripts/seed-plans.js', import.meta.url), 'utf8');
  const featureLines = seed.match(/features: \{[^}]*\}/g);
  assert.equal(featureLines.length, 3);
  for (const flag of ['automation', 'workflows', 'fallback', 'voice']) {
    for (const line of featureLines) assert.match(line, new RegExp(`${flag}: true`), `${flag} on every plan`);
  }
  if (KNOWN_FEATURE_FLAGS) assert.deepEqual(KNOWN_FEATURE_FLAGS, PLAN_FEATURE_KEYS);
});
