import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { getIntegrationHealth } from './integrationHealth.service.js';

let dbAvailable = false;
let workspaceId;

test('Integration Health - Module exports getIntegrationHealth', () => {
  assert.equal(typeof getIntegrationHealth, 'function');
});


test.before(async () => {

  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    return;
  }
  const stamp = Date.now();
  workspaceId = (await prisma.workspace.create({ data: { name: `test-health-${stamp}` } })).id;

  // Add dummy active WA number
  await prisma.waNumber.create({
    data: {
      workspaceId,
      phoneNumber: `+9198${stamp.toString().slice(-8)}`,
      displayName: 'Main Support WhatsApp',
      metaPhoneNumberId: `meta_${stamp}`,
      wabaId: `waba_${stamp}`,
      encryptedAccessToken: 'test_token',
    },
  });
});

test.after(async () => {
  if (!dbAvailable) return;
  try {
    await prisma.waNumber.deleteMany({ where: { workspaceId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.$disconnect();
  } catch {}
});

test('Integration Health - Retrieves status and detects active WhatsApp numbers', async (t) => {
  if (!dbAvailable) {
    t.skip('Database unavailable');
    return;
  }

  const result = await getIntegrationHealth(workspaceId);
  assert.ok(result);
  assert.equal(result.totalIntegrations, 4);
  assert.ok(['ALL_SYSTEMS_OPERATIONAL', 'PARTIALLY_OPERATIONAL', 'NEEDS_ATTENTION'].includes(result.overallStatus));

  const wa = result.integrations.find((i) => i.provider === 'whatsapp');
  assert.ok(wa);
  assert.equal(wa.status, 'HEALTHY');
  assert.equal(wa.statusCode, 'CONNECTED');
  assert.equal(wa.numbers.length, 1);
  assert.equal(wa.numbers[0].displayName, 'Main Support WhatsApp');

  const meta = result.integrations.find((i) => i.provider === 'meta-graph');
  assert.ok(meta);
  assert.equal(meta.status, 'HEALTHY');
  assert.equal(meta.apiVersion, 'v20.0');
});
