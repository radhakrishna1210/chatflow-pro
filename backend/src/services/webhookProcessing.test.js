import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { processWebhook } from './webhook.service.js';

// End-to-end through processWebhook against the real database: the inbound
// handler, its idempotency, the 24h window bookkeeping and template status
// updates. Automation is left off on the workspace, so nothing tries to reply.

let dbAvailable = false;
let workspaceId;
let waNumber;
const stamp = Date.now();
const PNID = `wh-test-pnid-${stamp}`;
const WABA = `wh-test-waba-${stamp}`;

test.before(async () => {
  try { await prisma.$connect(); dbAvailable = true; } catch { return; }
  const ws = await prisma.workspace.create({ data: { name: `wh-test-${stamp}` } });
  workspaceId = ws.id;
  waNumber = await prisma.waNumber.create({
    data: { workspaceId, phoneNumber: '+919000000001', metaPhoneNumberId: PNID, wabaId: WABA, encryptedAccessToken: 'x' },
  });
});

test.after(async () => {
  if (!dbAvailable || !workspaceId) return;
  await prisma.template.deleteMany({ where: { workspaceId } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { workspaceId } }).catch(() => {});
  await prisma.contact.deleteMany({ where: { workspaceId } }).catch(() => {});
  await prisma.waNumber.deleteMany({ where: { workspaceId } }).catch(() => {});
  await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
});

const delivery = (messages, from = '919811100011') => ({
  entry: [{
    id: WABA,
    changes: [{
      field: 'messages',
      value: {
        metadata: { phone_number_id: PNID },
        contacts: [{ profile: { name: 'Webhook Test' }, wa_id: from }],
        messages,
      },
    }],
  }],
});
const ts = (msAgo = 0) => String(Math.floor((Date.now() - msAgo) / 1000));

test('inbound media is stored with its attachment fields', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const id = `wamid.media.${stamp}`;
  await processWebhook(delivery([{ from: '919811100011', id, timestamp: ts(), type: 'image', image: { id: 'MID1', mime_type: 'image/jpeg', sha256: 'abc' } }]));
  const row = await prisma.message.findUnique({ where: { metaMessageId: id } });
  assert.ok(row, 'image message was dropped');
  assert.equal(row.type, 'IMAGE');
  assert.equal(row.mediaId, 'MID1');
  assert.equal(row.body, '[photo]');
});

test('a redelivered message is stored once', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const id = `wamid.dup.${stamp}`;
  const msg = { from: '919811100011', id, timestamp: ts(), type: 'text', text: { body: 'once only' } };
  await processWebhook(delivery([msg]));
  await processWebhook(delivery([msg]));
  assert.equal(await prisma.message.count({ where: { metaMessageId: id } }), 1);
});

test('one bad message does not drop the rest of the delivery', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const good = `wamid.good.${stamp}`;
  await processWebhook(delivery([
    // No sender: the contact write fails for this one.
    { id: `wamid.bad.${stamp}`, timestamp: ts(), type: 'text', text: { body: 'broken' } },
    { from: '919811100011', id: good, timestamp: ts(), type: 'text', text: { body: 'still here' } },
  ]));
  assert.ok(await prisma.message.findUnique({ where: { metaMessageId: good } }));
});

test('a late, older message never moves the 24h window backwards', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const from = '919811100022';
  await processWebhook(delivery([{ from, id: `wamid.new.${stamp}`, timestamp: ts(), type: 'text', text: { body: 'newest' } }], from));
  const conv = await prisma.conversation.findFirst({ where: { workspaceId, contact: { phoneNumber: from } } });
  const before = conv.lastInboundAt.getTime();

  await processWebhook(delivery([{ from, id: `wamid.old.${stamp}`, timestamp: ts(30 * 60 * 60 * 1000), type: 'text', text: { body: 'delayed' } }], from));
  const after = await prisma.conversation.findUnique({ where: { id: conv.id } });
  assert.equal(after.lastInboundAt.getTime(), before);
});

test('a customer writing to a resolved thread reopens it', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const from = '919811100033';
  await processWebhook(delivery([{ from, id: `wamid.r1.${stamp}`, timestamp: ts(), type: 'text', text: { body: 'first' } }], from));
  const conv = await prisma.conversation.findFirst({ where: { workspaceId, contact: { phoneNumber: from } } });
  await prisma.conversation.update({ where: { id: conv.id }, data: { status: 'RESOLVED' } });
  await processWebhook(delivery([{ from, id: `wamid.r2.${stamp}`, timestamp: ts(), type: 'text', text: { body: 'again' } }], from));
  const after = await prisma.conversation.findUnique({ where: { id: conv.id } });
  assert.equal(after.status, 'OPEN');
});

test('template rejection stores the reason, and a deleted template stays deleted', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const live = await prisma.template.create({
    data: { workspaceId, waNumberId: waNumber.id, name: `t_live_${stamp}`, category: 'UTILITY', language: 'en', components: [], status: 'PENDING', metaTemplateId: `mt-live-${stamp}` },
  });
  const gone = await prisma.template.create({
    data: { workspaceId, waNumberId: waNumber.id, name: `t_gone_${stamp}`, category: 'UTILITY', language: 'en', components: [], status: 'DELETED', metaTemplateId: `mt-gone-${stamp}` },
  });
  const update = (id, name, event, reason) => ({
    entry: [{ id: WABA, changes: [{ field: 'message_template_status_update', value: { message_template_id: id, message_template_name: name, message_template_language: 'en', event, reason } }] }],
  });

  await processWebhook(update(live.metaTemplateId, live.name, 'REJECTED', 'INCORRECT_CATEGORY'));
  let row = await prisma.template.findUnique({ where: { id: live.id } });
  assert.equal(row.status, 'REJECTED');
  assert.equal(row.rejectedReason, 'INCORRECT_CATEGORY');

  await processWebhook(update(live.metaTemplateId, live.name, 'APPROVED', 'NONE'));
  row = await prisma.template.findUnique({ where: { id: live.id } });
  assert.equal(row.status, 'APPROVED');
  assert.equal(row.rejectedReason, null);

  await processWebhook(update(gone.metaTemplateId, gone.name, 'APPROVED', 'NONE'));
  row = await prisma.template.findUnique({ where: { id: gone.id } });
  assert.equal(row.status, 'DELETED');
});

test('statuses arriving out of order never move a message backwards', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const conv = await prisma.conversation.findFirst({ where: { workspaceId } });
  const wamid = `wamid.out.${stamp}`;
  await prisma.message.create({ data: { conversationId: conv.id, body: 'hi', direction: 'OUTBOUND', metaMessageId: wamid, status: 'SENT' } });
  const statuses = (status) => ({ entry: [{ id: WABA, changes: [{ field: 'messages', value: { metadata: { phone_number_id: PNID }, statuses: [{ id: wamid, status, timestamp: ts() }] } }] }] });
  await processWebhook(statuses('read'));
  await processWebhook(statuses('delivered'));
  const row = await prisma.message.findUnique({ where: { metaMessageId: wamid } });
  assert.equal(row.status, 'READ');
});

test('a contact imported as a national number is matched, not duplicated', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const existing = await prisma.contact.create({ data: { workspaceId, name: 'Imported', phoneNumber: '09811100044' } });
  await processWebhook(delivery([{ from: '919811100044', id: `wamid.nat.${stamp}`, timestamp: ts(), type: 'text', text: { body: 'hello' } }], '919811100044'));
  const count = await prisma.contact.count({ where: { workspaceId, phoneNumber: { contains: '9811100044' } } });
  assert.equal(count, 1);
  const conv = await prisma.conversation.findFirst({ where: { workspaceId, contactId: existing.id } });
  assert.ok(conv, 'message went to a new duplicate contact');
});
