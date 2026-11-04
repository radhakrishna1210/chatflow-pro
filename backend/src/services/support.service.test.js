import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { createTicket, listWorkspaceTickets } from './support.service.js';

let dbAvailable = false;
let workspaceId;
let otherWorkspaceId;

test.before(async () => {
  try { await prisma.$connect(); dbAvailable = true; } catch { return; }
  workspaceId = (await prisma.workspace.create({ data: { name: `test-support-${Date.now()}` } })).id;
  otherWorkspaceId = (await prisma.workspace.create({ data: { name: `test-support-other-${Date.now()}` } })).id;
});

test.after(async () => {
  for (const id of [workspaceId, otherWorkspaceId]) {
    if (id) await prisma.workspace.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect().catch(() => {});
});

test('rejects non-string fields and unknown categories with 400', async (t) => {
  if (!dbAvailable) return t.skip('Database unavailable');
  for (const body of [
    { subject: 123, message: 'x' },
    { subject: 'x', message: { a: 1 } },
    { subject: '  ', message: 'x' },
    { subject: 'x', message: 'y', category: 'x'.repeat(500) },
    { subject: 'x', message: 'y', category: ['GENERAL'] },
  ]) {
    await assert.rejects(createTicket(workspaceId, null, body), (e) => e.status === 400, JSON.stringify(body).slice(0, 60));
  }
});

test('stores a valid ticket, trimmed and capped, visible only to its workspace', async (t) => {
  if (!dbAvailable) return t.skip('Database unavailable');
  const ticket = await createTicket(workspaceId, null, { subject: ' Help ', message: 'm'.repeat(5000), category: 'billing' });
  assert.equal(ticket.subject, 'Help');
  assert.equal(ticket.message.length, 4000);
  assert.equal(ticket.category, 'BILLING');
  assert.equal((await listWorkspaceTickets(otherWorkspaceId)).length, 0);
});
