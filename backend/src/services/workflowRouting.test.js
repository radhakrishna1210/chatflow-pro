import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelayMs, triggerFires } from './workflowEngine.service.js';
import { renderTemplate } from './workflowConditions.js';
import { keywordMatches } from './automation.service.js';
import { matchIntent } from './intent.service.js';
import { routeByIntent } from './intentRouting.service.js';
import { prisma } from '../lib/prisma.js';

// ── Unit Tests: Parsers & Interpolation ──────────────────────────────────────

test('parseDelayMs: parses bare digits as seconds (e.g. "10" -> 10,000ms)', () => {
  assert.equal(parseDelayMs('10'), 10_000);
  assert.equal(parseDelayMs('10s'), 10_000);
  assert.equal(parseDelayMs('10 sec'), 10_000);
  assert.equal(parseDelayMs('10 seconds'), 10_000);
  assert.equal(parseDelayMs('5 min'), 300_000);
  assert.equal(parseDelayMs('1 hour'), 3_600_000);
  assert.equal(parseDelayMs('0'), 0);
  assert.equal(parseDelayMs('immediate'), 0);
  assert.equal(parseDelayMs(''), 0);
  assert.equal(parseDelayMs(null), 0);
});

test('renderTemplate: interpolates {{customer_name}} and variants to contact name', () => {
  const contact = { name: 'Aditya', phoneNumber: '+919999999999' };

  assert.equal(
    renderTemplate('Hey {{customer_name}} 👋 Check out our latest Tendy Wear styles! Which one is your favorite? 👕', { contact }),
    'Hey Aditya 👋 Check out our latest Tendy Wear styles! Which one is your favorite? 👕',
  );

  assert.equal(
    renderTemplate('Hello {{customername}}', { contact }),
    'Hello Aditya',
  );

  assert.equal(
    renderTemplate('Hello {{contact_name}}', { contact }),
    'Hello Aditya',
  );

  assert.equal(
    renderTemplate('Hello {{name}}', { contact }),
    'Hello Aditya',
  );
});

test('keywordMatches: matches candidate in comma-separated keyword trigger list', () => {
  const triggerKeywords = 'new collection, latest styles, new arrivals, clothes, products';

  assert.equal(
    keywordMatches(triggerKeywords, 'Hi, I want to know more about your new collection'),
    true,
  );

  assert.equal(
    keywordMatches(triggerKeywords, 'Show me latest styles please'),
    true,
  );

  assert.equal(
    keywordMatches(triggerKeywords, 'Do you sell clothes?'),
    true,
  );

  assert.equal(
    keywordMatches(triggerKeywords, 'What are your delivery charges?'),
    false,
  );
});

test('triggerFires: fires for keyword when message body matches', () => {
  const trigger = {
    type: 'trigger',
    subtype: 'keyword',
    value: 'new collection, latest styles, new arrivals, clothes, products',
  };

  assert.equal(
    triggerFires(trigger, { messageBody: 'Hi, I want to know more about your new collection', event: 'message' }),
    true,
  );

  assert.equal(
    triggerFires(trigger, { messageBody: 'What are your delivery charges?', event: 'message' }),
    false,
  );
});

// ── Test Cases A through F: Routing & Isolation ─────────────────────────────

const WS_A = 'test_ws_workflow_a';
const WS_B = 'test_ws_workflow_b';

const MOCK_INTENT_RULE = {
  id: 'intent_rule_new_collection',
  workspaceId: WS_A,
  name: 'New Collection',
  phrases: ['new collection', 'latest styles', 'new arrivals', 'clothes', 'products'],
  actionType: 'workflow',
  actionTarget: 'Tendy Wear New Collection Promo',
  isActive: true,
};

const MOCK_WORKFLOW_NODES = [
  {
    id: 'step_1',
    type: 'trigger',
    subtype: 'keyword',
    value: 'new collection, latest styles, new arrivals, clothes, products',
  },
  {
    id: 'step_2',
    type: 'action',
    subtype: 'message',
    value: 'tendy_wear_new_collection',
  },
  {
    id: 'step_3',
    type: 'action',
    subtype: 'delay',
    value: '10',
  },
  {
    id: 'step_4',
    type: 'action',
    subtype: 'message',
    value: 'Hey {{customer_name}} 👋 Check out our latest Tendy Wear styles! Which one is your favorite? 👕',
  },
  {
    id: 'step_5',
    type: 'action',
    subtype: 'delay',
    value: '10',
  },
  {
    id: 'step_6',
    type: 'action',
    subtype: 'message',
    value: "We've got more styles waiting for you! ✨ Explore the Tendy Wear collection and find your next favorite look.",
  },
];

test('Test A: Inbound message matching Intent "New Collection" routes to workflow', () => {
  const message = 'Hi, I want to know more about your new collection';
  const best = matchIntent(message, [MOCK_INTENT_RULE]);

  assert.ok(best, 'Intent should match');
  assert.equal(best.rule.name, 'New Collection');
  assert.equal(best.rule.actionType, 'workflow');
  assert.equal(best.rule.actionTarget, 'Tendy Wear New Collection Promo');
  assert.ok(best.confidence >= 0.6, `Confidence ${best.confidence} should clear default threshold`);
});

test('Test B: Non-matching message ("What are your delivery charges?") does not route to workflow', () => {
  const message = 'What are your delivery charges?';
  const best = matchIntent(message, [MOCK_INTENT_RULE]);

  assert.equal(best, null, 'Non-matching message should return null');
});

test('Test C: Disabled workflow (isActive: false) does not execute', async () => {
  const originalFindFirst = prisma.workflow.findFirst;
  try {
    // Stub findFirst to return null when workflow is inactive
    prisma.workflow.findFirst = async ({ where }) => {
      if (where.isActive === true) return null;
      return { id: 'wf_123', name: 'Tendy Wear New Collection Promo', isActive: false, nodes: MOCK_WORKFLOW_NODES };
    };

    const { startRunForWorkflowId } = await import('./workflowEngine.service.js');
    const run = await startRunForWorkflowId(WS_A, 'Tendy Wear New Collection Promo', {
      conversationId: 'conv_123',
      contactId: 'contact_123',
      triggerMessage: 'Hi, I want to know more about your new collection',
    });

    assert.equal(run, null, 'Disabled workflow must return null and not start a run');
  } finally {
    prisma.workflow.findFirst = originalFindFirst;
  }
});

test('Test D: Disabled intent (isActive: false or intentMatchingEnabled: false) does not route', async () => {
  // Sub-case 1: Rule is inactive
  const disabledRule = { ...MOCK_INTENT_RULE, isActive: false };
  const matchResult = matchIntent('Hi, I want to know more about your new collection', [disabledRule]);
  assert.equal(matchResult, null, 'Inactive intent rule should never match');

  // Sub-case 2: Workspace has intentMatchingEnabled: false
  const originalWsFind = prisma.workspace.findUnique;
  try {
    prisma.workspace.findUnique = async () => ({ intentMatchingEnabled: false, intentMatchThreshold: 0.6 });
    const routed = await routeByIntent({
      workspaceId: WS_A,
      conversationId: 'conv_1',
      contact: { id: 'contact_1' },
      waNumber: { id: 'wanum_1' },
      messageBody: 'Hi, I want to know more about your new collection',
    });
    assert.equal(routed, null, 'Disabled workspace intent matching must return null');
  } finally {
    prisma.workspace.findUnique = originalWsFind;
  }
});

test('Test E: Wrong workspace isolation: cannot execute another workspace\'s workflow', async () => {
  const originalFindFirst = prisma.workflow.findFirst;
  try {
    prisma.workflow.findFirst = async ({ where }) => {
      if (where.workspaceId === WS_A && where.isActive === true) {
        return { id: 'wf_123', workspaceId: WS_A, name: 'Tendy Wear New Collection Promo', isActive: true, nodes: MOCK_WORKFLOW_NODES };
      }
      return null;
    };

    const { startRunForWorkflowId } = await import('./workflowEngine.service.js');
    const run = await startRunForWorkflowId(WS_B, 'Tendy Wear New Collection Promo', {
      conversationId: 'conv_b',
      contactId: 'contact_b',
      triggerMessage: 'Hi, I want to know more about your new collection',
    });

    assert.equal(run, null, 'Cross-workspace execution must be rejected');
  } finally {
    prisma.workflow.findFirst = originalFindFirst;
  }
});

test('Test F: Workflow action execution trace (template -> delay -> personalized text -> delay -> text)', () => {
  const nodes = MOCK_WORKFLOW_NODES.filter((n) => n.type === 'action');
  assert.equal(nodes.length, 5, 'Should have 5 action steps');

  // Step 1: Template
  assert.equal(nodes[0].subtype, 'message');
  assert.equal(nodes[0].value, 'tendy_wear_new_collection');

  // Step 2: Delay 10s
  assert.equal(nodes[1].subtype, 'delay');
  assert.equal(parseDelayMs(nodes[1].value), 10_000);

  // Step 3: Personalized message with customer_name
  assert.equal(nodes[2].subtype, 'message');
  const renderedStep3 = renderTemplate(nodes[2].value, { contact: { name: 'Aditya' } });
  assert.equal(
    renderedStep3,
    'Hey Aditya 👋 Check out our latest Tendy Wear styles! Which one is your favorite? 👕',
  );

  // Step 4: Delay 10s
  assert.equal(nodes[3].subtype, 'delay');
  assert.equal(parseDelayMs(nodes[3].value), 10_000);

  // Step 5: Follow-up text
  assert.equal(nodes[4].subtype, 'message');
  const renderedStep5 = renderTemplate(nodes[4].value, { contact: { name: 'Aditya' } });
  assert.equal(
    renderedStep5,
    "We've got more styles waiting for you! ✨ Explore the Tendy Wear collection and find your next favorite look.",
  );
});

test('simulateWorkflow handles template action subtype properly', async () => {
  const originalFindFirst = prisma.workflow.findFirst;
  try {
    prisma.workflow.findFirst = async () => ({
      id: 'wf_test_sim',
      name: 'Tendy Wear New Collection Promo',
      nodes: [
        { id: 'step_1', type: 'trigger', subtype: 'keyword', value: 'new collection' },
        { id: 'step_2', type: 'action', subtype: 'template', value: 'tendy_wear_new_collection' },
      ],
    });

    const { simulateWorkflow } = await import('./workflow.service.js');
    const result = await simulateWorkflow(WS_A, 'wf_test_sim', { message: 'I want new collection' });
    assert.equal(result.ran, true);
    assert.equal(result.trace.length, 2);
    assert.equal(result.trace[1].subtype, 'template');
    assert.equal(result.trace[1].detail, 'Would send template: "tendy_wear_new_collection"');
  } finally {
    prisma.workflow.findFirst = originalFindFirst;
  }
});
