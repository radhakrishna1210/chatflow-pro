import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// The OTP API sends a paid AUTHENTICATION template. It must claim a credit like
// every other send, give it back when Meta refuses, invalidate the code, and
// record the send without ever writing the code itself anywhere visible.

let ledger;
let metaFails;
let creditResult;
let invalidated;
let messages;

const template = {
  id: 't_auth', workspaceId: 'ws_1', name: 'login_code', language: 'en', status: 'APPROVED', category: 'AUTHENTICATION',
  components: [{ type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] }],
};

function reset() {
  ledger = { consumed: [], released: [] };
  metaFails = null;
  creditResult = { ok: true, source: 'QUOTA' };
  invalidated = [];
  messages = [];
}
reset();

const prisma = {
  authenticationConfig: {
    findUnique: async () => ({ workspaceId: 'ws_1', enabled: true, templateId: 't_auth', waNumberId: 'wa_1' }),
  },
  template: { findFirst: async () => template },
  waNumber: { findFirst: async () => ({ id: 'wa_1', workspaceId: 'ws_1', metaPhoneNumberId: 'PN_1', encryptedAccessToken: 'enc' }) },
  campaign: { findFirst: async () => ({ id: 'camp_1' }) },
  contact: {
    findFirst: async () => null,
    create: async ({ data }) => ({ id: 'c_1', ...data }),
  },
  conversation: {
    findFirst: async () => null,
    create: async ({ data }) => ({ id: 'cv_1', ...data }),
    update: async () => ({}),
  },
  message: { create: async ({ data }) => { messages.push(data); return { id: `m_${messages.length}`, ...data }; } },
};

mock.module('../lib/prisma.js', { namedExports: { prisma } });
mock.module('../lib/encryption.js', { namedExports: { decrypt: () => 'token', encrypt: (v) => v } });
mock.module('../lib/meta.js', {
  namedExports: {
    sendWhatsAppMessage: async () => {
      if (metaFails) throw metaFails;
      return { messages: [{ id: 'wamid.otp' }] };
    },
  },
});
mock.module('./otp.service.js', {
  namedExports: {
    createAuthenticationTransaction: async () => ({ transactionId: 'txn_1', code: '123456', expiresAt: new Date(Date.now() + 600_000) }),
    attachMetaMessageId: async () => {},
    invalidateAuthenticationTransaction: async (id) => { invalidated.push(id); },
    verifyAuthenticationTransaction: async () => ({ verified: false }),
  },
});
mock.module('../services/optout.service.js', {
  namedExports: {
    normalizePhone: (raw) => String(raw ?? '').replace(/\D/g, ''),
    assertNotOptedOut: async () => {},
  },
});
mock.module('../services/subscription.service.js', {
  namedExports: {
    consumeMessageCredit: async (workspaceId, opts) => { ledger.consumed.push({ workspaceId, ...opts }); return creditResult; },
    releaseMessageCredit: async (workspaceId, opts) => { ledger.released.push({ workspaceId, ...opts }); return { released: true }; },
  },
});
mock.module('../services/conversations.service.js', {
  namedExports: {
    describeSendFailure: (err) => { const e = new Error(`meta: ${err.message}`); e.status = 502; return e; },
  },
});

const { sendAuthenticationOtp } = await import('./authentication.service.js');

test('an API OTP claims a credit at the AUTHENTICATION rate and records the send without the code', async () => {
  reset();
  const out = await sendAuthenticationOtp('ws_1', { to: '+91 98765 43210' });
  assert.equal(out.status, 'SENT');
  assert.equal(ledger.consumed.length, 1);
  assert.equal(ledger.consumed[0].messageCategory, 'AUTHENTICATION');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].metaMessageId, 'wamid.otp');
  assert.ok(!messages[0].body.includes('123456'), 'the OTP must never be stored in the thread');
});

test('Meta refusing the OTP releases the credit and invalidates the code', async () => {
  reset();
  metaFails = new Error('rejected');
  await assert.rejects(sendAuthenticationOtp('ws_1', { to: '919876543210' }), (err) => err.status === 502);
  assert.equal(ledger.released.length, 1);
  assert.equal(ledger.released[0].source, 'QUOTA');
  assert.deepEqual(invalidated, ['txn_1']);
  assert.equal(messages.length, 0);
});

test('no credit means no OTP is sent and the code is invalidated', async () => {
  reset();
  creditResult = { ok: false, code: 'QUOTA_AND_WALLET_EXHAUSTED' };
  await assert.rejects(sendAuthenticationOtp('ws_1', { to: '919876543210' }), (err) => err.status === 403);
  assert.deepEqual(invalidated, ['txn_1']);
  assert.equal(messages.length, 0);
});

test('a campaign OTP is not charged twice — the campaign worker already claimed its credit', async () => {
  reset();
  await sendAuthenticationOtp('ws_1', { to: '919876543210', campaignId: 'camp_1' });
  assert.equal(ledger.consumed.length, 0);
});
