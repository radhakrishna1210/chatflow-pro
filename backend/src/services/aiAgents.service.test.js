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
