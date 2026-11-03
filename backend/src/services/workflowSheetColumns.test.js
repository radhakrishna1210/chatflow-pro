// Workflow messages can use columns from an uploaded contact sheet
// ({{oyster_price}}), so each customer sees their own values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, evaluateCondition } from './workflowConditions.js';

const contact = {
  name: 'Aarav',
  phoneNumber: '+917410066251',
  customFields: { tier: 'gold' },
  attributes: { oyster_price: '180', button_price: '120', name: 'from-sheet', tier: 'from-sheet' },
};

test('sheet columns fill workflow message variables', () => {
  assert.equal(
    renderTemplate('Hi {{name}}, Oyster ₹{{oyster_price}}/kg, Button ₹{{ button_price }}/kg', { contact }),
    'Hi Aarav, Oyster ₹180/kg, Button ₹120/kg',
  );
});

test('attr. prefix and differently-written column names resolve too', () => {
  assert.equal(renderTemplate('{{attr.oyster_price}}', { contact }), '180');
  assert.equal(renderTemplate('{{Oyster_Price}}', { contact }), '180');
});

test('built-in values and custom fields still win over sheet columns', () => {
  assert.equal(renderTemplate('{{name}} {{tier}}', { contact }), 'Aarav gold');
});

test('values the run collected still win, unknown tokens still vanish', () => {
  assert.equal(renderTemplate('{{oyster_price}}', { contact, variables: { oyster_price: '5' } }), '5');
  assert.equal(renderTemplate('[{{shiitake_price}}]', { contact }), '[]');
  assert.equal(renderTemplate('[{{oyster_price}}]', { contact: { name: 'No sheet' } }), '[]');
});

test('conditions can check a sheet column', () => {
  assert.equal(evaluateCondition({ subtype: 'field_equals', value: 'oyster_price=180' }, { contact }), true);
  assert.equal(evaluateCondition({ subtype: 'field_set', value: 'milky_price' }, { contact }), false);
});
