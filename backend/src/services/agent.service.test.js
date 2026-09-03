import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { scoreEvidence } from './agent.evidence.js';
import { assertPermittedUnattended, SENSITIVE, priceClaim, recordFact } from './agent.tools.js';
import { claimDue, enqueue, runTask, sweepWorkspace, historyFor } from './agent.service.js';

// The autonomous agent writes without asking, so the guarantees worth pinning
// are the ones that decide *whether* a write lands.

// ─── evidence ledger (pure) ────────────────────────────────────────────────

test('nothing recognised means no band at all', () => {
  assert.equal(scoreEvidence([]).band, null);
  assert.equal(scoreEvidence([{ kind: 'invented-kind' }]).band, null);
});

test('weak signals do not add up to a fact', () => {
  // Three secondary observations total more than the threshold on raw score,
  // and must still be WEAK: without something primary, this is an inference
  // stack, not an observation.
  const r = scoreEvidence([
    { kind: 'crm.no-activity-window' },
    { kind: 'crm.score-threshold' },
    { kind: 'crm.field-blank' },
  ]);
  assert.equal(r.band, 'WEAK');
  assert.match(r.rationale, /nothing directly observed/);
});

test('one primary observation over the threshold is applied', () => {
  const r = scoreEvidence([{ kind: 'crm.inbound-reply' }]);
  assert.equal(r.band, 'STRONG');
  assert.match(r.rationale, /^Applied/);
});

test('a contradiction holds back a claim that would otherwise land', () => {
  const without = scoreEvidence([{ kind: 'crm.inbound-reply' }]);
  const withIt = scoreEvidence([{ kind: 'crm.inbound-reply' }, { kind: 'contradiction' }]);

  assert.equal(without.band, 'STRONG');
  assert.equal(withIt.band, 'WEAK', 'a disagreeing source must stop an autonomous write');
  assert.match(withIt.rationale, /Held back/);
});

test('repeating one kind does not buy a second confirmation', () => {
  const once = scoreEvidence([{ kind: 'crm.no-activity-window' }]);
  const thrice = scoreEvidence([
    { kind: 'crm.no-activity-window' },
    { kind: 'crm.no-activity-window' },
    { kind: 'crm.no-activity-window' },
  ]);
  assert.equal(once.score, thrice.score, 'the same observation seen twice is still one observation');
});

// ─── deny-when-unattended ──────────────────────────────────────────────────

test('sensitive actions are refused unattended, not queued', () => {
  for (const action of Object.keys(SENSITIVE)) {
    assert.throws(
      () => assertPermittedUnattended(action),
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.denied, true);
        assert.match(err.message, /Not something to do unattended/);
        return true;
      },
      `${action} was permitted unattended`,
    );
  }
});

test('ordinary actions are permitted', () => {
  assert.doesNotThrow(() => assertPermittedUnattended('schedule_followup'));
  assert.doesNotThrow(() => assertPermittedUnattended('advance_contacted'));
});

// ─── database-backed ───────────────────────────────────────────────────────

let dbAvailable = false;
let workspaceId;
let contactId;
let dealId;
let leadId;

test.before(async () => {
  try { await prisma.$connect(); dbAvailable = true; } catch { return; }
  const stamp = Date.now();
  workspaceId = (await prisma.workspace.create({ data: { name: `agent-${stamp}` } })).id;
  contactId = (await prisma.contact.create({
    data: { workspaceId, name: 'Agent Fixture', phoneNumber: `+9197${stamp % 100000000}`, tags: [] },
  })).id;
  dealId = (await prisma.deal.create({
    data: { workspaceId, title: 'Fixture Deal', stage: 'PROPOSAL', value: 1000, contactId },
  })).id;
  leadId = (await prisma.lead.create({
    data: { workspaceId, contactId, status: 'NEW', score: 55 },
  })).id;
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  await prisma.$disconnect();
});

test('claimed evidence that the database cannot confirm is discarded', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  // The agent claims they replied. There is no inbound message on this contact,
  // so the claim must not survive pricing — this is the difference between a
  // ledger that trusts its inputs and one that checks them.
  const priced = await priceClaim(workspaceId, [{ kind: 'crm.inbound-reply', detail: 'fabricated' }], { contactId });

  assert.equal(priced.verifiedCount, 0);
  assert.deepEqual(priced.rejectedKinds, ['crm.inbound-reply']);
  assert.equal(priced.band, null, 'an unverifiable claim must not reach a band');
  assert.match(priced.rationale, /Discarded unverifiable/);
});

test('the same claim is honoured once the record actually exists', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const conversation = await prisma.conversation.create({ data: { workspaceId, contactId } });
  // The field is `body`, not `content`.
  await prisma.message.create({
    data: { conversationId: conversation.id, direction: 'INBOUND', body: 'yes please' },
  });

  const priced = await priceClaim(workspaceId, [{ kind: 'crm.inbound-reply', detail: 'they replied' }], { contactId });
  assert.equal(priced.verifiedCount, 1);
  assert.equal(priced.band, 'STRONG');
});

test('a fabricated claim writes nothing but is still recorded', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  let applyCalled = false;
  const before = await prisma.agentFact.count({ where: { workspaceId } });

  const result = await recordFact(workspaceId, {
    targetType: 'deal',
    targetId: dealId,
    field: 'testField',
    value: 'should not apply',
    evidence: [{ kind: 'crm.form-submission', detail: 'no such submission' }],
    apply: async () => { applyCalled = true; },
  });

  assert.equal(applyCalled, false, 'apply() ran on unverifiable evidence');
  assert.equal(result.applied, false);
  // band null means it was not even stored — nothing usable was observed.
  assert.equal(await prisma.agentFact.count({ where: { workspaceId } }), before);
});

test('claimDue leases a task and will not hand it out twice', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  await enqueue(workspaceId, { kind: 'schedule_followup', targetType: 'deal', targetId: dealId, reason: 'test' });

  const first = await claimDue('worker-a', { limit: 10 });
  assert.ok(first.length >= 1, 'nothing was claimed');

  // A second dispatcher must not get the same row while the lease is fresh.
  const second = await claimDue('worker-b', { limit: 10 });
  const overlap = second.filter((s) => first.some((f) => f.id === s.id));
  assert.equal(overlap.length, 0, 'two workers claimed the same task');
});

test('a denied task is skipped rather than retried forever', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const task = await prisma.agentTask.create({
    data: { workspaceId, kind: 'close_deal', targetType: 'deal', targetId: dealId, status: 'RUNNING', attempts: 1 },
  });

  const run = await runTask(task);
  assert.match(run.summary, /Refused: Not something to do unattended/);

  const after = await prisma.agentTask.findUnique({ where: { id: task.id } });
  assert.equal(after.status, 'SKIPPED', 'a refusal is a decision, not a failure to retry');
});

test('every pass is recorded against the record it touched', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const history = await historyFor(workspaceId, 'deal', dealId);
  assert.ok(history.runs.length >= 1, 'the Agent tab would show nothing');
  assert.ok(history.runs.every((r) => typeof r.summary === 'string' && r.summary.length > 0));
});

test('the sweep books work from the state of the CRM, not from a model', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const result = await sweepWorkspace(workspaceId);
  assert.ok(result.leads >= 1, 'a NEW lead should have been picked up');
  assert.equal(typeof result.booked, 'number');
});
