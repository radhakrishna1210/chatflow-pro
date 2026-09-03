import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { getForecast } from './forecast.service.js';
import { listStages, updateStage, reorderStages, stageProbabilities } from './pipelineStages.service.js';

let dbAvailable = false;
let workspaceId;
let ownerA;
let ownerB;

const inPeriod = new Date();
inPeriod.setDate(15);
const periodFrom = new Date(inPeriod.getFullYear(), inPeriod.getMonth(), 1);
const periodTo = new Date(inPeriod.getFullYear(), inPeriod.getMonth() + 1, 0, 23, 59, 59, 999);

test.before(async () => {
  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    return;
  }
  const stamp = Date.now();
  workspaceId = (await prisma.workspace.create({ data: { name: `test-fc-${stamp}` } })).id;
  ownerA = (await prisma.user.create({ data: { name: 'Owner A', email: `fca-${stamp}@example.test` } })).id;
  ownerB = (await prisma.user.create({ data: { name: 'Owner B', email: `fcb-${stamp}@example.test` } })).id;

  const contact = await prisma.contact.create({
    data: { workspaceId, name: 'Forecast Co', phoneNumber: `+9122${stamp.toString().slice(-8)}` },
  });

  const deal = (d) => prisma.deal.create({ data: { workspaceId, contactId: contact.id, ...d } });

  // Open, dated inside the period. Default probabilities: NEGOTIATION 75
  // (commit), PROPOSAL 50 (best case), QUALIFICATION 10 (pipeline).
  await deal({ title: 'Commit A',   value: 1000, stage: 'NEGOTIATION',   expectedCloseDate: inPeriod, ownerUserId: ownerA });
  await deal({ title: 'Best A',     value: 2000, stage: 'PROPOSAL',      expectedCloseDate: inPeriod, ownerUserId: ownerA });
  await deal({ title: 'Pipeline B', value: 500,  stage: 'QUALIFICATION', expectedCloseDate: inPeriod, ownerUserId: ownerB });

  // Won inside the period.
  await deal({ title: 'Won A', value: 3000, stage: 'CLOSED_WON', closedAt: inPeriod, ownerUserId: ownerA });
  await deal({ title: 'Lost B', value: 800, stage: 'CLOSED_LOST', closedAt: inPeriod, ownerUserId: ownerB });

  // Open but undated — must be excluded from the period and counted separately.
  await deal({ title: 'No date', value: 9999, stage: 'PROPOSAL', ownerUserId: ownerA });

  // Open, dated well outside the period.
  const farFuture = new Date(inPeriod.getFullYear() + 1, 5, 1);
  await deal({ title: 'Next year', value: 7777, stage: 'NEGOTIATION', expectedCloseDate: farFuture, ownerUserId: ownerA });
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  for (const id of [ownerA, ownerB]) {
    if (id) await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect().catch(() => {});
});

test('default stages are created on first read', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { data } = await listStages(workspaceId);
  assert.equal(data.length, 6);
  assert.deepEqual(data.map((s) => s.key), [
    'QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST',
  ]);
  assert.equal(data.find((s) => s.key === 'PROPOSAL').probability, 50);
});

test('deals are bucketed by stage probability', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { totals } = await getForecast(workspaceId, { from: periodFrom, to: periodTo });

  assert.equal(totals.commit.count, 1);
  assert.equal(totals.commit.value, 1000);
  assert.equal(totals.commit.weighted, 750);      // 1000 * 75%

  assert.equal(totals.bestCase.count, 1);
  assert.equal(totals.bestCase.weighted, 1000);   // 2000 * 50%

  assert.equal(totals.pipeline.count, 1);
  assert.equal(totals.pipeline.weighted, 50);     // 500 * 10%

  assert.equal(totals.closedWon.value, 3000);
  assert.equal(totals.closedLost.value, 800);

  // Won money plus everything weighted.
  assert.equal(totals.projected, 3000 + 750 + 1000 + 50);
});

test('deals outside the period and without a close date are excluded', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { totals, excluded } = await getForecast(workspaceId, { from: periodFrom, to: periodTo });

  // The 9999 undated deal and the 7777 next-year deal must not appear.
  const allValue = totals.commit.value + totals.bestCase.value + totals.pipeline.value;
  assert.equal(allValue, 1000 + 2000 + 500);
  assert.equal(excluded.noCloseDate, 1, 'an undated open deal must be reported, not silently dropped');
});

test('the owner breakdown sums to the workspace total', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { totals, byOwner } = await getForecast(workspaceId, { from: periodFrom, to: periodTo });

  assert.equal(byOwner.length, 2);
  const sum = byOwner.reduce((s, o) => s + o.projected, 0);
  assert.equal(Math.round(sum * 100) / 100, totals.projected);

  // Sorted strongest first.
  assert.ok(byOwner[0].projected >= byOwner[1].projected);
});

test('scoping to one owner returns only their deals', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { totals, byOwner } = await getForecast(workspaceId, { from: periodFrom, to: periodTo, ownerUserId: ownerB });

  assert.equal(byOwner.length, 1);
  assert.equal(totals.commit.count, 0);
  assert.equal(totals.pipeline.value, 500);
  assert.equal(totals.closedLost.value, 800);
});

test('changing a stage probability changes the weighted forecast', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const before = await getForecast(workspaceId, { from: periodFrom, to: periodTo });
  assert.equal(before.bestCase ?? before.totals.bestCase.weighted, 1000);

  await updateStage(workspaceId, 'PROPOSAL', { probability: 80 });
  const after = await getForecast(workspaceId, { from: periodFrom, to: periodTo });

  // At 80% the proposal deal is now a commit, not a best case.
  assert.equal(after.totals.bestCase.count, 0);
  assert.equal(after.totals.commit.count, 2);
  assert.equal(after.totals.commit.weighted, 750 + 1600);

  await updateStage(workspaceId, 'PROPOSAL', { probability: 50 });
});

test('closed stages keep fixed probabilities and cannot be hidden', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  // A relabel is allowed, a reweight is ignored.
  await updateStage(workspaceId, 'CLOSED_WON', { label: 'Signed', probability: 40 });
  const probs = await stageProbabilities(workspaceId);
  assert.equal(probs.get('CLOSED_WON'), 100, 'a won deal is always 100%');
  assert.equal(probs.get('CLOSED_LOST'), 0);

  await assert.rejects(
    () => updateStage(workspaceId, 'CLOSED_LOST', { isActive: false }),
    (e) => e.status === 400,
  );
});

test('reorder rewrites the whole ordering and rejects partial lists', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  await assert.rejects(
    () => reorderStages(workspaceId, ['PROPOSAL', 'QUALIFICATION']),
    (e) => e.status === 400,
    'a partial ordering must be refused',
  );
  await assert.rejects(
    () => reorderStages(workspaceId, ['PROPOSAL', 'PROPOSAL', 'QUALIFICATION', 'NEEDS_ANALYSIS', 'NEGOTIATION', 'CLOSED_WON']),
    (e) => e.status === 400,
    'duplicates must be refused',
  );

  const reversed = ['CLOSED_LOST', 'CLOSED_WON', 'NEGOTIATION', 'PROPOSAL', 'NEEDS_ANALYSIS', 'QUALIFICATION'];
  const { data } = await reorderStages(workspaceId, reversed);
  assert.deepEqual(data.map((s) => s.key), reversed);
});

test('an invalid period is refused', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  await assert.rejects(
    () => getForecast(workspaceId, { from: periodTo, to: periodFrom }),
    (e) => e.status === 400,
  );
});
