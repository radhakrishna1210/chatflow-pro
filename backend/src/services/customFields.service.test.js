import test from 'node:test';
import assert from 'node:assert/strict';
import { coerceValue, slugifyKey } from './customFields.service.js';

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

// Definitions and record validation run through the real routes in
// routes/customFields.http.test.js (CF-163).
