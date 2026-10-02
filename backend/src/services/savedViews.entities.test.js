import test from 'node:test';
import assert from 'node:assert/strict';

// SavedView also holds workspace configuration (customization sections,
// distribution rules, AI agents), much of it isShared. Listing without an
// entity returned all of it to any member, and a config row whose author was
// the caller could be deleted through /saved-views.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;

const { prisma } = await import('../lib/prisma.js');
const { listSavedViews, deleteSavedView, updateSavedView } = await import('./savedViews.service.js');

const rows = [
  { id: 'v1', workspaceId: 'ws', entity: 'leads', createdByUserId: 'me', isShared: false },
  { id: 'c1', workspaceId: 'ws', entity: 'crm_customization', createdByUserId: 'me', isShared: true },
  { id: 'c2', workspaceId: 'ws', entity: 'lead_distribution_rules', createdByUserId: null, isShared: true },
];
const entityMatches = (row, cond) => (typeof cond === 'string' ? row.entity === cond : cond.in.includes(row.entity));
prisma.savedView.findMany = async ({ where }) => rows.filter((r) => r.workspaceId === where.workspaceId && entityMatches(r, where.entity));
prisma.savedView.findFirst = async ({ where }) => rows.find((r) => r.id === where.id && entityMatches(r, where.entity)) ?? null;
const deleted = [];
prisma.savedView.delete = async ({ where }) => { deleted.push(where.id); };
prisma.savedView.update = async ({ where }) => ({ id: where.id });

test('listing without an entity returns list views only', async () => {
  const { data } = await listSavedViews('ws', 'me');
  assert.deepEqual(data.map((v) => v.id), ['v1']);
});

test('config rows cannot be updated or deleted through saved views, even by their author', async () => {
  await assert.rejects(deleteSavedView('ws', 'me', 'c1'), (e) => e.status === 404);
  await assert.rejects(updateSavedView('ws', 'me', 'c1', { isShared: false }), (e) => e.status === 404);
  await deleteSavedView('ws', 'me', 'v1');
  assert.deepEqual(deleted, ['v1']);
});
