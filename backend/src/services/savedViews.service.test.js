import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import {
  listSavedViews, createSavedView, updateSavedView, deleteSavedView,
} from './savedViews.service.js';

let dbAvailable = false;
let workspaceId;
let alice;
let bob;

test.before(async () => {
  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    return;
  }
  const stamp = Date.now();
  workspaceId = (await prisma.workspace.create({ data: { name: `test-views-${stamp}` } })).id;
  alice = (await prisma.user.create({ data: { name: 'Alice', email: `alice-${stamp}@example.test` } })).id;
  bob = (await prisma.user.create({ data: { name: 'Bob', email: `bob-${stamp}@example.test` } })).id;
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  for (const id of [alice, bob]) {
    if (id) await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect().catch(() => {});
});

test('a view round-trips its filters', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const view = await createSavedView(workspaceId, alice, {
    entity: 'leads',
    name: 'Hot leads',
    filters: { status: 'QUALIFIED', sort: 'score', minScore: 70 },
  });

  assert.equal(view.entity, 'leads');
  assert.deepEqual(view.filters, { status: 'QUALIFIED', sort: 'score', minScore: 70 });
  assert.equal(view.isShared, false);
  assert.equal(view.createdByUserId, alice);
});

test('re-saving the same name updates in place instead of duplicating', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const first = await createSavedView(workspaceId, alice, {
    entity: 'deals', name: 'Closing soon', filters: { stage: 'PROPOSAL' },
  });
  const second = await createSavedView(workspaceId, alice, {
    entity: 'deals', name: 'Closing soon', filters: { stage: 'NEGOTIATION' },
  });

  assert.equal(second.id, first.id, 'a repeat save must not create a second view');
  assert.deepEqual(second.filters, { stage: 'NEGOTIATION' });

  const { data } = await listSavedViews(workspaceId, alice, { entity: 'deals' });
  assert.equal(data.filter((v) => v.name === 'Closing soon').length, 1);
});

test('a private view is invisible to everyone but its author', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  await createSavedView(workspaceId, alice, {
    entity: 'tasks', name: 'Alice private', filters: { status: 'PENDING' },
  });

  const mine = await listSavedViews(workspaceId, alice, { entity: 'tasks' });
  assert.ok(mine.data.some((v) => v.name === 'Alice private'));

  const theirs = await listSavedViews(workspaceId, bob, { entity: 'tasks' });
  assert.ok(!theirs.data.some((v) => v.name === 'Alice private'), 'a private view leaked to another user');
});

test('a shared view is visible to the workspace but still owned by its author', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const shared = await createSavedView(workspaceId, alice, {
    entity: 'leads', name: 'Team pipeline', filters: { status: 'NEW' }, isShared: true,
  });

  const seenByBob = await listSavedViews(workspaceId, bob, { entity: 'leads' });
  assert.ok(seenByBob.data.some((v) => v.id === shared.id), 'a shared view should be readable by the workspace');

  // Readable is not the same as editable.
  await assert.rejects(
    () => updateSavedView(workspaceId, bob, shared.id, { name: 'Hijacked' }),
    (e) => e.status === 403,
    'a non-author must not be able to edit a shared view',
  );
  await assert.rejects(
    () => deleteSavedView(workspaceId, bob, shared.id),
    (e) => e.status === 403,
    'a non-author must not be able to delete a shared view',
  );

  const still = await prisma.savedView.findUnique({ where: { id: shared.id }, select: { name: true } });
  assert.equal(still.name, 'Team pipeline');
});

test('the author can rename, reshare and delete their own view', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const view = await createSavedView(workspaceId, alice, {
    entity: 'deals', name: 'Scratch', filters: {},
  });

  const renamed = await updateSavedView(workspaceId, alice, view.id, { name: 'Renamed', isShared: true });
  assert.equal(renamed.name, 'Renamed');
  assert.equal(renamed.isShared, true);

  await deleteSavedView(workspaceId, alice, view.id);
  assert.equal(await prisma.savedView.findUnique({ where: { id: view.id } }), null);
});

test('an unknown entity is refused', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  await assert.rejects(
    () => createSavedView(workspaceId, alice, { entity: 'invoices', name: 'Nope', filters: {} }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    () => listSavedViews(workspaceId, alice, { entity: 'invoices' }),
    (e) => e.status === 400,
  );
});

test('views from another workspace are never returned', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const other = await prisma.workspace.create({ data: { name: `test-views-other-${Date.now()}` } });
  try {
    await createSavedView(other.id, alice, { entity: 'leads', name: 'Foreign view', filters: {}, isShared: true });

    const { data } = await listSavedViews(workspaceId, alice, {});
    assert.ok(!data.some((v) => v.name === 'Foreign view'), 'another workspace leaked into saved views');
  } finally {
    await prisma.workspace.delete({ where: { id: other.id } }).catch(() => {});
  }
});
