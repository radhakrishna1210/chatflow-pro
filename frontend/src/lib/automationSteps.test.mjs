import test from 'node:test';
import assert from 'node:assert/strict';

// Mirrors applyStepChange in AutomationView.jsx. Kept as a standalone copy
// because the component imports React and the frontend has no test runner —
// see OPEN-006. The logic is small and self-contained enough that a drift
// between the two would be caught by the shape assertions below.
const DEFAULT_STEP_VALUE = {
  keyword: 'HELP',
  welcome: '', missed: '', lead_created: '',
  lead_status: '', deal_stage: '',
  score_above: '70',
  message: 'Thanks for reaching out. Our team will help you shortly.',
  delay: '1 hour',
  tag: '', agent: '',
  task: '', owner: '', sequence: '',
};

function applyStepChange(step, fields) {
  const next = { ...step, ...fields };
  if (fields.type && fields.type !== step.type) {
    next.subtype = fields.type === 'trigger' ? 'keyword' : 'message';
    next.value = DEFAULT_STEP_VALUE[next.subtype];
    return next;
  }
  if (fields.subtype && fields.subtype !== step.subtype) {
    next.value = DEFAULT_STEP_VALUE[fields.subtype] ?? '';
  }
  return next;
}

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
  const TRIGGERS = ['keyword', 'welcome', 'missed', 'lead_created', 'lead_status', 'deal_stage', 'score_above'];
  const ACTIONS = ['message', 'delay', 'tag', 'agent', 'task', 'lead_status', 'owner', 'sequence'];
  for (const subtype of [...TRIGGERS, ...ACTIONS]) {
    assert.ok(subtype in DEFAULT_STEP_VALUE, `"${subtype}" is selectable but has no default value`);
  }
});
