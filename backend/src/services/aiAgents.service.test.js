import test from 'node:test';
import assert from 'node:assert/strict';
import { listAgents, listGuidelines, listActions, testAgent, listChannels } from './aiAgents.service.js';

test('AI Agents Hub - Default starter templates verification', async () => {
  // Test with dummy workspace
  const agents = await listAgents('workspace_test_mock_123');
  assert.ok(Array.isArray(agents), 'listAgents should return an array');
  assert.ok(agents.length >= 4, 'Should include at least 4 default agents');

  const names = agents.map((a) => a.name);
  assert.ok(names.includes('Investor Support Agent'), 'Should have Investor Support Agent');
  assert.ok(names.includes('Investor Qualification Agent'), 'Should have Investor Qualification Agent');
  assert.ok(names.includes('Compliance Screening Agent'), 'Should have Compliance Screening Agent');
  assert.ok(names.includes('Fund Information Agent'), 'Should have Fund Information Agent');
});

test('AI Agents Hub - Guidelines and Actions catalogues', async () => {
  const guidelines = await listGuidelines('workspace_test_mock_123');
  assert.ok(Array.isArray(guidelines), 'Guidelines should be an array');
  assert.ok(guidelines.length >= 4, 'Should have standard guidelines');

  const actions = listActions();
  assert.ok(Array.isArray(actions), 'Actions should be an array');
  const actionIds = actions.map((a) => a.id);
  assert.ok(actionIds.includes('crm.qualify_lead'), 'Should include qualify_lead action');
  assert.ok(actionIds.includes('crm.assign_rep'), 'Should include assign_rep action');
  assert.ok(actionIds.includes('crm.create_task'), 'Should include create_task action');
  assert.ok(actionIds.includes('crm.book_meeting'), 'Should include book_meeting action');
  assert.ok(actionIds.includes('crm.escalate_human'), 'Should include escalate_human action');
});

test('AI Agents Hub - Conversational simulation testAgent', async () => {
  const result = await testAgent('workspace_test_mock_123', 'agent_investor_qualification', 'I have a 1 million dollar allocation budget and I am accredited');
  assert.equal(result.agentName, 'Investor Qualification Agent');
  assert.ok(result.reply.length > 10, 'Agent should return a valid reply');
  assert.ok(result.triggeredActions.includes('crm.qualify_lead'), 'Should trigger crm.qualify_lead action');
  assert.ok(result.triggeredActions.includes('crm.book_meeting'), 'Should trigger crm.book_meeting action');
});

test('AI Agents Hub - Channels deployment listing', async () => {
  const channels = await listChannels('workspace_test_mock_123');
  assert.ok(Array.isArray(channels), 'Channels should be an array');
  assert.equal(channels.length, 3, 'Should have 3 channels');
  const keys = channels.map((c) => c.channelKey);
  assert.ok(keys.includes('whatsapp'), 'Should have whatsapp channel');
  assert.ok(keys.includes('website'), 'Should have website channel');
  assert.ok(keys.includes('instagram'), 'Should have instagram channel');
});

// executeAction takes lead/contact ids from the request body. They must be
// checked against the caller's workspace, and qualify_lead must actually find
// the caller's own lead (its arguments to updateLead used to be swapped).
test('AI Agents Hub - executeAction is scoped to the caller workspace', async () => {
  const { prisma } = await import('../lib/prisma.js');
  const { executeAction } = await import('./aiAgents.service.js');
  const tag = `aiact_${Date.now()}`;
  const wsA = await prisma.workspace.create({ data: { name: `${tag}_A` } });
  const wsB = await prisma.workspace.create({ data: { name: `${tag}_B` } });
  try {
    const mk = async (ws, n) => {
      const contact = await prisma.contact.create({ data: { workspaceId: ws.id, name: n, phoneNumber: `+9198${String(Date.now()).slice(-8)}${n.length}` } });
      const lead = await prisma.lead.create({ data: { workspaceId: ws.id, contactId: contact.id } });
      return { contact, lead };
    };
    const a = await mk(wsA, 'a');
    const b = await mk(wsB, 'bb');

    await assert.rejects(
      executeAction(wsA.id, 'crm.book_meeting', { leadId: b.lead.id, contactId: b.contact.id }),
      /not found in this workspace/,
    );
    assert.equal(await prisma.crmActivity.count({ where: { leadId: b.lead.id } }), 0, 'nothing was written against the other tenant lead');

    const ok = await executeAction(wsA.id, 'crm.qualify_lead', { leadId: a.lead.id });
    assert.equal(ok.success, true);
    const fresh = await prisma.lead.findUnique({ where: { id: a.lead.id } });
    assert.equal(fresh.status, 'QUALIFIED');
  } finally {
    await prisma.workspace.deleteMany({ where: { id: { in: [wsA.id, wsB.id] } } });
  }
});

// Editing or deleting one starter agent must not make the others disappear,
// and a deleted starter must stay deleted.
test('AI Agents Hub - starters survive edits and deletes of their siblings', async () => {
  const { prisma } = await import('../lib/prisma.js');
  const svc = await import('./aiAgents.service.js');
  const ws = await prisma.workspace.create({ data: { name: `agents_${Date.now()}` } });
  try {
    const edited = await svc.updateAgent(ws.id, 'agent_investor_support', { name: 'Support (edited)', systemPrompt: 'x'.repeat(10_000), junk: 'y' });
    let list = await svc.listAgents(ws.id);
    assert.equal(list.length, 4, 'three starters plus the edited copy');
    assert.ok(list.some((a) => a.name === 'Support (edited)'));
    assert.ok(!list.some((a) => a.id === 'agent_investor_support'), 'the edited starter is replaced, not duplicated');
    assert.ok(edited.systemPrompt.length <= 4000);
    assert.equal(edited.junk, undefined);

    // Second edit of the same starter updates the copy.
    await svc.updateAgent(ws.id, 'agent_investor_support', { name: 'Support v2' });
    list = await svc.listAgents(ws.id);
    assert.equal(list.length, 4);

    await svc.deleteAgent(ws.id, 'agent_fund_info');
    list = await svc.listAgents(ws.id);
    assert.equal(list.length, 3);
    assert.ok(!list.some((a) => a.id === 'agent_fund_info'));

    const copy = list.find((a) => a.name === 'Support v2');
    await svc.deleteAgent(ws.id, copy.id);
    list = await svc.listAgents(ws.id);
    assert.equal(list.length, 2, 'deleting the copy does not resurrect the starter');
  } finally {
    await prisma.workspace.delete({ where: { id: ws.id } });
  }
});
