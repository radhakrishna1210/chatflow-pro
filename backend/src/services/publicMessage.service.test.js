import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Public API sends must be billed and recorded exactly like inbox sends. The
// database, the billing ledger and Meta are all faked so these run offline.

let db;
let ledger;
let metaCalls;
let metaFails;
let creditResult;

function reset() {
  db = {
    waNumbers: [{ id: 'wa_1', workspaceId: 'ws_1', metaPhoneNumberId: 'PN_1', encryptedAccessToken: 'enc', createdAt: new Date(0) }],
    templates: [
      { id: 't_ok', workspaceId: 'ws_1', name: 'promo', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'BODY', text: 'Hi {{1}}' }], createdAt: new Date(1) },
      { id: 't_pending', workspaceId: 'ws_1', name: 'draft', language: 'en', status: 'PENDING', category: 'UTILITY', components: [], createdAt: new Date(1) },
      { id: 't_other_ws', workspaceId: 'ws_2', name: 'theirs', language: 'en', status: 'APPROVED', category: 'UTILITY', components: [], createdAt: new Date(1) },
    ],
    contacts: [],
    conversations: [],
    messages: [],
  };
  ledger = { consumed: [], released: [] };
  metaCalls = [];
  metaFails = null;
  creditResult = { ok: true, source: 'WALLET', amount: 0.8 };
}
reset();

const matches = (row, where = {}) => Object.entries(where).every(([k, v]) => {
  if (k === 'OR') return v.some((w) => matches(row, w));
  if (v && typeof v === 'object' && 'not' in v) return row[k] !== v.not;
  return row[k] === v;
});
let seq = 0;

const prisma = {
  waNumber: { findFirst: async ({ where }) => db.waNumbers.find((r) => matches(r, where)) ?? null },
  template: {
    findFirst: async ({ where }) => db.templates.find((r) => matches(r, where)) ?? null,
  },
  contact: {
    findFirst: async ({ where }) => db.contacts.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }) => db.contacts.find((r) => r.workspaceId === where.workspaceId_phoneNumber.workspaceId
      && r.phoneNumber === where.workspaceId_phoneNumber.phoneNumber) ?? null,
    create: async ({ data }) => { const row = { id: `c_${++seq}`, ...data }; db.contacts.push(row); return row; },
  },
  conversation: {
    findFirst: async ({ where }) => db.conversations.find((r) => matches(r, where)) ?? null,
    create: async ({ data }) => { const row = { id: `cv_${++seq}`, ...data }; db.conversations.push(row); return row; },
    update: async ({ where, data }) => Object.assign(db.conversations.find((r) => r.id === where.id), data),
  },
  message: {
    create: async ({ data }) => { const row = { id: `m_${++seq}`, ...data }; db.messages.push(row); return row; },
  },
};

mock.module('../lib/prisma.js', { namedExports: { prisma } });
mock.module('../lib/encryption.js', { namedExports: { decrypt: () => 'token', encrypt: (v) => v } });
mock.module('../lib/meta.js', {
  namedExports: {
    sendWhatsAppMessage: async (...args) => {
      metaCalls.push({ kind: 'template', args });
      if (metaFails) throw metaFails;
      return { messages: [{ id: `wamid.${metaCalls.length}` }] };
    },
    sendTextMessage: async (...args) => {
      metaCalls.push({ kind: 'text', args });
      if (metaFails) throw metaFails;
      return { messages: [{ id: `wamid.${metaCalls.length}` }] };
    },
  },
});
mock.module('./subscription.service.js', {
  namedExports: {
    consumeMessageCredit: async (workspaceId, opts) => { ledger.consumed.push({ workspaceId, ...opts }); return creditResult; },
    releaseMessageCredit: async (workspaceId, opts) => { ledger.released.push({ workspaceId, ...opts }); return { released: true }; },
  },
});
mock.module('./conversations.service.js', {
  namedExports: {
    describeSendFailure: (err) => { const e = new Error(`meta: ${err.message}`); e.status = 502; e.expose = true; return e; },
  },
});
mock.module('./optout.service.js', {
  namedExports: {
    normalizePhone: (raw) => String(raw ?? '').replace(/\D/g, ''),
    assertNotOptedOut: async () => {},
  },
});
mock.module('./templatePayload.service.js', {
  namedExports: {
    buildTemplateSendPayload: async (template, { resolve }) => ({
      name: template.name,
      language: { code: template.language },
      components: [{ type: 'body', parameters: [{ type: 'text', text: resolve(0) }] }],
    }),
  },
});

const { sendPublicMessage } = await import('./publicMessage.service.js');

const templateSend = (over = {}) => ({
  type: 'template', to: '+91 98765 43210', template: { name: 'promo', variables: ['Asha'] }, ...over,
});

test('template send claims a credit at the template category and records the message', async () => {
  reset();
  const out = await sendPublicMessage('ws_1', templateSend());

  assert.equal(ledger.consumed.length, 1);
  assert.equal(ledger.consumed[0].messageCategory, 'MARKETING');
  assert.equal(ledger.released.length, 0);

  assert.equal(metaCalls.length, 1);
  const [phoneNumberId, , to, payload] = metaCalls[0].args;
  assert.equal(phoneNumberId, 'PN_1');
  assert.equal(to, '919876543210');
  assert.equal(payload.name, 'promo');
  assert.equal(payload.components[0].parameters[0].text, 'Asha');

  assert.equal(db.contacts.length, 1);
  assert.equal(db.contacts[0].phoneNumber, '+919876543210');
  assert.equal(db.conversations.length, 1);
  assert.equal(db.messages.length, 1);
  assert.equal(db.messages[0].direction, 'OUTBOUND');
  assert.equal(db.messages[0].type, 'TEMPLATE');
  assert.equal(db.messages[0].metaMessageId, 'wamid.1');
  assert.equal(out.messageId, db.messages[0].id);
  assert.equal(out.messages[0].id, 'wamid.1');
});

test('a second send to the same number reuses the contact and conversation', async () => {
  reset();
  await sendPublicMessage('ws_1', templateSend());
  await sendPublicMessage('ws_1', templateSend({ to: '919876543210' }));
  assert.equal(db.contacts.length, 1);
  assert.equal(db.conversations.length, 1);
  assert.equal(db.messages.length, 2);
  assert.equal(ledger.consumed.length, 2);
});

test('Meta rejecting the send releases exactly the credit that was taken', async () => {
  reset();
  metaFails = new Error('boom');
  await assert.rejects(sendPublicMessage('ws_1', templateSend()), (err) => err.status === 502);
  assert.equal(ledger.released.length, 1);
  assert.equal(ledger.released[0].source, 'WALLET');
  assert.equal(ledger.released[0].amount, 0.8);
  assert.equal(db.messages.length, 0);
});

test('an exhausted quota and wallet refuses the send before Meta is called', async () => {
  reset();
  creditResult = { ok: false, code: 'QUOTA_AND_WALLET_EXHAUSTED' };
  await assert.rejects(sendPublicMessage('ws_1', templateSend()), (err) => err.status === 403 && err.code === 'QUOTA_AND_WALLET_EXHAUSTED');
  assert.equal(metaCalls.length, 0);
  assert.equal(db.messages.length, 0);
});

test('an inactive subscription refuses the send', async () => {
  reset();
  creditResult = { ok: false, code: 'SUBSCRIPTION_INACTIVE' };
  await assert.rejects(sendPublicMessage('ws_1', templateSend()), (err) => err.status === 403 && err.code === 'SUBSCRIPTION_INACTIVE');
  assert.equal(metaCalls.length, 0);
});

test('a template that is not APPROVED is refused without charging', async () => {
  reset();
  await assert.rejects(
    sendPublicMessage('ws_1', templateSend({ template: { name: 'draft' } })),
    (err) => err.status === 422 && err.code === 'TEMPLATE_NOT_SENDABLE',
  );
  assert.equal(ledger.consumed.length, 0);
  assert.equal(metaCalls.length, 0);
});

test('another workspace\'s template is not found', async () => {
  reset();
  await assert.rejects(
    sendPublicMessage('ws_1', templateSend({ template: { name: 'theirs' } })),
    (err) => err.status === 404,
  );
  assert.equal(ledger.consumed.length, 0);
});

test('missing template variables are a 422, not an empty parameter sent to Meta', async () => {
  reset();
  await assert.rejects(
    sendPublicMessage('ws_1', templateSend({ template: { name: 'promo' } })),
    (err) => err.status === 422 && err.code === 'TEMPLATE_VARIABLES_REQUIRED' && err.details.requiredVariables === 1,
  );
  assert.equal(ledger.consumed.length, 0);
});

test('text send is charged at the flat rate and recorded as TEXT', async () => {
  reset();
  await sendPublicMessage('ws_1', { type: 'text', to: '919876543210', body: 'hello' });
  assert.equal(ledger.consumed.length, 1);
  assert.equal(ledger.consumed[0].messageCategory, null);
  assert.equal(metaCalls[0].kind, 'text');
  assert.equal(db.messages[0].type, 'TEXT');
  assert.equal(db.messages[0].body, 'hello');
});

test('a failure to record an accepted send does not fail the request', async () => {
  reset();
  const original = prisma.message.create;
  prisma.message.create = async () => { throw new Error('db down'); };
  const errors = mock.method(console, 'error', () => {});
  try {
    const out = await sendPublicMessage('ws_1', templateSend());
    assert.equal(out.messageId, null);
    assert.equal(ledger.released.length, 0, 'the message went out, so the credit stays spent');
  } finally {
    prisma.message.create = original;
    errors.mock.restore();
  }
});

test('an unknown waNumberId is a 404', async () => {
  reset();
  await assert.rejects(sendPublicMessage('ws_1', templateSend({ waNumberId: 'nope' })), (err) => err.status === 404);
  assert.equal(ledger.consumed.length, 0);
});
