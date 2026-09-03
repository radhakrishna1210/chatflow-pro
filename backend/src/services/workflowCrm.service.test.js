import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { crmTriggerFires, runWorkflowsForCrmEvent, MAX_CHAIN_DEPTH } from './workflowCrm.service.js';
import { createLead, updateLead } from './leads.service.js';
import { updateDealStage } from './deals.service.js';

// ─── Trigger matching (pure) ───────────────────────────────────────────────

const trig = (subtype, value) => ({ type: 'trigger', subtype, value });

test('lead_created fires only on that event', () => {
  assert.equal(crmTriggerFires(trig('lead_created'), { event: 'lead_created' }), true);
  assert.equal(crmTriggerFires(trig('lead_created'), { event: 'lead_status_changed' }), false);
});

test('a status trigger with no value matches any status change', () => {
  const t = trig('lead_status', '');
  assert.equal(crmTriggerFires(t, { event: 'lead_status_changed', payload: { status: 'QUALIFIED' } }), true);
  assert.equal(crmTriggerFires(t, { event: 'lead_status_changed', payload: { status: 'LOST' } }), true);
});

test('a status trigger with a value matches only that status, case-insensitively', () => {
  const t = trig('lead_status', 'qualified');
  assert.equal(crmTriggerFires(t, { event: 'lead_status_changed', payload: { status: 'QUALIFIED' } }), true);
  assert.equal(crmTriggerFires(t, { event: 'lead_status_changed', payload: { status: 'LOST' } }), false);
});

test('a deal stage trigger tolerates spacing in the configured value', () => {
  const t = trig('deal_stage', 'needs analysis');
  assert.equal(crmTriggerFires(t, { event: 'deal_stage_changed', payload: { stage: 'NEEDS_ANALYSIS' } }), true);
  assert.equal(crmTriggerFires(t, { event: 'deal_stage_changed', payload: { stage: 'PROPOSAL' } }), false);
});

test('a score threshold fires on the crossing, not on every rescore above it', () => {
  const t = trig('score_above', '70');

  // 40 -> 80 crosses the line.
  assert.equal(crmTriggerFires(t, { event: 'lead_score_changed', payload: { score: 80, previousScore: 40 } }), true);
  // 80 -> 85 is already above; re-firing here would spam on every nightly rescore.
  assert.equal(crmTriggerFires(t, { event: 'lead_score_changed', payload: { score: 85, previousScore: 80 } }), false);
  // Falling below does not fire.
  assert.equal(crmTriggerFires(t, { event: 'lead_score_changed', payload: { score: 50, previousScore: 90 } }), false);
  // Exactly on the threshold counts as crossing it.
  assert.equal(crmTriggerFires(t, { event: 'lead_score_changed', payload: { score: 70, previousScore: 69 } }), true);
});

test('a non-numeric threshold never fires rather than matching everything', () => {
  assert.equal(
    crmTriggerFires(trig('score_above', 'high'), { event: 'lead_score_changed', payload: { score: 99, previousScore: 0 } }),
    false,
  );
});

test('conversation triggers are not treated as CRM triggers', () => {
  assert.equal(crmTriggerFires(trig('keyword', 'hi'), { event: 'lead_created' }), false);
  assert.equal(crmTriggerFires(null, { event: 'lead_created' }), false);
});

// ─── Execution (database) ──────────────────────────────────────────────────

let dbAvailable = false;
let workspaceId;
let userId;
let contactId;

const workflow = (nodes) => prisma.workflow.create({
  data: { workspaceId, name: `wf-${Math.random().toString(36).slice(2, 8)}`, isActive: true, nodes, edges: [] },
});

test.before(async () => {
  try { await prisma.$connect(); dbAvailable = true; } catch { return; }
  const stamp = Date.now();
  workspaceId = (await prisma.workspace.create({ data: { name: `test-wfcrm-${stamp}` } })).id;
  userId = (await prisma.user.create({ data: { name: 'Rep', email: `wfcrm-${stamp}@example.test` } })).id;
  await prisma.workspaceMember.create({ data: { userId, workspaceId, role: 'ADMIN' } });
  contactId = (await prisma.contact.create({
    data: { workspaceId, name: 'Workflow Target', phoneNumber: `+9144${stamp.toString().slice(-8)}` },
  })).id;
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

test('a lead_created workflow creates its task', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  await workflow([
    { type: 'trigger', subtype: 'lead_created' },
    { type: 'action', subtype: 'task', value: 'Qualify this lead' },
  ]);

  const runs = await runWorkflowsForCrmEvent(workspaceId, 'lead_created', { leadId: null, contactId });

  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'COMPLETED');

  const task = await prisma.task.findFirst({ where: { workspaceId, title: 'Qualify this lead' } });
  assert.ok(task, 'the workflow should have created a task');
});

test('an inactive workflow does not fire', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const wf = await workflow([
    { type: 'trigger', subtype: 'lead_status', value: 'LOST' },
    { type: 'action', subtype: 'task', value: 'Should not exist' },
  ]);
  await prisma.workflow.update({ where: { id: wf.id }, data: { isActive: false } });

  await runWorkflowsForCrmEvent(workspaceId, 'lead_status_changed', { contactId, status: 'LOST' });

  const task = await prisma.task.findFirst({ where: { workspaceId, title: 'Should not exist' } });
  assert.equal(task, null, 'an inactive workflow must not run');
});

test('a workflow acts on the lead it was triggered for', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await prisma.contact.create({
    data: { workspaceId, name: 'Owner Target', phoneNumber: `+9145${Date.now().toString().slice(-8)}` },
  });
  const lead = await prisma.lead.create({ data: { workspaceId, contactId: contact.id } });

  await workflow([
    { type: 'trigger', subtype: 'score_above', value: '50' },
    { type: 'action', subtype: 'owner', value: 'Rep' },
    { type: 'action', subtype: 'lead_status', value: 'QUALIFIED' },
  ]);

  await runWorkflowsForCrmEvent(workspaceId, 'lead_score_changed', {
    leadId: lead.id, contactId: contact.id, score: 90, previousScore: 10,
  });

  const after = await prisma.lead.findUnique({ where: { id: lead.id }, select: { ownerUserId: true, status: true } });
  assert.equal(after.ownerUserId, userId);
  assert.equal(after.status, 'QUALIFIED');
});

test('actions needing a lead skip cleanly when the run has none', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  await workflow([
    { type: 'trigger', subtype: 'lead_status', value: 'CONTACTED' },
    { type: 'action', subtype: 'lead_status', value: 'QUALIFIED' },
  ]);

  const runs = await runWorkflowsForCrmEvent(workspaceId, 'lead_status_changed', {
    contactId, status: 'CONTACTED', // no leadId
  });

  const run = runs.find((r) => r.status === 'COMPLETED');
  assert.ok(run, 'the run should complete rather than fail');
  const step = (run.trace ?? []).find((s) => s.subtype === 'lead_status');
  assert.equal(step.result, 'skipped');
  assert.match(step.detail, /no lead/i);
});

test('an unsettable lead status is refused by the action, not written', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await prisma.contact.create({
    data: { workspaceId, name: 'Guard Target', phoneNumber: `+9146${Date.now().toString().slice(-8)}` },
  });
  const lead = await prisma.lead.create({ data: { workspaceId, contactId: contact.id, status: 'NEW' } });

  await workflow([
    { type: 'trigger', subtype: 'lead_created' },
    // CONVERTED is reachable only through the transactional conversion flow.
    { type: 'action', subtype: 'lead_status', value: 'CONVERTED' },
  ]);

  await runWorkflowsForCrmEvent(workspaceId, 'lead_created', { leadId: lead.id, contactId: contact.id });

  const after = await prisma.lead.findUnique({ where: { id: lead.id }, select: { status: true } });
  assert.equal(after.status, 'NEW', 'a workflow must not be able to fake a conversion');
});

test('the chain depth guard stops a cascade', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const runs = await runWorkflowsForCrmEvent(
    workspaceId, 'lead_created', { contactId }, { depth: MAX_CHAIN_DEPTH },
  );
  assert.deepEqual(runs, [], 'at max depth no further workflows may run');
});

test('a failing workflow does not break the CRM write that triggered it', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  await workflow([
    { type: 'trigger', subtype: 'lead_created' },
    { type: 'action', subtype: 'not_a_real_action', value: 'x' },
  ]);

  // createLead emits the event fire-and-forget; it must still return normally.
  const contact = await prisma.contact.create({
    data: { workspaceId, name: 'Resilient', phoneNumber: `+9147${Date.now().toString().slice(-8)}` },
  });
  const lead = await createLead(workspaceId, { contactId: contact.id });
  assert.ok(lead.id, 'the lead must be created even though a workflow step is unknown');
});

test('a real status change through the service reaches its workflow', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await prisma.contact.create({
    data: { workspaceId, name: 'End To End', phoneNumber: `+9148${Date.now().toString().slice(-8)}` },
  });
  const lead = await prisma.lead.create({ data: { workspaceId, contactId: contact.id, status: 'NEW' } });

  await workflow([
    { type: 'trigger', subtype: 'lead_status', value: 'QUALIFIED' },
    { type: 'action', subtype: 'task', value: 'Book the demo' },
  ]);

  await updateLead(workspaceId, lead.id, { status: 'QUALIFIED' });

  // The emit is fire-and-forget, so give it a moment to land.
  await new Promise((r) => setTimeout(r, 400));

  const task = await prisma.task.findFirst({ where: { workspaceId, title: 'Book the demo' } });
  assert.ok(task, 'changing a lead status should have run the workflow');
});

test('a deal stage change reaches its workflow', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const contact = await prisma.contact.create({
    data: { workspaceId, name: 'Deal Mover', phoneNumber: `+9149${Date.now().toString().slice(-8)}` },
  });
  const deal = await prisma.deal.create({
    data: { workspaceId, contactId: contact.id, title: 'Stage workflow deal', stage: 'QUALIFICATION' },
  });

  await workflow([
    { type: 'trigger', subtype: 'deal_stage', value: 'PROPOSAL' },
    { type: 'action', subtype: 'task', value: 'Send the proposal pack' },
  ]);

  await updateDealStage(workspaceId, deal.id, { stage: 'PROPOSAL' }, userId);
  await new Promise((r) => setTimeout(r, 400));

  const task = await prisma.task.findFirst({ where: { workspaceId, title: 'Send the proposal pack' } });
  assert.ok(task, 'moving a deal to Proposal should have run the workflow');
  assert.equal(task.dealId, deal.id, 'the task should be attached to the deal that moved');
});
