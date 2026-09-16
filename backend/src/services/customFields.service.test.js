import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import {
  coerceValue, slugifyKey, createDefinition, updateDefinition,
  deleteDefinition, validateCrmCustomFields, listDefinitions,
} from './customFields.service.js';

// ─── Pure coercion ─────────────────────────────────────────────────────────

const def = (over = {}) => ({ label: 'Field', type: 'TEXT', required: false, options: null, ...over });

test('a label becomes a stable machine key', () => {
  assert.equal(slugifyKey('Annual Contract Value'), 'annual_contract_value');
  assert.equal(slugifyKey('  Budget (₹)  '), 'budget');
  assert.equal(slugifyKey('---'), '');
});

test('numbers are coerced and rejected when not numeric', () => {
  assert.equal(coerceValue(def({ type: 'NUMBER' }), '42'), 42);
  assert.equal(coerceValue(def({ type: 'CURRENCY' }), 1500.5), 1500.5);
  assert.throws(() => coerceValue(def({ type: 'NUMBER' }), 'abc'), (e) => e.status === 400);
});

test('booleans accept real booleans and their string forms only', () => {
  assert.equal(coerceValue(def({ type: 'BOOLEAN' }), true), true);
  assert.equal(coerceValue(def({ type: 'BOOLEAN' }), 'false'), false);
  assert.throws(() => coerceValue(def({ type: 'BOOLEAN' }), 'maybe'), (e) => e.status === 400);
});

test('dates normalise to a plain calendar day', () => {
  assert.equal(coerceValue(def({ type: 'DATE' }), '2026-03-04T10:00:00Z'), '2026-03-04');
  assert.throws(() => coerceValue(def({ type: 'DATE' }), 'not a date'), (e) => e.status === 400);
});

test('a dropdown accepts only its own options', () => {
  const d = def({ type: 'DROPDOWN', options: ['Small', 'Medium', 'Large'] });
  assert.equal(coerceValue(d, 'Medium'), 'Medium');
  assert.throws(() => coerceValue(d, 'Enormous'), (e) => e.status === 400 && /not one of the allowed/.test(e.message));
});

test('a multiselect rejects any value outside its options and de-duplicates', () => {
  const d = def({ type: 'MULTISELECT', options: ['A', 'B', 'C'] });
  assert.deepEqual(coerceValue(d, ['A', 'C', 'A']), ['A', 'C']);
  assert.throws(() => coerceValue(d, ['A', 'Z']), (e) => e.status === 400);
});

test('URL fields refuse non-web schemes', () => {
  const d = def({ type: 'URL' });
  assert.equal(coerceValue(d, 'https://example.test/x'), 'https://example.test/x');
  // A javascript: value would become a live link on the record page.
  assert.throws(() => coerceValue(d, 'javascript:alert(1)'), (e) => e.status === 400);
  assert.throws(() => coerceValue(d, 'data:text/html,<script>'), (e) => e.status === 400);
  assert.throws(() => coerceValue(d, 'not a url'), (e) => e.status === 400);
});

test('email and phone are checked for shape', () => {
  assert.equal(coerceValue(def({ type: 'EMAIL' }), ' a@b.test '), 'a@b.test');
  assert.throws(() => coerceValue(def({ type: 'EMAIL' }), 'nope'), (e) => e.status === 400);

  assert.equal(coerceValue(def({ type: 'PHONE' }), '+91 90000 00001'), '+91 90000 00001');
  assert.throws(() => coerceValue(def({ type: 'PHONE' }), '123'), (e) => e.status === 400);
});

test('an empty value clears an optional field but fails a required one', () => {
  assert.equal(coerceValue(def(), ''), null);
  assert.equal(coerceValue(def({ type: 'MULTISELECT', options: ['A'] }), []), null);
  assert.throws(() => coerceValue(def({ required: true }), ''), (e) => e.status === 400 && /required/.test(e.message));
});

test('over-long text is refused rather than silently truncated', () => {
  assert.throws(() => coerceValue(def({ type: 'TEXT' }), 'x'.repeat(501)), (e) => e.status === 400);
  assert.throws(() => coerceValue(def({ type: 'TEXTAREA' }), 'x'.repeat(5001)), (e) => e.status === 400);
});

// ─── Definitions and record validation ─────────────────────────────────────

let dbAvailable = false;
let workspaceId;
let userId;
let outsiderId;

test.before(async () => {
  try { await prisma.$connect(); dbAvailable = true; } catch { return; }
  const stamp = Date.now();
  workspaceId = (await prisma.workspace.create({ data: { name: `test-cf-${stamp}` } })).id;
  userId = (await prisma.user.create({ data: { name: 'Member', email: `cf-${stamp}@example.test` } })).id;
  outsiderId = (await prisma.user.create({ data: { name: 'Outsider', email: `cfo-${stamp}@example.test` } })).id;
  await prisma.workspaceMember.create({ data: { userId, workspaceId, role: 'ADMIN' } });
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  for (const id of [userId, outsiderId]) {
    if (id) await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect().catch(() => {});
});

test('a choice field cannot be created without options', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await assert.rejects(
    () => createDefinition(workspaceId, { entity: 'lead', label: 'Size', type: 'DROPDOWN', options: [] }),
    (e) => e.status === 400,
  );
});

test('duplicate field names in the same entity are refused', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await createDefinition(workspaceId, { entity: 'lead', label: 'Budget', type: 'NUMBER' });
  await assert.rejects(
    () => createDefinition(workspaceId, { entity: 'lead', label: 'budget', type: 'TEXT' }),
    (e) => e.status === 409,
  );
  // The same label on a different entity is fine.
  await createDefinition(workspaceId, { entity: 'deal', label: 'Budget', type: 'NUMBER' });
});

test('unknown keys are rejected instead of being stored', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await assert.rejects(
    () => validateCrmCustomFields(workspaceId, 'lead', { not_a_field: 'x' }),
    (e) => e.status === 400 && /Unknown custom field/.test(e.message),
  );
});

test('values are validated against their definition and merged over existing', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await createDefinition(workspaceId, { entity: 'lead', label: 'Segment', type: 'DROPDOWN', options: ['SMB', 'Mid', 'Enterprise'] });

  const first = await validateCrmCustomFields(workspaceId, 'lead', { budget: '5000' }, {});
  assert.equal(first.budget, 5000);

  // A later partial update must not wipe the earlier key.
  const merged = await validateCrmCustomFields(workspaceId, 'lead', { segment: 'Mid' }, first);
  assert.deepEqual(merged, { budget: 5000, segment: 'Mid' });

  await assert.rejects(
    () => validateCrmCustomFields(workspaceId, 'lead', { segment: 'Gigantic' }, merged),
    (e) => e.status === 400,
  );
});

test('a required field must be present after the merge, not just in the request', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const def = await createDefinition(workspaceId, { entity: 'deal', label: 'Approver', type: 'TEXT', required: true });

  await assert.rejects(
    () => validateCrmCustomFields(workspaceId, 'deal', {}, {}),
    (e) => e.status === 400 && /required/.test(e.message),
  );

  const ok = await validateCrmCustomFields(workspaceId, 'deal', { approver: 'Priya' }, {});
  assert.equal(ok.approver, 'Priya');

  // Clearing it later must also fail.
  await assert.rejects(
    () => validateCrmCustomFields(workspaceId, 'deal', { approver: '' }, ok),
    (e) => e.status === 400,
  );

  await updateDefinition(workspaceId, def.id, { required: false });
});

test('a user field must name a member of this workspace', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await createDefinition(workspaceId, { entity: 'lead', label: 'Reviewer', type: 'USER' });

  const ok = await validateCrmCustomFields(workspaceId, 'lead', { reviewer: userId }, {});
  assert.equal(ok.reviewer, userId);

  await assert.rejects(
    () => validateCrmCustomFields(workspaceId, 'lead', { reviewer: outsiderId }, {}),
    (e) => e.status === 400 && /not a member/.test(e.message),
  );
});

test('the key and type cannot be changed after creation', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const created = await createDefinition(workspaceId, { entity: 'lead', label: 'Locked', type: 'TEXT' });

  const updated = await updateDefinition(workspaceId, created.id, {
    label: 'Renamed', key: 'something_else', type: 'NUMBER',
  });

  assert.equal(updated.label, 'Renamed');
  assert.equal(updated.key, created.key, 'the storage key must survive a rename');
  assert.equal(updated.type, 'TEXT', 'the type must not change under stored values');
});

test('deleting a field deactivates it so existing values stay readable', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const created = await createDefinition(workspaceId, { entity: 'lead', label: 'Temporary', type: 'TEXT' });

  const result = await deleteDefinition(workspaceId, created.id);
  assert.equal(result.isActive, false);

  const active = await listDefinitions(workspaceId, 'lead');
  assert.ok(!active.data.some((d) => d.id === created.id));

  const all = await listDefinitions(workspaceId, 'lead', { includeInactive: true });
  assert.ok(all.data.some((d) => d.id === created.id));
});

test('passing null clears every custom field', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  assert.deepEqual(await validateCrmCustomFields(workspaceId, 'lead', null, { budget: 1 }), {});
  // undefined means "not supplied" and leaves the record alone.
  assert.equal(await validateCrmCustomFields(workspaceId, 'lead', undefined, { budget: 1 }), undefined);
});
