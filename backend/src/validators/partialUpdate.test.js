import test from 'node:test';
import assert from 'node:assert/strict';
import { leadSchemas, dealSchemas, ticketSchemas, taskSchemas, teamSchemas } from './index.js';

// DEF-011: a PATCH that omits a field must not clear it.
//
// Every optional-nullable field was written as
//
//   z.union([inner, z.literal(''), z.null()]).optional().transform(v => v ? v : null)
//
// and a Zod transform runs on `undefined` as well. So parsing `{ status: 'X' }`
// produced `{ status: 'X', ownerUserId: null, source: null, notes: null }`, and
// because services spread the parsed body straight into `prisma.update`, every
// omitted field was written as NULL.
//
// These tests pin the rule that matters: absent stays absent, and an explicitly
// sent empty value still clears.

test('a partial lead update does not null the fields it never mentions', () => {
  const parsed = leadSchemas.update.parse({ status: 'QUALIFIED' });

  assert.equal(parsed.status, 'QUALIFIED');
  // The keys must be absent, not present-and-null. Prisma treats undefined as
  // "leave alone" and null as "write NULL", so this distinction is the bug.
  assert.ok(!('ownerUserId' in parsed) || parsed.ownerUserId === undefined,
    'ownerUserId leaked into a partial update and would clear the owner');
  assert.ok(!('source' in parsed) || parsed.source === undefined,
    'source leaked into a partial update and would clear the source');
  assert.ok(!('notes' in parsed) || parsed.notes === undefined,
    'notes leaked into a partial update and would erase the notes');
});

test('an explicitly emptied field still clears', () => {
  assert.equal(leadSchemas.update.parse({ ownerUserId: null }).ownerUserId, null);
  assert.equal(leadSchemas.update.parse({ ownerUserId: '' }).ownerUserId, null);
  assert.equal(leadSchemas.update.parse({ notes: '' }).notes, null);
});

test('a supplied value survives untouched', () => {
  const uid = 'cmswoeban000313rrqm90nxit';
  assert.equal(leadSchemas.update.parse({ ownerUserId: uid }).ownerUserId, uid);
  assert.equal(leadSchemas.update.parse({ source: 'Referral' }).source, 'Referral');
});

test('the same rule holds across the other update schemas', () => {
  const cases = [
    ['deal', dealSchemas.update, { title: 'Renewal' }],
    // `status` is intentionally not on ticketSchemas.update — it moves only
    // through /status, which enforces the transitions.
    ['ticket', ticketSchemas.update, { subject: 'Refund not received' }],
    ['task', taskSchemas.update, { status: 'COMPLETED' }],
    ['team', teamSchemas.update, { name: 'Field sales' }],
  ];

  for (const [label, schema, input] of cases) {
    const parsed = schema.parse(input);
    const nulled = Object.entries(parsed)
      .filter(([k, v]) => v === null && !(k in input))
      .map(([k]) => k);
    assert.deepEqual(nulled, [], `${label}: ${nulled.join(', ')} would be cleared by a partial update`);
  }
});
