import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { getCrmAnalytics } from './crm-analytics.service.js';

// The dashboard aggregates are computed with groupBy/aggregate rather than by
// summing rows in JS, so these pin the arithmetic against a known fixture:
// a workspace seeded with deals of deliberately distinct values.
let dbAvailable = false;
let workspaceId;
let otherWorkspaceId;
let userId;

const daysAgo = (n) => new Date(Date.now() - n * 86400000);

test.before(async () => {
  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    return;
  }
  const stamp = Date.now();
  workspaceId = (await prisma.workspace.create({ data: { name: `test-an-${stamp}` } })).id;
  otherWorkspaceId = (await prisma.workspace.create({ data: { name: `test-an-other-${stamp}` } })).id;
  userId = (await prisma.user.create({
    data: { name: 'Analytics Runner', email: `test-an-${stamp}@example.test` },
  })).id;

  const contact = await prisma.contact.create({
    data: { workspaceId, name: 'Acme', phoneNumber: `+9166${stamp.toString().slice(-8)}` },
  });

  const deal = (data) => prisma.deal.create({ data: { workspaceId, contactId: contact.id, ...data } });

  // Open pipeline: 1000 + 250 + 4000 = 5250 across three stages.
  await deal({ title: 'Open A', value: 1000, stage: 'QUALIFICATION' });
  await deal({ title: 'Open B', value: 250, stage: 'PROPOSAL' });
  await deal({ title: 'Open C', value: 4000, stage: 'PROPOSAL' });
  // A deal with no amount must count toward stage counts without breaking sums.
  await deal({ title: 'Open D', value: null, stage: 'QUALIFICATION' });

  // Closed in the last 90 days: two won (600 + 400), one lost => 66.7% win rate,
  // average won deal 500.
  await deal({ title: 'Won A', value: 600, stage: 'CLOSED_WON', closedAt: daysAgo(10) });
  await deal({ title: 'Won B', value: 400, stage: 'CLOSED_WON', closedAt: daysAgo(20) });
  await deal({ title: 'Lost A', value: 900, stage: 'CLOSED_LOST', closedAt: daysAgo(30) });

  // Outside the 90-day window — must not affect win rate or the average.
  await deal({ title: 'Won Old', value: 99999, stage: 'CLOSED_WON', closedAt: daysAgo(200) });

  // A different workspace must never leak into these numbers.
  const otherContact = await prisma.contact.create({
    data: { workspaceId: otherWorkspaceId, name: 'Foreign', phoneNumber: `+9155${stamp.toString().slice(-8)}` },
  });
  await prisma.deal.create({
    data: { workspaceId: otherWorkspaceId, contactId: otherContact.id, title: 'Foreign Open', value: 777777, stage: 'PROPOSAL' },
  });
});

test.after(async () => {
  for (const id of [workspaceId, otherWorkspaceId]) {
    if (id) await prisma.workspace.delete({ where: { id } }).catch(() => {});
  }
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

test('open pipeline totals only open deals in this workspace', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { kpis, charts } = await getCrmAnalytics(workspaceId);

  assert.equal(kpis.openPipelineTotal, 5250);

  const byStage = Object.fromEntries(charts.openPipelineByStage.map((s) => [s.stage, s]));
  assert.equal(byStage.PROPOSAL.value, 4250);
  assert.equal(byStage.PROPOSAL.count, 2);
  // The null-valued deal is still a deal in the stage, worth nothing.
  assert.equal(byStage.QUALIFICATION.value, 1000);
  assert.equal(byStage.QUALIFICATION.count, 2);
  assert.ok(!byStage.CLOSED_WON, 'closed deals must not appear in open pipeline');
});

test('win rate and average deal use only the last 90 days', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { kpis } = await getCrmAnalytics(workspaceId);

  // 2 won of 3 closed — the 200-day-old win is excluded.
  assert.equal(kpis.winRate90d, 66.7);
  assert.equal(kpis.averageDeal90d, 500);
});

test('deals in progress are the highest-value open deals, newest arithmetic intact', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { dealsInProgress } = await getCrmAnalytics(workspaceId);

  assert.equal(dealsInProgress[0].title, 'Open C');
  assert.equal(dealsInProgress[0].value, 4000);
  assert.equal(dealsInProgress[0].company, 'Acme');
  assert.ok(dealsInProgress.every((d) => !['CLOSED_WON', 'CLOSED_LOST'].includes(d.stage)));
  assert.ok(dealsInProgress[0].ageDays >= 0);
});

test('the six-month chart has one bucket per month and excludes other workspaces', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { charts } = await getCrmAnalytics(workspaceId);

  assert.equal(charts.pipelineVsWon.length, 6);
  const totalNew = charts.pipelineVsWon.reduce((s, m) => s + m.newPipeline, 0);
  // Every seeded deal was created now, so the current month holds them all and
  // the foreign workspace's 777777 is nowhere in the series.
  assert.ok(totalNew < 777777, 'another workspace leaked into the chart');

  // Wins land in the month they closed, not the month they are read in: the
  // 10-day-old win is this month, the 20-day-old one may be last month
  // depending on where today sits, and both are inside the window.
  const totalWon = charts.pipelineVsWon.reduce((s, m) => s + m.closedWon, 0);
  assert.equal(totalWon, 1000, 'both recent wins must appear somewhere in the window');
  assert.ok(charts.pipelineVsWon.at(-1).closedWon > 0, 'the 10-day-old win belongs to the current month');
});

test('scoping to an owner excludes deals owned by nobody', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { kpis } = await getCrmAnalytics(workspaceId, { userId });

  // Every fixture deal is unowned, so an owner-scoped view is empty rather
  // than falling back to the whole workspace.
  assert.equal(kpis.openPipelineTotal, 0);
});
