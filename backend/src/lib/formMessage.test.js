// A WhatsApp Form's closing message can repeat answers and work out a total
// from the customer's own prices (uploaded sheet columns).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderFormMessage } from './formMessage.js';

const contact = {
  name: 'Radhakrishna',
  phoneNumber: '+919226381481',
  attributes: { oyster_price: '180', button_price: '120', shiitake_price: '450', milky_price: '160' },
};
const fields = [
  { key: 'how_many_kg_of_oyster_reply_0_if_none' },
  { key: 'how_many_kg_of_button_reply_0_if_none' },
  { key: 'how_many_kg_of_shiitake_reply_0_if_none' },
  { key: 'how_many_kg_of_milky_reply_0_if_none' },
  { key: 'your_full_delivery_address_with_pincode' },
];
const answers = {
  how_many_kg_of_oyster_reply_0_if_none: '2',
  how_many_kg_of_button_reply_0_if_none: '0',
  how_many_kg_of_shiitake_reply_0_if_none: '1',
  how_many_kg_of_milky_reply_0_if_none: '1.5',
  your_full_delivery_address_with_pincode: 'Flat 4, MG Road, Pune 411001',
};
const ctx = { contact, fields, answers };

test('a message without {{ is sent exactly as written', () => {
  const text = "Thanks! We've recorded your response.";
  assert.equal(renderFormMessage(text, ctx), text);
  assert.equal(renderFormMessage('Line 1\n\nLine 2  ', ctx), 'Line 1\n\nLine 2  ');
});

test('answers, name and sheet prices fill in', () => {
  assert.equal(
    renderFormMessage('Hi {{name}}: {{q1}} kg × ₹{{oyster_price}}, to {{q5}}', ctx),
    'Hi Radhakrishna: 2 kg × ₹180, to Flat 4, MG Road, Pune 411001',
  );
});

test('line totals and the order total are worked out', () => {
  assert.equal(renderFormMessage('₹{{= q1 * oyster_price}}', ctx), '₹360');
  assert.equal(
    renderFormMessage('Total ₹{{= q1*oyster_price + q2*button_price + q3*shiitake_price + q4*milky_price}}', ctx),
    'Total ₹1,050',
  );
  assert.equal(renderFormMessage('{{= (q1 + q3) * 10 / 4 - 1}}', ctx), '6.5');
});

test('multi-line receipt keeps its layout', () => {
  const out = renderFormMessage('Oyster: {{q1}} kg = ₹{{= q1 * oyster_price}}\nTotal: ₹{{= q1 * oyster_price}}', ctx);
  assert.equal(out, 'Oyster: 2 kg = ₹360\nTotal: ₹360');
});

test('a bad or unfillable expression renders empty, never runs code', () => {
  assert.equal(renderFormMessage('[{{= q1 * missing_price}}]', ctx), '[]');
  assert.equal(renderFormMessage('[{{= q5 * 2}}]', ctx), '[]'); // address is not a number
  assert.equal(renderFormMessage('[{{= process.exit(1)}}]', ctx), '[]');
  assert.equal(renderFormMessage('[{{= 1 / 0}}]', ctx), '[]');
  assert.equal(renderFormMessage('[{{= 2 +}}]', ctx), '[]');
});

test('what the customer typed is never treated as a variable', () => {
  const sneaky = { ...ctx, answers: { ...answers, your_full_delivery_address_with_pincode: '{{oyster_price}}' } };
  assert.equal(renderFormMessage('To: {{q5}}', sneaky), 'To: {{oyster_price}}');
});
