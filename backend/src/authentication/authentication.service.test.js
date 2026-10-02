import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Everything external is mocked: no database, no Meta.

const copyCode = (id, extra = {}) => ({
  id, workspaceId: 'w1', name: `tpl_${id}`, language: 'en', status: 'APPROVED', category: 'AUTHENTICATION',
  components: [{ type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] }],
  ...extra,
});

let templates;
let numbers;
let campaigns;
let config;
let sent;

const prisma = {
  template: { findFirst: async ({ where }) => templates.find((t) => t.id === where.id && t.workspaceId === where.workspaceId && (!where.status || t.status === where.status)) ?? null },
  waNumber: { findFirst: async ({ where }) => numbers.find((n) => n.id === where.id && n.workspaceId === where.workspaceId) ?? null },
  campaign: { findFirst: async ({ where }) => campaigns.find((c) => c.id === where.id && c.workspaceId === where.workspaceId) ?? null },
  authenticationConfig: { findUnique: async () => config },
};

mock.module(new URL('../lib/prisma.js', import.meta.url).href, { namedExports: { prisma } });
mock.module(new URL('../lib/encryption.js', import.meta.url).href, { namedExports: { decrypt: (v) => `plain-${v}`, encrypt: (v) => v } });
mock.module(new URL('../lib/meta.js', import.meta.url).href, {
  namedExports: {
    sendWhatsAppMessage: async (phoneNumberId, token, to, payload) => {
      sent.push({ phoneNumberId, token, to, template: payload.name });
      return { messages: [{ id: 'wamid.1' }] };
    },
  },
});
mock.module(new URL('./otp.service.js', import.meta.url).href, {
  namedExports: {
    createAuthenticationTransaction: async () => ({ transactionId: 't1', code: '123456', expiresAt: new Date(Date.now() + 600_000) }),
    attachMetaMessageId: async () => {},
    invalidateAuthenticationTransaction: async () => {},
    verifyAuthenticationTransaction: async () => ({ verified: true }),
  },
});
mock.module(new URL('../services/optout.service.js', import.meta.url).href, {
  namedExports: { assertNotOptedOut: async () => {}, normalizePhone: (raw) => String(raw ?? '').replace(/\D/g, '') },
});

const { sendAuthenticationOtp } = await import('./authentication.service.js');

beforeEach(() => {
  templates = [copyCode('tplConfig'), copyCode('tplCampaign')];
  numbers = [
    { id: 'numConfig', workspaceId: 'w1', metaPhoneNumberId: 'PN-CONFIG', encryptedAccessToken: 'c' },
    { id: 'numCampaign', workspaceId: 'w1', metaPhoneNumberId: 'PN-CAMPAIGN', encryptedAccessToken: 'k' },
  ];
  campaigns = [{ id: 'camp1', workspaceId: 'w1', templateId: 'tplCampaign', waNumberId: 'numCampaign' }];
  config = { workspaceId: 'w1', enabled: true, templateId: 'tplConfig', waNumberId: 'numConfig' };
  sent = [];
});

test('a campaign OTP goes out on the campaign’s own template and number', async () => {
  await sendAuthenticationOtp('w1', { to: '+919876543210', campaignId: 'camp1', templateId: 'tplCampaign', waNumberId: 'numCampaign' });
  assert.deepEqual(sent[0], { phoneNumberId: 'PN-CAMPAIGN', token: 'plain-k', to: '919876543210', template: 'tpl_tplCampaign' });
});

test('a campaign OTP does not need the workspace Authentication product configured', async () => {
  config = null;
  await sendAuthenticationOtp('w1', { to: '+919876543210', campaignId: 'camp1', templateId: 'tplCampaign', waNumberId: 'numCampaign' });
  assert.equal(sent.length, 1);
});

test('the public API path still uses the workspace configuration', async () => {
  await sendAuthenticationOtp('w1', { to: '+919876543210' });
  assert.equal(sent[0].phoneNumberId, 'PN-CONFIG');
  assert.equal(sent[0].template, 'tpl_tplConfig');
});

test('sender ids that do not match the campaign are refused', async () => {
  await assert.rejects(
    sendAuthenticationOtp('w1', { to: '+919876543210', campaignId: 'camp1', templateId: 'tplConfig', waNumberId: 'numCampaign' }),
    /campaign not found/i,
  );
  assert.equal(sent.length, 0);
});

test('a campaign template that is not a COPY_CODE authentication template is refused', async () => {
  templates[1] = copyCode('tplCampaign', { category: 'MARKETING' });
  await assert.rejects(
    sendAuthenticationOtp('w1', { to: '+919876543210', campaignId: 'camp1', templateId: 'tplCampaign', waNumberId: 'numCampaign' }),
    /COPY_CODE/,
  );
});

test('a template bound to another number is refused', async () => {
  templates[1] = copyCode('tplCampaign', { waNumberId: 'numConfig' });
  await assert.rejects(
    sendAuthenticationOtp('w1', { to: '+919876543210', campaignId: 'camp1', templateId: 'tplCampaign', waNumberId: 'numCampaign' }),
    /different WhatsApp number/,
  );
});
