import test from 'node:test';
import assert from 'node:assert/strict';
import { toE164, phoneVariants } from './phone.js';
import { planPhoneBackfill } from '../services/contactPhoneBackfill.js';

// CF-200: one spelling per number, so the (workspaceId, phoneNumber) unique
// key actually stops duplicates.

test('every common spelling of an Indian number becomes the same E.164 value', () => {
  for (const raw of ['+91 98765 43210', '+91-98765-43210', '0091 9876543210', '09876543210', '9876543210', '919876543210', ' (+91) 98765 43210 ']) {
    assert.equal(toE164(raw, { country: 'IN' }), '+919876543210', raw);
  }
});

test('the workspace country supplies the code for national numbers only', () => {
  assert.equal(toE164('5551234567', { country: 'US' }), '+15551234567');
  assert.equal(toE164('15551234567', { country: 'US' }), '+15551234567');
  assert.equal(toE164('07911 123456', { country: 'GB' }), '+447911123456');
  // An explicit international number keeps its own code whatever the default.
  assert.equal(toE164('+447911123456', { country: 'IN' }), '+447911123456');
  // A foreign number typed without "+" but with its code is not re-prefixed.
  assert.equal(toE164('447911123456', { country: 'IN' }), '+447911123456');
});

test('international-only sources never get the national rule', () => {
  // A 10-digit Singapore number from Meta must not become +91…
  assert.equal(toE164('6591234567', { country: 'IN', international: true }), '+6591234567');
  assert.equal(toE164('6591234567', { country: 'IN' }), '+916591234567');
});

test('junk is refused rather than stored', () => {
  for (const raw of ['', null, undefined, 'abc', '123', '+0123456789', '1234567890123456']) {
    assert.equal(toE164(raw, { country: 'IN' }), null, String(raw));
  }
});

test('lookup variants cover the spellings rows were stored under before normalisation', () => {
  assert.deepEqual(
    new Set(phoneVariants('+919876543210', { country: 'IN' })),
    new Set(['+919876543210', '919876543210', '9876543210', '09876543210']),
  );
  // Another country's number has no national spelling in this workspace.
  assert.deepEqual(new Set(phoneVariants('+447911123456', { country: 'IN' })), new Set(['+447911123456', '447911123456']));
});

test('the backfill rewrites single rows and reports collapsing duplicates without touching them', () => {
  const plan = planPhoneBackfill([
    { id: 'a', phoneNumber: '9876543210' },
    { id: 'b', phoneNumber: '+91 98765 43210' },
    { id: 'c', phoneNumber: '09811111111' },
    { id: 'd', phoneNumber: '+919822222222' },
    { id: 'e', phoneNumber: 'n/a' },
  ], 'IN');
  assert.deepEqual(plan.updates, [{ id: 'c', from: '09811111111', to: '+919811111111' }]);
  assert.equal(plan.collisions.length, 1);
  assert.equal(plan.collisions[0].phoneNumber, '+919876543210');
  assert.deepEqual(plan.collisions[0].contacts.map((c) => c.id), ['a', 'b']);
  assert.deepEqual(plan.invalid.map((c) => c.id), ['e']);
});
