import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, mockIdentity, startApp } from './crmHttp.testutil.js';
import { unscopedRecordScope } from '../services/recordScope.testStub.js';

// CRM custom fields through the real routers (CF-163): definitions via
// /custom-fields (admin-only, route Zod enum), values via PATCH /leads/:id.
// These replace the DB-only service tests, which exercised types the route
// rejected (CF-063) and were skipped without a database.

const store = createStore({ defaults: { customFieldDefinition: { isActive: true, required: false } } });
let app;

test.before(async () => {
  mock.module('../lib/prisma.js', { namedExports: { prisma: store.prisma } });
  mockIdentity(mock);
  mock.module('../services/recordScope.service.js', { namedExports: unscopedRecordScope });
  mock.module('../services/workflowCrm.service.js', { namedExports: { emitCrmEvent: () => {} } });
  mock.module('../services/gamification.service.js', {
    namedExports: { awardXp: async () => {}, unlockAchievement: async () => {}, earnsQualifiedLead: () => false },
  });
  const { default: customFields } = await import('./customFields.routes.js');
  const { default: leads } = await import('./leads.routes.js');
  app = await startApp({ '/custom-fields': customFields, '/leads': leads });
});
test.after(() => app?.server.close());
test.beforeEach(() => {
  store.reset();
  store.seed('workspaceMember', { userId: 'u1', workspaceId: 'ws1', role: 'ADMIN' });
  store.seed('lead', { id: 'l1', workspaceId: 'ws1', contactId: 'c1', status: 'NEW', customFields: null, ownerUserId: null });
});

const define = (body, opts) => app.call('POST', '/custom-fields', body, opts);
const setFields = (customFields) => app.call('PATCH', '/leads/l1', { customFields });
const leadFields = () => store.rows('lead')[0].customFields;

test('a choice field cannot be created without options', async () => {
  assert.equal((await define({ entity: 'lead', label: 'Size', type: 'DROPDOWN', options: [] })).status, 400);
});

test('duplicate field names in the same entity are refused; another entity is fine', async () => {
  assert.equal((await define({ entity: 'lead', label: 'Budget', type: 'NUMBER' })).status, 201);
  assert.equal((await define({ entity: 'lead', label: 'budget', type: 'TEXT' })).status, 409);
  assert.equal((await define({ entity: 'deal', label: 'Budget', type: 'NUMBER' })).status, 201);
});

test('only admins define fields', async () => {
  assert.equal((await define({ entity: 'lead', label: 'Region' }, { role: 'CLIENT' })).status, 403);
});

test('unknown keys on a record are rejected instead of being stored', async () => {
  const res = await setFields({ not_a_field: 'x' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Unknown custom field/);
  assert.equal(leadFields(), null);
});

test('values are validated against their definition and merged over existing ones', async () => {
  await define({ entity: 'lead', label: 'Budget', type: 'NUMBER' });
  await define({ entity: 'lead', label: 'Segment', type: 'DROPDOWN', options: ['SMB', 'Mid', 'Enterprise'] });

  assert.equal((await setFields({ budget: '5000' })).status, 200);
  assert.equal(leadFields().budget, 5000);
  assert.equal((await setFields({ segment: 'Mid' })).status, 200);
  assert.equal(leadFields().budget, 5000, 'a partial update keeps the earlier key');
  assert.equal(leadFields().segment, 'Mid');
  assert.equal((await setFields({ segment: 'Gigantic' })).status, 400);
});

test('a required field must be present after the merge and cannot be cleared', async () => {
  const def = await (await define({ entity: 'lead', label: 'Approver', type: 'TEXT', required: true })).json();
  assert.equal((await setFields({})).status, 400);
  assert.equal((await setFields({ approver: 'Priya' })).status, 200);
  assert.equal((await setFields({ approver: '' })).status, 400);
  assert.equal((await app.call('PATCH', `/custom-fields/${def.id}`, { required: false })).status, 200);
  assert.equal((await setFields({ approver: '' })).status, 200);
});

test('a user field must name a member of this workspace', async () => {
  await define({ entity: 'lead', label: 'Reviewer', type: 'USER' });
  assert.equal((await setFields({ reviewer: 'u1' })).status, 200);
  const res = await setFields({ reviewer: 'outsider' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /not a member/);
});

test('the key and type cannot be changed after creation', async () => {
  const created = await (await define({ entity: 'lead', label: 'Locked', type: 'TEXT' })).json();
  // The strict update schema refuses the attempt outright…
  assert.equal((await app.call('PATCH', `/custom-fields/${created.id}`, { label: 'Renamed', type: 'NUMBER' })).status, 400);
  // …and a rename keeps the storage key.
  const renamed = await (await app.call('PATCH', `/custom-fields/${created.id}`, { label: 'Renamed' })).json();
  assert.equal(renamed.label, 'Renamed');
  assert.equal(renamed.key, created.key);
  assert.equal(renamed.type, 'TEXT');
});

test('deleting a field deactivates it so existing values stay readable', async () => {
  const created = await (await define({ entity: 'lead', label: 'Temporary', type: 'TEXT' })).json();
  const res = await app.call('DELETE', `/custom-fields/${created.id}`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).isActive, false);
  const active = await (await app.call('GET', '/custom-fields?entity=lead')).json();
  assert.ok(!active.data.some((d) => d.id === created.id));
});
