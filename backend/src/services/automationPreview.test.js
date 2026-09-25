import test from 'node:test';
import assert from 'node:assert/strict';
import { __testing } from './automation.service.js';

const { cleanWorkflowPreview } = __testing;

// What "Create with AI" saves is what runs on WhatsApp, so the model's output
// is cleaned into steps the engine understands before the person sees it.

test('a condition from the model stays a condition — it is never sent as a message', () => {
  const { nodes } = cleanWorkflowPreview({
    name: 'Menu',
    nodes: [
      { type: 'trigger', subtype: 'keyword', value: 'menu' },
      { type: 'action', subtype: 'buttons', value: 'What would you like? | Pizza | Pasta' },
      { type: 'action', subtype: 'wait_reply', value: '' },
      { type: 'condition', subtype: 'equals', value: 'Pizza', skipIfFalse: 1 },
      { type: 'action', subtype: 'message', value: 'Great choice!' },
    ],
  }, 'menu');
  assert.deepEqual(nodes.map((n) => `${n.type}:${n.subtype}`),
    ['trigger:keyword', 'action:buttons', 'action:wait_reply', 'condition:equals', 'action:message']);
  assert.ok(!nodes.some((n) => n.type === 'action' && n.value === 'Pizza'));
});

test('buttons followed straight by a condition get a wait for the tap', () => {
  const { nodes } = cleanWorkflowPreview({
    nodes: [
      { type: 'trigger', subtype: 'keyword', value: 'help' },
      { type: 'action', subtype: 'buttons', value: 'Help with? | Orders | Returns' },
      { type: 'condition', subtype: 'equals', value: 'Orders', skipIfFalse: 1 },
      { type: 'action', subtype: 'message', value: 'Send your order ID' },
    ],
  }, 'help');
  assert.equal(nodes[2].subtype, 'wait_reply');
});

test('unrunnable pieces are repaired or dropped rather than saved', () => {
  const { nodes } = cleanWorkflowPreview({
    nodes: [
      { type: 'trigger', subtype: 'missed', value: '' },
      { type: 'action', subtype: 'delay', value: 'a little while' },
      { type: 'action', subtype: 'send_email', value: 'x@y.z' },
      { type: 'condition', subtype: 'sounds_angry', value: 'x' },
      { type: 'action', subtype: 'buttons', value: 'Just a question' },
      { type: 'condition', subtype: 'contains', value: 'yes', skipIfFalse: 9 },
      { type: 'action', subtype: 'message', value: 'Ok' },
    ],
  }, 'refund please');
  assert.deepEqual(nodes[0], { id: 'step_1', type: 'trigger', subtype: 'keyword', value: 'REFUND, RETURN, MONEY BACK' });
  assert.equal(nodes[1].value, '5 min');
  assert.ok(!nodes.some((n) => n.subtype === 'send_email' || n.subtype === 'sounds_angry'));
  assert.deepEqual(nodes[2], { id: 'step_3', type: 'action', subtype: 'message', value: 'Just a question' });
  // Skip count clamped to what actually follows it.
  assert.equal(nodes[3].skipIfFalse, 1);
});

test('a trailing condition is dropped and an empty flow still replies', () => {
  const { nodes } = cleanWorkflowPreview({
    nodes: [
      { type: 'trigger', subtype: 'welcome' },
      { type: 'action', subtype: 'wait_reply', value: '' },
      { type: 'condition', subtype: 'contains', value: 'hi' },
    ],
  }, 'greet');
  assert.equal(nodes.at(-1).subtype, 'message');
  assert.ok(!nodes.some((n) => n.type === 'condition'));
});

// The trigger is what the customer's first message is about. "Order" in "ask
// for their order ID" is something the flow asks for later, and picking it made
// a refund workflow fire on every order question instead of on refunds.
test('the topic named first in the request becomes the trigger, with its synonyms', () => {
  const { inferKeyword } = __testing;
  assert.equal(inferKeyword('When a customer asks for a refund, ask for their order ID'), 'REFUND, RETURN, MONEY BACK');
  assert.equal(inferKeyword('When someone asks where their order is, send the tracking link'), 'ORDER, TRACK, DELIVERY');
  assert.equal(inferKeyword('Say hello'), 'HELP');
});

test('a generic HELP trigger from the model is replaced when the request names a topic', () => {
  const run = (value, prompt) => cleanWorkflowPreview({
    nodes: [{ type: 'trigger', subtype: 'keyword', value }, { type: 'action', subtype: 'message', value: 'Hi' }],
  }, prompt).nodes[0].value;
  assert.equal(run('HELP', 'When a customer asks for a refund, reply'), 'REFUND, RETURN, MONEY BACK');
  assert.equal(run('HELP', 'When someone needs help, reply'), 'HELP');
  assert.equal(run('refund, money back', 'When a customer asks for a refund'), 'REFUND, MONEY BACK');
});

test('a wait_reply keeps a reminder only when both the delay and the text are usable', () => {
  const nodes = cleanWorkflowPreview({
    nodes: [
      { type: 'trigger', subtype: 'keyword', value: 'refund' },
      { type: 'action', subtype: 'message', value: 'Your order ID?' },
      { type: 'action', subtype: 'wait_reply', value: 'order_id', remindAfter: '5 min', reminder: 'Still there?' },
      { type: 'action', subtype: 'message', value: 'And the reason?' },
      { type: 'action', subtype: 'wait_reply', value: 'reason', remindAfter: 'soonish', reminder: 'Hello?' },
      { type: 'action', subtype: 'wait_reply', value: 'x', remindAfter: '5 min' },
    ],
  }, 'refund').nodes;
  assert.deepEqual([nodes[2].remindAfter, nodes[2].reminder], ['5 min', 'Still there?']);
  assert.equal(nodes[4].remindAfter, undefined);
  assert.equal(nodes[5].remindAfter, undefined);
});
