// The form as one screen (a WhatsApp Flow): sent when the keyword arrives,
// filed when the customer taps Submit, and the chat version whenever the
// screen cannot be used.
import { test, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { flowFingerprint } from '../lib/formFlowScreen.js';
import { parseInboundMessage, carriesCustomerText, FLOW_REPLY_BODY } from './inboundMessage.js';

const form = {
  id: 'f1', workspaceId: 'ws1', name: 'Mushroom Order', status: 'Active', keyword: 'PLACE ORDER',
  completionMessage: [
    '{{? q2}}White Button: {{q2}} box = ₹{{= q2 * button_price}}',
    '{{? q3}}Oyster: {{q3}} pack = ₹{{= q3 * oyster_price}}',
    '{{? q4}}Baby Corn: {{q4}} kg = ₹{{= q4 * babycorn_price}}',
    'Deliver to: {{q5}}',
    'Total ₹{{= q2*button_price + q3*oyster_price + q4*babycorn_price}}',
  ].join('\n'),
  schema: [
    { key: 'what', label: 'What would you like to order?', type: 'multi', required: true, options: ['White Button Mushroom', 'Oyster Mushroom', 'Baby Corn'] },
    { key: 'boxes', label: 'How many 10 kg boxes of White Button Mushroom?', type: 'number', required: true, options: [], showIf: { question: 1, option: 'White Button Mushroom' } },
    { key: 'packs', label: 'How many 200 g packs of Oyster Mushroom?', type: 'number', required: true, options: [], showIf: { question: 1, option: 'Oyster Mushroom' } },
    { key: 'corn', label: 'How many kg of Baby Corn?', type: 'number', required: true, options: [], showIf: { question: 1, option: 'Baby Corn' } },
    { key: 'address', label: 'Delivery address for this order?', type: 'text', required: true, options: [] },
  ],
};
const FP = flowFingerprint(form);
const contact = {
  id: 'c1', name: 'krishna', phoneNumber: '+919226381481',
  attributes: { button_price: '1100', oyster_price: '40', babycorn_price: '90' },
};
const conversation = { id: 'conv1', waNumberId: 'wa1' };
const waNumber = { id: 'wa1', workspaceId: 'ws1', wabaId: 'waba1', metaPhoneNumberId: 'pn1', encryptedAccessToken: 'enc', status: 'ACTIVE' };
const published = () => ({ formId: 'f1', enabled: true, status: 'PUBLISHED', metaFlowId: 'flow1', wabaId: 'waba1', fingerprint: FP, error: null });

const db = {};
const meta = {};

let forms; let screens;
before(async () => {
  mock.module('../lib/prisma.js', {
    namedExports: {
      prisma: {
        whatsappFormSubmission: {
          findFirst: async ({ where }) => (where.id ? db.byId[where.id] ?? null : db.open),
          create: async ({ data }) => { const row = { id: `s${db.created.length + 10}`, ...data }; db.created.push(row); return row; },
          update: async (args) => { db.updates.push(args); return args; },
          findMany: async () => [],
        },
        whatsappForm: {
          findFirst: async () => db.form,
          findMany: async () => [db.form],
          update: async (args) => { db.formUpdates.push(args); return {}; },
        },
        whatsappFormScreen: {
          findUnique: async () => { if (db.noTable) throw new Error('The table `WhatsappFormScreen` does not exist'); return db.screen; },
          upsert: async (args) => { db.upserts.push(args); db.screen = { formId: 'f1', ...(db.screen ? { ...db.screen, ...args.update } : args.create) }; return db.screen; },
          update: async ({ data }) => { db.screen = { ...db.screen, ...data }; return db.screen; },
        },
        waNumber: { findUnique: async () => waNumber, findFirst: async () => db.waNumber },
        message: { create: async ({ data }) => { db.messages.push(data); return data; } },
        conversation: { update: async () => ({}) },
        contact: { findUnique: async () => contact, findMany: async () => [contact], update: async () => ({}) },
        workspaceCustomField: { findMany: async () => [] },
        workspace: { findUnique: async () => ({ orderingEnabled: true }) },
      },
    },
  });
  mock.module('../lib/encryption.js', { namedExports: { decrypt: () => 'token', encrypt: (v) => v } });
  mock.module('../lib/meta.js', {
    namedExports: {
      createFlow: async (...a) => { meta.calls.push(['create', ...a]); return { id: 'flow2' }; },
      uploadFlowJson: async (...a) => { meta.calls.push(['upload', ...a]); return meta.upload; },
      publishFlow: async (...a) => { meta.calls.push(['publish', ...a]); if (meta.publishError) throw meta.publishError; return { success: true }; },
      deprecateFlow: async (...a) => { meta.calls.push(['deprecate', ...a]); return { success: true }; },
      deleteFlow: async (...a) => { meta.calls.push(['delete', ...a]); return { success: true }; },
      sendFlowMessage: async (...a) => { meta.calls.push(['send', ...a]); if (meta.sendError) throw meta.sendError; return { messages: [{ id: 'wamid.1' }] }; },
    },
  });
  mock.module('./optout.service.js', { namedExports: { isOptedOut: async () => db.optedOut } });
  mock.module('./messagingWindow.js', { namedExports: { getWindowState: async () => ({ open: db.windowOpen }), WINDOW_MS: 86400000 } });
  mock.module('./outbound.service.js', {
    namedExports: { sendAutomatedReply: async ({ body }) => { db.sent.push(body); } },
  });
  mock.module('./subscription.service.js', { namedExports: { assertWithinLimit: async () => {} } });
  mock.module('./automation.service.js', {
    namedExports: { keywordMatches: (keyword, body) => String(body).trim().toUpperCase() === keyword },
  });
  forms = await import('./whatsappForms.service.js');
  screens = await import('./whatsappFormScreen.service.js');
});

beforeEach(() => {
  Object.assign(db, {
    form, open: null, byId: {}, created: [], updates: [], formUpdates: [], upserts: [], messages: [], sent: [],
    screen: published(), waNumber, optedOut: false, windowOpen: true, noTable: false,
  });
  Object.assign(meta, { calls: [], upload: { success: true, validation_errors: [] }, publishError: null, sendError: null });
});

const inbound = (messageBody) => forms.handleFormInbound({ workspaceId: 'ws1', conversation, contact, messageBody });
const submit = (token, data) => screens.handleFlowReply({ workspaceId: 'ws1', conversation, contact, flowReply: { token, data } });
const tokenFor = (id) => `${id}.${FP.slice(0, 12)}`;

// ── Reading Meta's webhook ─────────────────────────────────────────────────

test('a submitted screen is parsed into a token and its inputs, never into customer text', () => {
  const parsed = parseInboundMessage({
    type: 'interactive',
    interactive: {
      type: 'nfm_reply',
      nfm_reply: { name: 'flow', body: 'Sent', response_json: JSON.stringify({ flow_token: 's1.abc', f1_o1: true, f2: '5' }) },
    },
  });
  assert.equal(parsed.type, 'INTERACTIVE');
  assert.equal(parsed.body, FLOW_REPLY_BODY);
  assert.deepEqual(parsed.flowReply, { token: 's1.abc', data: { f1_o1: true, f2: '5' } });
  assert.equal(carriesCustomerText(parsed), false);

  // Unreadable JSON is still a screen reply, with nothing in it.
  const broken = parseInboundMessage({ interactive: { type: 'nfm_reply', nfm_reply: { response_json: '{oops' } } });
  assert.deepEqual(broken.flowReply, { token: '', data: {} });

  // Ordinary button taps are untouched.
  const tap = parseInboundMessage({ interactive: { type: 'button_reply', button_reply: { id: 'x_0', title: 'Place order' } } });
  assert.equal(tap.body, 'Place order');
  assert.equal(tap.flowReply, undefined);
  assert.equal(carriesCustomerText(tap), true);
});

// ── The keyword arrives ────────────────────────────────────────────────────

test('the keyword sends the screen instead of the first question', async () => {
  assert.equal(await inbound('Place order'), true);

  const send = meta.calls.find((c) => c[0] === 'send');
  assert.deepEqual(send.slice(1, 4), ['pn1', 'token', '+919226381481']);
  assert.deepEqual(send[4], {
    body: 'Mushroom Order\n\nTap the button below, fill in the form and tap Submit.',
    cta: 'Open form', flowId: 'flow1', flowToken: tokenFor('s10'), screen: 'FORM',
  });
  assert.deepEqual(db.sent, [], 'no question asked in chat');
  assert.equal(db.messages.length, 1, 'recorded for the inbox');
  assert.equal(db.messages[0].metaMessageId, 'wamid.1');
  assert.deepEqual(db.updates.at(-1), { where: { id: 's10' }, data: { answers: { __screen: true } } });
});

for (const [name, setup] of [
  ['no screen was ever published', () => { db.screen = null; }],
  ['the screen is switched off', () => { db.screen.enabled = false; }],
  ['the questions changed after publishing', () => { db.screen.fingerprint = 'something-older'; }],
  ['the conversation is on another WhatsApp account', () => { db.screen.wabaId = 'waba-other'; }],
  ['the migration has not run yet', () => { db.noTable = true; }],
  ['WhatsApp refuses the send', () => { meta.sendError = new Error('boom'); }],
  ['the 24-hour window is closed', () => { db.windowOpen = false; }],
]) {
  test(`falls back to asking in chat when ${name}`, async () => {
    setup();
    assert.equal(await inbound('PLACE ORDER'), true);
    assert.equal(db.sent.length, 1);
    assert.match(db.sent[0], /^What would you like to order\?\nReply with the numbers/);
    assert.equal(db.updates.some((u) => u.data?.answers?.__screen), false, 'not marked as waiting on a screen');
  });
}

// ── The customer taps Submit ───────────────────────────────────────────────

test('a submitted screen saves the order with its total and sends the receipt', async () => {
  db.byId.s1 = { id: 's1', formId: 'f1', contactId: 'c1', form, completed: false, answers: { __screen: true } };
  const handled = await submit(tokenFor('s1'), { f1_o1: true, f2: '5', f1_o2: false, f1_o3: true, f4: '5', f5: 'Baner branch, Pune' });
  assert.equal(handled, true);

  const saved = db.updates.find((u) => u.where.id === 's1').data;
  assert.equal(saved.completed, true);
  assert.equal(saved.cursor, 5);
  assert.deepEqual(saved.answers, {
    what: 'White Button Mushroom, Baby Corn', boxes: '5', packs: '0', corn: '5', address: 'Baner branch, Pune', __total: 5950,
  });
  assert.deepEqual(db.sent, ['White Button: 5 box = ₹5,500\nBaby Corn: 5 kg = ₹450\nDeliver to: Baner branch, Pune\nTotal ₹5,950']);
  assert.deepEqual(db.formUpdates, [{ where: { id: 'f1' }, data: { submissions: { increment: 1 } } }]);
});

test('missing answers are named and nothing is saved', async () => {
  db.byId.s1 = { id: 's1', formId: 'f1', contactId: 'c1', form, completed: false, answers: { __screen: true } };
  assert.equal(await submit(tokenFor('s1'), { f1_o1: true, f5: 'Baner' }), true);
  assert.equal(db.updates.length, 0);
  assert.match(db.sent[0], /Some answers are missing:\n• How many 10 kg boxes of White Button Mushroom\?/);
});

test('a screen sent before the form was edited is refused, not misread', async () => {
  db.byId.s1 = { id: 's1', formId: 'f1', contactId: 'c1', form, completed: false, answers: { __screen: true } };
  assert.equal(await submit('s1.000000000000', { f1_o1: true, f2: '5', f5: 'Baner' }), true);
  assert.equal(db.updates.length, 0);
  assert.deepEqual(db.sent, ['This form has been updated since it was sent to you. Send PLACE ORDER to start again.']);
});

test('submitting the same screen again is a second order', async () => {
  db.byId.s1 = { id: 's1', formId: 'f1', contactId: 'c1', form, completed: true, answers: { what: 'Baby Corn', corn: '1', __total: 90 } };
  assert.equal(await submit(tokenFor('s1'), { f1_o2: true, f3: '25', f5: 'Kothrud' }), true);
  assert.equal(db.created.length, 1);
  const saved = db.updates.find((u) => u.where.id === db.created[0].id).data;
  assert.equal(saved.answers.__total, 1000);
  assert.equal(db.updates.some((u) => u.where.id === 's1'), false, 'the first order is left as it was');
});

test('a screen abandoned for a typed message can still be submitted later', async () => {
  // Typing instead of submitting closes the waiting submission and lets the
  // message through to the rest of the automation.
  db.open = { id: 's1', formId: 'f1', contactId: 'c1', form, completed: false, cursor: 0, answers: { __screen: true } };
  assert.equal(await inbound('hello?'), false);
  assert.deepEqual(db.updates[0].where, { id: 's1' });
  assert.equal(db.updates[0].data.completed, true);
  assert.deepEqual(db.sent, [], 'the message is not treated as an answer');

  db.byId.s1 = { ...db.open, completed: true };
  db.updates = [];
  assert.equal(await submit(tokenFor('s1'), { f1_o3: true, f4: '2', f5: 'Baner' }), true);
  assert.equal(db.created.length, 0, 'the same submission is completed');
  assert.equal(db.updates.find((u) => u.where.id === 's1').data.answers.__total, 180);
});

test('"cancel" while the screen is waiting still cancels', async () => {
  db.open = { id: 's1', formId: 'f1', contactId: 'c1', form, completed: false, cursor: 0, answers: { __screen: true } };
  assert.equal(await inbound('cancel'), true);
  assert.equal(db.updates.at(-1).data.completed, true);
  assert.equal(db.sent.length, 1);
});

test('a reply that is not for one of our forms, or from someone else, is left alone', async () => {
  assert.equal(await submit('unknown.abc', { f1_o1: true }), false);
  assert.equal(await submit('', {}), false);
  db.byId.s1 = { id: 's1', formId: 'f1', contactId: 'someone-else', form, completed: false, answers: { __screen: true } };
  assert.equal(await submit(tokenFor('s1'), { f1_o1: true, f2: '1', f5: 'x' }), false);
  assert.deepEqual(db.sent, []);
});

// ── Publishing ─────────────────────────────────────────────────────────────

test('publishing creates the flow, uploads the screen, publishes it and retires the old one', async () => {
  db.screen = { ...published(), fingerprint: 'older' };
  const state = await screens.publishScreen('ws1', 'f1');

  assert.deepEqual(meta.calls.map((c) => c[0]), ['create', 'upload', 'publish', 'deprecate']);
  assert.equal(meta.calls[0][1], 'waba1');
  assert.match(meta.calls[0][3].name, /^Mushroom Order [a-z0-9]+$/);
  assert.equal(meta.calls[1][1], 'flow2');
  assert.equal(meta.calls[1][3].screens[0].id, 'FORM');
  assert.equal(meta.calls[3][1], 'flow1');

  assert.equal(db.screen.metaFlowId, 'flow2');
  assert.equal(db.screen.fingerprint, FP);
  assert.deepEqual(
    { supported: state.supported, published: state.published, upToDate: state.upToDate, enabled: state.enabled, live: state.live, error: state.error },
    { supported: true, published: true, upToDate: true, enabled: true, live: true, error: null },
  );
});

test('a screen WhatsApp rejects is reported, cleaned up, and the old one kept', async () => {
  meta.upload = { success: true, validation_errors: [{ error: 'INVALID_PROPERTY', message: 'Property "label" is too long.' }] };
  await assert.rejects(screens.publishScreen('ws1', 'f1'), /WhatsApp did not accept the screen: Property "label" is too long\./);
  assert.deepEqual(meta.calls.map((c) => c[0]), ['create', 'upload', 'delete']);
  assert.equal(db.screen.metaFlowId, 'flow1', 'the working screen is untouched');
  assert.match(db.screen.error, /too long/);
});

test('Meta\'s own explanation is shown when publishing is refused', async () => {
  db.screen = null;
  meta.publishError = Object.assign(new Error('Request failed with status code 400'), {
    response: { data: { error: { message: '(#100) Invalid parameter', error_user_msg: 'Verify your business to publish flows.' } } },
  });
  await assert.rejects(screens.publishScreen('ws1', 'f1'), { status: 502, message: 'Verify your business to publish flows.' });
  assert.equal(db.screen.status, 'FAILED');
  const state = await screens.getScreenState('ws1', 'f1');
  assert.equal(state.published, false);
  assert.equal(state.live, false);
  assert.equal(state.error, 'Verify your business to publish flows.');
});

test('publishing needs a connected number and a form that fits one screen', async () => {
  db.waNumber = null;
  await assert.rejects(screens.publishScreen('ws1', 'f1'), { status: 400, message: /Connect a WhatsApp number/ });
  db.waNumber = waNumber;
  db.form = { ...form, schema: [] };
  await assert.rejects(screens.publishScreen('ws1', 'f1'), { status: 400, code: 'FLOW_UNSUPPORTED' });
  assert.deepEqual(meta.calls, []);
});

test('editing the questions republishes a live screen; an unchanged form is left alone', async () => {
  await screens.republishIfStale('ws1', 'f1');
  assert.deepEqual(meta.calls, [], 'nothing changed');

  db.form = { ...form, schema: form.schema.map((f, i) => (i === 4 ? { ...f, label: 'Where to?' } : f)) };
  await screens.republishIfStale('ws1', 'f1');
  assert.deepEqual(meta.calls.map((c) => c[0]), ['create', 'upload', 'publish', 'deprecate']);
  assert.equal(db.screen.fingerprint, flowFingerprint(db.form));

  // Switched off: an edit does not touch WhatsApp.
  meta.calls = [];
  db.screen = { ...published(), enabled: false, fingerprint: 'older' };
  await screens.republishIfStale('ws1', 'f1');
  assert.deepEqual(meta.calls, []);
});

test('the screen can be switched off and on without republishing', async () => {
  assert.equal((await screens.setScreenEnabled('ws1', 'f1', false)).live, false);
  assert.equal((await screens.setScreenEnabled('ws1', 'f1', true)).live, true);
  await assert.rejects(screens.setScreenEnabled('ws1', 'f1', 'yes'), /true or false/);
  db.screen = null;
  await assert.rejects(screens.setScreenEnabled('ws1', 'f1', true), /Publish the form screen first/);
});
