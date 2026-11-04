// "Pick several" questions and "Ask only if" rules in WhatsApp Forms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMulti, isPicked, advance, normalizeShowIf } from './formFlow.js';
import { renderFormMessage, closingTotal } from './formMessage.js';

const OPTIONS = ['Oyster', 'Button', 'Shiitake', 'Milky'];

test('pick several: numbers, names and mixed ways of writing them', () => {
  assert.deepEqual(parseMulti('1,3', OPTIONS).picked, ['Oyster', 'Shiitake']);
  assert.deepEqual(parseMulti('1 3', OPTIONS).picked, ['Oyster', 'Shiitake']);
  assert.deepEqual(parseMulti('3 and 1', OPTIONS).picked, ['Oyster', 'Shiitake']); // form order kept
  assert.deepEqual(parseMulti('oyster, milky', OPTIONS).picked, ['Oyster', 'Milky']);
  assert.deepEqual(parseMulti('2', OPTIONS).picked, ['Button']);
  assert.deepEqual(parseMulti('1,1,1', OPTIONS).picked, ['Oyster']);
  assert.deepEqual(parseMulti('all', OPTIONS).picked, OPTIONS);
  assert.deepEqual(parseMulti('1, 9', OPTIONS).error, ['9']);
});

test('isPicked reads a stored "A, B" answer, including options with commas', () => {
  assert.equal(isPicked('Oyster, Shiitake', 'Shiitake'), true);
  assert.equal(isPicked('Oyster, Shiitake', 'Button'), false);
  assert.equal(isPicked('Under ₹10,000, Above ₹2,00,000', 'Under ₹10,000'), true);
  assert.equal(isPicked('', 'Oyster'), false);
});

const fields = [
  { key: 'which', type: 'multi', options: OPTIONS },
  { key: 'oyster_kg', type: 'number', showIf: { question: 1, option: 'Oyster' } },
  { key: 'button_kg', type: 'number', showIf: { question: 1, option: 'Button' } },
  { key: 'shiitake_kg', type: 'number', showIf: { question: 1, option: 'Shiitake' } },
  { key: 'milky_kg', type: 'number', showIf: { question: 1, option: 'Milky' } },
  { key: 'address', type: 'text' },
];

test('only the picked items are asked; skipped quantities are recorded as 0', () => {
  let state = advance(fields, 1, { which: 'Oyster, Shiitake' });
  assert.equal(state.cursor, 1); // oyster asked
  state = advance(fields, 2, { ...state.answers, oyster_kg: '2' });
  assert.equal(state.cursor, 3); // button skipped, shiitake asked
  assert.equal(state.answers.button_kg, '0');
  state = advance(fields, 4, { ...state.answers, shiitake_kg: '1' });
  assert.equal(state.cursor, 5); // milky skipped, address asked
  assert.equal(state.answers.milky_kg, '0');
  state = advance(fields, 6, { ...state.answers, address: 'Narhe, Pune' });
  assert.equal(state.cursor, 6); // done
});

test('a form without rules moves on one question at a time, as before', () => {
  const plain = [{ key: 'a', type: 'text' }, { key: 'b', type: 'number' }];
  assert.deepEqual(advance(plain, 1, { a: 'x' }), { cursor: 1, answers: { a: 'x' } });
});

test('ask-only-if rules must point at an earlier question with that option', () => {
  const f = [{ key: 'which', type: 'multi', options: OPTIONS }, { key: 'x', type: 'text', options: [] }];
  assert.deepEqual(normalizeShowIf({ question: 1, option: 'Oyster' }, 1, f), { question: 1, option: 'Oyster' });
  assert.equal(normalizeShowIf({ question: 1, option: 'Truffle' }, 1, f), null);
  assert.equal(normalizeShowIf({ question: 2, option: 'Oyster' }, 1, f), null); // not earlier
  assert.equal(normalizeShowIf({ question: 2, option: 'a' }, 2, f), null); // not a choice question
});

test('receipt lines starting with {{? qN}} appear only for picked items', () => {
  const contact = { name: 'krishna', attributes: { oyster_price: '180', button_price: '120', shiitake_price: '450', milky_price: '160' } };
  const answers = { which: 'Oyster, Shiitake', oyster_kg: '2', button_kg: '0', shiitake_kg: '1', milky_kg: '0', address: 'Narhe, Pune' };
  const text = [
    'Thank you {{name}}! Your order:',
    '{{? q2}}Oyster: {{q2}} kg × ₹{{oyster_price}} = ₹{{= q2 * oyster_price}}',
    '{{? q3}}Button: {{q3}} kg × ₹{{button_price}} = ₹{{= q3 * button_price}}',
    '{{? q4}}Shiitake: {{q4}} kg × ₹{{shiitake_price}} = ₹{{= q4 * shiitake_price}}',
    '{{? q5}}Milky: {{q5}} kg × ₹{{milky_price}} = ₹{{= q5 * milky_price}}',
    'Total to pay: ₹{{= q2*oyster_price + q3*button_price + q4*shiitake_price + q5*milky_price}}',
    'Delivery to: {{q6}}',
  ].join('\n');
  assert.equal(renderFormMessage(text, { contact, fields, answers }), [
    'Thank you krishna! Your order:',
    'Oyster: 2 kg × ₹180 = ₹360',
    'Shiitake: 1 kg × ₹450 = ₹450',
    'Total to pay: ₹810',
    'Delivery to: Narhe, Pune',
  ].join('\n'));
  assert.equal(closingTotal(text, { contact, fields, answers }), 810);
});
