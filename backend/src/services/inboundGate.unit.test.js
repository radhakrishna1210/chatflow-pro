import test from 'node:test';
import assert from 'node:assert/strict';

// Pure pieces of the inbound gate (WF-IN-*): control words, opt-out/opt-in
// keywords, what counts as customer text, escalation rules and the handoff
// clock. The pipeline around them is exercised in inboundGate.test.js.
process.env.DATABASE_URL ??= 'postgresql://offline:offline@127.0.0.1:1/offline';

const { detectControlCommand, interruptsFlow } = await import('./conversationControl.service.js');
const { matchOptOutKeyword, matchOptInKeyword, isFlowControlKeyword } = await import('./optout.service.js');
const { parseInboundMessage, carriesCustomerText, inboundEvent, isButtonReply } = await import('./inboundMessage.js');
const { escalationMatch, escalationRulesApply } = await import('./intentRouting.service.js');
const { handoffState, handoffTtlMs, describeHandoffReason } = await import('./automationPause.service.js');
const { normaliseEscalationRules } = await import('./aiAgent.service.js');

// ── WF-IN-5: ordinary answers are not control words (port of the audit repro)

const answers = [
  ['None', 'Any allergies? → "None"'],
  ['Gone', 'Is the issue still there? → "Gone"'],
  ['Dona', 'What is your name? → "Dona"'],
  ['Complete', 'Order status you see? → "Complete"'],
  ['Agent', 'button option "Agent"'],
];
for (const [reply, why] of answers) {
  test(`an answer "${reply}" to a waiting workflow is not a control word (${why})`, () => {
    assert.equal(detectControlCommand(reply, { awaitingReply: true }), null);
  });
}

test('no typo tolerance anywhere: "None", "Gone", "Dona", "operate", "cancle" are not commands', () => {
  for (const word of ['None', 'Gone', 'Dona', 'operate', 'cancle', 'agnet', 'humen']) {
    assert.equal(detectControlCommand(word), null, word);
  }
});

test('an offered option is an answer whatever it says', () => {
  assert.equal(detectControlCommand('Cancel order', { awaitingReply: true, options: ['Track order', 'Cancel order'] }), null);
  assert.equal(detectControlCommand('Agent', { options: ['Sales', 'Agent'] }), null);
  assert.equal(detectControlCommand('talk to a human', { awaitingReply: true, options: ['Talk to a human'] }), null);
});

test('while a run waits, only explicit multi-word phrases count', () => {
  assert.deepEqual(detectControlCommand('stop this', { awaitingReply: true }), { command: 'cancel', matched: 'stop this', explicit: true });
  assert.equal(detectControlCommand('cancel this please', { awaitingReply: true }).command, 'cancel');
  assert.equal(detectControlCommand('I want to talk to a human', { awaitingReply: true }).command, 'human');
  assert.equal(detectControlCommand('start over', { awaitingReply: true }).command, 'restart');
  for (const word of ['cancel', 'done', 'bye', 'agent', 'human', 'help', 'restart']) {
    assert.equal(detectControlCommand(word, { awaitingReply: true }), null, word);
  }
});

test('outside a waiting run, exact single words are contextual (not explicit) commands', () => {
  assert.deepEqual(detectControlCommand('agent'), { command: 'human', matched: 'agent', explicit: false });
  assert.deepEqual(detectControlCommand('please cancel'), { command: 'cancel', matched: 'cancel', explicit: false });
  assert.equal(detectControlCommand('customer care').explicit, false);
  assert.equal(detectControlCommand('speak to agent').explicit, true);
  assert.equal(detectControlCommand('I want to cancel my order today'), null, 'prose is not a command');
  assert.ok(interruptsFlow('cancel') && interruptsFlow('human') && !interruptsFlow('help'));
});

// ── WF-IN-6: opt-out narrowed; START opts in ────────────────────────────────

test('only STOP / UNSUBSCRIBE (and explicit variants) as the whole message opt out', () => {
  for (const yes of ['STOP', ' stop ', 'Stop.', 'STOP!', 'unsubscribe', 'Stop all', 'please stop']) {
    assert.ok(matchOptOutKeyword(yes), yes);
  }
  for (const no of ['end', 'quit', 'cancel', 'remove', 'no thanks', 'No Thanks', "don't stop", 'stop by tomorrow', 'agent']) {
    assert.equal(matchOptOutKeyword(no), null, no);
  }
  assert.equal(isFlowControlKeyword('cancel'), false);
});

test('START / SUBSCRIBE as the whole message opt back in', () => {
  assert.equal(matchOptInKeyword('START'), 'start');
  assert.equal(matchOptInKeyword('Subscribe!'), 'subscribe');
  assert.equal(matchOptInKeyword('start my order'), null);
});

// ── WF-IN-8: captions are customer text; placeholders are not ──────────────

test('a caption on a photo, video or document is customer text and keeps the media type', () => {
  const parsed = parseInboundMessage({ type: 'image', image: { id: 'm1', caption: '  ORDER 123  ' } });
  assert.equal(parsed.body, 'ORDER 123');
  assert.equal(carriesCustomerText(parsed), true);
  assert.equal(inboundEvent(parsed), 'message');
  for (const [type, node] of [['video', { id: 'v', caption: 'look' }], ['document', { id: 'd', caption: 'invoice', filename: 'a.pdf' }]]) {
    assert.equal(carriesCustomerText(parseInboundMessage({ type, [type]: node })), true, type);
  }
});

test('placeholders ("[photo]", "[location]", "[unsupported message: order]") are never customer text', () => {
  const cases = [
    { type: 'image', image: { id: 'm1' } },
    { type: 'location', location: { latitude: 1, longitude: 2 } },
    { type: 'order', order: {} },
    { type: 'contacts', contacts: [{ name: { formatted_name: 'Ravi' } }] },
    { type: 'sticker', sticker: { id: 's' } },
  ];
  for (const msg of cases) {
    const parsed = parseInboundMessage(msg);
    assert.equal(carriesCustomerText(parsed), false, msg.type);
    assert.equal(inboundEvent(parsed), 'media', msg.type);
  }
});

test('a tap on one of our buttons is a button reply', () => {
  assert.equal(isButtonReply(parseInboundMessage({ type: 'interactive', interactive: { button_reply: { id: 'x', title: 'No thanks' } } })), true);
  assert.equal(isButtonReply(parseInboundMessage({ type: 'button', button: { text: 'Stop promotions', payload: 'p' } })), true);
  assert.equal(isButtonReply(parseInboundMessage({ type: 'text', text: { body: 'stop' } })), false);
});

// ── WF-IN-3: escalation rules ───────────────────────────────────────────────

test('escalation rules apply only while the AI agent is deployed, and name the rule', () => {
  assert.equal(escalationRulesApply({ aiAgentEnabled: false, escalationRules: { refund: true } }), false);
  assert.equal(escalationRulesApply({ aiAgentEnabled: true }), true);
  assert.deepEqual(escalationMatch('I want a refund', { refund: true }), {
    rule: 'refund', reason: 'The customer raised a refund or complaint', reasonCode: 'escalation_rule:refund',
  });
  assert.equal(escalationMatch('I want a refund', { refund: false }), null);
});

test('the AI Agent screen\'s defaults are only defaults (normaliseEscalationRules)', () => {
  assert.deepEqual(normaliseEscalationRules(null), { refund: true, negativeSentiment: true, asksForHuman: true, highIntent: false });
  assert.deepEqual(normaliseEscalationRules({ refund: false, asksForHuman: false, negativeSentiment: false }),
    { refund: false, negativeSentiment: false, asksForHuman: false, highIntent: false });
});

// ── WF-IN-1: the handoff clock ──────────────────────────────────────────────

test('a handoff lapses HANDOFF_TTL_HOURS after the later of the handoff and the last human reply', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  const h = (n) => new Date(now - n * 3_600_000);
  assert.equal(handoffTtlMs({}), 24 * 3_600_000);
  assert.equal(handoffTtlMs({ HANDOFF_TTL_HOURS: '6' }), 6 * 3_600_000);
  assert.equal(handoffTtlMs({ HANDOFF_TTL_HOURS: 'nonsense' }), 24 * 3_600_000);

  assert.equal(handoffState({ humanHandoffAt: h(23) }, { now }).paused, true);
  assert.equal(handoffState({ humanHandoffAt: h(25) }, { now }).paused, false);
  const kept = handoffState({ humanHandoffAt: h(30) }, { now, lastHumanAt: h(2) });
  assert.equal(kept.paused, true);
  assert.equal(kept.reason, 'manual_reply', 'a person replied after the handoff');
});

test('the reason: recorded, or inferred from what the thread shows', () => {
  const at = new Date('2026-10-03T10:00:00Z');
  assert.equal(handoffState({ humanHandoffAt: at, handoffReason: 'escalation_rule:refund' }, { now: at.getTime() }).reason, 'escalation_rule:refund');
  // A person replied at (or after) the handoff: that is why.
  assert.equal(handoffState({ humanHandoffAt: at, handoffReason: 'escalation_rule:refund' }, { now: at.getTime(), lastHumanAt: at }).reason, 'manual_reply');
  // An assignee and no recorded reason: a workflow's agent step.
  assert.equal(handoffState({ humanHandoffAt: at, assignedToUserId: 'u1' }, { now: at.getTime() }).reason, 'workflow_agent_step');
  assert.match(describeHandoffReason('escalation_rule:negativeSentiment'), /negative sentiment/);
  assert.match(describeHandoffReason('intent_rule:Refunds'), /"Refunds"/);
});
