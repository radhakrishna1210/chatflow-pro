import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowSchemas } from './index.js';

// Workflow create/update used to accept `nodes: z.any()`: a string, null,
// invented subtypes or more steps than the engine runs were all saved, and
// the engine then skipped or truncated them silently.

const trigger = { id: 'step_1', type: 'trigger', subtype: 'keyword', value: 'HELP', pos: { x: 10, y: 20 } };
const message = (value, extra = {}) => ({ id: `m_${value}`, type: 'action', subtype: 'message', value, ...extra });
const create = (nodes, extra = {}) => workflowSchemas.create.safeParse({ name: 'Support flow', nodes, ...extra });
const firstError = (r) => r.error?.issues?.[0]?.message ?? '';

test('a builder-shaped workflow is accepted with its ids and canvas positions intact', () => {
  const nodes = [
    trigger,
    { id: 'b', type: 'action', subtype: 'buttons', value: 'How can we help? | Track | Support' },
    { id: 'w', type: 'action', subtype: 'wait_reply', value: 'choice', reminder: 'Still there?', remindAfter: '5 min' },
    { id: 'c', type: 'condition', subtype: 'equals', value: 'Track', skipIfFalse: 1 },
    message('Send your order ID'),
    { id: 'd', type: 'action', subtype: 'delay', value: '1 hour' },
    message('Thanks'),
  ];
  const r = create(nodes, { edges: [], isActive: true });
  assert.equal(r.success, true, firstError(r));
  assert.deepEqual(r.data.nodes[0].pos, { x: 10, y: 20 });
  assert.equal(r.data.nodes[2].reminder, 'Still there?');
});

test('nodes that are not a list of nodes are refused', () => {
  assert.equal(create('garbage').success, false);
  assert.equal(create(null).success, false);
  assert.equal(create(undefined).success, false);
  assert.equal(create([]).success, false);
});

test('an unknown action subtype is refused instead of being skipped at run time', () => {
  const r = create([trigger, { type: 'action', subtype: 'send_email', value: 'hi' }]);
  assert.equal(r.success, false);
  assert.match(firstError(r), /Unknown action/);
});

test('an unknown node type is refused', () => {
  assert.equal(create([trigger, { type: 'branch', subtype: 'message', value: 'x' }]).success, false);
});

test('the missed-call trigger, which nothing fires, is refused', () => {
  const r = create([{ type: 'trigger', subtype: 'missed', value: '' }, message('Sorry we missed you')]);
  assert.equal(r.success, false);
});

test('more steps than the engine runs is a 400, not a silent truncation', () => {
  const steps = Array.from({ length: 21 }, (_, i) => message(`m${i}`));
  const r = create([trigger, ...steps]);
  assert.equal(r.success, false);
});

test('graph rules apply: a trigger is required and values must be present', () => {
  assert.match(firstError(create([message('hi')])), /starting point/);
  assert.match(firstError(create([trigger, { type: 'action', subtype: 'tag', value: '' }])), /missing its value/);
  assert.match(firstError(create([trigger, { type: 'action', subtype: 'delay', value: 'soonish' }, message('x')])), /duration/);
});

test('update validates nodes when they are sent and still allows a bare toggle', () => {
  assert.equal(workflowSchemas.update.safeParse({ isActive: false }).success, true);
  assert.equal(workflowSchemas.update.safeParse({ nodes: 'garbage' }).success, false);
  assert.equal(workflowSchemas.update.safeParse({ nodes: [trigger, message('ok')], edges: [] }).success, true);
});
