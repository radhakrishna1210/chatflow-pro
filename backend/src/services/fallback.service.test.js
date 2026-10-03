import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Twilio, the wallet, the database and SMTP are all mocked.

let optedOut;
let smsSent;
let twilioFails;
let debits;
let credits;
let balanceOk;

const here = (rel) => new URL(rel, import.meta.url).href;
mock.module('twilio', {
  defaultExport: () => ({
    messages: {
      create: async (msg) => {
        if (twilioFails) throw new Error('Twilio rejected');
        smsSent.push(msg);
        return { sid: 'SM1' };
      },
    },
  }),
});
mock.module(here('../config/env.js'), { namedExports: { env: { TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 'tok', SMTP_HOST: '' } } });
mock.module(here('../lib/prisma.js'), {
  namedExports: { prisma: { campaignRecipient: { findUnique: async () => ({ failReason: 'x' }), update: async () => ({}) } } },
});
mock.module(here('../lib/mailer.js'), { namedExports: { sendMail: async () => {} } });
mock.module(here('./optout.service.js'), { namedExports: { isOptedOut: async () => optedOut } });
mock.module(here('./wallet.service.js'), {
  namedExports: {
    debit: async (ws, amount, opts) => { debits.push({ amount, key: opts.idempotencyKey }); return balanceOk ? { ok: true } : { ok: false }; },
    credit: async (ws, amount, opts) => { credits.push({ amount, key: opts.idempotencyKey }); return { balance: 1 }; },
  },
});

const { runFallbackForRecipient } = await import('./fallback.service.js');
const { SMS_FALLBACK_RATE } = await import('../lib/messagePricing.js');

const DLT = { dltTemplateId: '1007161234567890123', dltEntityId: '1201161234567890123' };
const campaign = { id: 'c1', workspaceId: 'w1', name: 'Diwali', fallbackConfig: { smsEnabled: true, smsFrom: 'SPNDAN', smsText: 'Hi {{1}}', ...DLT } };
const recipient = { id: 'r1' };
const contact = { id: 'k1', name: 'Asha', phoneNumber: '+919999999999' };

beforeEach(() => {
  optedOut = false;
  smsSent = [];
  twilioFails = false;
  debits = [];
  credits = [];
  balanceOk = true;
});

test('a fallback SMS is charged to the wallet once per recipient', async () => {
  const r = await runFallbackForRecipient(campaign, recipient, contact);
  assert.deepEqual(r.succeeded, ['sms']);
  assert.deepEqual(debits, [{ amount: SMS_FALLBACK_RATE, key: 'sms_fallback_r1' }]);
  assert.equal(smsSent[0].body, 'Hi Asha');
});

test('without a DLT template or entity id no SMS is sent and nothing is charged', async () => {
  for (const missing of ['dltTemplateId', 'dltEntityId']) {
    smsSent = []; debits = [];
    const fallbackConfig = { ...campaign.fallbackConfig, [missing]: undefined };
    const r = await runFallbackForRecipient({ ...campaign, fallbackConfig }, recipient, contact);
    assert.equal(smsSent.length, 0);
    assert.equal(debits.length, 0);
    assert.deepEqual(r.succeeded, []);
    assert.match(r.failed[0], /^sms: No DLT (template|entity) id configured/);
  }
});

test('a sent SMS records the DLT template it went out under', async () => {
  const r = await runFallbackForRecipient(campaign, recipient, contact);
  assert.equal(r.attempts[0].dltTemplateId, DLT.dltTemplateId);
});

test('an opted-out contact gets no fallback and is not charged', async () => {
  optedOut = true;
  const r = await runFallbackForRecipient(campaign, recipient, contact);
  assert.equal(smsSent.length, 0);
  assert.equal(debits.length, 0);
  assert.deepEqual(r.succeeded, []);
});

test('no wallet balance, no SMS', async () => {
  balanceOk = false;
  const r = await runFallbackForRecipient(campaign, recipient, contact);
  assert.equal(smsSent.length, 0);
  assert.match(r.failed[0], /Insufficient wallet balance/);
});

test('an SMS Twilio refuses is refunded', async () => {
  twilioFails = true;
  await runFallbackForRecipient(campaign, recipient, contact);
  assert.deepEqual(credits, [{ amount: SMS_FALLBACK_RATE, key: 'sms_fallback_r1_refund' }]);
});
