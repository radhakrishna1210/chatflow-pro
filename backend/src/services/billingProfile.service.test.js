import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const rows = new Map();
const prisma = {
  workspaceBillingProfile: {
    findUnique: async ({ where }) => rows.get(where.workspaceId) ?? null,
    upsert: async ({ where, update, create }) => {
      const row = rows.has(where.workspaceId) ? { ...rows.get(where.workspaceId), ...update } : { ...create };
      rows.set(where.workspaceId, row);
      return row;
    },
  },
};
mock.module('../lib/prisma.js', { namedExports: { prisma } });
const { getBillingProfile, saveBillingProfile } = await import('./billingProfile.service.js');

test('an unsaved profile reads as blank fields', async () => {
  assert.deepEqual(await getBillingProfile('ws_new'), { businessName: '', email: '', address: '', taxId: '' });
});

test('saving trims, stores blanks as null and upper-cases the tax id', async () => {
  const saved = await saveBillingProfile('ws_1', {
    businessName: '  Acme Pvt Ltd ', email: 'billing@acme.in', address: '', taxId: '29aaaaa0000a1z5',
  });
  assert.deepEqual(saved, { businessName: 'Acme Pvt Ltd', email: 'billing@acme.in', address: '', taxId: '29AAAAA0000A1Z5' });
  assert.equal(rows.get('ws_1').address, null);
  // Workspaces never see each other's profile.
  assert.equal((await getBillingProfile('ws_2')).businessName, '');
});
