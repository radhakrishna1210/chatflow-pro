import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGraph, describeGraph, TRIGGERS, ACTIONS, CONDITIONS, __testing } from './workflowGraph.js';

// The validator's job is to refuse a graph the engine cannot run. An invented
// subtype used to produce a workflow that saves, appears in the list, and
// never fires. That is the failure these tests exist to prevent, because it
// looks like success.

const trigger = (subtype, value) => ({ type: 'trigger', subtype, value });
const action = (subtype, value) => ({ type: 'action', subtype, value });

test('an invented action subtype is refused, not quietly saved', () => {
  assert.throws(
    () => validateGraph([trigger('keyword', 'refund'), action('send_email', 'hi')]),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /not something an automation can do/);
      // The refusal lists what is available, so the next attempt can succeed.
      assert.match(err.message, /message/);
      return true;
    },
  );
});

test('an invented trigger subtype is refused', () => {
  assert.throws(
    () => validateGraph([trigger('on_full_moon'), action('message', 'hi')]),
    /not something that can start an automation/,
  );
});

test('a graph with no trigger or no actions is refused', () => {
  assert.throws(() => validateGraph([action('message', 'hi')]), /no starting point/);
  assert.throws(() => validateGraph([trigger('welcome')]), /does not do anything/);
  assert.throws(() => validateGraph([]), /no starting point/);
});

test('two triggers are refused', () => {
  assert.throws(
    () => validateGraph([trigger('welcome'), trigger('keyword', 'hi'), action('message', 'x')]),
    /only have one trigger/,
  );
});

test('a trigger that needs a value must have one', () => {
  assert.throws(() => validateGraph([trigger('keyword', '  '), action('message', 'x')]), /needs a value/);
  // welcome takes no value, so it is fine without one.
  assert.doesNotThrow(() => validateGraph([trigger('welcome'), action('message', 'x')]));
});

test('a delay the engine cannot parse is refused', () => {
  // The engine's parseDelayMs would return 0 and the step would vanish.
  assert.throws(
    () => validateGraph([trigger('welcome'), action('delay', 'a little while'), action('message', 'x')]),
    /not a duration the engine understands/,
  );
  assert.doesNotThrow(() => validateGraph([trigger('welcome'), action('delay', '2 hours'), action('message', 'x')]));
});

// Contract C6: workspaces add their own lifecycle stages and pipeline stages,
// so the graph accepts any non-empty key; workflow.service.js warns on save
// about a key the workspace does not have. The old expectation (built-in
// enums only) made CONVERTED, NURTURING and every custom stage unusable.
test('lead statuses and deal stages: any non-empty key at graph level', () => {
  assert.doesNotThrow(() => validateGraph([trigger('welcome'), action('lead_status', 'INTERESTED')]));
  assert.doesNotThrow(() => validateGraph([trigger('deal_stage', 'ALMOST_THERE'), action('message', 'x')]));
  assert.doesNotThrow(() => validateGraph([trigger('lead_status', 'CONVERTED'), action('task', 'Onboard')]));
  assert.doesNotThrow(() => validateGraph([trigger('deal_stage', 'NEGOTIATION'), action('lead_status', 'QUALIFIED')]));
  assert.throws(() => validateGraph([trigger('welcome'), action('lead_status', '  ')]), /missing its value/);
});

test('a score trigger needs a number', () => {
  assert.throws(() => validateGraph([trigger('score_above', 'high'), action('message', 'x')]), /needs a number/);
  assert.doesNotThrow(() => validateGraph([trigger('score_above', '70'), action('message', 'x')]));
});

test('more steps than the engine runs is refused rather than truncated', () => {
  const many = Array.from({ length: __testing.MAX_ACTIONS + 1 }, (_, i) => action('message', `m${i}`));
  assert.throws(() => validateGraph([trigger('welcome'), ...many]), /engine runs at most/);
});

test('a workflow that parks forever warns rather than failing', () => {
  // Valid, runnable, and almost certainly not what was meant — so it saves
  // with a warning instead of being refused.
  const { warnings } = validateGraph([trigger('welcome'), action('message', 'hi'), action('delay', '1 day')]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /pause and then stop/);
});

test('the graph is normalised to what the engine and the builder both read', () => {
  const { nodes } = validateGraph([
    trigger('keyword', 'refund'),
    action('delay', '30 minutes'),
    action('message', 'Sorry about that'),
  ]);
  assert.deepEqual(nodes, [
    { type: 'trigger', subtype: 'keyword', value: 'refund' },
    { type: 'action', subtype: 'delay', value: '30 minutes' },
    { type: 'action', subtype: 'message', value: 'Sorry about that' },
  ]);
});

test('the read-back is a sentence, not JSON', () => {
  const { nodes } = validateGraph([
    trigger('keyword', 'refund'),
    action('delay', '30 minutes'),
    action('message', 'Sorry about that'),
  ]);
  assert.equal(
    describeGraph(nodes),
    'When someone messages "refund", wait 30 minutes, then send "Sorry about that".',
  );
});

test('every declared subtype can describe itself', () => {
  // A subtype added to the table without a describe() would render as a raw
  // identifier in the confirmation the person reads before activating.
  for (const [name, spec] of Object.entries({ ...TRIGGERS, ...ACTIONS, ...CONDITIONS })) {
    assert.equal(typeof spec.describe, 'function', `${name} has no describe()`);
    assert.ok(spec.describe('x').length > 0, `${name} describes as empty`);
  }
});

const condition = (subtype, value, skipIfFalse = 1) => ({ type: 'condition', subtype, value, skipIfFalse });

test('conditions survive validation in place, with their skip counts', () => {
  // They used to be dropped silently, so every branch ran for every customer.
  const { nodes } = validateGraph([
    trigger('keyword', 'help'),
    action('buttons', 'How can we help? | Track order | Support'),
    action('wait_reply', ''),
    condition('equals', 'Track order', 1),
    action('message', 'Send your order ID'),
    condition('equals', 'Support', 1),
    action('agent', ''),
  ]);
  assert.deepEqual(nodes.map((n) => n.type), ['trigger', 'action', 'action', 'condition', 'action', 'condition', 'action']);
  assert.equal(nodes[3].skipIfFalse, 1);
});

test('buttons straight into a condition gets a wait for the reply, with a warning', () => {
  const { nodes, warnings } = validateGraph([
    trigger('keyword', 'help'),
    action('buttons', 'Pick one | A | B'),
    condition('equals', 'A'),
    action('message', 'You chose A'),
  ]);
  assert.equal(nodes[2].subtype, 'wait_reply');
  assert.match(warnings.join(' '), /wait for their reply/);
});

test('a condition that skips past the end, or an unknown condition, is refused', () => {
  assert.throws(
    () => validateGraph([trigger('welcome'), condition('contains', 'x', 3), action('message', 'y')]),
    /must skip between 1 and 1/,
  );
  assert.throws(
    () => validateGraph([trigger('welcome'), condition('sounds_angry', 'x'), action('message', 'y')]),
    /not a condition the engine can check/,
  );
});

test('buttons without options are refused', () => {
  assert.throws(() => validateGraph([trigger('welcome'), action('buttons', 'Just a question')]), /Option A/);
});

test('the media trigger validates its kind', () => {
  assert.doesNotThrow(() => validateGraph([{ type: 'trigger', subtype: 'media', value: 'audio' }, { type: 'action', subtype: 'message', value: 'Got your voice note' }]));
  assert.doesNotThrow(() => validateGraph([{ type: 'trigger', subtype: 'media', value: '' }, { type: 'action', subtype: 'message', value: 'Thanks' }]));
  assert.throws(() => validateGraph([{ type: 'trigger', subtype: 'media', value: 'gif' }, { type: 'action', subtype: 'message', value: 'x' }]), /not a kind of media/);
  assert.equal(TRIGGERS.media.describe('audio'), 'someone sends a voice note');
});

// ── Audit fixes (WF-EN-12, WF-EN-16, C2, C5) ────────────────────────────────

test('C5: the builder\'s "Immediate" delay is a zero delay, not an error', () => {
  for (const v of ['Immediate', 'immediate', '0']) {
    assert.doesNotThrow(() => validateGraph([trigger('welcome'), action('message', 'a'), action('delay', v), action('message', 'b')]), v);
  }
});

test('WF-EN-12: two buttons that clip to the same 20 characters are refused with the step number', () => {
  assert.throws(
    () => validateGraph([trigger('keyword', 'help'), action('message', 'x'), action('buttons', 'How can we help? | Talk to support team (billing) | Talk to support team (technical)')]),
    (err) => err.status === 400 && /^Step 2: /.test(err.message) && /20 characters/.test(err.message),
  );
  // Four or more options are a list, whose rows are cut at 24.
  assert.throws(
    () => validateGraph([trigger('keyword', 'help'), action('buttons', 'Pick | Order status for my parcel A | Order status for my parcel B | Refund | Other')]),
    /24 characters/,
  );
  assert.doesNotThrow(() => validateGraph([trigger('keyword', 'help'), action('buttons', 'Pick | Billing question | Technical question')]));
});

test('C2: normalisation keeps ids, canvas positions and step settings', () => {
  const { nodes } = validateGraph([
    { id: 't', type: 'trigger', subtype: 'keyword', value: 'order', pos: { x: 1, y: 2 } },
    { id: 's1', type: 'action', subtype: 'template', value: 'order_update', templateId: 'tpl_1', params: ['{{name}}', '{{order_id}}'], pos: { x: 3, y: 4 } },
    { id: 's2', type: 'action', subtype: 'wait_reply', value: 'answer', reminder: 'Still there?', remindAfter: '5 min' },
  ]);
  assert.deepEqual(nodes[0], { id: 't', type: 'trigger', subtype: 'keyword', value: 'order', pos: { x: 1, y: 2 } });
  assert.deepEqual(nodes[1].params, ['{{name}}', '{{order_id}}']);
  assert.equal(nodes[1].templateId, 'tpl_1');
  assert.deepEqual(nodes[1].pos, { x: 3, y: 4 });
  assert.equal(nodes[2].reminder, 'Still there?');
});

test('C3: template values must be a list of texts', () => {
  assert.throws(() => validateGraph([trigger('welcome'), { type: 'action', subtype: 'template', value: 't', params: 'a,b' }]), /list of texts/);
  assert.throws(() => validateGraph([trigger('welcome'), { type: 'action', subtype: 'template', value: 't', params: [{ a: 1 }] }]), /list of texts/);
});

test('the inserted wait gets an id and widens an earlier condition\'s skip window', () => {
  const { nodes } = validateGraph([
    trigger('keyword', 'help'),
    condition('is_new_contact', '', 3),
    { id: 'b', type: 'action', subtype: 'buttons', value: 'Welcome! | Browse | Talk to us' },
    condition('equals', 'Browse', 1),
    action('message', 'Here is our catalogue'),
  ]);
  assert.deepEqual(nodes.map((n) => n.subtype), ['keyword', 'is_new_contact', 'buttons', 'wait_reply', 'equals', 'message']);
  assert.equal(nodes[1].skipIfFalse, 4);
  assert.equal(nodes[3].id, 'b_reply');
});

test('WF-EN-16: a free-form message a day or more after the customer last wrote is flagged', () => {
  const { warnings } = validateGraph([
    trigger('keyword', 'demo'),
    action('message', 'Thanks!'),
    action('delay', '2 days'),
    action('message', 'Still interested?'),
  ]);
  assert.ok(warnings.some((w) => /^Step 3 \(message\)/.test(w) && /24 hours/.test(w) && /template/.test(w)), warnings.join(' | '));

  // Hours add up; a wait for the reply reopens the window.
  const split = validateGraph([trigger('keyword', 'demo'), action('delay', '12 hours'), action('delay', '12 hours'), action('message', 'x')]);
  assert.ok(split.warnings.some((w) => /24 hours/.test(w)));
  const answered = validateGraph([trigger('keyword', 'demo'), action('delay', '1 day'), action('wait_reply', ''), action('message', 'x')]);
  assert.ok(!answered.warnings.some((w) => /24 hours/.test(w)));
  const template = validateGraph([trigger('keyword', 'demo'), action('delay', '2 days'), action('template', 'follow_up')]);
  assert.ok(!template.warnings.some((w) => /24 hours/.test(w)), 'a template is fine out of the window');
});

test('WF-EN-16: "Assign to agent" warns that it pauses automation on the chat', () => {
  const { warnings } = validateGraph([trigger('keyword', 'support'), action('agent', '')]);
  assert.ok(warnings.some((w) => /pauses all automation on this chat until an agent resolves it or it expires/.test(w)));
});

test('WF-EN-16: a CRM trigger with a free-form step is told to use a template', () => {
  const { warnings } = validateGraph([trigger('lead_created'), action('message', 'Welcome!'), action('buttons', 'Demo? | Yes | No')]);
  assert.ok(warnings.some((w) => /Steps 1, 2/.test(w) && /last 24h/.test(w) && /template/.test(w)), warnings.join(' | '));
  const tplOnly = validateGraph([trigger('lead_created'), action('template', 'lead_welcome')]);
  assert.deepEqual(tplOnly.warnings, []);
});
