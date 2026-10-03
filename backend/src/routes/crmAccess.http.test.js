import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, mockIdentity, startApp } from './crmHttp.testutil.js';

// CF-163: what used to be checked by calling services or middleware directly
// (crmPermissions.service.test.js read route files with regexes; the
// integration-health tests called the service) now goes
// through the real routers, validate(), authorize() and the CRM permission
// matrix, with the real record-scope helper.

const store = createStore({ defaults: { lead: { status: 'NEW', customFields: null, ownerUserId: null } } });
let app;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: store.prisma } });
  mockIdentity(mock, { defaultRole: 'CLIENT' });
  mock.module('../services/workflowCrm.service.js', { namedExports: { emitCrmEvent: () => {} } });
  mock.module('../services/crmEvents.service.js', { namedExports: { emitCrmEvent: () => {}, emitCrmEvents: () => {}, applyLeadStatus: async () => ({ changed: false }), currentChainDepth: () => undefined } });
  mock.module('../services/audit.service.js', { namedExports: { record: async () => {} } });
  const routes = {};
  for (const [path, file] of [
    ['/leads', './leads.routes.js'],
    ['/lead-distribution', './leadDistribution.routes.js'],
    ['/crm-data', './crmData.routes.js'],
    ['/crm-sales-inbox', './crmSalesInbox.routes.js'],
    ['/crm-analytics', './crm-analytics.routes.js'],
  ]) routes[path] = (await import(file)).default;
  app = await startApp(routes);
});
test.after(() => app?.server.close());
test.beforeEach(() => {
  store.reset();
  store.seed('workspace', { id: 'ws1', recordVisibility: 'ALL' });
  store.seed('workspaceMember', { userId: 'u1', workspaceId: 'ws1', role: 'CLIENT' }, { userId: 'u2', workspaceId: 'ws1', role: 'CLIENT' });
});

// ─── The permission matrix, enforced on the routes it governs ───────────────

for (const [method, path, body, denied, allowed] of [
  ['DELETE', '/leads/l1', undefined, 'CLIENT', 'ADMIN'],
  ['POST', '/leads/bulk-delete', { ids: ['l1'] }, 'CLIENT', 'ADMIN'],
  ['POST', '/leads/bulk-assign', { ids: ['l1'], ownerUserId: null }, 'AGENT', 'CLIENT'],
  ['POST', '/lead-distribution/rules', { rules: [] }, 'CLIENT', null],
  ['GET', '/crm-data/export/leads', undefined, 'CLIENT', null],
  ['POST', '/crm-sales-inbox/launch-bulk-campaign', {}, 'AGENT', null],
  ['POST', '/crm-analytics/reports/saved', {}, 'AGENT', null],
  ['DELETE', '/crm-analytics/reports/saved/r1', undefined, 'AGENT', null],
]) {
  test(`${method} ${path} is refused for ${denied}${allowed ? ` and reaches the handler for ${allowed}` : ''}`, async () => {
    store.seed('lead', { id: 'l1', workspaceId: 'ws1', contactId: 'c1' });
    const res = await app.call(method, path, body, { role: denied });
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /permission|role|access/i);
    assert.equal(store.rows('lead').length, 1, 'a refused request changes nothing');
    if (allowed) {
      const ok = await app.call(method, path, body, { role: allowed });
      assert.ok(ok.status < 300, `${allowed} got ${ok.status}`);
    }
  });
}

test('viewers can read leads but not write them', async () => {
  assert.equal((await app.call('GET', '/leads', undefined, { role: 'VIEWER' })).status, 200);
  assert.equal((await app.call('POST', '/leads', { phoneNumber: '9876543210' }, { role: 'VIEWER' })).status, 403);
});

// ─── Integration health: recorded signals only (CF-077) ─────────────────────

const healthyNumber = {
  workspaceId: 'ws1', phoneNumber: '+911', displayName: 'Main', status: 'ACTIVE', quality: 'GREEN',
  appSubscribed: true, unreachableSince: null, unreachableReason: null, codeVerificationStatus: 'VERIFIED',
};

test('integration health reports recorded signals and nothing fabricated', async () => {
  const at = new Date();
  store.seed('waNumber', healthyNumber);
  store.seed('message',
    { direction: 'INBOUND', sentAt: at },
    { direction: 'OUTBOUND', status: 'FAILED', sentAt: at, statusAt: at, errorCode: 131026, errorMessage: 'Message undeliverable' });
  const res = await app.call('GET', '/crm-analytics/integration-health');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.uptime, undefined);
  assert.ok(!body.integrations.some((i) => i.provider === 'meta-graph' || 'latencyMs' in i));
  const wa = body.integrations.find((i) => i.provider === 'whatsapp');
  assert.equal(wa.status, 'HEALTHY');
  assert.equal(wa.lastSendFailure.code, 131026);
  assert.equal(wa.failedSendsLast24h, 1);
  assert.equal(body.integrations.find((i) => i.provider === 'facebook-lead').status, 'NOT_CONFIGURED');
  assert.equal(body.overallStatus, 'ALL_SYSTEMS_OPERATIONAL');
});

test('an unreachable or unsubscribed number makes WhatsApp degraded', async () => {
  store.seed('waNumber',
    { ...healthyNumber, unreachableSince: new Date('2026-09-30T00:00:00Z'), unreachableReason: 'Meta error 100' },
    { ...healthyNumber, appSubscribed: false });
  const body = await (await app.call('GET', '/crm-analytics/integration-health')).json();
  const wa = body.integrations.find((i) => i.provider === 'whatsapp');
  assert.equal(wa.status, 'DEGRADED');
  assert.equal(body.overallStatus, 'NEEDS_ATTENTION');
  assert.match(wa.numbers[0].problems[0], /Unreachable/);
  assert.match(wa.numbers[1].problems[0], /Webhook not subscribed/);
});

test('facebook lead ads is connected only through its integration row; no number needs attention', async () => {
  store.seed('workspaceIntegration',
    { workspaceId: 'ws1', provider: 'facebook-lead', status: 'CONNECTED', connectedAt: new Date() },
    { workspaceId: 'ws1', provider: 'google', status: 'CONNECTED', connectedAt: new Date() });
  const body = await (await app.call('GET', '/crm-analytics/integration-health')).json();
  assert.equal(body.integrations.find((i) => i.provider === 'facebook-lead').status, 'HEALTHY');
  assert.equal(body.integrations.find((i) => i.provider === 'google-sheets').status, 'HEALTHY');
  assert.equal(body.overallStatus, 'NEEDS_ATTENTION', 'no WhatsApp number at all');
});
