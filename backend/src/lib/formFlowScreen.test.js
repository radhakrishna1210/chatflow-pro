// A WhatsApp Form as one screen: the questions become Flow JSON, and a
// submitted screen becomes the same answers the chat version saves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFlowJson, flowFingerprint, answersFromFlowReply, usesTickBoxes, FLOW_SCREEN_ID,
} from './formFlowScreen.js';
import { advance } from './formFlow.js';

// The order form as the builder saves it.
const order = {
  name: 'Mushroom Order',
  schema: [
    { key: 'what', label: 'What would you like to order?', type: 'multi', required: true, options: ['White Button Mushroom', 'Oyster Mushroom', 'Baby Corn'] },
    { key: 'boxes', label: 'How many 10 kg boxes of White Button Mushroom?', type: 'number', required: true, options: [], showIf: { question: 1, option: 'White Button Mushroom' } },
    { key: 'packs', label: 'How many 200 g packs of Oyster Mushroom?', type: 'number', required: true, options: [], showIf: { question: 1, option: 'Oyster Mushroom' } },
    { key: 'corn', label: 'How many kg of Baby Corn?', type: 'number', required: true, options: [], showIf: { question: 1, option: 'Baby Corn' } },
    { key: 'address', label: 'Delivery address for this order?', type: 'text', required: true, options: [] },
  ],
};

const screenOf = (form) => buildFlowJson(form).screens[0];
const flat = (list) => list.flatMap((c) => [c, ...(c.then ? flat(c.then) : [])]);

test('the order form becomes one screen: tick boxes, a quantity under each, address, Submit', () => {
  const screen = screenOf(order);
  assert.equal(screen.id, FLOW_SCREEN_ID);
  assert.equal(screen.title, 'Mushroom Order');
  assert.equal(screen.terminal, true);

  const children = screen.layout.children;
  assert.deepEqual(children.map((c) => c.type), [
    'TextSubheading', 'OptIn', 'If', 'OptIn', 'If', 'OptIn', 'If', 'TextBody', 'TextArea', 'Footer',
  ]);
  assert.equal(children[0].text, 'What would you like to order?');
  assert.deepEqual(children[1], { type: 'OptIn', name: 'f1_o1', label: 'White Button Mushroom', required: false });

  // The quantity appears only when its item is ticked, with the full question
  // above a short label (WhatsApp caps an input label at 20 characters).
  assert.equal(children[2].condition, '${form.f1_o1}');
  assert.deepEqual(children[2].then, [
    { type: 'TextBody', text: 'How many 10 kg boxes of White Button Mushroom?' },
    { type: 'TextInput', name: 'f2', label: 'Quantity', 'input-type': 'number', required: true },
  ]);
  assert.equal(children[6].condition, '${form.f1_o3}');
  assert.equal(children[6].then[1].name, 'f4');

  assert.deepEqual(children[8], { type: 'TextArea', name: 'f5', label: 'Your answer', required: true });
});

test('Submit sends back every input on the screen', () => {
  const footer = screenOf(order).layout.children.at(-1);
  assert.equal(footer.label, 'Submit');
  assert.equal(footer['on-click-action'].name, 'complete');
  assert.deepEqual(footer['on-click-action'].payload, {
    f1_o1: '${form.f1_o1}', f2: '${form.f2}',
    f1_o2: '${form.f1_o2}', f3: '${form.f3}',
    f1_o3: '${form.f1_o3}', f4: '${form.f4}',
    f5: '${form.f5}',
  });
});

test('every label stays inside WhatsApp\'s limits', () => {
  const long = 'x'.repeat(200);
  const screen = screenOf({
    name: long,
    schema: [
      { key: 'a', label: long, type: 'multi', required: true, options: [long, 'B'] },
      { key: 'b', label: long, type: 'choice', required: true, options: [long, 'B'] },
      { key: 'c', label: long, type: 'number', required: true, options: [], showIf: { question: 1, option: long } },
      { key: 'd', label: long, type: 'multi', required: true, options: [long] },
    ],
  });
  assert.ok(screen.title.length <= 30);
  for (const c of flat(screen.layout.children)) {
    if (c.type === 'TextSubheading') assert.ok(c.text.length <= 80);
    if (c.type === 'OptIn') assert.ok(c.label.length <= 120);
    if (c.type === 'TextInput' || c.type === 'TextArea') assert.ok(c.label.length <= 20);
    if (c.type === 'RadioButtonsGroup' || c.type === 'CheckboxGroup') {
      assert.ok(c.label.length <= 30);
      for (const o of c['data-source']) assert.ok(o.title.length <= 30);
    }
  }
});

test('plain questions: short labels are used as they are, and each type gets its input', () => {
  const children = screenOf({
    name: 'Feedback',
    schema: [
      { key: 'name', label: 'Your name', type: 'text', required: true, options: [] },
      { key: 'email', label: 'Email', type: 'email', required: false, options: [] },
      { key: 'phone', label: 'Phone', type: 'phone', required: true, options: [] },
      { key: 'rating', label: 'Rating', type: 'choice', required: true, options: ['Good', 'Bad'] },
      { key: 'topics', label: 'Topics', type: 'multi', required: false, options: ['Price', 'Taste'] },
    ],
  }).layout.children;
  assert.deepEqual(children.slice(0, 5), [
    { type: 'TextArea', name: 'f1', label: 'Your name', required: true },
    { type: 'TextInput', name: 'f2', label: 'Email', 'input-type': 'email', required: false },
    { type: 'TextInput', name: 'f3', label: 'Phone', 'input-type': 'phone', required: true },
    { type: 'RadioButtonsGroup', name: 'f4', label: 'Rating', required: true, 'data-source': [{ id: 'o1', title: 'Good' }, { id: 'o2', title: 'Bad' }] },
    { type: 'CheckboxGroup', name: 'f5', label: 'Topics', required: false, 'data-source': [{ id: 'o1', title: 'Price' }, { id: 'o2', title: 'Taste' }] },
  ]);
});

test('a choice question shows its dependent question under the chosen option', () => {
  const children = screenOf({
    name: 'Visit',
    schema: [
      { key: 'come', label: 'Will you visit?', type: 'choice', required: true, options: ['Yes', 'No'] },
      { key: 'when', label: 'Which day?', type: 'text', required: true, options: [], showIf: { question: 1, option: 'Yes' } },
    ],
  }).layout.children;
  assert.deepEqual(children.map((c) => c.type), ['RadioButtonsGroup', 'If', 'Footer']);
  assert.equal(children[1].condition, "${form.f1} == 'o1'");
  assert.deepEqual(children[1].then, [{ type: 'TextArea', name: 'f2', label: 'Which day?', required: true }]);
});

test('forms that cannot be one screen are refused with a reason', () => {
  assert.throws(() => buildFlowJson({ name: 'Empty', schema: [] }), { status: 400, code: 'FLOW_UNSUPPORTED' });

  // "Ask only if" two levels deep.
  assert.throws(() => buildFlowJson({
    name: 'Deep',
    schema: [
      { key: 'a', label: 'A', type: 'choice', required: true, options: ['Yes', 'No'] },
      { key: 'b', label: 'B', type: 'choice', required: true, options: ['Yes', 'No'], showIf: { question: 1, option: 'Yes' } },
      { key: 'c', label: 'C', type: 'text', required: true, options: [], showIf: { question: 2, option: 'Yes' } },
    ],
  }), /one level of "Ask only if"/);

  // More than WhatsApp's 50 items on a screen.
  const many = Array.from({ length: 51 }, (_, i) => ({ key: `q${i}`, label: `Q${i}`, type: 'number', required: true, options: [] }));
  assert.throws(() => buildFlowJson({ name: 'Long', schema: many }), /WhatsApp allows 50/);
});

test('the fingerprint changes when the questions change, and only then', () => {
  const same = { ...order, completionMessage: 'Thanks!', keyword: 'PLACE ORDER' };
  assert.equal(flowFingerprint(order), flowFingerprint(same));
  const relabelled = { ...order, schema: order.schema.map((f, i) => (i === 4 ? { ...f, label: 'Where to?' } : f)) };
  assert.notEqual(flowFingerprint(order), flowFingerprint(relabelled));
});

test('a submitted screen gives the answers the chat version would have saved', () => {
  // Ticked White Button and Baby Corn; the Oyster quantity was never shown.
  const { answers, problems } = answersFromFlowReply(order.schema, {
    f1_o1: true, f2: '5', f1_o2: false, f3: '', f1_o3: true, f4: '5', f5: ' Baner branch, Pune 411045 ',
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(answers, {
    what: 'White Button Mushroom, Baby Corn',
    boxes: '5',
    packs: '0',
    corn: '5',
    address: 'Baner branch, Pune 411045',
  });

  // The same order typed in chat: "1,3", then "5", "5" and the address.
  let chat = advance(order.schema, 1, { what: 'White Button Mushroom, Baby Corn' });
  chat = advance(order.schema, chat.cursor + 1, { ...chat.answers, boxes: '5' });
  chat = advance(order.schema, chat.cursor + 1, { ...chat.answers, corn: '5' });
  assert.deepEqual(answers, { ...chat.answers, address: 'Baner branch, Pune 411045' });
});

test('hidden inputs arrive missing, null or as text — all read as not answered', () => {
  const { answers, problems } = answersFromFlowReply(order.schema, {
    f1_o1: 'false', f1_o2: 'true', f2: null, f3: 12, f5: 'Kothrud',
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(answers, { what: 'Oyster Mushroom', boxes: '0', packs: '12', corn: '0', address: 'Kothrud' });
});

test('missing or malformed required answers are named', () => {
  // Nothing ticked, no address.
  assert.deepEqual(answersFromFlowReply(order.schema, {}).problems, [
    'What would you like to order?', 'Delivery address for this order?',
  ]);
  // Ticked, but the quantity left empty or not a number.
  assert.deepEqual(answersFromFlowReply(order.schema, { f1_o1: true, f5: 'x' }).problems,
    ['How many 10 kg boxes of White Button Mushroom?']);
  assert.deepEqual(answersFromFlowReply(order.schema, { f1_o1: true, f2: 'five', f5: 'x' }).problems,
    ['How many 10 kg boxes of White Button Mushroom?']);
});

test('checkbox groups, radio buttons and optional numbers', () => {
  const fields = [
    { key: 'topics', label: 'Topics', type: 'multi', required: true, options: ['Price', 'Taste', 'Service'] },
    { key: 'rating', label: 'Rating', type: 'choice', required: true, options: ['Good', 'Bad'] },
    { key: 'qty', label: 'Extra', type: 'number', required: false, options: [] },
  ];
  assert.equal(usesTickBoxes(fields, 0), false);
  assert.deepEqual(answersFromFlowReply(fields, { f1: ['o3', 'o1'], f2: 'o2' }).answers,
    { topics: 'Price, Service', rating: 'Bad', qty: '0' });
  assert.deepEqual(answersFromFlowReply(fields, { f1: [], f2: 'nonsense' }).problems, ['Topics', 'Rating']);
});
