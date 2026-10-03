import test from 'node:test';
import assert from 'node:assert/strict';
import { can, canOpenSection, CAPABILITIES, SECTION_MIN_ROLE } from './permissions.js';
// The backend floor module has no imports, so the UI's map can be checked
// against the rule the server actually enforces.
import { checkRoleCapability } from '../../../backend/src/middleware/roleCapabilities.js';

const as = (role, extra = {}) => ({ role, ...extra });

test('each role gets exactly its floor', () => {
  assert.equal(can('inbox.reply', as('VIEWER')), false);
  assert.equal(can('inbox.reply', as('AGENT')), true);
  assert.equal(can('campaigns.manage', as('AGENT')), false);
  assert.equal(can('campaigns.manage', as('CLIENT')), true);
  assert.equal(can('billing', as('CLIENT')), false);
  assert.equal(can('billing', as('ADMIN')), true);
  assert.equal(can('autonomousAgent.manage', as('CLIENT')), false);
  assert.equal(can('autonomousAgent.manage', as('ADMIN')), true);
});

test('a super admin can do everything; no role and unknown capabilities can do nothing', () => {
  for (const cap of Object.keys(CAPABILITIES)) assert.equal(can(cap, { superAdmin: true }), true, cap);
  assert.equal(can('inbox.reply', {}), false);
  assert.equal(can('no.such.capability', as('ADMIN')), false);
});

test('pure-configuration sections are closed to VIEWER and AGENT only', () => {
  for (const section of Object.keys(SECTION_MIN_ROLE)) {
    assert.equal(canOpenSection(section, as('VIEWER')), false, section);
    assert.equal(canOpenSection(section, as('AGENT')), false, section);
    assert.equal(canOpenSection(section, as('CLIENT')), true, section);
  }
  assert.equal(canOpenSection('inbox', as('VIEWER')), true);
  assert.equal(canOpenSection('ai-agent', as('VIEWER')), true);
});

// One representative request per capability the backend floor decides. For
// VIEWER and AGENT, the UI must offer an action exactly when the server's
// checkRoleCapability lets it through.
const SAMPLE_REQUEST = {
  'inbox.reply':             ['POST', 'conversations', '/c1/messages'],
  'inbox.manage':            ['PATCH', 'conversations', '/c1/assign'],
  'inbox.sendTemplate':      ['POST', 'conversations', '/c1/template'],
  'inbox.startConversation': ['POST', 'conversations', '/'],
  'contacts.edit':           ['PATCH', 'contacts', '/k1'],
  'contacts.block':          ['POST', 'opt-outs', '/'],
  'activities.log':          ['POST', 'activities', '/'],
  'aiAgent.test':            ['POST', 'ai-agents/whatsapp', '/test'],
  'contacts.import':         ['POST', 'contacts', '/import'],
  'contacts.delete':         ['DELETE', 'contacts', '/k1'],
  'contacts.export':         ['GET', 'contacts', '/export'],
  'contacts.unblock':        ['POST', 'opt-outs', '/unblock'],
  'segments.manage':         ['POST', 'segments', '/'],
  'templates.manage':        ['POST', 'templates', '/'],
  'campaigns.manage':        ['POST', 'campaigns', '/'],
  'automation.manage':       ['PATCH', 'automation', '/basic'],
  'intents.manage':          ['POST', 'intents', '/'],
  'aiAgents.manage':         ['PATCH', 'ai-agents/whatsapp', '/config'],
  'aiAgents.studioTest':     ['POST', 'ai-agents', '/a1/test'],
  'aiAgent.settleSuggestion':['PATCH', 'ai-agents/autonomous', '/facts/f1'],
  'widgets.manage':          ['POST', 'widgets', '/'],
  'crm.records':             ['POST', 'leads', '/'],
  'crm.savedViews':          ['POST', 'saved-views', '/'],
  'activities.delete':       ['DELETE', 'activities', '/a1'],
  'support.create':          ['POST', 'support', '/'],
  'autonomousAgent.manage':  ['POST', 'ai-agents/autonomous', '/tasks/t1/cancel'],
};

test('the VIEWER/AGENT entries agree with the backend floor', () => {
  for (const [cap, [method, resource, rest]] of Object.entries(SAMPLE_REQUEST)) {
    for (const role of ['VIEWER', 'AGENT']) {
      const req = { user: { role }, method, baseUrl: `/api/v1/workspaces/ws_1/${resource}`, path: rest };
      const serverAllows = checkRoleCapability(req) === null;
      assert.equal(can(cap, as(role)), serverAllows, `${cap} for ${role}: server ${serverAllows ? 'allows' : 'denies'}`);
    }
  }
});
