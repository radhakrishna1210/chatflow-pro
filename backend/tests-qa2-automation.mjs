// End-to-end verification for the defects in qa_testing_2.pdf.
//
// Drives the real inbound pipeline (processWebhook) against the real database,
// with Meta's Graph API replaced by an axios adapter that records every send.
// Each block maps to a BUG id from the report.
//
//   node --env-file=.env tests-qa2-automation.mjs   (from backend/)

process.env.PRISMA_PG_ADAPTER = '1';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// No LLM provider during the run. Every model-backed path then takes its
// deterministic fallback, so the suite is fast, free and repeatable — and the
// fallbacks are the behaviour that has to hold when the provider is down.
// The one test that needs a key present flips it back on for that assertion.
//
// Blanked rather than deleted: something in the import chain calls
// dotenv.config(), which re-reads .env and puts a deleted key straight back.
// dotenv leaves a key that is already present alone, even when it is empty.
process.env.GEMINI_API_KEY = '';

import axios from 'axios';

// ── Meta stub ──────────────────────────────────────────────────────────────
// Every outbound WhatsApp send lands here instead of on the network.
const sent = [];
let wamid = 0;
axios.defaults.adapter = async (config) => {
  let payload = {};
  try { payload = typeof config.data === 'string' ? JSON.parse(config.data) : (config.data || {}); } catch { /* non-JSON */ }
  const text = payload?.text?.body
    ?? payload?.interactive?.body?.text
    ?? '';
  sent.push({ to: payload.to, text, type: payload.type, raw: payload });
  return {
    data: { messages: [{ id: `wamid.TEST${++wamid}` }], contacts: [{ wa_id: payload.to }] },
    status: 200, statusText: 'OK', headers: {}, config,
  };
};

const { prisma } = await import('./src/lib/prisma.js');
const { encrypt } = await import('./src/lib/encryption.js');
const { processWebhook } = await import('./src/services/webhook.service.js');
const automation = await import('./src/services/automation.service.js');
const segments = await import('./src/services/segments.service.js');
const workflows = await import('./src/services/workflow.service.js');
const forms = await import('./src/services/whatsappForms.service.js');
const instagram = await import('./src/services/instagram.service.js');
const voice = await import('./src/services/voice.service.js');
const aiAgent = await import('./src/services/aiAgent.service.js');
const intents = await import('./src/services/intent.service.js');
const voiceCtrl = await import('./src/controllers/voice.controller.js');
const { env } = await import('./src/config/env.js');
const { encrypt: enc } = await import('./src/lib/encryption.js');

let pass = 0, fail = 0;
const failures = [];
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; failures.push(name); console.log(`  ✘ ${name}${extra ? ` — ${extra}` : ''}`); }
};
const section = (title) => console.log(`\n■ ${title}`);

// ── Fixture ────────────────────────────────────────────────────────────────
const STAMP = Date.now();
const CUSTOMER = `9199${String(STAMP).slice(-8)}`;
const PN_ID = `PN_QA2_${STAMP}`;

const workspace = await prisma.workspace.create({
  data: {
    name: `QA2 ${STAMP}`,
    autoWelcomeEnabled: false,
    autoOooEnabled: false,
    autoDelayedEnabled: false,
    welcomeMessage: 'Welcome to QA2 Traders!',
    oooMessage: 'We are closed right now.',
  },
});
const waNumber = await prisma.waNumber.create({
  data: {
    workspaceId: workspace.id,
    phoneNumber: '+15550002222',
    metaPhoneNumberId: PN_ID,
    wabaId: `WABA_QA2_${STAMP}`,
    encryptedAccessToken: encrypt('fake-token'),
    displayName: 'QA2 Number',
  },
});

// A webhook delivery carrying one customer text message.
let msgSeq = 0;
const inbound = (text) => ({
  entry: [{
    id: 'ENTRY',
    changes: [{
      field: 'messages',
      value: {
        metadata: { phone_number_id: PN_ID },
        contacts: [{ profile: { name: 'QA Tester' }, wa_id: CUSTOMER }],
        messages: [{
          from: CUSTOMER,
          id: `wamid.IN_${STAMP}_${++msgSeq}`,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: 'text',
          text: { body: text },
        }],
      },
    }],
  }],
});

// Sends a message and returns the replies it produced.
async function say(text) {
  sent.length = 0;
  await processWebhook(inbound(text));
  return sent.map((s) => s.text);
}

// Clears the two pieces of state that silence a conversation, so one section's
// opt-out or handoff cannot cascade into the next.
async function resetContact() {
  await prisma.optOut.deleteMany({ where: { workspaceId: workspace.id } });
  const c = await conv();
  if (c?.humanHandoffAt) await prisma.conversation.update({ where: { id: c.id }, data: { humanHandoffAt: null } });
}

const replied = (replies, fragment) =>
  replies.some((r) => String(r).toLowerCase().includes(String(fragment).toLowerCase()));

let exitCode = 0;
try {
  // ── BUG-06: Smart Lists contact creation ─────────────────────────────────
  section('BUG-06 · Smart Lists — add customer');
  {
    const segment = await segments.createSegment(workspace.id, { name: 'Test Customers', desc: 'Test segment' });

    // The exact payload the UI sends now.
    const added = await segments.addContactToSegment(workspace.id, segment.id, {
      name: 'Test User', phoneNumber: '9689607480',
    });
    const created = await prisma.contact.findUnique({ where: { id: added.contactId } });
    check('adds a contact with phoneNumber', created?.phoneNumber === '9689607480', JSON.stringify(created?.phoneNumber));

    // The legacy payload the old UI sent — this is what produced the Prisma error.
    const legacy = await segments.addContactToSegment(workspace.id, segment.id, {
      name: 'Legacy User', phone: '+91 96896 07481',
    });
    const legacyContact = await prisma.contact.findUnique({ where: { id: legacy.contactId } });
    check('accepts the legacy `phone` field', legacyContact?.phoneNumber === '+919689607481', JSON.stringify(legacyContact?.phoneNumber));

    // Same number twice must reuse the contact, not fail on the unique index.
    const again = await segments.addContactToSegment(workspace.id, segment.id, {
      name: 'Test User', phoneNumber: '9689607480',
    });
    check('re-adding the same number reuses the contact', again.contactId === added.contactId);

    let rejected = null;
    try { await segments.addContactToSegment(workspace.id, segment.id, { name: 'No Phone' }); }
    catch (err) { rejected = err; }
    check('a missing phone number is a 400, not a Prisma crash',
      rejected?.status === 400 && /phone number is required/i.test(rejected.message),
      rejected ? `${rejected.status}: ${rejected.message}` : 'no error thrown');

    const withContacts = await segments.listSegments(workspace.id);
    const seg = withContacts.find((s) => s.id === segment.id);
    check('the segment reports its contacts', (seg?.contacts?.length ?? seg?._count?.contacts ?? 0) >= 2);
  }

  // ── BUG-01: Working Hours persistence ────────────────────────────────────
  section('BUG-01 · Working Hours survive disable/enable');
  {
    // 1–3. Enable working hours and configure Monday 10:00–17:00.
    await automation.updateBasicAutomations(workspace.id, { businessHoursEnabled: true });
    const days = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day, enabled: day === 1, start: day === 1 ? '10:00' : '09:00', end: day === 1 ? '17:00' : '18:00',
    }));
    await automation.updateBasicAutomations(workspace.id, { businessHours: { tz: 'Asia/Kolkata', days } });

    const saved = await automation.getBasicAutomations(workspace.id);
    const savedMonday = saved.businessHours.days.find((d) => d.day === 1);
    check('Monday saves as 10:00–17:00', savedMonday.start === '10:00' && savedMonday.end === '17:00',
      `${savedMonday.start}-${savedMonday.end}`);
    check('working hours read back as enabled', saved.businessHoursEnabled === true);

    // 4. Turn working hours OFF.
    const off = await automation.updateBasicAutomations(workspace.id, { businessHoursEnabled: false });
    check('switching off reports disabled', off.businessHoursEnabled === false);
    const offMonday = off.businessHours.days.find((d) => d.day === 1);
    check('switching off keeps Monday 10:00–17:00 on disk',
      offMonday.start === '10:00' && offMonday.end === '17:00', `${offMonday.start}-${offMonday.end}`);

    // 5–6. Turn it back ON and re-read Monday. This is the QA scenario.
    const on = await automation.updateBasicAutomations(workspace.id, { businessHoursEnabled: true });
    const onMonday = on.businessHours.days.find((d) => d.day === 1);
    check('re-enabling restores Monday 10:00–17:00 (not the 09:00–18:00 default)',
      onMonday.start === '10:00' && onMonday.end === '17:00' && onMonday.enabled === true,
      `${onMonday.start}-${onMonday.end}`);
    check('re-enabling reports enabled', on.businessHoursEnabled === true);

    const { isWithinBusinessHours } = await import('./src/services/businessHours.service.js');
    check('a disabled schedule is treated as always open',
      isWithinBusinessHours({ ...on.businessHours, enabled: false }) === true);

    // Leave working hours off so later blocks are not answered by the OOO reply.
    await automation.updateBasicAutomations(workspace.id, { businessHoursEnabled: false });
  }

  // ── First contact: greeting ──────────────────────────────────────────────
  section('BUG-03/07 · Greeting and welcome behaviour');
  {
    await automation.updateBasicAutomations(workspace.id, { autoWelcomeEnabled: true });

    const first = await say('Hi');
    check('a first-time "Hi" is answered', first.length > 0, JSON.stringify(first));
    check('the first answer is the workspace welcome', replied(first, 'Welcome to QA2 Traders'), JSON.stringify(first));

    // BUG-07: the welcome must not repeat on every following message.
    const second = await say('Hello');
    check('the welcome is not repeated on the next message',
      !replied(second, 'Welcome to QA2 Traders'), JSON.stringify(second));
    check('but the greeting still gets an answer', second.length > 0, JSON.stringify(second));
    check('a repeat greeting gets a plain greeting', replied(second, 'How can we help'), JSON.stringify(second));

    const hours = await say('Working hours');
    check('"Working hours" is answered', hours.length > 0, JSON.stringify(hours));

    const bye = await say('Bye');
    check('"Bye" gets a goodbye', replied(bye, 'goodbye'), JSON.stringify(bye));

    const thanks = await say('thanks');
    check('"thanks" is acknowledged', replied(thanks, 'welcome'), JSON.stringify(thanks));
  }

  // ── Working hours are quoted back from configuration ──────────────────────
  section('BUG-03 · "Working hours" answers from the saved schedule');
  {
    await automation.updateBasicAutomations(workspace.id, { businessHoursEnabled: true });
    const hours = await say('what are your working hours');
    check('the configured Monday window is quoted back',
      replied(hours, '10:00') && replied(hours, 'Monday'), JSON.stringify(hours));
    await automation.updateBasicAutomations(workspace.id, { businessHoursEnabled: false });
  }

  // ── BUG-02 / BUG-04: the support form ────────────────────────────────────
  section('BUG-02/04 · WhatsApp form — interruption and fuzzy answers');
  {
    const form = await prisma.whatsappForm.create({
      data: {
        workspaceId: workspace.id,
        name: 'Customer Support',
        keyword: 'SUPPORT',
        status: 'Active',
        completionMessage: 'Request successfully logged.',
        schema: [
          { key: 'category', label: 'What do you need help with?', type: 'choice', required: true,
            options: ['Technical problem', 'Order issue', 'Billing'] },
          { key: 'description', label: 'Please describe the issue', type: 'text', required: true },
          { key: 'urgency', label: 'How urgent is it?', type: 'choice', required: true,
            options: ['Urgent', 'Normal', 'Low'] },
          { key: 'phone', label: 'Best number to reach you on', type: 'phone', required: true },
        ],
      },
    });

    // Happy path, with the loose phrasings QA said were rejected.
    check('SUPPORT starts the form', replied(await say('SUPPORT'), 'What do you need help with'));
    check('"Technical issue" is accepted for "Technical problem"',
      replied(await say('Technical issue'), 'describe the issue'));
    check('a free-text description is accepted', replied(await say('Hsm'), 'How urgent is it'));

    const typo = await say('Urrget');
    check('the typo "Urrget" is accepted as Urgent', replied(typo, 'Best number'), JSON.stringify(typo));

    const finish = await say('1234567890');
    check('the form completes', replied(finish, 'Request successfully logged'), JSON.stringify(finish));

    const submission = await prisma.whatsappFormSubmission.findFirst({
      where: { formId: form.id, completed: true }, orderBy: { createdAt: 'desc' },
    });
    check('the submission is stored', !!submission);
    check('"Technical issue" is stored as the configured option',
      submission?.answers?.category === 'Technical problem', JSON.stringify(submission?.answers?.category));
    check('"Urrget" is stored as "Urgent"',
      submission?.answers?.urgency === 'Urgent', JSON.stringify(submission?.answers?.urgency));

    // "very urgent" — QA's other rejected phrasing.
    await say('SUPPORT');
    await say('Order issue');
    await say('parcel never arrived');
    check('"this is very urgent" is accepted', replied(await say('this is very urgent'), 'Best number'));
    await say('1234567890');

    // BUG-02 · cancel mid-form.
    check('SUPPORT restarts the form', replied(await say('SUPPORT'), 'What do you need help with'));
    await say('Order issue');
    const cancelled = await say('cancel');
    check('"cancel" leaves the form', replied(cancelled, 'cancelled'), JSON.stringify(cancelled));
    check('no open submission remains after cancel',
      (await prisma.whatsappFormSubmission.count({ where: { conversationId: (await conv()).id, completed: false } })) === 0);

    // BUG-02 · "bye" mid-form — QA's exact case.
    await say('SUPPORT');
    await say('Technical problem');
    await say('screen is frozen');
    const byeMidForm = await say('bye');
    check('"bye" at the urgency question ends the form instead of re-asking',
      replied(byeMidForm, 'goodbye') && !replied(byeMidForm, 'Urgent, Normal, Low'), JSON.stringify(byeMidForm));

    // BUG-02 · "done" mid-form.
    await say('SUPPORT');
    await say('Billing');
    const doneMidForm = await say('done');
    check('"done" acknowledges and ends the form',
      replied(doneMidForm, 'all done'), JSON.stringify(doneMidForm));

    // BUG-02 · "restart" mid-form.
    await say('SUPPORT');
    await say('Billing');
    const restarted = await say('restart');
    check('"restart" goes back to question one',
      replied(restarted, 'Starting over') && replied(restarted, 'What do you need help with'),
      JSON.stringify(restarted));
    await say('cancel');

    // A real answer that merely contains a control word must still be an answer.
    await say('SUPPORT');
    const notAControl = await say('I want to cancel my order and get a refund');
    check('"I want to cancel my order..." is not read as the cancel command',
      !replied(notAControl, 'cancelled'), JSON.stringify(notAControl));
    await say('cancel');
  }

  // ── BUG-02: interrupting a workflow ──────────────────────────────────────
  section('BUG-02 · Workflow interruption');
  {
    await resetContact();
    const workflow = await prisma.workflow.create({
      data: {
        workspaceId: workspace.id,
        name: 'Promo follow-up',
        isActive: true,
        edges: [],
        nodes: [
          { id: 't', type: 'trigger', subtype: 'keyword', value: 'promo' },
          { id: 'a1', type: 'action', subtype: 'message', value: 'Here is our current promotion!' },
          { id: 'a2', type: 'action', subtype: 'delay', value: '1 hour' },
          { id: 'a3', type: 'action', subtype: 'message', value: 'Still interested in the promo?' },
        ],
      },
    });

    const started = await say('promo');
    check('the workflow replies', replied(started, 'current promotion'), JSON.stringify(started));

    const running = await prisma.workflowRun.count({
      where: { workflowId: workflow.id, status: { in: ['RUNNING', 'WAITING'] } },
    });
    check('the workflow is parked on its delay', running === 1, `runs=${running}`);

    const stop = await say('exit');
    check('"exit" acknowledges the interruption', replied(stop, 'cancelled'), JSON.stringify(stop));
    const stillRunning = await prisma.workflowRun.count({
      where: { workflowId: workflow.id, status: { in: ['RUNNING', 'WAITING'] } },
    });
    check('the parked run is cancelled and will not wake up later',
      stillRunning === 0, `runs=${stillRunning}`);

    // A cancelled run must ignore a delayed resume that fires afterwards.
    const { advanceRun } = await import('./src/services/workflowEngine.service.js');
    const cancelledRun = await prisma.workflowRun.findFirst({
      where: { workflowId: workflow.id }, orderBy: { startedAt: 'desc' },
    });
    sent.length = 0;
    await advanceRun(cancelledRun.id);
    check('a late resume of a cancelled run sends nothing', sent.length === 0, JSON.stringify(sent.map((s) => s.text)));
  }

  // ── BUG-02: asking for a human ───────────────────────────────────────────
  section('BUG-02 · "human" hands the thread over');
  {
    const c = await conv();
    if (c) await prisma.conversation.update({ where: { id: c.id }, data: { humanHandoffAt: null } });

    await say('SUPPORT');
    await say('agent');
    const after = await conv();
    check('asking for an agent mid-form sets the handoff flag', !!after.humanHandoffAt);
    check('the form is closed on handoff',
      (await prisma.whatsappFormSubmission.count({ where: { conversationId: after.id, completed: false } })) === 0);

    const silent = await say('are you there?');
    check('automation stays out once a person has the thread', silent.length === 0, JSON.stringify(silent));
    await prisma.conversation.update({ where: { id: after.id }, data: { humanHandoffAt: null } });
  }

  // ── BUG-03/04: intent matching ───────────────────────────────────────────
  section('BUG-03/04 · Intent matching');
  {
    const { matchIntent } = await import('./src/services/intent.service.js');
    const rules = [
      { isActive: true, name: 'Order Status', phrases: ['where is my order', 'order status', 'tracking'] },
      { isActive: true, name: 'Size Availability', phrases: ['do you have this in size', 'size available', 'in stock'] },
    ];
    const at = (m) => matchIntent(m, rules);

    check('"where is my order" matches Order Status', at('where is my order')?.rule.name === 'Order Status');
    check('the typo "order stauts" still matches Order Status',
      at('order stauts')?.rule.name === 'Order Status' && at('order stauts').confidence >= 0.6,
      JSON.stringify(at('order stauts')?.confidence));
    check('the typo "trackign" still matches Order Status',
      at('trackign')?.rule.name === 'Order Status' && at('trackign').confidence >= 0.6);
    check('QA\'s "do you have this in size 9?" matches Size Availability, not Order Status',
      at('do you have this in size 9?')?.rule.name === 'Size Availability',
      JSON.stringify(at('do you have this in size 9?')));
    check('an unrelated message does not clear the 0.6 threshold',
      (at('the weather is nice today')?.confidence ?? 0) < 0.6);
  }

  // ── BUG-05: routing precedence ───────────────────────────────────────────
  section('BUG-05 · Overlapping automations resolve in one order');
  {
    await resetContact();
    await prisma.automationTrigger.create({
      data: { workspaceId: workspace.id, keyword: 'hi', responseTemplate: 'Hi! This is the keyword trigger.', isActive: true },
    });

    const hi = await say('hi');
    check('a configured keyword trigger beats the built-in greeting',
      replied(hi, 'keyword trigger'), JSON.stringify(hi));
    check('only one automation answers', hi.length === 1, `${hi.length} replies: ${JSON.stringify(hi)}`);

    // A form in flight outranks the keyword trigger.
    await say('SUPPORT');
    const duringForm = await say('hi');
    check('a form in flight outranks the keyword trigger',
      !replied(duringForm, 'keyword trigger'), JSON.stringify(duringForm));
    check('the form answers it as an invalid choice instead',
      replied(duringForm, 'Please reply with one of'), JSON.stringify(duringForm));
    await say('cancel');
  }

  // ── Opt-out still wins outside a flow ────────────────────────────────────
  section('Opt-out compliance is not weakened');
  {
    await resetContact();
    const before = await prisma.optOut.count({ where: { workspaceId: workspace.id } });
    await say('stop');
    const after = await prisma.optOut.count({ where: { workspaceId: workspace.id } });
    check('"stop" with no flow running still opts the contact out', after === before + 1, `${before} -> ${after}`);
    await prisma.optOut.deleteMany({ where: { workspaceId: workspace.id } });
  }

  // ══ Tab-by-tab coverage ═══════════════════════════════════════════════════
  // Everything below walks the Automation screen's nine tabs end to end, so the
  // modules QA could not reach (Instagram, Voice AI) are exercised too.

  // ── Tab 2 · Custom Auto Reply ────────────────────────────────────────────
  section('Tab · Custom Auto Reply (keyword triggers)');
  {
    await resetContact();

    const trigger = await automation.createTrigger(workspace.id, {
      keyword: 'BROCHURE',
      responseTemplate: 'Here is our brochure: https://example.com/brochure.pdf',
    });
    check('a trigger is created', !!trigger.id && trigger.keyword === 'BROCHURE');

    const list = await automation.listTriggers(workspace.id);
    check('the trigger is listed', list.some((t) => t.id === trigger.id));

    const fired = await say('brochure');
    check('the keyword fires case-insensitively', replied(fired, 'brochure.pdf'), JSON.stringify(fired));

    const inSentence = await say('can I get a brochure please');
    check('the keyword fires inside a sentence', replied(inSentence, 'brochure.pdf'), JSON.stringify(inSentence));

    // Whole-word matching: "brochures" must not fire the "BROCHURE" trigger.
    check('keywordMatches is whole-word', automation.keywordMatches('BROCHURE', 'brochure') === true
      && automation.keywordMatches('BROCHURE', 'brochured') === false);

    await automation.updateTrigger(workspace.id, trigger.id, { isActive: false });
    const off = await say('brochure');
    check('a deactivated trigger stops firing', !replied(off, 'brochure.pdf'), JSON.stringify(off));

    await automation.deleteTrigger(workspace.id, trigger.id);
    check('the trigger is deleted',
      !(await automation.listTriggers(workspace.id)).some((t) => t.id === trigger.id));

    // Custom Auto Reply must work independently of Working Hours — QA checked
    // this and it is worth keeping true.
    await automation.updateBasicAutomations(workspace.id, { businessHoursEnabled: true, autoOooEnabled: true });
    const t2 = await automation.createTrigger(workspace.id, { keyword: 'PRICING', responseTemplate: 'Plans start at 499.' });
    const outOfHours = await say('pricing');
    check('a keyword trigger still fires with out-of-office active',
      replied(outOfHours, 'Plans start at 499'), JSON.stringify(outOfHours));
    await automation.deleteTrigger(workspace.id, t2.id);
    await automation.updateBasicAutomations(workspace.id, { businessHoursEnabled: false, autoOooEnabled: false });
  }

  // ── Tab 3 · Workflows ────────────────────────────────────────────────────
  section('Tab · Workflows (builder + engine)');
  {
    await resetContact();

    const wf = await workflows.createWorkflow(workspace.id, {
      name: 'Onboarding',
      nodes: [
        { id: 't', type: 'trigger', subtype: 'keyword', value: 'onboard' },
        { id: 'a1', type: 'action', subtype: 'message', value: 'Welcome aboard, {{name}}!' },
        { id: 'c1', type: 'condition', subtype: 'contains', value: 'vip', skipIfFalse: 1 },
        { id: 'a2', type: 'action', subtype: 'tag', value: 'VIP' },
        { id: 'a3', type: 'action', subtype: 'buttons', value: 'Pick a plan | Basic | Pro' },
      ],
      edges: [],
    });
    check('a workflow is created', !!wf.id);
    check('the workflow is listed',
      (await workflows.listWorkflows(workspace.id)).some((w) => w.id === wf.id));

    const run = await say('onboard');
    check('the workflow trigger fires', replied(run, 'Welcome aboard'), JSON.stringify(run));
    check('{{name}} is filled in from the contact', replied(run, 'QA Tester'), JSON.stringify(run));
    check('a buttons step asks its question', replied(run, 'Pick a plan'), JSON.stringify(run));
    check('the buttons step sends real options',
      sent.some((m) => JSON.stringify(m.raw).includes('Basic') && JSON.stringify(m.raw).includes('Pro')));

    const contactRow = await prisma.contact.findFirst({ where: { workspaceId: workspace.id, phoneNumber: CUSTOMER } });
    check('the guarded tag step was skipped (condition did not hold)',
      !(contactRow?.tags || []).includes('VIP'), JSON.stringify(contactRow?.tags));

    const vip = await say('onboard vip');
    check('the condition holds when the message matches', replied(vip, 'Welcome aboard'), JSON.stringify(vip));
    const tagged = await prisma.contact.findFirst({ where: { workspaceId: workspace.id, phoneNumber: CUSTOMER } });
    check('the guarded tag step ran this time', (tagged?.tags || []).includes('VIP'), JSON.stringify(tagged?.tags));

    const runs = await prisma.workflowRun.findMany({ where: { workflowId: wf.id } });
    check('runs are recorded with a trace', runs.length === 2 && runs.every((r) => Array.isArray(r.trace) && r.trace.length > 0));
    check('runs completed', runs.every((r) => r.status === 'COMPLETED'));

    await workflows.updateWorkflow(workspace.id, wf.id, { isActive: false });
    const inactive = await say('onboard');
    check('an inactive workflow does not fire', !replied(inactive, 'Welcome aboard'), JSON.stringify(inactive));

    await workflows.deleteWorkflow(workspace.id, wf.id);
    check('the workflow is deleted',
      !(await workflows.listWorkflows(workspace.id)).some((w) => w.id === wf.id));
  }

  // ── Tab 4 · AI Intent Matching (rules + routing) ─────────────────────────
  section('Tab · AI Intent Matching (rule CRUD and routing)');
  {
    await resetContact();

    const target = await automation.createTrigger(workspace.id, {
      keyword: 'ZZTRACKORDER', responseTemplate: 'You can track your order at example.com/track.',
    });

    const rule = await intents.createRule(workspace.id, {
      name: 'Order Status',
      phrases: ['where is my order', 'order status', 'tracking'],
      actionType: 'trigger',
      actionTarget: target.id,
    });
    check('an intent rule is created', !!rule.id);
    check('the rule is listed', (await intents.listRules(workspace.id)).some((r) => r.id === rule.id));

    const duplicate = await intents.createRule(workspace.id, { name: 'Order Status' }).catch((e) => e);
    check('a duplicate intent name is a 409', duplicate?.status === 409, String(duplicate?.message));

    const tested = await intents.testMessage(workspace.id, 'where is my order');
    check('the tester reports a match', tested.matched === true && tested.confidence >= 0.6, JSON.stringify(tested.confidence));

    const routed = await say('where is my order');
    check('a matching intent routes to its trigger reply',
      replied(routed, 'example.com/track'), JSON.stringify(routed));

    const events = await prisma.intentMatchEvent.count({ where: { workspaceId: workspace.id } });
    check('the match is recorded for the accuracy panel', events > 0, `events=${events}`);

    // Human-handoff action.
    await intents.updateRule(workspace.id, rule.id, { actionType: 'human', actionTarget: 'Support' });
    await say('order status');
    const handed = await conv();
    check('a "human" intent hands the thread to a person', !!handed?.humanHandoffAt);
    check('the handoff carries the rule\'s team label', handed?.label === 'Support', String(handed?.label));

    await intents.deleteRule(workspace.id, rule.id);
    check('the rule is deleted', !(await intents.listRules(workspace.id)).some((r) => r.id === rule.id));
    await automation.deleteTrigger(workspace.id, target.id);
  }

  // ── Tab 5 · WhatsApp AI Agent ────────────────────────────────────────────
  section('Tab · WhatsApp AI Agent (configuration and guards)');
  {
    await resetContact();

    const cfg = await aiAgent.updateAgentConfig(workspace.id, {
      name: 'Order Support Agent',
      systemPrompt: 'You answer questions about orders using only the supplied knowledge.',
      purpose: 'Answer order and delivery questions for QA2 Traders.',
      escalationRules: { asksForHuman: true, refund: true, negativeSentiment: false, highIntent: false },
      escalationThreshold: 0.5,
    });
    check('agent configuration saves', cfg.aiAgentName === 'Order Support Agent');
    check('escalation rules save', cfg.escalationRules.asksForHuman === true && cfg.escalationRules.highIntent === false,
      JSON.stringify(cfg.escalationRules));
    check('the readiness score is recomputed on save', typeof cfg.readiness === 'object' && cfg.readiness !== null);

    const read = await aiAgent.getAgentConfig(workspace.id);
    check('agent configuration reads back', read.aiAgentPrompt.startsWith('You answer questions'));
    check('llmAvailable reports the provider state', read.llmAvailable === false, String(read.llmAvailable));

    const badThreshold = await aiAgent.updateAgentConfig(workspace.id, { escalationThreshold: 4 }).catch((e) => e);
    check('an out-of-range escalation threshold is a 400', badThreshold?.status === 400, String(badThreshold?.message));

    const emptyName = await aiAgent.updateAgentConfig(workspace.id, { name: '🙂🙂' }).catch((e) => e);
    check('a symbol-only agent name is rejected', emptyName?.status === 400, String(emptyName?.message));

    // Deploy guard: no LLM configured in this run.
    const blocked = await aiAgent.deployAgent(workspace.id).catch((e) => e);
    check('deploying without an LLM provider is refused',
      blocked?.status === 400 && /LLM provider/i.test(blocked.message), String(blocked?.message));

    // Deploy guard: prompt too short.
    env.GEMINI_API_KEY = 'test-key-not-used-for-network';
    await prisma.workspace.update({ where: { id: workspace.id }, data: { aiAgentPrompt: 'short' } });
    const shortPrompt = await aiAgent.deployAgent(workspace.id).catch((e) => e);
    check('deploying without a real prompt is refused',
      shortPrompt?.status === 400 && /system prompt/i.test(shortPrompt.message), String(shortPrompt?.message));

    await aiAgent.updateAgentConfig(workspace.id, {
      systemPrompt: 'You answer questions about orders using only the supplied knowledge.',
    });
    const deployed = await aiAgent.deployAgent(workspace.id);
    check('a configured agent deploys', deployed.aiAgentEnabled === true && !!deployed.aiAgentDeployedAt);

    const undeployed = await aiAgent.undeployAgent(workspace.id);
    check('the agent undeploys', undeployed.aiAgentEnabled === false);
    delete env.GEMINI_API_KEY;

    // Escalation rules are read at runtime — this is what routes a customer to
    // a person before any automation answers.
    const { escalationReason } = await import('./src/services/intentRouting.service.js');
    const rules = { asksForHuman: true, refund: true };
    check('"I want to speak to a person" escalates',
      /person/i.test(escalationReason('I want to speak to a person', rules) || ''));
    check('a refund request escalates',
      !!escalationReason('I need a refund for this', rules));
    check('an ordinary question does not escalate',
      escalationReason('what colours does it come in?', rules) === null);
    check('an unticked rule does not fire',
      escalationReason('this is the worst product ever', rules) === null);

    // Intent matching switch.
    const im = await aiAgent.setIntentMatching(workspace.id, { enabled: true, threshold: 0.75 });
    check('intent matching settings save', im.intentMatchingEnabled === true && im.intentMatchThreshold === 0.75);
    await aiAgent.setIntentMatching(workspace.id, { enabled: false, threshold: 0.6 });
  }

  // ── Tab 6 · Instagram Quickflows ─────────────────────────────────────────
  section('Tab · Instagram Quickflows');
  {
    const IG_USER = `IGUSER_${STAMP}`;
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { instagramUserId: IG_USER, instagramAccessToken: enc('fake-ig-token') },
    });

    const dmFlow = await instagram.createFlow(workspace.id, {
      name: 'Price DM', source: 'dm', keyword: 'price',
      responseTemplate: 'Our plans start at 499 a month.',
    });
    check('a DM quickflow is created', !!dmFlow.id);
    check('the keyword is normalised to upper case', dmFlow.keyword === 'PRICE', dmFlow.keyword);

    const commentFlow = await instagram.createFlow(workspace.id, {
      name: 'Comment reply', source: 'comment', keyword: 'info',
      responseTemplate: 'Sent you a DM with the details!', alsoSendDm: true,
    });
    check('a comment quickflow is created', !!commentFlow.id);

    const listed = await instagram.listFlows(workspace.id);
    check('quickflows are listed', listed.length === 2);

    // A DM arriving on the webhook.
    sent.length = 0;
    await instagram.processInstagramWebhook({
      entry: [{
        id: IG_USER,
        messaging: [{ sender: { id: 'IG_FAN_1' }, message: { text: 'whats the price?' } }],
      }],
    });
    check('an incoming DM gets the quickflow reply',
      sent.some((m) => String(m.raw?.message?.text || '').includes('499')), JSON.stringify(sent.map((m) => m.raw)));

    const afterDm = await prisma.instagramFlow.findUnique({ where: { id: dmFlow.id } });
    check('the DM quickflow counts the trigger', afterDm.triggeredCount === 1, String(afterDm.triggeredCount));

    // Our own outbound DM echoing back must not start a loop.
    sent.length = 0;
    await instagram.processInstagramWebhook({
      entry: [{ id: IG_USER, messaging: [{ sender: { id: IG_USER }, message: { text: 'price', is_echo: true } }] }],
    });
    check('an echo of our own DM is ignored', sent.length === 0, JSON.stringify(sent));

    // A comment, which also sends a DM.
    sent.length = 0;
    await instagram.processInstagramWebhook({
      entry: [{
        id: IG_USER,
        changes: [{ field: 'comments', value: { id: 'IG_COMMENT_1', text: 'can I get info', from: { id: 'IG_FAN_2' } } }],
      }],
    });
    check('a comment gets a public reply',
      sent.some((m) => String(m.raw?.message || '').includes('Sent you a DM')), JSON.stringify(sent.map((m) => m.raw)));
    check('alsoSendDm additionally sends a DM',
      sent.some((m) => String(m.raw?.message?.text || '').includes('Sent you a DM')), `${sent.length} calls`);

    // Our own comment reply coming back must not be answered again.
    sent.length = 0;
    await instagram.processInstagramWebhook({
      entry: [{
        id: IG_USER,
        changes: [{ field: 'comments', value: { id: 'IG_COMMENT_2', text: 'info', from: { id: IG_USER } } }],
      }],
    });
    check('our own comment is ignored', sent.length === 0, JSON.stringify(sent));

    // An unknown Instagram account must not reach this workspace.
    sent.length = 0;
    await instagram.processInstagramWebhook({
      entry: [{ id: 'SOMEONE_ELSE', messaging: [{ sender: { id: 'X' }, message: { text: 'price' } }] }],
    });
    check('an event for an unconnected account is dropped', sent.length === 0);

    // Deactivating stops the flow.
    await instagram.updateFlow(workspace.id, dmFlow.id, { isActive: false });
    sent.length = 0;
    await instagram.processInstagramWebhook({
      entry: [{ id: IG_USER, messaging: [{ sender: { id: 'IG_FAN_3' }, message: { text: 'price' } }] }],
    });
    check('an inactive quickflow does not reply', sent.length === 0, JSON.stringify(sent));

    await instagram.deleteFlow(workspace.id, dmFlow.id);
    await instagram.deleteFlow(workspace.id, commentFlow.id);
    check('quickflows are deleted', (await instagram.listFlows(workspace.id)).length === 0);
  }

  // ── Tab 7 · Voice AI — inbound calls ─────────────────────────────────────
  section('Tab · Voice AI (inbound call state machine)');
  {
    const INBOUND = '+15550009999';
    const CALLER = '+15551234567';

    const saved = await automation.updateVoiceSettings(workspace.id, {
      voiceAiEnabled: true,
      voiceAiName: 'QA Receptionist',
      voiceAiPrompt: 'Answer calls for QA2 Traders and take a message.',
      voiceAiInboundPhone: INBOUND,
      voiceAiPhone: '+15557654321',
      voiceAiGreeting: 'Thanks for calling QA2 Traders. How can I help?',
    });
    check('voice settings save', saved.voiceAiInboundPhone === INBOUND && saved.voiceAiEnabled === true);

    const routedWs = await voice.findWorkspaceForNumber('15550009999');
    check('an inbound number routes to its workspace', routedWs?.id === workspace.id);
    check('an unknown number routes nowhere', (await voice.findWorkspaceForNumber('+15550000000')) === null);

    // Drive the Twilio webhooks through the controller (the signature guard is
    // asserted separately below).
    const CallSid = `CA_QA2_${STAMP}`;
    const xml = [];
    const res = () => ({
      type() { return this; },
      status() { return this; },
      send(body) { xml.push(String(body)); return this; },
    });

    await voiceCtrl.incoming({ body: { CallSid, From: CALLER, To: INBOUND } }, res());
    check('the call is answered with the configured greeting',
      xml[0].includes('Thanks for calling QA2 Traders'), xml[0]?.slice(0, 120));
    check('the greeting gathers speech', xml[0].includes('<Gather input="speech"'));

    const call = await prisma.voiceCall.findUnique({ where: { providerCallId: CallSid } });
    check('a VoiceCall row is created', !!call && call.status === 'IN_PROGRESS');
    check('the greeting is in the transcript',
      (call.transcript || []).some((t) => t.role === 'agent' && t.text.includes('Thanks for calling')));

    xml.length = 0;
    await voiceCtrl.respond(
      { query: { callId: call.id }, body: { SpeechResult: 'Hi, I want to ask about my order.' } },
      res(),
    );
    check('the caller gets a spoken reply', xml[0].includes('<Say'), xml[0]?.slice(0, 120));
    const afterTurn = await prisma.voiceCall.findUnique({ where: { id: call.id } });
    check('the caller turn is transcribed',
      (afterTurn.transcript || []).some((t) => t.role === 'caller' && t.text.includes('about my order')));

    // Silence ends the call.
    xml.length = 0;
    await voiceCtrl.respond({ query: { callId: call.id }, body: { SpeechResult: '' } }, res());
    check('silence hangs up', xml[0].includes('<Hangup/>'), xml[0]?.slice(0, 120));

    const finished = await prisma.voiceCall.findUnique({ where: { id: call.id } });
    check('the call is finalised', finished.status === 'COMPLETED');
    check('a duration is recorded', Number.isInteger(finished.durationSec));
    check('the caller is captured as a contact', !!finished.contactId);

    const lead = await prisma.contact.findUnique({ where: { id: finished.contactId } });
    check('the lead contact carries the caller number', lead?.phoneNumber === CALLER, String(lead?.phoneNumber));
    check('the lead is tagged as a Voice AI lead', (lead?.tags || []).includes('Voice AI Lead'), JSON.stringify(lead?.tags));

    const calls = await voice.listCalls(workspace.id);
    check('the call appears in the call list', calls.some((c) => c.id === call.id));

    // TwiML builders.
    check('forwardTo dials the handoff number', voice.forwardTo('+15557654321', 'Connecting').includes('<Dial>+15557654321</Dial>'));
    check('TwiML escapes special characters', voice.hangup('Tom & "Jerry" <b>').includes('&amp;') === true);

    // The status callback finalises a call the caller simply hung up on.
    const CallSid2 = `CA_QA2B_${STAMP}`;
    await voiceCtrl.incoming({ body: { CallSid: CallSid2, From: CALLER, To: INBOUND } }, res());
    let statusCode = null;
    await voiceCtrl.status(
      { body: { CallSid: CallSid2, CallStatus: 'completed' } },
      { status(c) { statusCode = c; return this; }, send() { return this; } },
    );
    const hungUp = await prisma.voiceCall.findUnique({ where: { providerCallId: CallSid2 } });
    check('the status callback finalises a hung-up call', hungUp.status === 'COMPLETED', hungUp.status);
    check('the status callback answers 204', statusCode === 204, String(statusCode));

    // An unrouteable number is rejected rather than answered.
    xml.length = 0;
    await voiceCtrl.incoming({ body: { CallSid: `CA_QA2C_${STAMP}`, From: CALLER, To: '+15550000000' } }, res());
    check('a call to an unconfigured number is declined',
      xml[0].includes('not configured') && xml[0].includes('<Hangup/>'), xml[0]?.slice(0, 120));

    // The webhook is signature-protected — an unsigned request must not drive it.
    let rejected = null;
    voiceCtrl.verifyTwilioSignature(
      { headers: {}, originalUrl: '/api/v1/voice/incoming', body: {} },
      { status(c) { rejected = c; return this; }, type() { return this; }, send() { return this; } },
      () => { rejected = 'passed'; },
    );
    check('an unsigned Twilio webhook is rejected', rejected === 403 || rejected === 503, String(rejected));

    await automation.updateVoiceSettings(workspace.id, { voiceAiEnabled: false });
  }

  // ── Tab 8 · WhatsApp Forms (builder side) ────────────────────────────────
  section('Tab · WhatsApp Forms (builder and submissions)');
  {
    await resetContact();

    const built = await forms.createForm(workspace.id, {
      name: 'Feedback',
      keyword: 'FEEDBACK',
      status: 'Active',
      completionMessage: 'Thanks for the feedback!',
      schema: [
        { label: 'How would you rate us?', type: 'choice', required: true, options: ['Great', 'Okay', 'Poor'] },
        // Keyed `email` on purpose: that is what routes the answer onto the
        // contact's own email column rather than only the submission row.
        { key: 'email', label: 'Your email', type: 'email', required: true },
      ],
    });
    check('a form is created', !!built.id);
    check('question keys are generated', built.schema.every((f) => !!f.key), JSON.stringify(built.schema.map((f) => f.key)));
    check('the form is listed', (await forms.listForms(workspace.id)).some((f) => f.id === built.id));

    check('FEEDBACK starts the form', replied(await say('FEEDBACK'), 'How would you rate us'));
    const badEmailFirst = await say('Great');
    check('the choice is accepted and the email asked for', replied(badEmailFirst, 'Your email'), JSON.stringify(badEmailFirst));
    const invalidEmail = await say('not-an-email');
    check('an invalid email is rejected', replied(invalidEmail, "doesn't look like an email"), JSON.stringify(invalidEmail));
    const done = await say('tester@example.com');
    check('the form completes', replied(done, 'Thanks for the feedback'), JSON.stringify(done));

    const subs = await forms.listSubmissions(workspace.id, built.id);
    check('the submission is listed', subs.length === 1 && subs[0].completed === true);
    check('the answers are stored',
      JSON.stringify(subs[0].answers).includes('Great') && JSON.stringify(subs[0].answers).includes('tester@example.com'),
      JSON.stringify(subs[0].answers));

    const counted = await prisma.whatsappForm.findUnique({ where: { id: built.id } });
    check('the form submission counter increments', counted.submissions === 1, String(counted.submissions));

    // The email answer is written onto the contact record, not only the row.
    const enriched = await prisma.contact.findFirst({ where: { workspaceId: workspace.id, phoneNumber: CUSTOMER } });
    check('a captured email lands on the contact', enriched?.email === 'tester@example.com', String(enriched?.email));

    await forms.updateForm(workspace.id, built.id, { status: 'Draft' });
    const draft = await say('FEEDBACK');
    check('a draft form does not trigger', !replied(draft, 'How would you rate us'), JSON.stringify(draft));

    await forms.deleteForm(workspace.id, built.id);
    check('the form is deleted', !(await forms.listForms(workspace.id)).some((f) => f.id === built.id));
  }

  // ── Tab 9 · Smart Lists (segment side) ───────────────────────────────────
  section('Tab · Smart Lists (segment CRUD)');
  {
    const seg = await segments.createSegment(workspace.id, { name: 'Newsletter', desc: 'Opted in' });
    check('a segment is created', !!seg.id);

    const renamed = await segments.updateSegment(workspace.id, seg.id, { name: 'Newsletter 2026' });
    check('a segment is renamed', renamed.name === 'Newsletter 2026');

    const added = await segments.addContactToSegment(workspace.id, seg.id, { name: 'Ann', phoneNumber: '+91 90000 00001' });
    check('a contact joins the segment', !!added.contactId);

    const edited = await segments.updateContactInSegment(workspace.id, seg.id, added.contactId, { name: 'Ann B' });
    check('a contact in the segment is edited', edited.name === 'Ann B');

    const badEdit = await segments.updateContactInSegment(workspace.id, seg.id, added.contactId, { phoneNumber: '   ' })
      .catch((e) => e);
    check('blanking the phone number on edit is a 400', badEdit?.status === 400, String(badEdit?.message));

    await segments.removeContactFromSegment(workspace.id, seg.id, added.contactId);
    const afterRemove = (await segments.listSegments(workspace.id)).find((s) => s.id === seg.id);
    check('a contact leaves the segment without being deleted',
      (afterRemove?.contacts?.length ?? 0) === 0
      && !!(await prisma.contact.findUnique({ where: { id: added.contactId } })));

    await segments.deleteSegment(workspace.id, seg.id);
    check('the segment is deleted', !(await segments.listSegments(workspace.id)).some((s) => s.id === seg.id));

    const missing = await segments.deleteSegment(workspace.id, seg.id).catch((e) => e);
    check('deleting a missing segment is a 404', missing?.status === 404, String(missing?.status));
  }

  // ── An unanswered message must not switch automation off ─────────────────
  section('Unmatched messages do not seize the conversation');
  {
    await resetContact();
    await prisma.workspace.update({ where: { id: workspace.id }, data: { aiAgentEnabled: false } });

    const trigger = await automation.createTrigger(workspace.id, {
      keyword: 'ZZHOURS', responseTemplate: 'We are open 9 to 6.',
    });

    // A message nothing can answer, on a workspace with no AI agent deployed.
    const unanswered = await say('do you have this in size 9?');
    check('an unanswerable message gets no reply', unanswered.length === 0, JSON.stringify(unanswered));

    const after = await conv();
    check('...and does NOT hand the conversation to a person', !after?.humanHandoffAt,
      String(after?.humanHandoffAt));

    // The next message must still be automated. Before the fix, this was silent.
    const stillWorks = await say('ZZHOURS');
    check('a later keyword trigger still fires', replied(stillWorks, 'open 9 to 6'), JSON.stringify(stillWorks));

    const greeting = await say('hello');
    check('a later greeting still works', greeting.length > 0, JSON.stringify(greeting));

    await automation.deleteTrigger(workspace.id, trigger.id);
  }

  // ── Negative / robustness ────────────────────────────────────────────────
  section('Negative testing');
  {
    await resetContact();
    await say('SUPPORT');
    const invalid = await say('banana');
    check('an unmatched choice is still rejected',
      replied(invalid, 'Please reply with one of'), JSON.stringify(invalid));

    const numeric = await say('2');
    check('a numbered reply selects the option', replied(numeric, 'describe the issue'), JSON.stringify(numeric));
    await say('cancel');

    const empty = await say('   ');
    check('a blank message does not crash the pipeline', Array.isArray(empty));
  }
} catch (err) {
  console.error('\nHarness error:', err);
  exitCode = 1;
} finally {
  // ── Teardown ─────────────────────────────────────────────────────────────
  await prisma.workspace.delete({ where: { id: workspace.id } }).catch((err) =>
    console.error('cleanup failed:', err.message));
  await prisma.$disconnect();
}

async function conv() {
  return prisma.conversation.findFirst({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: 'desc' },
  });
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Passed: ${pass}   Failed: ${fail}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✘ ${f}`);
}
process.exit(fail > 0 || exitCode ? 1 : 0);
