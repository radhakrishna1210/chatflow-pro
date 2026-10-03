import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// sendTemplateMessage — the path a workflow "template" step and the inbox use.
//  - WF-EN-6: the credit taken before building the payload is handed back
//    when building throws (media gone, validation, header upload refused).
//  - WF-EN-5: an automated send (strictVariables) never fills {{2}}+ with the
//    template's approval samples; it is refused before any credit is taken.
//    The inbox path keeps its sample fallback (its picker supplies no values).
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';

const consumed = [];
const released = [];
const noop = async () => {};
mock.module('./subscription.service.js', {
  namedExports: {
    consumeMessageCredit: async (ws, opts) => { consumed.push(opts); return { ok: true, source: 'WALLET', amount: 0.86 }; },
    releaseMessageCredit: async (ws, opts) => { released.push(opts); },
    getActiveSubscription: noop, assertWithinLimit: noop, assertContactCapacity: noop, hasContactCapacity: noop,
    hasFeature: noop, getPlanLimits: noop, listPlans: noop, createCheckoutOrder: noop, verifyCheckoutPayment: noop,
    applyCheckoutPayment: noop, renewalCharge: () => null, scheduleSubscriptionChange: noop, retryPastDueRenewal: noop,
    renewSubscriptionNow: noop, runBillingCycleSweep: noop,
  },
});
let buildThrows = null;
const resolved = [];
mock.module('./templatePayload.service.js', {
  namedExports: {
    validateCarouselTemplate: () => {},
    validateCatalogTemplate: () => {},
    buildTemplateSendPayload: async (template, { resolve }) => {
      if (buildThrows) throw buildThrows;
      resolved.push([0, 1, 2].map((i) => resolve(i, template.components[1])));
      return { name: template.name, language: { code: 'en' } };
    },
  },
});
const metaSends = [];
const realMeta = await import('../lib/meta.js');
mock.module('../lib/meta.js', {
  namedExports: {
    ...realMeta,
    sendWhatsAppMessage: async (...args) => { metaSends.push(args); return { messages: [{ id: 'wamid.T' }] }; },
  },
});

const { prisma } = await import('../lib/prisma.js');
const { encrypt } = await import('../lib/encryption.js');
const { sendTemplateMessage } = await import('./conversations.service.js');

const contact = { id: 'ct_1', name: 'Asha', phoneNumber: '+919800000000', optedOut: false };
prisma.conversation.findFirst = async () => ({
  id: 'conv_1', workspaceId: 'ws', contactId: 'ct_1', channel: 'WHATSAPP', contact,
  waNumber: { id: 'wa_1', metaPhoneNumberId: 'pn', encryptedAccessToken: encrypt('tok') },
});
prisma.conversation.update = async () => ({});
prisma.message.create = async ({ data }) => ({ id: 'm1', ...data });
prisma.optOut.findUnique = async () => null;
prisma.contact.findFirst = async () => null;
prisma.template.findFirst = async () => ({
  id: 'tpl_1', workspaceId: 'ws', name: 'order_update', status: 'APPROVED', category: 'UTILITY', language: 'en',
  components: [
    { type: 'HEADER', format: 'IMAGE' },
    { type: 'BODY', text: 'Hi {{1}}, order {{2}} ships on {{3}}', example: { body_text: [['John', 'ORD-12345', '12 Jan']] } },
  ],
});

const reset = () => { consumed.length = 0; released.length = 0; resolved.length = 0; metaSends.length = 0; buildThrows = null; };
const send = (opts = {}) => sendTemplateMessage('ws', 'conv_1', null, { templateId: 'tpl_1', contactId: 'ct_1', phoneNumber: contact.phoneNumber, ...opts });

test('WF-EN-6: a send that fails while building its payload hands the credit back', async () => {
  reset();
  buildThrows = Object.assign(new Error('The media for this template is not available in this workspace'), { status: 422, code: 'TEMPLATE_MEDIA_UNAVAILABLE' });
  await assert.rejects(send({ variables: ['a', 'b', 'c'] }), /not available/);
  assert.equal(consumed.length, 1);
  assert.equal(released.length, 1, 'credit (wallet money at the template rate) was taken for a message that never left');
  assert.deepEqual([released[0].source, released[0].amount], ['WALLET', 0.86]);
  assert.equal(metaSends.length, 0);
});

test('WF-EN-5: an automated send missing {{2}}+ is refused before any credit is taken', async () => {
  reset();
  await assert.rejects(send({ variables: ['Asha'], strictVariables: true }), (err) => {
    assert.equal(err.status, 422);
    assert.equal(err.code, 'TEMPLATE_VARIABLES_MISSING');
    assert.match(err.message, /\{\{2\}\}, \{\{3\}\}/);
    return true;
  });
  assert.equal(consumed.length, 0);
  assert.equal(metaSends.length, 0);
});

test('WF-EN-5: an automated send with every value sends exactly those values — never a sample', async () => {
  reset();
  await send({ variables: ['Asha', 'ORD-991', '3 Oct'], strictVariables: true });
  assert.deepEqual(resolved[0], ['Asha', 'ORD-991', '3 Oct']);
  assert.equal(metaSends.length, 1);
  assert.equal(released.length, 0);
});

test('the inbox path (no values supplied) keeps its name + sample fallback', async () => {
  reset();
  await send();
  assert.deepEqual(resolved[0], ['Asha', 'ORD-12345', '12 Jan']);
});
