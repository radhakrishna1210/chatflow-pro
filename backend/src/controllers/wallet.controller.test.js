import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// The demo recharge credits the wallet without a payment, so it must be
// unreachable unless explicitly enabled outside production. env, the wallet
// service and notifications are faked: nothing here touches a database.
const env = { NODE_ENV: 'production', ALLOW_DEMO_RECHARGE: false };
mock.module('../config/env.js', { namedExports: { env } });

const credits = [];
mock.module('../services/wallet.service.js', {
  namedExports: {
    credit: async (workspaceId, amount, opts) => {
      credits.push({ workspaceId, amount, opts });
      return { balance: amount, transaction: {}, alreadyProcessed: false };
    },
  },
});
mock.module('../services/notification.service.js', {
  namedExports: { notifyWorkspace: async () => {} },
});

const { recharge, isDemoRechargeEnabled } = await import('./wallet.controller.js');

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
const fakeReq = (amount) => ({
  params: { workspaceId: 'ws_1' },
  body: { amount },
  get: () => undefined,
});

test('isDemoRechargeEnabled requires non-production AND the explicit flag', () => {
  assert.equal(isDemoRechargeEnabled({ NODE_ENV: 'production', ALLOW_DEMO_RECHARGE: true }), false);
  assert.equal(isDemoRechargeEnabled({ NODE_ENV: 'production', ALLOW_DEMO_RECHARGE: false }), false);
  assert.equal(isDemoRechargeEnabled({ NODE_ENV: 'development', ALLOW_DEMO_RECHARGE: false }), false);
  assert.equal(isDemoRechargeEnabled({ NODE_ENV: 'development' }), false);
  assert.equal(isDemoRechargeEnabled({ NODE_ENV: 'development', ALLOW_DEMO_RECHARGE: 'true' }), false);
  assert.equal(isDemoRechargeEnabled({ NODE_ENV: 'development', ALLOW_DEMO_RECHARGE: true }), true);
  assert.equal(isDemoRechargeEnabled({ NODE_ENV: 'test', ALLOW_DEMO_RECHARGE: true }), true);
});

test('recharge is a 404 in production even with the flag set, and credits nothing', async () => {
  credits.length = 0;
  env.NODE_ENV = 'production';
  env.ALLOW_DEMO_RECHARGE = true;
  const res = fakeRes();
  await recharge(fakeReq(500), res);
  assert.equal(res.statusCode, 404);
  assert.equal(credits.length, 0);
});

test('recharge is a 404 in development without the flag', async () => {
  credits.length = 0;
  env.NODE_ENV = 'development';
  env.ALLOW_DEMO_RECHARGE = false;
  const res = fakeRes();
  await recharge(fakeReq(500), res);
  assert.equal(res.statusCode, 404);
  assert.equal(credits.length, 0);
});

test('recharge credits the wallet only when enabled outside production', async () => {
  credits.length = 0;
  env.NODE_ENV = 'development';
  env.ALLOW_DEMO_RECHARGE = true;
  const res = fakeRes();
  await recharge(fakeReq(500), res);
  assert.equal(res.statusCode, 200);
  assert.equal(credits.length, 1);
  assert.equal(credits[0].opts.gateway, 'manual');
  assert.equal(res.body.demo, true);
});
