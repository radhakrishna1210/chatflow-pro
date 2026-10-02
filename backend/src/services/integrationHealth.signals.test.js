import test from 'node:test';
import assert from 'node:assert/strict';

// Integration health is derived from recorded signals only. A workspace with
// one number and one web lead form used to read "ALL_SYSTEMS_OPERATIONAL",
// 99.98% uptime and 42 ms latency regardless of reality.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;

const { prisma } = await import('../lib/prisma.js');
const { getIntegrationHealth } = await import('./integrationHealth.service.js');

let numbers;
let integrations;
prisma.waNumber.findMany = async () => numbers;
prisma.workspaceIntegration.findFirst = async ({ where }) => {
  const providers = where.provider.in ?? [where.provider];
  return integrations.find((i) => providers.includes(i.provider)) ?? null;
};
const inbound = new Date('2026-10-01T10:00:00Z');
prisma.message.findFirst = async ({ where }) => (where.direction === 'INBOUND'
  ? { sentAt: inbound }
  : { sentAt: inbound, statusAt: inbound, errorCode: 131026, errorMessage: 'Message undeliverable' });
prisma.message.count = async ({ where }) => (where.status === 'FAILED' ? 2 : 10);

const healthyNumber = { id: 'n1', phoneNumber: '+911', displayName: 'Main', status: 'ACTIVE', quality: 'GREEN', appSubscribed: true, unreachableSince: null, unreachableReason: null, codeVerificationStatus: 'VERIFIED' };

test.beforeEach(() => { numbers = [healthyNumber]; integrations = []; });

test('no fabricated metrics; optional integrations left unset do not degrade the workspace', async () => {
  const res = await getIntegrationHealth('ws');
  assert.equal(res.uptime, undefined);
  assert.ok(!res.integrations.some((i) => i.provider === 'meta-graph' || 'latencyMs' in i));
  assert.equal(res.overallStatus, 'ALL_SYSTEMS_OPERATIONAL');
  const wa = res.integrations.find((i) => i.provider === 'whatsapp');
  assert.equal(wa.lastInboundAt, inbound);
  assert.deepEqual(wa.lastSendFailure, { at: inbound, code: 131026, message: 'Message undeliverable' });
  assert.equal(wa.failedSendsLast24h, 2);
  assert.equal(res.integrations.find((i) => i.provider === 'facebook-lead').status, 'NOT_CONFIGURED');
});

test('an unreachable or unsubscribed number makes WhatsApp degraded and the workspace need attention', async () => {
  numbers = [{ ...healthyNumber, unreachableSince: new Date('2026-09-30T00:00:00Z'), unreachableReason: 'Meta error 100' }, { ...healthyNumber, id: 'n2', appSubscribed: false }];
  const res = await getIntegrationHealth('ws');
  const wa = res.integrations.find((i) => i.provider === 'whatsapp');
  assert.equal(wa.status, 'DEGRADED');
  assert.equal(res.overallStatus, 'NEEDS_ATTENTION');
  assert.match(wa.numbers[0].problems[0], /Unreachable/);
  assert.match(wa.numbers[1].problems[0], /Webhook not subscribed/);
});

test('facebook lead ads is connected only through its integration row, not because a web form exists', async () => {
  integrations = [{ provider: 'facebook-lead', status: 'CONNECTED', connectedAt: inbound }, { provider: 'google', status: 'CONNECTED', connectedAt: inbound }];
  const res = await getIntegrationHealth('ws');
  assert.equal(res.integrations.find((i) => i.provider === 'facebook-lead').status, 'HEALTHY');
  assert.equal(res.integrations.find((i) => i.provider === 'google-sheets').status, 'HEALTHY');
  numbers = [];
  assert.equal((await getIntegrationHealth('ws')).overallStatus, 'NEEDS_ATTENTION');
});
