import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blankStep, stepWarnings, templateParamCount, describeStep, formatMinutes, DEFAULT_WAIT_MINUTES,
} from './sequenceSteps.js';

// The sequence builder's delivery warnings (WF-EV-1): a free-form MESSAGE
// step after a day of waiting, or to contacts who have never chatted, cannot
// be delivered on WhatsApp; a TEMPLATE step can.

const msg = (body = 'Hi') => ({ kind: 'MESSAGE', body });
const wait = (minutes) => ({ kind: 'WAIT', minutes });
const tpl = (templateId = 't1') => ({ kind: 'TEMPLATE', templateId, params: [] });

test('a new wait defaults to 23 hours, not the 24 that falls just outside the window', () => {
  assert.equal(blankStep('WAIT').minutes, DEFAULT_WAIT_MINUTES);
  assert.equal(DEFAULT_WAIT_MINUTES, 23 * 60);
  assert.deepEqual(blankStep('TEMPLATE'), { kind: 'TEMPLATE', templateId: '', params: [] });
});

test('a MESSAGE after a cumulative wait of 23h or more is flagged, pointing at a template', () => {
  const warnings = stepWarnings([tpl(), wait(12 * 60), wait(11 * 60), msg()]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].index, 3);
  assert.match(warnings[0].message, /23 hours after enrolment.*Send template/);
  assert.match(stepWarnings([tpl(), wait(2880), msg()])[0].message, /2 days/);
});

test('a MESSAGE inside the window, after a template, is fine', () => {
  assert.deepEqual(stepWarnings([tpl(), wait(60), msg()]), []);
});

test('a MESSAGE as the first send warns that never-chatted contacts will be skipped', () => {
  const [w] = stepWarnings([msg(), wait(60), msg()]);
  assert.equal(w.index, 0);
  assert.match(w.message, /never chatted/);
  assert.equal(stepWarnings([msg(), wait(60), msg()]).length, 1, 'only the first send carries it');
});

test('template steps: missing, deleted and unapproved templates are called out', () => {
  const templates = [{ id: 't1', name: 'welcome', status: 'APPROVED' }, { id: 't2', name: 'promo', status: 'PENDING' }];
  assert.equal(stepWarnings([tpl('')])[0].level, 'error');
  assert.deepEqual(stepWarnings([tpl('t1')], { templates }), []);
  assert.match(stepWarnings([tpl('t2')], { templates })[0].message, /"promo" is pending/);
  assert.match(stepWarnings([tpl('gone')], { templates })[0].message, /no longer exists/);
  // Without the template list nothing is claimed about it.
  assert.deepEqual(stepWarnings([tpl('t2')]), []);
});

test('the parameter count is the highest {{n}} across components', () => {
  assert.equal(templateParamCount({ components: [{ type: 'HEADER', text: 'Hi {{1}}' }, { type: 'BODY', text: 'Order {{2}} ships {{3}}' }] }), 3);
  assert.equal(templateParamCount({ components: [{ type: 'BODY', text: 'No params' }] }), 0);
  assert.equal(templateParamCount(null), 0);
});

test('step descriptions', () => {
  assert.equal(describeStep({ kind: 'TEMPLATE', templateId: 't', templateName: 'welcome' }), 'Template "welcome"');
  assert.equal(formatMinutes(1380), '23 hours');
  assert.equal(formatMinutes(2880), '2 days');
  assert.equal(formatMinutes(90), '90 minutes');
});
