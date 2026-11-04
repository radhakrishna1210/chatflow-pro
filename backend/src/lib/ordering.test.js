// Workflow messages see sheet columns only when the workspace has ordering on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactForWorkflows } from './ordering.js';
import { renderTemplate } from '../services/workflowConditions.js';

const contact = { name: 'Asha', phoneNumber: '+919800000000', attributes: { price: '180' } };

test('ordering on: sheet columns fill workflow messages', () => {
  assert.equal(renderTemplate('{{name}} ₹{{price}}', { contact: contactForWorkflows(contact, true) }), 'Asha ₹180');
});

test('ordering off: sheet columns are hidden, as before the feature', () => {
  const seen = contactForWorkflows(contact, false);
  assert.equal(seen.attributes, undefined);
  assert.equal(renderTemplate('{{name}} ₹{{price}}', { contact: seen }), 'Asha ₹');
  assert.equal(contact.attributes.price, '180'); // the contact itself is untouched
  assert.equal(contactForWorkflows(null, false), null);
});
