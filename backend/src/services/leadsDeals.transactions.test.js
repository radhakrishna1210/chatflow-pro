import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { convertLead } from './leads.service.js';
import { updateDealStage, getDeal } from './deals.service.js';

// These exercise the real $transaction paths against the configured database.
// Everything is created under a throwaway workspace and removed afterwards —
// the workspace cascade takes the contacts, leads, deals and history with it.
let dbAvailable = false;
let workspaceId;
let userId;
let contactId;

test.before(async () => {
  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    return;
  }
  const stamp = Date.now();
  const workspace = await prisma.workspace.create({ data: { name: `test-leads-${stamp}` } });
  workspaceId = workspace.id;
  const user = await prisma.user.create({ data: { name: 'Test Runner', email: `test-leads-${stamp}@example.test` } });
  userId = user.id;
  const contact = await prisma.contact.create({
    data: { workspaceId, name: 'Convert Target', phoneNumber: `+9199${stamp.toString().slice(-8)}` },
  });
  contactId = contact.id;
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

test('convertLead creates the deal, its first history row, and marks the lead converted', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const lead = await prisma.lead.create({ data: { workspaceId, contactId } });

  const deal = await convertLead(workspaceId, lead.id, { title: 'Converted Deal', value: 5000 }, userId);

  assert.equal(deal.contactId, contactId);
  assert.equal(deal.leadId, lead.id);
  assert.equal(deal.stage, 'QUALIFICATION');

  const refreshed = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.equal(refreshed.status, 'CONVERTED');
  assert.equal(refreshed.convertedDealId, deal.id);
  assert.ok(refreshed.convertedAt instanceof Date);

  const history = await prisma.dealStageHistory.findMany({ where: { dealId: deal.id } });
  assert.equal(history.length, 1);
  assert.equal(history[0].fromStage, null);
  assert.equal(history[0].toStage, 'QUALIFICATION');
  assert.equal(history[0].changedByUserId, userId);
});

test('converting an already-converted lead is refused with 409', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await prisma.contact.create({
    data: { workspaceId, name: 'Double Convert', phoneNumber: `+9188${Date.now().toString().slice(-8)}` },
  });
  const lead = await prisma.lead.create({ data: { workspaceId, contactId: contact.id } });
  await convertLead(workspaceId, lead.id, { title: 'First' }, userId);

  const dealsBefore = await prisma.deal.count({ where: { leadId: lead.id } });
  await assert.rejects(
    () => convertLead(workspaceId, lead.id, { title: 'Second' }, userId),
    (err) => err.status === 409,
  );
  // The rejected attempt must not have left a second deal behind.
  assert.equal(await prisma.deal.count({ where: { leadId: lead.id } }), dealsBefore);
});

test('every stage move appends a history row and closes terminal stages', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await prisma.contact.create({
    data: { workspaceId, name: 'Pipeline Mover', phoneNumber: `+9177${Date.now().toString().slice(-8)}` },
  });
  const lead = await prisma.lead.create({ data: { workspaceId, contactId: contact.id } });
  const deal = await convertLead(workspaceId, lead.id, { title: 'Moving Deal' }, userId);

  await updateDealStage(workspaceId, deal.id, { stage: 'PROPOSAL' }, userId);
  await updateDealStage(workspaceId, deal.id, { stage: 'NEGOTIATION' }, userId);
  const won = await updateDealStage(workspaceId, deal.id, { stage: 'CLOSED_WON' }, userId);

  assert.equal(won.stage, 'CLOSED_WON');
  assert.ok(won.closedAt instanceof Date, 'terminal stage sets closedAt');

  const full = await getDeal(workspaceId, deal.id);
  assert.equal(full.stageHistory.length, 4, 'initial + three moves');
  assert.deepEqual(
    full.stageHistory.map((h) => h.toStage),
    ['QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON'],
  );
  assert.equal(full.stageHistory[1].fromStage, 'QUALIFICATION');
});

test('reopening a closed-lost deal clears the loss reason and close date', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await prisma.contact.create({
    data: { workspaceId, name: 'Reopened', phoneNumber: `+9166${Date.now().toString().slice(-8)}` },
  });
  const lead = await prisma.lead.create({ data: { workspaceId, contactId: contact.id } });
  const deal = await convertLead(workspaceId, lead.id, { title: 'Reopen Me' }, userId);

  const lost = await updateDealStage(workspaceId, deal.id, { stage: 'CLOSED_LOST', lostReason: 'Budget cut' }, userId);
  assert.equal(lost.lostReason, 'Budget cut');
  assert.ok(lost.closedAt instanceof Date);

  const reopened = await updateDealStage(workspaceId, deal.id, { stage: 'PROPOSAL' }, userId);
  assert.equal(reopened.lostReason, null);
  assert.equal(reopened.closedAt, null);
});

test('a deal from another workspace is not reachable', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const other = await prisma.workspace.create({ data: { name: `test-other-${Date.now()}` } });
  try {
    const contact = await prisma.contact.create({
      data: { workspaceId, name: 'Isolation', phoneNumber: `+9155${Date.now().toString().slice(-8)}` },
    });
    const lead = await prisma.lead.create({ data: { workspaceId, contactId: contact.id } });
    const deal = await convertLead(workspaceId, lead.id, { title: 'Private Deal' }, userId);

    await assert.rejects(
      () => updateDealStage(other.id, deal.id, { stage: 'PROPOSAL' }, userId),
      (err) => err.status === 404,
    );
    await assert.rejects(() => getDeal(other.id, deal.id), (err) => err.status === 404);
  } finally {
    await prisma.workspace.delete({ where: { id: other.id } }).catch(() => {});
  }
});
