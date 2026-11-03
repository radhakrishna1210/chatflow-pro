import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contactVariableResolver, normalizeVariableMapping, missingMappedValues, describeMissing,
  buildTextComponents, fillVariables,
} from './templateParams.js';
import { attributesFromRow, toAttributeKey, mergeAttributes, normalizeAttributePatch } from './contactAttributes.js';

const BODY = {
  type: 'BODY',
  text: 'Hello {{1}}, special price: ₹{{2}} per kg',
  example: { body_text: [['Rahul', '180']] },
};
const components = [BODY];
const rahul = { name: 'Rahul', phoneNumber: '919876543210', attributes: { price: '165' } };
const priya = { name: 'Priya', phoneNumber: '919812345678', attributes: {} };
const mapping = { BODY: ['name', 'attr:price'] };

test('without a mapping, {{2}} keeps the approved sample (old behaviour)', () => {
  const resolve = contactVariableResolver(rahul);
  assert.equal(fillVariables(BODY.text, BODY, resolve), 'Hello Rahul, special price: ₹180 per kg');
});

test('mapped {{2}} uses each contact\'s own price', () => {
  const resolve = contactVariableResolver(rahul, mapping);
  assert.equal(fillVariables(BODY.text, BODY, resolve), 'Hello Rahul, special price: ₹165 per kg');
  const [body] = buildTextComponents(components, resolve);
  assert.deepEqual(body.parameters.map((p) => p.text), ['Rahul', '165']);
});

test('a contact without the mapped value is reported missing', () => {
  assert.deepEqual(missingMappedValues(components, rahul, mapping), []);
  const gaps = missingMappedValues(components, priya, mapping);
  assert.deepEqual(gaps, [{ component: 'BODY', variable: 2, source: 'attr:price' }]);
  assert.equal(describeMissing(gaps), 'No value for {{2}} (price)');
});

test('custom fields, email and sample sources', () => {
  const contact = { name: 'A', phoneNumber: '91', email: '', customFields: { city: 'Pune' } };
  const resolve = contactVariableResolver(contact, { BODY: ['field:city', 'sample'] });
  assert.equal(resolve(0, BODY), 'Pune');
  assert.equal(resolve(1, BODY), '180');
});

test('email mapped but absent is missing', () => {
  const contact = { name: 'A', phoneNumber: '91', email: null };
  assert.equal(missingMappedValues(components, contact, { BODY: ['name', 'email'] }).length, 1);
});

test('normalizeVariableMapping rejects bad input when strict', () => {
  assert.equal(normalizeVariableMapping(null), null);
  assert.equal(normalizeVariableMapping({ BODY: [null, null] }), null);
  assert.deepEqual(normalizeVariableMapping({ body: ['name', 'attr:price'] }), { BODY: ['name', 'attr:price'] });
  assert.throws(() => normalizeVariableMapping({ BODY: ['attr:Price!'] }, { strict: true }));
  assert.throws(() => normalizeVariableMapping({ FOOTER: ['name'] }, { strict: true }));
});

test('extra CSV columns become attributes; built-ins are ignored', () => {
  const row = { name: 'Rahul', 'Phone Number': '+91 98765 43210', email: '', tags: 'vip', 'Price (₹)': ' 180 ', City: '', 'Order ID': 'A1' };
  assert.deepEqual(attributesFromRow(row), { price: '180', order_id: 'A1' });
  assert.equal(toAttributeKey('Price (₹)'), 'price');
});

test('attribute merge updates, keeps and removes', () => {
  const merged = mergeAttributes({ price: '180', city: 'Pune' }, normalizeAttributePatch({ price: '200', city: null, grade: 'A' }));
  assert.deepEqual(merged, { price: '200', grade: 'A' });
});
