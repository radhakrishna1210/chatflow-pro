import test from 'node:test';
import assert from 'node:assert/strict';

// Nothing here may reach a database or a model: these are the rules that
// decide what the onboarding agent is allowed to build.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.GEMINI_API_KEY = '';

const {
  normalizeBlueprint, checkBlueprint, hasErrors, describeItem, hashItem, resolveNodes, templateComponents,
} = await import('./agentBlueprint.js');

// The agent's job is to connect the pieces. On this platform a button starts a
// workflow only because its label matches a keyword, so a blueprint whose
// pieces do not connect saves, looks finished and does nothing — the failure
// these checks exist to catch before anything is created.

const form = (over = {}) => ({
  key: 'order_form', type: 'form', name: 'Order form', keyword: 'ORDER',
  fields: [{ label: 'What would you like?', type: 'choice', options: ['Tea', 'Coffee'] }],
  ...over,
});
const workflow = (nodes, over = {}) => ({ key: 'flow', type: 'workflow', name: 'Flow', nodes, ...over });
const trigger = (subtype, value) => ({ type: 'trigger', subtype, value });
const action = (subtype, value) => ({ type: 'action', subtype, value });
const condition = (subtype, value, skipIfFalse = 1) => ({ type: 'condition', subtype, value, skipIfFalse });

const check = (items, existing) => checkBlueprint(normalizeBlueprint({ items }), existing);
const errorsOf = (r) => r.issues.filter((i) => i.level === 'error').map((i) => i.message);
const warningsOf = (r) => r.issues.filter((i) => i.level === 'warning').map((i) => i.message);

test('a welcome menu that starts a form from a button is accepted', () => {
  const r = check([
    form({ keyword: '' }),
    workflow([
      trigger('welcome'),
      action('buttons', 'Hi! How can we help? | Place an order | Talk to us'),
      action('wait_reply'),
      condition('equals', 'Place an order', 1),
      action('form', '@order_form'),
      condition('equals', 'Talk to us', 1),
      action('agent'),
    ]),
  ]);
  assert.deepEqual(errorsOf(r), []);
  assert.equal(hasErrors(r.issues), false);
});

test('a form nothing can start is refused', () => {
  const r = check([form({ keyword: '' })]);
  assert.match(errorsOf(r).join(' '), /Nothing starts the form/);
});

test('a workflow that starts a form which is not there is refused', () => {
  const missing = check([workflow([trigger('keyword', 'BUY'), action('form', '@nope')])]);
  assert.match(errorsOf(missing).join(' '), /not part of this setup/);

  const named = check([workflow([trigger('keyword', 'BUY'), action('form', 'Survey')])]);
  assert.match(errorsOf(named).join(' '), /does not exist/);

  const existing = check([workflow([trigger('keyword', 'BUY'), action('form', 'survey')])], { forms: [{ id: 'f1', name: 'Survey', keyword: 'SURVEY' }] });
  assert.deepEqual(errorsOf(existing), []);
});

test('two items listening for the same keyword are refused, naming which one would win', () => {
  const r = check([
    form(),
    { key: 'reply', type: 'auto_reply', keyword: 'order', response: 'We will call you.' },
  ]);
  const errors = errorsOf(r);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"ORDER" starts both the form "Order form" and the auto-reply/);
  // Reported on the one that would never run.
  assert.equal(r.issues.find((i) => i.level === 'error').itemKey, 'reply');
});

test('a keyword the workspace already uses is caught', () => {
  const taken = { forms: [{ id: 'f1', name: 'Old form', keyword: 'ORDER' }], triggers: [{ id: 't1', keyword: 'HOURS' }] };
  assert.match(errorsOf(check([form({ name: 'New form' })], taken)).join(' '), /already uses the keyword "ORDER"/);
  assert.match(
    errorsOf(check([{ key: 'r', type: 'auto_reply', keyword: 'HOURS', response: '9 to 6' }], taken)).join(' '),
    /already have an auto-reply for "HOURS"/,
  );
});

test('a second form with the same name is refused, since workflows start forms by name', () => {
  const r = check([form({ keyword: 'BUY' })], { forms: [{ id: 'f1', name: 'order form', keyword: 'OLD' }] });
  assert.match(errorsOf(r).join(' '), /already have a form called "Order form"/);
});

test('a button that leads nowhere is flagged', () => {
  const r = check([
    workflow([trigger('welcome'), action('buttons', 'Welcome! | Place an order | See prices')]),
    form(),
  ]);
  assert.deepEqual(errorsOf(r), []);
  const warnings = warningsOf(r);
  // "Place an order" contains the form keyword ORDER; "See prices" matches nothing.
  assert.equal(warnings.some((w) => /"Place an order"/.test(w)), false);
  assert.equal(warnings.some((w) => /nothing happens when a customer taps "See prices"/.test(w)), true);
});

test('buttons answered inside the workflow are not flagged', () => {
  const r = check([workflow([
    trigger('keyword', 'MENU'),
    action('buttons', 'Pick one | Red | Blue'),
    action('wait_reply', 'colour'),
    action('message', 'You picked {{colour}}'),
  ])]);
  assert.deepEqual(r.issues, []);
});

test('WhatsApp button limits are enforced', () => {
  const tooMany = check([workflow([trigger('welcome'), action('buttons', 'Q | A | B | C | D'), action('wait_reply'), action('message', 'ok')])]);
  assert.match(errorsOf(tooMany).join(' '), /at most 3 buttons/);
  const tooLong = check([workflow([trigger('welcome'), action('buttons', 'Q | This label is far too long | B'), action('wait_reply'), action('message', 'ok')])]);
  assert.match(errorsOf(tooLong).join(' '), /longer than 20 characters/);
});

test('an invented step is refused through the engine validator', () => {
  const r = check([workflow([trigger('keyword', 'PAY'), action('take_payment', '500')])]);
  assert.match(errorsOf(r).join(' '), /not something an automation can do/);
});

test('a template is validated, and a workflow sending it is told it waits for Meta', () => {
  const template = { key: 'offer', type: 'template', name: 'Weekend Offer', category: 'MARKETING', body: 'Hi {{1}}, 10% off this weekend.', buttons: ['Place an order'], examples: ['Asha'] };
  const r = check([
    template,
    form(),
    workflow([trigger('lead_created'), action('template', '@offer')]),
  ]);
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.blueprint.items[0].name, 'weekend_offer');
  assert.equal(warningsOf(r).some((w) => /Meta has to approve first/.test(w)), true);

  const components = templateComponents(r.blueprint.items[0]);
  assert.deepEqual(components.find((c) => c.type === 'BODY').example, { body_text: [['Asha']] });
  assert.deepEqual(components.find((c) => c.type === 'BUTTONS').buttons, [{ type: 'QUICK_REPLY', text: 'Place an order' }]);

  const clash = check([template], { templates: [{ id: 't', name: 'weekend_offer', status: 'APPROVED' }] });
  assert.match(errorsOf(clash).join(' '), /already exists/);
});

test('unknown item types are dropped and keys are made unique', () => {
  const bp = normalizeBlueprint({ items: [
    { key: 'A b', type: 'auto_reply', keyword: 'hi', response: 'Hello' },
    { key: 'a_b', type: 'auto_reply', keyword: 'bye', response: 'Bye' },
    { key: 'x', type: 'campaign', name: 'Blast everyone' },
    null,
  ] });
  assert.equal(bp.items.length, 2);
  assert.notEqual(bp.items[0].key, bp.items[1].key);
  assert.equal(bp.items[0].keyword, 'HI');
});

test('an empty blueprint cannot be applied', () => {
  assert.equal(hasErrors(check([]).issues), true);
});

test('references resolve to real names, and the read-back uses them', () => {
  const r = check([form({ keyword: '' }), workflow([trigger('keyword', 'BUY'), action('form', '@order_form')])]);
  const flow = r.blueprint.items.find((i) => i.type === 'workflow');
  assert.match(describeItem(flow, r.blueprint), /start the form "Order form"/);
  const nodes = resolveNodes(flow.nodes, { order_form: 'Order form' });
  assert.equal(nodes.at(-1).value, 'Order form');
  assert.equal(nodes[0].id, 'step_1');
});

test('the hash changes with the content and not with the key', () => {
  const a = normalizeBlueprint({ items: [form()] }).items[0];
  assert.equal(hashItem(a), hashItem({ ...a, key: 'other' }));
  assert.notEqual(hashItem(a), hashItem({ ...a, keyword: 'BUY' }));
});
