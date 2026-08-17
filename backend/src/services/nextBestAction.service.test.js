import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { getRecommendations } from './nextBestAction.service.js';
import { relationshipStrength, buildSignals } from './relationship.service.js';

// ─── Relationship strength (pure) ──────────────────────────────────────────

test('a contact who has never replied is weak, not strong', () => {
  const r = relationshipStrength({ inboundCount: 0, outboundCount: 1 });
  assert.equal(r.band, 'WEAK');
  assert.match(r.factors[0].label, /No reply/);
});

test('repeated unanswered outreach is at risk', () => {
  const r = relationshipStrength({ inboundCount: 0, outboundCount: 5 });
  assert.equal(r.band, 'AT_RISK');
  assert.match(r.factors[0].detail, /none answered/);
});

test('an opted-out contact short-circuits to at risk', () => {
  const r = relationshipStrength({ optedOut: true, inboundCount: 50, daysSinceLastInbound: 1 });
  assert.equal(r.band, 'AT_RISK');
  assert.equal(r.confidence, 'certain');
  assert.equal(r.factors.length, 1, 'nothing else matters once they have opted out');
});

test('a recent, deep, long-standing conversation is strong', () => {
  const r = relationshipStrength({
    daysSinceLastInbound: 2, inboundCount: 12, outboundCount: 14, daysKnown: 200,
  });
  assert.equal(r.band, 'STRONG');
  assert.ok(r.factors.some((f) => /Sustained/.test(f.label)));
  assert.ok(r.factors.some((f) => /Long-standing/.test(f.label)));
});

test('a long silence pulls the band down however deep the history', () => {
  const r = relationshipStrength({
    daysSinceLastInbound: 200, inboundCount: 12, outboundCount: 12, daysKnown: 400,
  });
  assert.ok(['WEAK', 'AT_RISK'].includes(r.band));
  assert.ok(r.factors.some((f) => /silence/i.test(f.label)));
});

test('a one-sided thread is named as such', () => {
  const r = relationshipStrength({
    daysSinceLastInbound: 5, inboundCount: 1, outboundCount: 10,
  });
  assert.ok(r.factors.some((f) => /one-sided/i.test(f.label)));
});

test('confidence is reported low when there is barely any history', () => {
  // Two data points is not a trend, and saying so beats a confident-looking band.
  assert.equal(relationshipStrength({ daysSinceLastInbound: 1, inboundCount: 1, outboundCount: 1 }).confidence, 'low');
  assert.equal(relationshipStrength({ daysSinceLastInbound: 1, inboundCount: 5, outboundCount: 5 }).confidence, 'moderate');
});

test('buildSignals derives counts and recency from message rows', () => {
  const now = new Date('2026-08-17T00:00:00Z');
  const signals = buildSignals({
    contact: { optedOut: false, createdAt: new Date('2026-05-09T00:00:00Z') },
    messages: [
      { direction: 'INBOUND', sentAt: new Date('2026-08-15T00:00:00Z') },
      { direction: 'OUTBOUND', sentAt: new Date('2026-08-16T00:00:00Z') },
      { direction: 'INBOUND', sentAt: new Date('2026-07-01T00:00:00Z') },
    ],
    now,
  });
  assert.equal(signals.inboundCount, 2);
  assert.equal(signals.outboundCount, 1);
  assert.equal(signals.daysSinceLastInbound, 2);
  assert.equal(signals.daysSinceLastOutbound, 1);
  assert.equal(signals.daysKnown, 100);
});

// ─── Recommendations (database) ────────────────────────────────────────────

let dbAvailable = false;
let workspaceId;
let userId;
let seq = 0;
const asUser = () => ({ id: userId, role: 'ADMIN' });
const phone = () => `+9197${String(Date.now()).slice(-7)}${seq++}`;

test.before(async () => {
  try { await prisma.$connect(); dbAvailable = true; } catch { return; }
  const stamp = Date.now();
  workspaceId = (await prisma.workspace.create({ data: { name: `test-nba-${stamp}` } })).id;
  userId = (await prisma.user.create({ data: { name: 'Rep', email: `nba-${stamp}@example.test` } })).id;
  await prisma.workspaceMember.create({ data: { userId, workspaceId, role: 'ADMIN' } });
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

test('an empty workspace produces no recommendations rather than filler', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const { data, total } = await getRecommendations(workspaceId, asUser());
  assert.equal(total, 0);
  assert.deepEqual(data, []);
});

test('an overdue task outranks a merely drifting deal', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await prisma.contact.create({ data: { workspaceId, name: 'Acme', phoneNumber: phone() } });
  // A deal with no amount — a low-urgency suggestion.
  await prisma.deal.create({
    data: { workspaceId, contactId: contact.id, title: 'Drifting deal', stage: 'PROPOSAL', ownerUserId: userId },
  });
  await prisma.task.create({
    data: {
      workspaceId, title: 'Call the customer back', status: 'PENDING',
      assignedToUserId: userId, dueDate: new Date(Date.now() - 3 * 86400000),
    },
  });

  const { data } = await getRecommendations(workspaceId, asUser());

  assert.equal(data[0].record.type, 'task', 'a broken commitment outranks a suggestion');
  assert.match(data[0].title, /Call the customer back/);
  assert.match(data[0].evidence[0], /Due 3 days ago/);
});

test('a task due today does not read as "Due 0 days ago"', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  await prisma.task.create({
    data: {
      workspaceId, title: 'Due right now', status: 'PENDING',
      assignedToUserId: userId, dueDate: new Date(Date.now() - 60_000),
    },
  });

  const { data } = await getRecommendations(workspaceId, asUser(), { limit: 50 });
  const today = data.find((r) => /Due right now/.test(r.title));
  assert.ok(today);
  assert.equal(today.evidence[0], 'Due today');
});

test('every recommendation states why and cites evidence', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { data } = await getRecommendations(workspaceId, asUser());
  assert.ok(data.length > 0);

  for (const r of data) {
    assert.ok(r.title && r.title.length > 0, 'needs a title');
    assert.ok(r.why && r.why.length > 0, `"${r.title}" has no reason`);
    assert.ok(Array.isArray(r.evidence) && r.evidence.length > 0, `"${r.title}" cites no evidence`);
    assert.ok(r.record?.type && r.record?.id, `"${r.title}" points at no record`);
    assert.ok(r.action?.type && r.action?.label, `"${r.title}" offers no action`);
  }
});

test('a hot untouched lead is surfaced with its score as evidence', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await prisma.contact.create({ data: { workspaceId, name: 'Hot Prospect', phoneNumber: phone() } });
  await prisma.lead.create({
    data: {
      workspaceId, contactId: contact.id, status: 'NEW', score: 85,
      createdAt: new Date(Date.now() - 4 * 86400000),
    },
  });

  const { data } = await getRecommendations(workspaceId, asUser());
  const hot = data.find((r) => /Follow up with Hot Prospect/.test(r.title));

  assert.ok(hot, 'a high-scoring untouched lead should be recommended');
  assert.ok(hot.evidence.some((e) => /Score 85/.test(e)));
  assert.ok(hot.evidence.some((e) => /Still marked New/.test(e)));
});

test('a low-scoring lead is not nagged about', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await prisma.contact.create({ data: { workspaceId, name: 'Cold One', phoneNumber: phone() } });
  await prisma.lead.create({
    data: { workspaceId, contactId: contact.id, status: 'NEW', score: 5, ownerUserId: userId,
      createdAt: new Date(Date.now() - 10 * 86400000) },
  });

  const { data } = await getRecommendations(workspaceId, asUser(), { limit: 50 });
  assert.ok(!data.some((r) => /Cold One/.test(r.title)), 'noise trains people to ignore the list');
});

test('a breaching ticket is surfaced with its target', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  await prisma.crmTicket.create({
    data: {
      workspaceId, ticketNumber: 'T-9001', subject: 'Payment failed', priority: 'URGENT',
      status: 'OPEN', dueAt: new Date(Date.now() - 3600_000),
    },
  });

  const { data } = await getRecommendations(workspaceId, asUser(), { limit: 50 });
  const ticket = data.find((r) => r.record.type === 'ticket');

  assert.ok(ticket);
  assert.match(ticket.title, /T-9001/);
  assert.match(ticket.why, /missed/);
  assert.ok(ticket.evidence.some((e) => /Priority URGENT/.test(e)));
});

test('a closed deal generates nothing', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await prisma.contact.create({ data: { workspaceId, name: 'Done Deal Co', phoneNumber: phone() } });
  await prisma.deal.create({
    data: {
      workspaceId, contactId: contact.id, title: 'Already won', stage: 'CLOSED_WON',
      closedAt: new Date(), ownerUserId: userId,
    },
  });

  const { data } = await getRecommendations(workspaceId, asUser(), { limit: 50 });
  assert.ok(!data.some((r) => /Already won/.test(r.title)), 'a settled deal needs no action');
});

test('recommendations are ranked and capped', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { data, total } = await getRecommendations(workspaceId, asUser(), { limit: 3 });
  assert.equal(data.length, 3);
  assert.ok(total >= 3, 'the full count is reported even when the list is capped');

  const urgencies = data.map((r) => r.urgency);
  assert.deepEqual(urgencies, [...urgencies].sort((a, b) => b - a), 'most urgent first');
});

test('recommendation keys are unique so the UI can key a list on them', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { data } = await getRecommendations(workspaceId, asUser(), { limit: 50 });
  const keys = data.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
});
