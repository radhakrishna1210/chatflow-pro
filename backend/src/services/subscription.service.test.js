import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Plan-limit and billing logic in subscription.service.js against an
// in-memory Prisma fake. env and Razorpay are faked so nothing here reaches a
// database or a payment gateway.
mock.module('../config/env.js', { namedExports: { env: { RAZORPAY_KEY_SECRET: 'test_secret' } } });

const PLANS = {
  plan_free: { id: 'plan_free', key: 'FREE', name: 'Free', priceMonthly: 0, priceQuarterly: null, contactLimit: 100, memberLimit: 1, apiKeyLimit: 1 },
  plan_basic: { id: 'plan_basic', key: 'BASIC', name: 'Basic', priceMonthly: 1500, priceQuarterly: 3500, contactLimit: null, memberLimit: 10, apiKeyLimit: 10 },
  plan_growth: { id: 'plan_growth', key: 'GROWTH', name: 'Growth', priceMonthly: 2500, priceQuarterly: 7500, contactLimit: null, memberLimit: null, apiKeyLimit: null },
};

const state = {
  plan: { id: 'plan_free', contactLimit: 3 },
  contacts: [],
  sub: null,
  members: 1,
  apiKeys: 0,
};

const prisma = {
  subscription: {
    findUnique: async ({ include } = {}) => {
      if (state.sub) {
        const sub = { ...state.sub };
        if (include?.plan) sub.plan = PLANS[sub.planId];
        if (include?.pendingPlan) sub.pendingPlan = sub.pendingPlanId ? PLANS[sub.pendingPlanId] : null;
        return sub;
      }
      return {
        workspaceId: 'ws_1', plan: state.plan,
        currentPeriodStart: new Date(0), currentPeriodEnd: new Date(86_400_000),
      };
    },
    update: async ({ data, include }) => {
      Object.assign(state.sub, data);
      return prisma.subscription.findUnique({ include });
    },
  },
  plan: {
    findFirst: async ({ where }) => (PLANS[where.id] && where.isActive ? PLANS[where.id] : null),
  },
  usageCounter: {
    findUnique: async () => ({ messagesUsed: 0 }),
  },
  contact: {
    count: async ({ where }) => state.contacts.filter((c) => {
      if (c.workspaceId !== where.workspaceId) return false;
      if (where.phoneNumber?.in) return where.phoneNumber.in.includes(c.phoneNumber);
      return true;
    }).length,
  },
  workspaceMember: { count: async () => state.members },
  invitation: { count: async () => 0 },
  apiKey: { count: async () => state.apiKeys },
};
mock.module('../lib/prisma.js', { namedExports: { prisma } });

const {
  assertContactCapacity, hasContactCapacity, scheduleSubscriptionChange, renewalCharge, releaseMessageCredit,
} = await import('./subscription.service.js');

const setContacts = (...phones) => {
  state.contacts = phones.map((phoneNumber) => ({ workspaceId: 'ws_1', phoneNumber }));
};

test('a single new contact is allowed below the limit and refused at it', async () => {
  state.plan = { contactLimit: 3 };
  setContacts('+911', '+912');
  await assertContactCapacity('ws_1');
  setContacts('+911', '+912', '+913');
  await assert.rejects(() => assertContactCapacity('ws_1'), (e) => e.status === 403 && e.code === 'PLAN_LIMIT_REACHED');
});

test('a null contactLimit means unlimited', async () => {
  state.plan = { contactLimit: null };
  setContacts('+911', '+912', '+913', '+914');
  await assertContactCapacity('ws_1');
  assert.equal(await hasContactCapacity('ws_1'), true);
});

test('a batch counts only phone numbers not already in the workspace', async () => {
  state.plan = { contactLimit: 3 };
  setContacts('+911', '+912');
  // +911 and +912 already exist, only +913 is new: fits exactly.
  await assertContactCapacity('ws_1', { phoneNumbers: ['+911', '+912', '+913', '+913'] });
  // Two new numbers would take the workspace to 4.
  await assert.rejects(
    () => assertContactCapacity('ws_1', { phoneNumbers: ['+913', '+914'] }),
    (e) => e.code === 'PLAN_LIMIT_REACHED' && /2 new contacts/.test(e.message),
  );
});

test('a batch of only existing numbers never trips the limit', async () => {
  state.plan = { contactLimit: 2 };
  setContacts('+911', '+912');
  await assertContactCapacity('ws_1', { phoneNumbers: ['+911', '+912'] });
  await assertContactCapacity('ws_1', { phoneNumbers: [] });
});

test('hasContactCapacity reports false at the limit instead of throwing', async () => {
  state.plan = { contactLimit: 1 };
  setContacts('+911');
  assert.equal(await hasContactCapacity('ws_1'), false);
  setContacts();
  assert.equal(await hasContactCapacity('ws_1'), true);
});

// ─── Scheduled plan changes (PATCH /subscription) ───────────────────────────

const onPlan = (planId, extra = {}) => {
  state.sub = {
    id: 'sub_1', workspaceId: 'ws_1', planId, pendingPlanId: null, status: 'ACTIVE',
    cancelAtPeriodEnd: false, currentPeriodStart: new Date(0), currentPeriodEnd: new Date(30 * 86_400_000),
    ...extra,
  };
  state.members = 1;
  state.apiKeys = 0;
  setContacts();
};

test('a downgrade is scheduled for the next cycle, not applied now', async () => {
  onPlan('plan_growth');
  const r = await scheduleSubscriptionChange('ws_1', { planId: 'plan_basic' });
  assert.equal(state.sub.planId, 'plan_growth');
  assert.equal(state.sub.pendingPlanId, 'plan_basic');
  assert.deepEqual(r.pendingPlan, { key: 'BASIC', name: 'Basic' });
  // planId null clears the scheduled change.
  await scheduleSubscriptionChange('ws_1', { planId: null });
  assert.equal(state.sub.pendingPlanId, null);
});

test('upgrades are refused here because they go through paid checkout', async () => {
  onPlan('plan_basic');
  await assert.rejects(() => scheduleSubscriptionChange('ws_1', { planId: 'plan_growth' }), (e) => e.status === 400);
  assert.equal(state.sub.pendingPlanId, null);
});

test('a downgrade the workspace does not fit is refused', async () => {
  onPlan('plan_basic');
  state.members = 4; // owner + 3 teammates; Free allows 1 teammate
  await assert.rejects(
    () => scheduleSubscriptionChange('ws_1', { planId: 'plan_free' }),
    (e) => e.status === 409 && /team members/.test(e.message),
  );
});

test('cancel at period end clears a pending switch, and can be undone', async () => {
  onPlan('plan_growth', { pendingPlanId: 'plan_basic' });
  await scheduleSubscriptionChange('ws_1', { cancelAtPeriodEnd: true });
  assert.equal(state.sub.cancelAtPeriodEnd, true);
  assert.equal(state.sub.pendingPlanId, null);
  await scheduleSubscriptionChange('ws_1', { cancelAtPeriodEnd: false });
  assert.equal(state.sub.cancelAtPeriodEnd, false);
});

test('the Free plan cannot be cancelled and expired subscriptions cannot be changed', async () => {
  onPlan('plan_free');
  await assert.rejects(() => scheduleSubscriptionChange('ws_1', { cancelAtPeriodEnd: true }), (e) => e.status === 400);
  onPlan('plan_growth', { status: 'EXPIRED' });
  await assert.rejects(() => scheduleSubscriptionChange('ws_1', { planId: 'plan_basic' }), (e) => e.status === 409);
});

test('releaseMessageCredit reports a failed release instead of throwing', async () => {
  onPlan('plan_basic');
  const original = prisma.usageCounter.updateMany;
  prisma.usageCounter.updateMany = async () => { throw new Error('db down'); };
  const errors = [];
  const origError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const r = await releaseMessageCredit('ws_1', { source: 'QUOTA' });
    assert.equal(r.released, false);
    assert.equal(r.error, 'db down');
    assert.ok(errors.some((line) => /QUOTA credit failed for ws_1/.test(line)));
  } finally {
    console.error = origError;
    prisma.usageCounter.updateMany = original;
  }
});

// ─── Renewal pricing ────────────────────────────────────────────────────────

test('renewalCharge prefers the stored billing cycle over the period length', () => {
  const day = 86_400_000;
  const basic = PLANS.plan_basic;
  // Legacy row: inferred from a 90-day period.
  const legacy = renewalCharge({ currentPeriodStart: new Date(0), currentPeriodEnd: new Date(90 * day) }, basic);
  assert.equal(legacy.cycle, 'quarterly');
  assert.equal(legacy.amount, 3500);
  // A monthly subscription whose period was extended to 95 days stays monthly.
  const extended = renewalCharge({ billingCycle: 'monthly', currentPeriodStart: new Date(0), currentPeriodEnd: new Date(95 * day) }, basic);
  assert.equal(extended.cycle, 'monthly');
  assert.equal(extended.amount, 1500);
  assert.equal(extended.cycleDays, 30);
  // Quarterly on a plan with no quarterly price falls back to monthly.
  const free = renewalCharge({ billingCycle: 'quarterly', currentPeriodStart: new Date(0), currentPeriodEnd: new Date(90 * day) }, PLANS.plan_free);
  assert.equal(free.cycle, 'monthly');
  assert.equal(free.amount, 0);
});
