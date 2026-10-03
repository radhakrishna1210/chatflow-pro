import test from 'node:test';
import assert from 'node:assert/strict';

// WF-EN-5: what {{2}} becomes when a sender has no value for it. By default
// nothing — a workflow template step once told every customer "order
// ORD-12345 ships on 12 Jan" from the template's approval samples. Senders
// whose template IS the message (a campaign, the inbox picker) opt into the
// samples explicitly.
const { contactVariableResolver } = await import('./templateParams.js');

const body = { type: 'BODY', text: 'Hi {{1}}, order {{2}} ships on {{3}}', example: { body_text: [['John', 'ORD-12345', '12 Jan']] } };

test('by default {{2}}+ never take the approval sample value', () => {
  const resolve = contactVariableResolver({ name: 'Asha' });
  const values = [0, 1, 2].map((i) => resolve(i, body));
  assert.deepEqual(values, ['Asha', '', '']);
  assert.ok(!values.includes('ORD-12345'));
});

test('a campaign (samples: true) keeps its approved sample values', () => {
  const resolve = contactVariableResolver({ name: 'Asha' }, { samples: true });
  assert.deepEqual([0, 1, 2].map((i) => resolve(i, body)), ['Asha', 'ORD-12345', '12 Jan']);
});

test('{{1}} is the contact name, or "there" without one', () => {
  assert.equal(contactVariableResolver({ name: '  ' })(0, body), 'there');
});
