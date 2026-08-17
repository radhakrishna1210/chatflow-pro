import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { searchWorkspace } from './search.service.js';

let dbAvailable = false;
let workspaceId;
let otherWorkspaceId;
const TOKEN = `Zarquon${Date.now().toString().slice(-6)}`;

test.before(async () => {
  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    return;
  }
  const stamp = Date.now();
  workspaceId = (await prisma.workspace.create({ data: { name: `test-search-${stamp}` } })).id;
  otherWorkspaceId = (await prisma.workspace.create({ data: { name: `test-search-other-${stamp}` } })).id;

  const contact = await prisma.contact.create({
    data: { workspaceId, name: `${TOKEN} Industries`, phoneNumber: `+9144${stamp.toString().slice(-8)}`, email: `${TOKEN}@example.test` },
  });
  await prisma.lead.create({ data: { workspaceId, contactId: contact.id, score: 55 } });
  await prisma.deal.create({ data: { workspaceId, contactId: contact.id, title: `${TOKEN} renewal`, stage: 'PROPOSAL', value: 1000 } });
  await prisma.task.create({ data: { workspaceId, title: `Call ${TOKEN}` } });

  // Same distinctive token in a different workspace — must never be returned.
  const foreign = await prisma.contact.create({
    data: { workspaceId: otherWorkspaceId, name: `${TOKEN} Foreign`, phoneNumber: `+9133${stamp.toString().slice(-8)}` },
  });
  await prisma.deal.create({ data: { workspaceId: otherWorkspaceId, contactId: foreign.id, title: `${TOKEN} foreign deal` } });
});

test.after(async () => {
  for (const id of [workspaceId, otherWorkspaceId]) {
    if (id) await prisma.workspace.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect().catch(() => {});
});

test('search reaches contacts, leads, deals and tasks in one call', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { results } = await searchWorkspace(workspaceId, { q: TOKEN });
  const types = new Set(results.map((r) => r.type));

  for (const expected of ['contact', 'lead', 'deal', 'task']) {
    assert.ok(types.has(expected), `expected a ${expected} result`);
  }
  assert.ok(results.every((r) => r.id && r.title && r.href), 'every result needs an id, title and destination');
});

test('search never crosses a workspace boundary', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { results } = await searchWorkspace(workspaceId, { q: TOKEN });
  assert.ok(
    results.every((r) => !/Foreign|foreign deal/.test(r.title)),
    'another workspace leaked into search results',
  );

  const foreign = await searchWorkspace(otherWorkspaceId, { q: TOKEN });
  assert.ok(foreign.results.some((r) => /Foreign|foreign deal/.test(r.title)));
  assert.ok(foreign.results.every((r) => !/Industries|renewal/.test(r.title)));
});

test('a one-character query returns nothing rather than the whole workspace', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  for (const q of ['', ' ', 'a']) {
    const { results, total } = await searchWorkspace(workspaceId, { q });
    assert.equal(total, 0, `query ${JSON.stringify(q)} should not match`);
    assert.deepEqual(results, []);
  }
});

test('search matches on phone number and is case insensitive', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const lower = await searchWorkspace(workspaceId, { q: TOKEN.toLowerCase() });
  assert.ok(lower.results.length > 0, 'search should ignore case');

  const contact = await prisma.contact.findFirst({ where: { workspaceId }, select: { phoneNumber: true } });
  const byPhone = await searchWorkspace(workspaceId, { q: contact.phoneNumber.slice(-6) });
  assert.ok(byPhone.results.some((r) => r.type === 'contact'), 'a partial phone number should find the contact');
});

test('the per-entity limit is clamped to a sane range', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const huge = await searchWorkspace(workspaceId, { q: TOKEN, limit: 10_000 });
  // 4 entity types, capped at 20 each.
  assert.ok(huge.results.length <= 80);

  const zero = await searchWorkspace(workspaceId, { q: TOKEN, limit: 0 });
  assert.ok(zero.results.length > 0, 'a zero limit must not silently return nothing');
});
