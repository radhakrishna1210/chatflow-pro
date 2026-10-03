import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStepChange, DEFAULT_STEP_VALUE, TRIGGER_SUBTYPES, ACTION_SUBTYPES, CONDITION_SUBTYPES,
  DELAY_CHOICES, stepHint, actionSubtypesFor, HINTS, leadStatusChoices, dealStageChoices,
  parseKeywords, templateParamCount, templateBodyText, unmappedParams, resizeParams, variablesBefore,
  stepNumber, stepTitle, insertStep, removeStep, moveStep, moveStepTo, maxSkipFor, clampSkips,
  normaliseLoadedSteps, chatFlowIssue, chatFlowError, readRunsPage, describeRun, subtypeLabel,
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

// ── Delay ───────────────────────────────────────────────────────────────────
test('the delay default is one of the dropdown choices, and "Immediate" is offered', () => {
  assert.ok(DELAY_CHOICES.includes(DEFAULT_STEP_VALUE.delay), 'palette/default and dropdown must agree');
  assert.ok(DELAY_CHOICES.includes('Immediate'));
});

// ── Compatibility hints ─────────────────────────────────────────────────────
const act = (subtype, extra = {}) => ({ id: `a_${subtype}`, type: 'action', subtype, value: '', ...extra });

test('a CRM trigger flags free-form chat steps and recommends the template step', () => {
  for (const trig of ['lead_created', 'lead_status', 'deal_stage', 'score_above']) {
    for (const sub of ['message', 'buttons', 'wait_reply']) {
      const h = stepHint(trig, act(sub));
      assert.equal(h?.key, 'crmChatStep', `${trig} + ${sub}`);
      assert.match(h.text, /24 hours/);
      assert.match(h.text, /approved template/i);
    }
    assert.equal(stepHint(trig, act('template')), null);
    assert.equal(actionSubtypesFor(trig)[0][0], 'template', 'template step first under a CRM trigger');
    assert.equal(actionSubtypesFor(trig).length, ACTION_SUBTYPES.length);
  }
});

test('a message trigger flags lead steps; chat steps are fine there', () => {
  for (const trig of ['keyword', 'welcome', 'media']) {
    assert.equal(stepHint(trig, act('lead_status'))?.key, 'messageLeadStep');
    assert.equal(stepHint(trig, act('owner'))?.key, 'messageLeadStep');
    assert.equal(stepHint(trig, act('message')), null);
    assert.equal(actionSubtypesFor(trig), ACTION_SUBTYPES, 'normal order under a message trigger');
  }
  assert.equal(stepHint('lead_created', act('lead_status')), null, 'a CRM run has its lead');
});

test('"Assign to agent" says it pauses automation, in its label and its hint', () => {
  assert.match(subtypeLabel('action', 'agent'), /pauses automation/i);
  assert.equal(stepHint('keyword', act('agent'))?.key, 'agent');
  assert.match(HINTS.agent, /pauses until the conversation is resolved or the handoff expires/);
});

test('conditions and triggers get human labels, not raw ids', () => {
  assert.equal(subtypeLabel('condition', 'is_new_contact'), 'Is a new contact');
  assert.equal(subtypeLabel('trigger', 'deal_stage'), 'CRM: Deal stage changed');
});

// ── Lead statuses / deal stages ─────────────────────────────────────────────
test('status and stage choices include the workspace configuration plus built-ins', () => {
  const cfg = {
    lead_lifecycle: { stages: [{ key: 'NEW', label: 'New Lead' }, { key: 'DEMO_BOOKED', label: 'Demo booked' }, { key: 'OLD', label: 'Old', isActive: false }] },
    deal_setup: { stages: [{ key: 'PILOT', label: 'Pilot' }, { key: 'CLOSED_WON', label: 'Won' }] },
  };
  const leads = leadStatusChoices(cfg);
  assert.deepEqual(leads.slice(0, 2), [{ key: 'NEW', label: 'New Lead' }, { key: 'DEMO_BOOKED', label: 'Demo booked' }]);
  assert.ok(leads.some((c) => c.key === 'CONVERTED'), 'a trigger can wait for conversion');
  assert.ok(!leads.some((c) => c.key === 'OLD'), 'an inactive stage is not offered');
  assert.equal(leads.filter((c) => c.key === 'NEW').length, 1, 'no duplicates');
  assert.ok(!leadStatusChoices(cfg, { forAction: true }).some((c) => c.key === 'CONVERTED'));
  const deals = dealStageChoices(cfg);
  assert.equal(deals[0].key, 'PILOT');
  assert.equal(deals.find((c) => c.key === 'CLOSED_WON').label, 'Won');
  assert.ok(deals.some((c) => c.key === 'NEGOTIATION'));
  // No config at all still offers the built-ins; a stale saved value stays selectable.
  assert.ok(leadStatusChoices(null).length >= 5);
  assert.ok(dealStageChoices(undefined, { current: 'GONE' }).some((c) => c.key === 'GONE'));
});

// ── Keywords ────────────────────────────────────────────────────────────────
test('keyword chips are trimmed and de-duplicated case-insensitively', () => {
  assert.deepEqual(parseKeywords(' ORDER, track ,, Order,PRICE LIST '), ['ORDER', 'track', 'PRICE LIST']);
  assert.deepEqual(parseKeywords(''), []);
});

// ── Templates ───────────────────────────────────────────────────────────────
test('template placeholders are read from the body and unmapped ones are reported', () => {
  const tpl = { components: [{ type: 'HEADER', text: '{{9}}' }, { type: 'BODY', text: 'Hi {{1}}, order {{2}} ships {{ 3 }}.' }] };
  const body = templateBodyText(tpl);
  assert.equal(templateParamCount(body), 3, 'header placeholders are not body params');
  assert.equal(templateParamCount('No variables'), 0);
  assert.deepEqual(unmappedParams(3, ['{{name}}', ' ', undefined]), [2, 3]);
  assert.deepEqual(unmappedParams(2, ['{{name}}', '{{order_id}}']), []);
  assert.deepEqual(resizeParams(['a'], 3), ['a', '', '']);
  assert.deepEqual(resizeParams(['a', 'b', 'c'], 1), ['a']);
});

test('switching a template step to another kind drops its template id and params', () => {
  const tpl = act('template', { value: 'order_update', templateId: 't1', params: ['{{name}}'] });
  const kept = applyStepChange(tpl, { params: ['{{order_id}}'] });
  assert.equal(kept.templateId, 't1');
  const changed = applyStepChange(tpl, { subtype: 'message' });
  assert.equal(changed.templateId, undefined);
  assert.equal(changed.params, undefined);
});

test('the variable helper lists names saved by earlier "Wait for reply" steps only', () => {
  const steps = [
    { id: 't', type: 'trigger', subtype: 'keyword', value: 'ORDER' },
    act('wait_reply', { id: 'w1', value: 'order_id' }),
    act('template', { id: 'tp' }),
    act('wait_reply', { id: 'w2', value: 'later' }),
  ];
  const tokens = variablesBefore(steps, 2).map((v) => v.token);
  assert.ok(tokens.includes('{{name}}'));
  assert.ok(tokens.some((t) => t.startsWith('{{custom.')));
  assert.ok(tokens.includes('{{order_id}}'));
  assert.ok(!tokens.includes('{{later}}'), 'a later step\'s variable is not yet known');
});

// ── Numbering ───────────────────────────────────────────────────────────────
test('steps are numbered from 1 after the trigger, like the server\'s errors', () => {
  const steps = [{ id: 't', type: 'trigger', subtype: 'keyword', value: 'X' }, act('message'), act('tag')];
  assert.equal(stepNumber(steps, 0), null);
  assert.equal(stepTitle(steps, 0), 'Trigger');
  assert.equal(stepTitle(steps, 1), 'Step 1');
  assert.equal(stepTitle(steps, 2), 'Step 2');
  const issue = chatFlowIssue([steps[0], act('buttons', { id: 'b', value: 'Q | A | B' }), { id: 'c', type: 'condition', subtype: 'equals', value: 'A', skipIfFalse: 1 }, act('message')]);
  assert.match(issue.message, /^Step 1 asks with buttons and step 2 is a condition/);
});

// ── Insert / remove / move ──────────────────────────────────────────────────
const trig = { id: 't', type: 'trigger', subtype: 'keyword', value: 'X' };
const cond = (id, skip) => ({ id, type: 'condition', subtype: 'contains', value: 'y', skipIfFalse: skip });
const m = (id) => ({ id, type: 'action', subtype: 'message', value: id });
const ids = (steps) => steps.map((s) => s.id);

test('inserting inside a condition\'s window grows it; inserting after it does not', () => {
  const steps = [trig, cond('c', 2), m('a'), m('b'), m('z')];
  const inside = insertStep(steps, 2, m('new'));
  assert.deepEqual(ids(inside), ['t', 'c', 'a', 'new', 'b', 'z']);
  assert.equal(inside[1].skipIfFalse, 3, 'still guards a and b, plus the new step between them');
  const rightAfterCond = insertStep(steps, 1, m('new'));
  assert.equal(rightAfterCond[1].skipIfFalse, 3);
  const after = insertStep(steps, 3, m('new'));
  assert.deepEqual(ids(after), ['t', 'c', 'a', 'b', 'new', 'z']);
  assert.equal(after[1].skipIfFalse, 2);
  assert.equal(insertStep(steps, 0, m('new'))[1].id, 'new', 'never above the trigger');
});

test('removing a guarded step shrinks the window; skips never exceed the steps below', () => {
  const steps = [trig, cond('c', 2), m('a'), m('b'), m('z')];
  const out = removeStep(steps, 'a');
  assert.deepEqual(ids(out), ['t', 'c', 'b', 'z']);
  assert.equal(out[1].skipIfFalse, 1);
  const tail = removeStep([trig, m('a'), cond('c', 2), m('b'), m('z')], 'z');
  assert.equal(tail[2].skipIfFalse, 1);
  assert.equal(maxSkipFor(tail, 2), 1);
  assert.equal(clampSkips([trig, cond('c', 5), m('a')])[1].skipIfFalse, 1);
});

test('moving steps keeps the trigger first and clamps skips', () => {
  const steps = [trig, m('a'), m('b'), cond('c', 1), m('d')];
  assert.deepEqual(ids(moveStep(steps, 'b', -1)), ['t', 'b', 'a', 'c', 'd']);
  assert.deepEqual(ids(moveStep(steps, 'a', -1)), ['t', 'a', 'b', 'c', 'd'], 'the first step cannot climb over the trigger');
  assert.deepEqual(ids(moveStep(steps, 'd', 1)), ids(steps));
  const moved = moveStepTo(steps, 'c', 3);
  assert.deepEqual(ids(moved), ['t', 'a', 'b', 'd', 'c']);
  assert.equal(moved[4].skipIfFalse, 1);
});

test('loaded nodes get ids, lose canvas positions and keep the trigger first', () => {
  const out = normaliseLoadedSteps([{ type: 'trigger', subtype: 'keyword', value: 'X' }, { type: 'action', subtype: 'message', value: 'hi', pos: { x: 1, y: 2 } }, { id: 'dup', type: 'action', subtype: 'tag', value: 'a' }, { id: 'dup', type: 'action', subtype: 'tag', value: 'b' }]);
  assert.ok(out.every((s) => s.id));
  assert.equal(new Set(out.map((s) => s.id)).size, out.length, 'ids are unique');
  assert.equal(out[1].pos, undefined);
});

// ── Save checks ─────────────────────────────────────────────────────────────
test('buttons straight into a condition offer an "insert Wait for reply" fix', () => {
  const steps = [trig, act('buttons', { id: 'b', value: 'Q | A | B' }), cond('c', 1), m('x')];
  const issue = chatFlowIssue(steps);
  assert.equal(issue.fix.kind, 'insert_wait_reply');
  assert.equal(issue.fix.afterId, 'b');
  const fixed = insertStep(steps, issue.fix.position, { id: 'w', type: 'action', subtype: 'wait_reply', value: '' });
  assert.deepEqual(ids(fixed), ['t', 'b', 'w', 'c', 'x']);
  assert.equal(chatFlowError(fixed), '');
});

test('a template step with an unmapped variable is caught when the template is known', () => {
  const templates = [{ id: 't1', name: 'order_update', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi {{1}}, order {{2}}' }] }];
  const steps = [trig, act('template', { value: 'order_update', templateId: 't1', params: ['{{name}}', ''] })];
  assert.match(chatFlowError(steps, { templates }), /\{\{2\}\}/);
  assert.equal(chatFlowError([trig, act('template', { value: 'order_update', templateId: 't1', params: ['{{name}}', '{{order_id}}'] })], { templates }), '');
  assert.match(chatFlowError([trig, act('template')]), /approved template/);
});

// ── Runs ────────────────────────────────────────────────────────────────────
test('a runs page is read from an array or an object, total from body or header', () => {
  assert.deepEqual(readRunsPage([{ id: 1 }], '42'), { items: [{ id: 1 }], total: 42 });
  assert.deepEqual(readRunsPage([{ id: 1 }], null), { items: [{ id: 1 }], total: null });
  assert.deepEqual(readRunsPage({ data: [{ id: 2 }], total: 7 }, null), { items: [{ id: 2 }], total: 7 });
  assert.deepEqual(readRunsPage({ runs: [{ id: 3 }] }, '5'), { items: [{ id: 3 }], total: 5 });
  assert.deepEqual(readRunsPage(null, null), { items: [], total: null });
});

test('a suppressed trigger reads "Didn\'t run — <reason>"', () => {
  const d = describeRun({ status: 'CANCELLED', error: 'Not run: the chat is with a person' });
  assert.equal(d.label, "Didn't run");
  assert.equal(d.reason, 'the chat is with a person');
  assert.equal(describeRun({ status: 'CANCELLED', trace: [{ detail: 'Not run: contact opted out' }] }).reason, 'contact opted out');
  assert.equal(describeRun({ status: 'CANCELLED', error: 'Workflow deactivated' }).label, 'Cancelled');
  assert.equal(describeRun({ status: 'FAILED', error: 'boom' }).reason, 'boom');
});
