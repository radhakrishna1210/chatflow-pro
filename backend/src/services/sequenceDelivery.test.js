import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Sequence delivery (WF-EV-1, WF-EV-2, WF-EV-9). Real sequence engine, real
// sequenceSender and real outbound.deliverAutomatedReply; Meta, billing,
// Instagram and the template send are stubbed.
//
//  - A MESSAGE step after a wait longer than 24h cannot be delivered (free-form
//    text, window closed). That used to fail the whole enrollment; now the
//    step is recorded, the cadence moves on and the workspace is told.
//  - A TEMPLATE step reaches the contact whatever the window, with its
//    parameters filled from the contact.
//  - No credit pauses the enrollment and retries; it no longer fails it.
//  - An Instagram contact's thread is never given a WhatsApp number, and an
//    Instagram-only contact is refused at enrolment.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';

const metaSends = [];
mock.module('../lib/meta.js', {
  namedExports: {
    sendTextMessage: async (pnid, token, to, body) => { metaSends.push({ to, body }); return { messages: [{ id: `wamid.${metaSends.length}` }] }; },
    sendButtonMessage: async () => ({ messages: [{ id: 'x' }] }),
    sendListMessage: async () => ({ messages: [{ id: 'x' }] }),
    INTERACTIVE_LIMITS: { buttonCount: 3, rowCount: 10 },
  },
});
let creditOk = true;
mock.module('./subscription.service.js', {
  namedExports: {
    consumeMessageCredit: async () => (creditOk ? { ok: true, source: 'QUOTA' } : { ok: false, code: 'QUOTA_AND_WALLET_EXHAUSTED' }),
    releaseMessageCredit: async () => ({ released: true }),
  },
});
const igSends = [];
mock.module('./instagram.service.js', {
  namedExports: { deliverInstagramReply: async (a) => { igSends.push(a); return { ok: true, message: { id: 'ig' } }; } },
});
const templateSends = [];
let templateError = null;
mock.module('./conversations.service.js', {
  namedExports: {
    sendTemplateMessage: async (workspaceId, conversationId, userId, opts) => {
      if (templateError) throw templateError;
      templateSends.push({ workspaceId, conversationId, userId, ...opts });
      return { id: 'msg_t', metaMessageId: 'wamid.t' };
    },
  },
});
const alerts = [];
mock.module('./sequenceAlerts.service.js', {
  namedExports: { notifySequenceProblem: async (enrollment, kind, detail) => { alerts.push({ sequenceId: enrollment.sequenceId, kind, detail }); return true; } },
});

const { prisma } = await import('../lib/prisma.js');
const { encrypt } = await import('../lib/encryption.js');
const { advanceEnrollment, validateSteps, NO_CREDIT_RETRY_MS, NO_CREDIT_GIVE_UP_MS } = await import('./sequenceEngine.service.js');
const { sendSequenceMessage } = await import('./sequenceSender.js');
const { enrollContacts, assertTemplateSteps } = await import('./sequences.service.js');

const H = 3_600_000;
const WS = 'ws_seq';
let state;
const wa = { id: 'wa_1', workspaceId: WS, status: 'ACTIVE', metaPhoneNumberId: 'pn_1', encryptedAccessToken: encrypt('tok'), phoneNumber: '+911111111111' };

const waContact = { id: 'ct_1', name: 'Asha', phoneNumber: '+919800000000', optedOut: false, email: null, tags: [], customFields: { city: 'Pune' } };
const waConv = { id: 'conv_1', waNumberId: 'wa_1', channel: 'WHATSAPP' };

const twoDayFollowUp = [{ kind: 'MESSAGE', body: 'Hi!' }, { kind: 'WAIT', minutes: 2880 }, { kind: 'MESSAGE', body: 'Following up after 2 days' }];

function setup({ enrolledAgoH = 48, lastInboundAgoH, exitOnReply = false, contact = waContact, conversations = [{ ...waConv }], steps = twoDayFollowUp, cursor = 2 }) {
  const now = Date.now();
  state = {
    enrollment: {
      id: 'en_1', workspaceId: WS, sequenceId: 'seq_1', contactId: contact.id, leadId: null,
      status: 'WAITING', cursor, nextRunAt: new Date(now - 1000), enrolledAt: new Date(now - enrolledAgoH * H), lastError: null,
      steps, sequence: { status: 'PUBLISHED', respectBusinessHours: false },
    },
    lastInboundAt: lastInboundAgoH == null ? null : new Date(now - lastInboundAgoH * H),
    exitOnReply, contact, conversations, stepRuns: [], convUpdates: [], convCreates: [],
  };
  metaSends.length = 0; igSends.length = 0; templateSends.length = 0; alerts.length = 0;
  creditOk = true; templateError = null;
}

const claimMatches = (where) => {
  const e = state.enrollment;
  if (where.cursor !== undefined && where.cursor !== e.cursor) return false;
  if (where.status?.in && !where.status.in.includes(e.status)) return false;
  return true;
};
prisma.sequenceEnrollment.findUnique = async () => structuredClone(state.enrollment);
prisma.sequenceEnrollment.updateMany = async ({ where, data }) => {
  if (!claimMatches(where)) return { count: 0 };
  Object.assign(state.enrollment, data);
  return { count: 1 };
};
prisma.sequenceEnrollment.update = async ({ data }) => Object.assign(state.enrollment, data);
prisma.sequenceStepRun.create = async ({ data }) => { state.stepRuns.push({ ...data, ranAt: state.ranAt ?? new Date() }); return data; };
prisma.sequenceStepRun.findFirst = async ({ where }) => state.stepRuns
  .filter((r) => r.stepIndex === where.stepIndex && r.outcome === where.outcome)
  .sort((a, b) => a.ranAt - b.ranAt)[0] ?? null;
prisma.sequence.findFirst = async () => ({ status: 'PUBLISHED', exitOnReply: state.exitOnReply });
prisma.contact.findFirst = async ({ where }) => (where.optedOut === true ? null : state.contact);
prisma.contact.findUnique = async () => state.contact;
prisma.optOut.findUnique = async () => null;
// The exit-on-reply check: any inbound after enrolment.
prisma.message.findFirst = async ({ where }) => (state.lastInboundAt && state.lastInboundAt > where.sentAt.gt ? { id: 'in_1' } : null);
prisma.message.create = async ({ data }) => ({ id: 'out_1', ...data });
prisma.conversation.findFirst = async ({ where }) => {
  const found = state.conversations.find((c) => !where.channel || c.channel === where.channel);
  return found ? { ...found } : null;
};
prisma.conversation.findUnique = async ({ where, select }) => {
  const c = state.conversations.find((x) => x.id === where.id);
  return select?.channel ? { channel: c?.channel } : { lastInboundAt: state.lastInboundAt };
};
prisma.conversation.update = async ({ where, data }) => {
  state.convUpdates.push({ id: where.id, data });
  const c = state.conversations.find((x) => x.id === where.id);
  Object.assign(c, data);
  return c;
};
prisma.conversation.create = async ({ data }) => {
  const c = { id: `conv_new_${state.convCreates.length + 1}`, ...data };
  state.convCreates.push(data);
  state.conversations.push(c);
  return { id: c.id, waNumberId: c.waNumberId };
};
prisma.waNumber.findUnique = async () => wa;
prisma.waNumber.findFirst = async () => ({ id: wa.id });
prisma.workspace.findUnique = async () => ({ businessHours: null });

const run = (opts) => advanceEnrollment('en_1', { send: sendSequenceMessage, ...opts });
const lastRun = () => state.stepRuns.at(-1);

// ─── WINDOW_CLOSED: the step fails, the cadence goes on ────────────────────

test('A: a MESSAGE after a 2-day wait (window closed) fails the step, not the enrollment', async () => {
  setup({ lastInboundAgoH: 49 });
  const r = await run();
  assert.equal(r.status, 'COMPLETED', 'the last step was skipped and the cadence finished');
  assert.notEqual(state.enrollment.status, 'FAILED');
  assert.equal(metaSends.length, 0, 'nothing sent outside the window');
  assert.equal(lastRun().outcome, 'FAILED');
  assert.equal(lastRun().kind, 'MESSAGE');
  assert.match(lastRun().detail, /WINDOW_CLOSED/);
  assert.match(lastRun().detail, /template/);
  assert.deepEqual(alerts.map((a) => a.kind), ['window'], 'the workspace is told');
});

test('A2: after a skipped MESSAGE the next step still runs', async () => {
  setup({
    lastInboundAgoH: 49,
    steps: [{ kind: 'WAIT', minutes: 2880 }, { kind: 'MESSAGE', body: 'Nudge' }, { kind: 'TASK', title: 'Call them' }],
    cursor: 1,
  });
  prisma.task.create = async ({ data }) => { state.task = data; return data; };
  const first = await run();
  assert.equal(first.status, 'ACTIVE');
  assert.equal(state.enrollment.cursor, 2);
  const second = await run();
  assert.equal(second.status, 'COMPLETED');
  assert.equal(state.task?.title, 'Call them');
});

test('A3: a MESSAGE to a contact who never wrote in on WhatsApp skips the step with a template hint', async () => {
  setup({ lastInboundAgoH: null, conversations: [], steps: [{ kind: 'MESSAGE', body: 'Hello' }], cursor: 0 });
  const r = await run();
  assert.equal(r.status, 'COMPLETED');
  assert.match(lastRun().detail, /never messaged this workspace on WhatsApp.*template/);
  assert.equal(state.convCreates.length, 0, 'no conversation is opened for free-form text');
});

test('B: exit-on-reply (the default) still ends the cadence on the reply', async () => {
  setup({ lastInboundAgoH: 1, exitOnReply: true });
  const r = await run();
  assert.equal(r.status, 'EXITED');
  assert.equal(r.exitReason, 'Contact replied');
  assert.equal(metaSends.length, 0);
});

test('C (control): inside 24h of the last inbound, a MESSAGE sends, with {{name}} filled in', async () => {
  setup({ enrolledAgoH: 0.5, lastInboundAgoH: 1, exitOnReply: true, steps: [{ kind: 'MESSAGE', body: 'Hi {{name}} from {{custom.city}}' }], cursor: 0 });
  const r = await run();
  assert.equal(r.status, 'COMPLETED');
  assert.deepEqual(metaSends, [{ to: '+919800000000', body: 'Hi Asha from Pune' }]);
  assert.equal(lastRun().outcome, 'SENT');
});

// ─── TEMPLATE steps ────────────────────────────────────────────────────────

test('T1: a TEMPLATE after a 2-day wait is sent, with parameters rendered from the contact', async () => {
  setup({
    lastInboundAgoH: 49,
    steps: [{ kind: 'WAIT', minutes: 2880 }, { kind: 'TEMPLATE', templateId: 'tpl_1', templateName: 'follow_up', params: ['{{name}}', 'order {{custom.city}}', 'fixed'] }],
    cursor: 1,
  });
  const r = await run();
  assert.equal(r.status, 'COMPLETED');
  assert.equal(templateSends.length, 1);
  assert.deepEqual(templateSends[0], {
    workspaceId: WS, conversationId: 'conv_1', userId: null, templateId: 'tpl_1', variables: ['Asha', 'order Pune', 'fixed'], contactId: 'ct_1',
  });
  assert.equal(lastRun().outcome, 'SENT');
  assert.match(lastRun().detail, /follow_up.*wamid\.t/);
});

test('T2: a TEMPLATE to a contact who never wrote in opens a WhatsApp conversation for it', async () => {
  setup({ lastInboundAgoH: null, conversations: [], steps: [{ kind: 'TEMPLATE', templateId: 'tpl_1', params: [] }], cursor: 0 });
  const r = await run();
  assert.equal(r.status, 'COMPLETED');
  assert.deepEqual(state.convCreates, [{ workspaceId: WS, contactId: 'ct_1', waNumberId: 'wa_1', channel: 'WHATSAPP', status: 'OPEN' }]);
  assert.equal(templateSends[0].conversationId, 'conv_new_1');
});

test('T3: a template the workspace can no longer send fails the enrollment and alerts', async () => {
  setup({ lastInboundAgoH: null, steps: [{ kind: 'TEMPLATE', templateId: 'tpl_x', params: [] }], cursor: 0 });
  templateError = Object.assign(new Error('"promo" is rejected and cannot be sent.'), { status: 422, code: 'TEMPLATE_NOT_SENDABLE' });
  const r = await run();
  assert.equal(r.status, 'FAILED');
  assert.deepEqual(alerts.map((a) => a.kind), ['failed']);
});

// ─── NO_CREDIT: pause and retry ────────────────────────────────────────────

test('N1: no message credit pauses the enrollment on the same step and retries later', async () => {
  setup({ enrolledAgoH: 0.5, lastInboundAgoH: 1, steps: [{ kind: 'MESSAGE', body: 'Hi' }, { kind: 'EXIT', reason: 'done' }], cursor: 0 });
  creditOk = false;
  const now = new Date();
  const r = await run({ now });
  assert.equal(r.status, 'WAITING');
  assert.equal(r.paused, 'NO_CREDIT');
  assert.equal(state.enrollment.status, 'WAITING');
  assert.equal(state.enrollment.cursor, 0, 'the step is retried, not skipped');
  assert.equal(state.enrollment.nextRunAt.getTime(), now.getTime() + NO_CREDIT_RETRY_MS);
  assert.match(state.enrollment.lastError, /Paused for credit/);
  assert.equal(lastRun().outcome, 'DEFERRED');
  assert.deepEqual(alerts.map((a) => a.kind), ['no_credit']);

  // A retry that is still refused adds no second history entry.
  const later = new Date(now.getTime() + NO_CREDIT_RETRY_MS);
  await run({ now: later });
  assert.equal(state.stepRuns.filter((s) => s.outcome === 'DEFERRED').length, 1);

  // After a top-up the step goes out and the pause reason clears.
  creditOk = true;
  const r3 = await run({ now: new Date(later.getTime() + NO_CREDIT_RETRY_MS) });
  assert.equal(r3.status, 'ACTIVE');
  assert.equal(metaSends.length, 1);
  assert.equal(state.enrollment.lastError, null);
  assert.equal(state.enrollment.cursor, 1);
});

test('N2: a template refused for credit (403 from sendTemplateMessage) pauses too', async () => {
  setup({ lastInboundAgoH: null, steps: [{ kind: 'TEMPLATE', templateId: 'tpl_1', params: [] }], cursor: 0 });
  templateError = Object.assign(new Error('Message quota and wallet balance exhausted — recharge your wallet or upgrade your plan'), { status: 403 });
  const r = await run();
  assert.equal(r.status, 'WAITING');
  assert.equal(r.paused, 'NO_CREDIT');
});

test('N3: after a week without credit the enrollment fails, and says why', async () => {
  setup({ enrolledAgoH: 0.5, lastInboundAgoH: 1, steps: [{ kind: 'MESSAGE', body: 'Hi' }], cursor: 0 });
  creditOk = false;
  const start = new Date();
  state.ranAt = start;
  await run({ now: start });
  state.ranAt = undefined;
  state.lastInboundAt = new Date(); // keep the window open
  state.enrollment.enrolledAt = new Date(Date.now() + 10 * 24 * H); // no "reply after enrolment"
  const r = await run({ now: new Date(start.getTime() + NO_CREDIT_GIVE_UP_MS) });
  assert.equal(r.status, 'FAILED');
  assert.match(state.enrollment.lastError, /No message credit for 7 days/);
});

// ─── OPTED_OUT: exit, not fail ─────────────────────────────────────────────

test('O1: a recipient on the opt-out list at send time exits the enrollment rather than failing it', async () => {
  setup({ lastInboundAgoH: null, steps: [{ kind: 'TEMPLATE', templateId: 'tpl_1', params: [] }], cursor: 0 });
  templateError = Object.assign(new Error('Recipient opted out'), { status: 403, code: 'RECIPIENT_OPTED_OUT' });
  const r = await run();
  assert.equal(r.status, 'EXITED');
  assert.equal(r.exitReason, 'Contact opted out');
});

// ─── Instagram contacts ────────────────────────────────────────────────────

test('D: an Instagram contact enrolled before the check exits; its IG thread is untouched', async () => {
  const igContact = { id: 'ct_ig', name: 'IG', phoneNumber: 'ig:bcdefgh', optedOut: false };
  setup({ enrolledAgoH: 0.5, lastInboundAgoH: 1, contact: igContact, conversations: [{ id: 'conv_ig', waNumberId: null, channel: 'INSTAGRAM' }] });
  const r = await run();
  assert.equal(r.status, 'EXITED');
  assert.match(r.exitReason, /Instagram-only/);
  assert.deepEqual(state.convUpdates, [], 'no WhatsApp number written onto the Instagram conversation');
  assert.equal(metaSends.length, 0);
  assert.equal(igSends.length, 0);
});

test('D2: a contact with both threads is messaged on its WhatsApp one; the IG thread keeps no number', async () => {
  setup({
    enrolledAgoH: 0.5, lastInboundAgoH: 1, steps: [{ kind: 'MESSAGE', body: 'Hi' }], cursor: 0,
    // The Instagram thread is the most recent one.
    conversations: [{ id: 'conv_ig', waNumberId: null, channel: 'INSTAGRAM' }, { id: 'conv_wa', waNumberId: null, channel: 'WHATSAPP' }],
  });
  await run();
  assert.deepEqual(state.convUpdates.filter((u) => 'waNumberId' in u.data), [{ id: 'conv_wa', data: { waNumberId: 'wa_1' } }]);
  assert.equal(state.conversations[0].waNumberId, null);
  assert.equal(metaSends.length, 1);
});

test('D3: enrolling an Instagram-only contact is refused with a reason', async () => {
  prisma.sequence.findFirst = async () => ({ id: 'seq_1', status: 'PUBLISHED', steps: [{ kind: 'MESSAGE', body: 'x' }] });
  prisma.contact.findMany = async ({ where }) => (where.optedOut ? [] : [
    { id: 'ct_ig', name: 'IG person', optedOut: false, phoneNumber: 'ig:bcdefgh' },
    { id: 'ct_wa', name: 'WA person', optedOut: false, phoneNumber: '+919800000000' },
  ]);
  prisma.sequenceEnrollment.findMany = async () => [];
  prisma.optOut.findMany = async () => [];
  let created;
  prisma.sequenceEnrollment.createManyAndReturn = async ({ data }) => { created = data; return data.map((d, i) => ({ id: `en_${i}`, contactId: d.contactId })); };
  try {
    const out = await enrollContacts(WS, 'seq_1', { contactIds: ['ct_ig', 'ct_wa'] });
    assert.equal(out.enrolled, 1, JSON.stringify(out));
    assert.deepEqual(created.map((c) => c.contactId), ['ct_wa']);
    assert.deepEqual(out.skipped, [{ contactId: 'ct_ig', name: 'IG person', reason: 'Instagram-only contact — sequences send on WhatsApp' }]);
  } finally {
    prisma.sequence.findFirst = async () => ({ status: 'PUBLISHED', exitOnReply: state.exitOnReply });
  }
});

// ─── Validation ────────────────────────────────────────────────────────────

test('V1: a TEMPLATE step is validated and normalised', () => {
  assert.deepEqual(
    validateSteps([{ kind: 'send_template', templateId: ' tpl_1 ', templateName: 'promo', params: ['{{name}}', 5] }]),
    [{ kind: 'TEMPLATE', templateId: 'tpl_1', templateName: 'promo', params: ['{{name}}', '5'] }],
  );
  assert.deepEqual(validateSteps([{ kind: 'TEMPLATE', templateId: 't' }]), [{ kind: 'TEMPLATE', templateId: 't', params: [] }]);
  assert.throws(() => validateSteps([{ kind: 'TEMPLATE' }]), (e) => e.status === 400 && /Step 1: a template step needs a template/.test(e.message));
  assert.throws(() => validateSteps([{ kind: 'TEMPLATE', templateId: 't', params: 'x' }]), (e) => e.status === 400);
  assert.throws(() => validateSteps([{ kind: 'TEMPLATE', templateId: 't', params: Array(21).fill('a') }]), (e) => e.status === 400);
});

test('V2: template steps must name a template of this workspace, approved to publish', async () => {
  prisma.template.findMany = async ({ where }) => [
    { id: 'tpl_ok', name: 'ok', status: 'APPROVED' },
    { id: 'tpl_pending', name: 'pending_one', status: 'PENDING' },
  ].filter((t) => where.id.in.includes(t.id));
  const steps = validateSteps([{ kind: 'WAIT', minutes: 60 }, { kind: 'TEMPLATE', templateId: 'tpl_pending' }, { kind: 'TEMPLATE', templateId: 'tpl_ok' }]);

  // A draft may hold a template still in review; the name is filled in.
  const saved = await assertTemplateSteps(WS, steps);
  assert.equal(saved[1].templateName, 'pending_one');
  await assert.rejects(
    () => assertTemplateSteps(WS, steps, { requireApproved: true }),
    (e) => e.status === 400 && /Step 2: "pending_one" is pending/.test(e.message),
  );
  await assert.rejects(
    () => assertTemplateSteps(WS, validateSteps([{ kind: 'TEMPLATE', templateId: 'gone' }])),
    (e) => e.status === 400 && /Step 1: the template no longer exists/.test(e.message),
  );
});

test('V3: the request validator accepts a TEMPLATE step and refuses one without a template', async () => {
  const { sequenceSchemas } = await import('../validators/index.js');
  const ok = sequenceSchemas.create.safeParse({ name: 'S', steps: [{ kind: 'TEMPLATE', templateId: 'tpl_1', params: ['{{name}}'] }] });
  assert.equal(ok.success, true);
  assert.deepEqual(ok.data.steps[0], { kind: 'TEMPLATE', templateId: 'tpl_1', params: ['{{name}}'] });
  assert.equal(sequenceSchemas.create.safeParse({ name: 'S', steps: [{ kind: 'TEMPLATE' }] }).success, false);
});
