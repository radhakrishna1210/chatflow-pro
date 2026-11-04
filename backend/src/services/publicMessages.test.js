// POST /public/messages goes through the inbox send path: window, opt-out,
// approved templates, required variables, credit and the conversation record.
// Meta, token decryption and billing are faked; the database is real.
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';

const sends = [];
const credits = { consumed: 0, released: 0 };
let prisma; let sendPublicMessage; let resolveRecipient;
let dbAvailable = false;
let workspaceId; let waNumber;
const stamp = Date.now();
const tail = String(stamp).slice(-8);

before(async () => {
  const realMeta = await import('../lib/meta.js');
  resolveRecipient = realMeta.resolveRecipient;
  const fakeSend = (kind) => async (phoneNumberId, token, to, payload) => {
    sends.push({ kind, to, payload });
    return { messages: [{ id: `wamid.${stamp}.${sends.length}` }] };
  };
  mock.module('../lib/meta.js', {
    namedExports: { ...realMeta, sendTextMessage: fakeSend('text'), sendWhatsAppMessage: fakeSend('template') },
  });
  mock.module('../lib/encryption.js', { namedExports: { decrypt: () => 'token', encrypt: (v) => v } });
  const realSub = await import('./subscription.service.js');
  mock.module('./subscription.service.js', {
    namedExports: {
      ...realSub,
      consumeMessageCredit: async () => { credits.consumed += 1; return { ok: true, source: 'quota' }; },
      releaseMessageCredit: async () => { credits.released += 1; },
      assertWithinLimit: async () => {},
    },
  });

  ({ prisma } = await import('../lib/prisma.js'));
  try { await prisma.$connect(); await prisma.$queryRaw`SELECT 1`; dbAvailable = true; } catch { return; }
  ({ sendPublicMessage } = await import('./whatsapp.service.js'));

  workspaceId = (await prisma.workspace.create({ data: { name: `public-api-${stamp}` } })).id;
  waNumber = await prisma.waNumber.create({
    data: {
      workspaceId, phoneNumber: `+9190${tail}`, metaPhoneNumberId: `pub-meta-${stamp}`,
      wabaId: `pub-waba-${stamp}`, encryptedAccessToken: 'x', status: 'ACTIVE',
    },
  });
  await prisma.template.createMany({
    data: [
      { workspaceId, waNumberId: waNumber.id, name: 'order_update', language: 'en', category: 'UTILITY', status: 'APPROVED',
        components: [{ type: 'BODY', text: 'Hi {{1}}, order {{2}} ships {{3}}', example: { body_text: [['Priya', 'A1', 'today']] } }] },
      { workspaceId, waNumberId: waNumber.id, name: 'draft_one', language: 'en', category: 'MARKETING', status: 'PENDING',
        components: [{ type: 'BODY', text: 'Hello' }] },
    ],
  });
});

after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
});

const skip = (t) => { if (!dbAvailable) { t.skip('database unavailable'); return true; } return false; };

test('free-form text to someone who never wrote is refused before charging or sending', async (t) => {
  if (skip(t)) return;
  const before = sends.length;
  await assert.rejects(
    sendPublicMessage(workspaceId, { to: `+9181${tail}`, type: 'text', body: 'hello' }),
    (err) => err.code === 'OUTSIDE_24H_WINDOW',
  );
  assert.equal(sends.length, before);
  assert.equal(credits.consumed, 0);
});

test('text inside the window is charged, sent and stored on the contact\'s conversation', async (t) => {
  if (skip(t)) return;
  const phone = `+9182${tail}`;
  const contact = await prisma.contact.create({ data: { workspaceId, name: 'Inside', phoneNumber: phone } });
  await prisma.conversation.create({ data: { workspaceId, contactId: contact.id, waNumberId: waNumber.id, lastInboundAt: new Date() } });

  const res = await sendPublicMessage(workspaceId, { to: phone.replace('+', ''), type: 'text', body: 'Your order shipped' });
  assert.equal(credits.consumed, 1);
  assert.equal(res.contactId, contact.id, 'matched the existing contact, no duplicate');
  assert.ok(res.messages[0].id.startsWith('wamid.'));
  const stored = await prisma.message.findUnique({ where: { id: res.id } });
  assert.equal(stored.body, 'Your order shipped');
  assert.equal(stored.direction, 'OUTBOUND');
  assert.equal(stored.conversationId, res.conversationId);
});

test('only approved templates, and every {{2}}+ must have a value', async (t) => {
  if (skip(t)) return;
  const to = `+9183${tail}`;
  await assert.rejects(
    sendPublicMessage(workspaceId, { to, type: 'template', template: { name: 'draft_one', language: { code: 'en' } } }),
    (err) => err.code === 'TEMPLATE_NOT_SENDABLE',
  );
  await assert.rejects(
    sendPublicMessage(workspaceId, { to, type: 'template', template: { name: 'nope', language: { code: 'en' } } }),
    (err) => err.status === 404,
  );
  const consumedBefore = credits.consumed;
  await assert.rejects(
    sendPublicMessage(workspaceId, { to, type: 'template', template: { name: 'order_update', language: { code: 'en' }, variables: ['Asha', 'A9'] } }),
    (err) => err.code === 'TEMPLATE_VARIABLES_REQUIRED' && /\{\{3\}\}/.test(err.message),
  );
  assert.equal(credits.consumed, consumedBefore, 'nothing charged for a refused template');

  // {{1}} may be left empty: it falls back to the contact's name ("there" when none).
  const res = await sendPublicMessage(workspaceId, {
    to, type: 'template', template: { name: 'order_update', language: { code: 'en' }, variables: ['', 'A9', 'tomorrow'] },
  });
  assert.equal(credits.consumed, consumedBefore + 1);
  const sent = sends.at(-1);
  const params = sent.payload.components.find((c) => c.type === 'body').parameters.map((p) => p.text);
  assert.deepEqual(params.slice(1), ['A9', 'tomorrow']);
  assert.ok(!params.includes(''));
  const stored = await prisma.message.findUnique({ where: { id: res.id } });
  assert.equal(stored.type, 'TEMPLATE');
});

test('Meta-style components are accepted in place of variables', async (t) => {
  if (skip(t)) return;
  const res = await sendPublicMessage(workspaceId, {
    to: `+9184${tail}`, type: 'template',
    template: { name: 'order_update', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ravi' }, { type: 'text', text: 'B2' }, { type: 'text', text: 'Friday' }] }] },
  });
  assert.ok(res.id);
  const params = sends.at(-1).payload.components.find((c) => c.type === 'body').parameters.map((p) => p.text);
  assert.deepEqual(params, ['Ravi', 'B2', 'Friday']);
});

test('opted-out recipients are refused', async (t) => {
  if (skip(t)) return;
  const phone = `+9185${tail}`;
  await prisma.contact.create({ data: { workspaceId, name: 'Stopped', phoneNumber: phone, optedOut: true } });
  await assert.rejects(
    sendPublicMessage(workspaceId, { to: phone, type: 'template', template: { name: 'order_update', language: { code: 'en' }, variables: ['a', 'b', 'c'] } }),
    (err) => err.status === 403,
  );
});

test('a national-format number is sent with the sending number\'s country code', async (t) => {
  if (skip(t)) return;
  assert.equal(await resolveRecipient(waNumber.metaPhoneNumberId, '98765 43210'), '919876543210');
  assert.equal(await resolveRecipient(waNumber.metaPhoneNumberId, '+44 7700 900123'), '447700900123');
  assert.equal(await resolveRecipient(waNumber.metaPhoneNumberId, '919876543210'), '919876543210');
  // The public API normalises the same way before matching/creating the contact.
  const res = await sendPublicMessage(workspaceId, { to: `86${tail}`, type: 'template', template: { name: 'order_update', language: { code: 'en' }, variables: ['a', 'b', 'c'] } });
  assert.equal(res.to, `9186${tail}`);
});
