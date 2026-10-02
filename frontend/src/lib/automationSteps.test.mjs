import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStepChange, DEFAULT_STEP_VALUE, TRIGGER_SUBTYPES, ACTION_SUBTYPES, CONDITION_SUBTYPES,
} from './automationSteps.js';

// Tests the real applyStepChange the workflow builder uses (it used to test a
// hand-copied version that had drifted from the component).

const keywordTrigger = { id: 's1', type: 'trigger', subtype: 'keyword', value: 'ORDER' };

test('switching a keyword trigger to a CRM trigger clears the stale keyword', () => {
  const next = applyStepChange(keywordTrigger, { subtype: 'deal_stage' });
  assert.equal(next.subtype, 'deal_stage');
  assert.equal(next.value, '', 'a leftover "ORDER" would show as nothing selected and save an unmatched stage');
});

test('a score trigger arrives with a usable default rather than empty', () => {
  const next = applyStepChange(keywordTrigger, { subtype: 'score_above' });
  assert.equal(next.value, '70');
  assert.ok(Number.isFinite(Number(next.value)), 'the default must satisfy the save-time numeric check');
});

test('changing type resets both subtype and value', () => {
  const asAction = applyStepChange(keywordTrigger, { type: 'action' });
  assert.equal(asAction.type, 'action');
  assert.equal(asAction.subtype, 'message');
  assert.notEqual(asAction.value, 'ORDER');

  const backToTrigger = applyStepChange(asAction, { type: 'trigger' });
  assert.equal(backToTrigger.subtype, 'keyword');
  assert.equal(backToTrigger.value, 'HELP');
});

test('changing to a condition defaults to "equals" and a skip of one step', () => {
  const asCondition = applyStepChange(keywordTrigger, { type: 'condition' });
  assert.equal(asCondition.subtype, 'equals');
  assert.equal(asCondition.value, '');
  assert.equal(asCondition.skipIfFalse, 1);

  const kept = applyStepChange({ ...asCondition, skipIfFalse: 3 }, { type: 'condition' });
  assert.equal(kept.skipIfFalse, 3, 'a no-op type change keeps the configured skip');

  const backToAction = applyStepChange(asCondition, { type: 'action' });
  assert.equal(backToAction.skipIfFalse, undefined, 'only a condition carries a skip count');
});

test('a reminder belongs to a "Wait for reply" step only', () => {
  const wait = { id: 'w', type: 'action', subtype: 'wait_reply', value: 'order', remindAfter: '5 min', reminder: 'Still there?' };
  const edited = applyStepChange(wait, { value: 'order_id' });
  assert.equal(edited.reminder, 'Still there?');
  const changed = applyStepChange(wait, { subtype: 'message' });
  assert.equal(changed.reminder, undefined);
  assert.equal(changed.remindAfter, undefined);
  assert.equal(changed.value, DEFAULT_STEP_VALUE.message);
});

test('editing only the value leaves subtype alone', () => {
  const next = applyStepChange(keywordTrigger, { value: 'REFUND' });
  assert.equal(next.subtype, 'keyword');
  assert.equal(next.value, 'REFUND');
});

test('re-selecting the same subtype does not wipe a typed value', () => {
  const typed = { id: 's2', type: 'action', subtype: 'task', value: 'Call the lead' };
  const next = applyStepChange(typed, { subtype: 'task' });
  assert.equal(next.value, 'Call the lead', 'a no-op change must not clear the field');
});

test('every selectable subtype has a defined default', () => {
  for (const [subtype] of [...TRIGGER_SUBTYPES, ...ACTION_SUBTYPES, ...CONDITION_SUBTYPES]) {
    assert.ok(subtype in DEFAULT_STEP_VALUE, `"${subtype}" is selectable but has no default value`);
  }
});

test('the missed-call trigger, which nothing fires, is not offered', () => {
  assert.ok(!TRIGGER_SUBTYPES.some(([subtype]) => subtype === 'missed'));
});
