import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGraph, describeGraph, TRIGGERS, ACTIONS } from './workflowCompiler.service.js';

// The compiler's job is not to produce a graph — it is to refuse a graph the
// engine cannot run.
//
// `workflowSchemas.create` declares `nodes: z.any()`, and the engine reads
// `node.subtype` and silently does nothing when it does not recognise one. So
// an invented subtype produces a workflow that saves, appears in the list, and
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

test('enum values are checked against the real enums', () => {
  assert.throws(
    () => validateGraph([trigger('welcome'), action('lead_status', 'INTERESTED')]),
    /not a lead status/,
  );
  assert.throws(
    () => validateGraph([trigger('deal_stage', 'ALMOST_THERE'), action('message', 'x')]),
    /not a deal stage/,
  );
  assert.doesNotThrow(() => validateGraph([trigger('deal_stage', 'NEGOTIATION'), action('lead_status', 'QUALIFIED')]));
});

test('a score trigger needs a number', () => {
  assert.throws(() => validateGraph([trigger('score_above', 'high'), action('message', 'x')]), /needs a number/);
  assert.doesNotThrow(() => validateGraph([trigger('score_above', '70'), action('message', 'x')]));
});

test('more steps than the engine runs is refused rather than truncated', () => {
  const many = Array.from({ length: 11 }, (_, i) => action('message', `m${i}`));
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
  for (const [name, spec] of Object.entries({ ...TRIGGERS, ...ACTIONS })) {
    assert.equal(typeof spec.describe, 'function', `${name} has no describe()`);
    assert.ok(spec.describe('x').length > 0, `${name} describes as empty`);
  }
});
