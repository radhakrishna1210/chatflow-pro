import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRoleCapability, roleAtLeast, ROLE_RANK } from './roleCapabilities.js';

// Shape the request the way workspaceContext sees it: mounted inside the
// resource router, so baseUrl carries /…/workspaces/:id/<resource>.
function req(role, method, resource, rest = '/') {
  return {
    user: { role },
    method,
    baseUrl: `/api/v1/workspaces/ws_1/${resource}`,
    path: rest,
  };
}

const allowed = (r) => assert.equal(checkRoleCapability(r), null);
const denied = (r) => assert.equal(checkRoleCapability(r)?.status, 403);

test('role rank is a total order', () => {
  assert.ok(ROLE_RANK.VIEWER < ROLE_RANK.AGENT);
  assert.ok(ROLE_RANK.AGENT < ROLE_RANK.CLIENT);
  assert.ok(ROLE_RANK.CLIENT < ROLE_RANK.ADMIN);
  assert.equal(roleAtLeast('CLIENT', 'AGENT'), true);
  assert.equal(roleAtLeast('AGENT', 'CLIENT'), false);
  assert.equal(roleAtLeast('BOGUS', 'VIEWER'), false);
  assert.equal(roleAtLeast('ADMIN', 'BOGUS'), false);
});

test('CLIENT and ADMIN are not restricted by the floor', () => {
  allowed(req('CLIENT', 'POST', 'conversations', '/c1/template'));
  allowed(req('ADMIN', 'POST', 'contacts', '/import'));
});

test('VIEWER reads but writes nothing, and cannot bulk-export', () => {
  allowed(req('VIEWER', 'GET', 'contacts'));
  denied(req('VIEWER', 'GET', 'contacts', '/export'));
  denied(req('VIEWER', 'POST', 'conversations', '/c1/messages'));
  denied(req('VIEWER', 'POST', 'activities'));
});

test('any member may switch their active workspace', () => {
  allowed(req('VIEWER', 'POST', 'switch'));
  allowed(req('AGENT', 'POST', 'switch'));
});

test('AGENT can do inbox work', () => {
  allowed(req('AGENT', 'POST', 'conversations', '/c1/messages'));
  allowed(req('AGENT', 'POST', 'conversations', '/c1/media'));
  allowed(req('AGENT', 'POST', 'conversations', '/c1/notes'));
  allowed(req('AGENT', 'DELETE', 'conversations', '/c1/notes/n1'));
  allowed(req('AGENT', 'PATCH', 'conversations', '/c1/assign'));
  allowed(req('AGENT', 'PATCH', 'conversations', '/c1/status'));
  allowed(req('AGENT', 'POST', 'contacts'));
  allowed(req('AGENT', 'PATCH', 'contacts', '/k1'));
  allowed(req('AGENT', 'POST', 'opt-outs'));
  allowed(req('AGENT', 'POST', 'blocked-numbers'));
  allowed(req('AGENT', 'POST', 'ai-agent', '/test'));
  allowed(req('AGENT', 'POST', 'ai-agents/whatsapp', '/test'));
});

test('AGENT can log CRM activities but not delete them', () => {
  allowed(req('AGENT', 'POST', 'activities'));
  denied(req('AGENT', 'DELETE', 'activities', '/a1'));
});

test('AGENT cannot spend, fabricate or bulk-change data', () => {
  denied(req('AGENT', 'POST', 'conversations', '/c1/template'));
  denied(req('AGENT', 'POST', 'conversations', '/c1/reopen-window'));
  denied(req('AGENT', 'POST', 'conversations', '/c1/inbound-simulate'));
  denied(req('AGENT', 'POST', 'conversations'));
  denied(req('AGENT', 'POST', 'contacts', '/import'));
  denied(req('AGENT', 'DELETE', 'contacts', '/k1'));
  denied(req('AGENT', 'GET', 'contacts', '/export'));
  denied(req('AGENT', 'POST', 'opt-outs', '/unblock'));
  denied(req('AGENT', 'DELETE', 'blocked-numbers', '/o1'));
  denied(req('AGENT', 'PATCH', 'ai-agent', '/config'));
  denied(req('AGENT', 'PATCH', 'ai-agents/whatsapp', '/config'));
  denied(req('AGENT', 'POST', 'ai-agents', '/a1/test'));
  denied(req('AGENT', 'POST', 'ai-agents/autonomous', '/tasks/t1/cancel'));
  denied(req('AGENT', 'POST', 'campaigns'));
});

test('a trailing slash does not open or close a path', () => {
  allowed(req('AGENT', 'POST', 'activities', '/'));
  denied(req('AGENT', 'GET', 'contacts', '/export/'));
});

test('platform super admins bypass the floor', () => {
  assert.equal(checkRoleCapability({ ...req('VIEWER', 'POST', 'campaigns'), user: { role: 'VIEWER', superAdmin: true } }), null);
});
