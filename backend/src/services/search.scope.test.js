import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { searchWorkspace } from './search.service.js';

// DEF-013: global search ignored record-level visibility.
//
// `searchWorkspace` was written before teams and record scoping existed, and
// its comment still claimed workspace scoping "IS the permission model here".
// Once `recordVisibility` could be set to TEAM or OWN, that stopped being true:
// the command palette returned leads, deals and tasks the user could not open,
// including their titles and values. Opening one 404s, which is the tell that
// the list should never have contained it.
//
// Contacts are deliberately excluded from scoping — they have no owner field,
// and the shared contact list is the same for the whole workspace by design.

let dbAvailable = false;
let workspaceId;
let ownerId;
let strangerId;

test.before(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    return;
  }

  const workspace = await prisma.workspace.create({
    data: { name: `search-scope-${Date.now()}`, recordVisibility: 'OWN' },
  });
  workspaceId = workspace.id;

  const mk = async (suffix) => {
    const u = await prisma.user.create({
      data: { name: `u-${suffix}-${Date.now()}`, email: `u-${suffix}-${Date.now()}@example.com` },
    });
    await prisma.workspaceMember.create({ data: { workspaceId, userId: u.id, role: 'CLIENT' } });
    return u.id;
  };
  ownerId = await mk('owner');
  strangerId = await mk('stranger');

  const contact = await prisma.contact.create({
    data: { workspaceId, name: 'Zephyrine Quarrytide', phoneNumber: `+9198${Date.now() % 100000000}`, tags: [] },
  });

  await prisma.deal.create({
    data: { workspaceId, title: 'Zephyrine Confidential Rollout', stage: 'PROPOSAL', value: 500000, contactId: contact.id, ownerUserId: ownerId },
  });
  await prisma.lead.create({
    data: { workspaceId, contactId: contact.id, status: 'NEW', source: 'Zephyrine referral', score: 40, ownerUserId: ownerId },
  });
  await prisma.task.create({
    data: { workspaceId, title: 'Zephyrine private follow-up', status: 'PENDING', assignedToUserId: ownerId },
  });
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  await prisma.$disconnect();
});

const asUser = (id) => ({ id, role: 'CLIENT', workspaceId });
const typesFor = (results, type) => results.filter((r) => r.type === type);

test('a stranger does not see another user\'s deal, lead or task through search', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { results } = await searchWorkspace(workspaceId, { q: 'Zephyrine' }, asUser(strangerId));

  assert.equal(typesFor(results, 'deal').length, 0, 'a deal owned by someone else leaked through search');
  assert.equal(typesFor(results, 'lead').length, 0, 'a lead owned by someone else leaked through search');
  assert.equal(typesFor(results, 'task').length, 0, 'a task assigned to someone else leaked through search');
});

test('the owner still finds their own records', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { results } = await searchWorkspace(workspaceId, { q: 'Zephyrine' }, asUser(ownerId));

  assert.equal(typesFor(results, 'deal').length, 1);
  assert.equal(typesFor(results, 'lead').length, 1);
  assert.equal(typesFor(results, 'task').length, 1);
});

test('the shared contact stays visible to everyone', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { results } = await searchWorkspace(workspaceId, { q: 'Zephyrine' }, asUser(strangerId));
  assert.equal(typesFor(results, 'contact').length, 1, 'contacts are workspace-wide by design and must not be scoped away');
});

test('an admin sees everything', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { results } = await searchWorkspace(workspaceId, { q: 'Zephyrine' }, { id: strangerId, role: 'ADMIN', workspaceId });
  assert.equal(typesFor(results, 'deal').length, 1);
});
