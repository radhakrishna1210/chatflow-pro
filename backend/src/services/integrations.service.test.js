import test from 'node:test';
import assert from 'node:assert/strict';

// The generic connect endpoint used to accept `{ type: 'oauth', config: { pending: true } }`
// and store it as CONNECTED, so providers with no OAuth flow showed as connected.

const { prisma } = await import('../lib/prisma.js');
const { connectIntegration } = await import('./integrations.service.js');

const upserts = [];
prisma.workspaceIntegration.upsert = async ({ create }) => {
  upserts.push(create);
  return { id: 'wi_1', ...create };
};

test('connectIntegration rejects OAuth placeholders', async () => {
  await assert.rejects(
    connectIntegration('ws_1', 'salesforce', { type: 'oauth', config: { oauth: true, pending: true } }),
    (err) => err.status === 400,
  );
  assert.equal(upserts.length, 0, 'nothing is stored');
});

test('connectIntegration still stores API-key and webhook connections', async () => {
  const hook = await connectIntegration('ws_1', 'zapier', { type: 'webhook', config: { webhook_url: 'https://example.test/h' } });
  assert.equal(hook.status, 'CONNECTED');
  assert.equal(hook.hasCredentials, false);
  assert.equal(upserts.length, 1);
});
