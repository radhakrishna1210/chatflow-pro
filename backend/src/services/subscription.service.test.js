import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Plan-limit and billing logic in subscription.service.js against an
// in-memory Prisma fake. env and Razorpay are faked so nothing here reaches a
// database or a payment gateway.
mock.module('../config/env.js', { namedExports: { env: { RAZORPAY_KEY_SECRET: 'test_secret' } } });

const state = {
  plan: { id: 'plan_free', contactLimit: 3 },
  contacts: [],
};

const prisma = {
  subscription: {
    findUnique: async () => ({
      workspaceId: 'ws_1', plan: state.plan,
      currentPeriodStart: new Date(0), currentPeriodEnd: new Date(86_400_000),
    }),
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
};
mock.module('../lib/prisma.js', { namedExports: { prisma } });

const { assertContactCapacity, hasContactCapacity } = await import('./subscription.service.js');

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
