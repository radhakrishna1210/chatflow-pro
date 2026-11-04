import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { encrypt } from '../lib/encryption.js';
import { connectIntegration, listIntegrations } from './integrations.service.js';

let dbAvailable = false;
let workspaceId;

test.before(async () => {
  try { await prisma.$connect(); dbAvailable = true; } catch { return; }
  workspaceId = (await prisma.workspace.create({ data: { name: `test-intg-${Date.now()}` } })).id;
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

test('rejects malformed connect input', async (t) => {
  if (!dbAvailable) return t.skip('Database unavailable');
  const bad = [
    ['../x', { type: 'webhook' }],
    ['a'.repeat(80), { type: 'webhook' }],
    ['razorpay', { type: 'bogus' }],
    ['razorpay', { type: 'apikey' }],
    ['razorpay', { type: 'apikey', credentials: { key: { nested: true } } }],
    ['razorpay', { type: 'apikey', credentials: ['x'] }],
    ['zapier', { type: 'webhook', config: 'string' }],
    ['zapier', { type: 'webhook', config: { blob: 'x'.repeat(5000) } }],
  ];
  for (const [provider, input] of bad) {
    await assert.rejects(connectIntegration(workspaceId, provider, input), (e) => e.status === 400, `${provider} ${JSON.stringify(input).slice(0, 60)}`);
  }
});

test('api-key credentials are stored encrypted and never returned', async (t) => {
  if (!dbAvailable) return t.skip('Database unavailable');
  const row = await connectIntegration(workspaceId, 'razorpay', { type: 'apikey', credentials: { key_id: 'rzp_test_1', key_secret: 's3cret' } });
  assert.equal(row.hasCredentials, true);
  assert.equal(row.encryptedCredentials, undefined);
  const listed = await listIntegrations(workspaceId);
  assert.ok(!JSON.stringify(listed).includes('s3cret'));
});

test('a manual oauth record is PENDING and cannot wipe a real OAuth grant', async (t) => {
  if (!dbAvailable) return t.skip('Database unavailable');
  const pending = await connectIntegration(workspaceId, 'zoho-crm', { type: 'oauth', config: { oauth: true, pending: true } });
  assert.equal(pending.status, 'PENDING');

  await prisma.workspaceIntegration.create({
    data: { workspaceId, provider: 'hubspot', type: 'oauth', status: 'CONNECTED', encryptedCredentials: encrypt('{"access_token":"t"}') },
  });
  const res = await connectIntegration(workspaceId, 'hubspot', { type: 'oauth', config: { pending: true } });
  assert.equal(res.status, 'CONNECTED');
  const stored = await prisma.workspaceIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider: 'hubspot' } } });
  assert.ok(stored.encryptedCredentials, 'real OAuth tokens must survive');
});
