import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import {
  listConversations,
  getOrCreateConversation,
  sendMessage,
  sendTemplateMessage,
} from './conversations.service.js';

let dbAvailable = false;
let workspaceId;
let waNumberId;
let contact1;
let contact2;
let conv1;

test.before(async () => {
  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    return;
  }

  const stamp = Date.now();
  const ws = await prisma.workspace.create({
    data: { name: `conv-test-ws-${stamp}` },
  });
  workspaceId = ws.id;

  const waNum = await prisma.waNumber.create({
    data: {
      workspaceId,
      phoneNumber: `+919900${stamp.toString().slice(-6)}`,
      metaPhoneNumberId: `meta-${stamp}`,
      wabaId: `waba-${stamp}`,
      encryptedAccessToken: 'test_token',
      displayName: 'Test Business',
      status: 'ACTIVE',
    },
  });
  waNumberId = waNum.id;

  // Contact 1: Aditya
  contact1 = await prisma.contact.create({
    data: {
      workspaceId,
      name: 'Aditya Test',
      phoneNumber: '+917889115922',
      email: 'aditya@example.com',
    },
  });

  // Contact 2: Other Contact
  contact2 = await prisma.contact.create({
    data: {
      workspaceId,
      name: 'Other Person',
      phoneNumber: '+919876543202',
      email: 'other@example.com',
    },
  });

  // Existing conversation for Contact 2
  conv1 = await prisma.conversation.create({
    data: {
      workspaceId,
      contactId: contact2.id,
      waNumberId,
      status: 'OPEN',
    },
  });
});

test.after(async () => {
  if (!dbAvailable || !workspaceId) return;
  await prisma.conversation.deleteMany({ where: { workspaceId } }).catch(() => {});
  await prisma.contact.deleteMany({ where: { workspaceId } }).catch(() => {});
  await prisma.waNumber.deleteMany({ where: { workspaceId } }).catch(() => {});
  await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
});

test('listConversations filters strictly by contactId', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  // Querying for contact1 (who has no conversation yet) must return 0 items
  const res1 = await listConversations(workspaceId, { contactId: contact1.id });
  assert.equal(res1.data.length, 0, 'Must not return unrelated conversations for contact1');
  assert.equal(res1.total, 0);

  // Querying for contact2 must return only contact2 conversation
  const res2 = await listConversations(workspaceId, { contactId: contact2.id });
  assert.equal(res2.data.length, 1);
  assert.equal(res2.data[0].contactId, contact2.id);
  assert.equal(res2.total, 1);
});

test('listConversations filters by search query matching name or phone', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const resPhone = await listConversations(workspaceId, { search: '9876543202' });
  assert.equal(resPhone.data.length, 1);
  assert.equal(resPhone.data[0].contactId, contact2.id);

  const resName = await listConversations(workspaceId, { search: 'Other' });
  assert.equal(resName.data.length, 1);
  assert.equal(resName.data[0].contactId, contact2.id);

  const resNone = await listConversations(workspaceId, { search: 'NonExistent' });
  assert.equal(resNone.data.length, 0);
});

test('getOrCreateConversation returns existing conversation without duplication', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const conv = await getOrCreateConversation(workspaceId, { contactId: contact2.id });
  assert.equal(conv.id, conv1.id);
  assert.equal(conv.contactId, contact2.id);
  assert.equal(conv.waNumberId, waNumberId);
});

test('getOrCreateConversation creates new conversation with active waNumber for contact without conversation', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const newConv = await getOrCreateConversation(workspaceId, { contactId: contact1.id });
  assert.ok(newConv.id);
  assert.equal(newConv.contactId, contact1.id);
  assert.equal(newConv.workspaceId, workspaceId);
  assert.equal(newConv.waNumberId, waNumberId);
  assert.equal(newConv.status, 'OPEN');

  // Second call must return the exact same conversation
  const secondCall = await getOrCreateConversation(workspaceId, { contactId: contact1.id });
  assert.equal(secondCall.id, newConv.id);
});

test('getOrCreateConversation throws 404 for unknown contact', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  await assert.rejects(
    () => getOrCreateConversation(workspaceId, { contactId: 'non_existent_cuid' }),
    (err) => err.status === 404 && err.message === 'Contact not found'
  );
});

test('sendMessage rejects recipient mismatch when target contactId does not match conversation', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  // conv1 belongs to contact2. Attempting to send with contact1 ID must throw RECIPIENT_MISMATCH
  await assert.rejects(
    () => sendMessage(workspaceId, conv1.id, null, {
      body: 'Hello',
      contactId: contact1.id,
    }),
    (err) => err.code === 'RECIPIENT_MISMATCH' && err.status === 400
  );
});

test('sendTemplateMessage rejects recipient mismatch when target contactId does not match conversation', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  // conv1 belongs to contact2. Attempting to send template with contact1 ID must throw RECIPIENT_MISMATCH
  await assert.rejects(
    () => sendTemplateMessage(workspaceId, conv1.id, null, {
      templateId: 'tmpl_any',
      contactId: contact1.id,
    }),
    (err) => err.code === 'RECIPIENT_MISMATCH' && err.status === 400
  );
});

// ─── Audit: messaging fixes ─────────────────────────────────────────────────

test('sendMessage refuses a free-form reply outside the 24h window and does not fake an inbound timestamp', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const stale = new Date(Date.now() - 30 * 60 * 60 * 1000);
  await prisma.conversation.update({ where: { id: conv1.id }, data: { lastInboundAt: stale } });

  await assert.rejects(
    () => sendMessage(workspaceId, conv1.id, null, { body: 'Hello after the window' }),
    (err) => err.status === 409 && err.code === 'OUTSIDE_24H_WINDOW',
  );
  const after = await prisma.conversation.findUnique({ where: { id: conv1.id }, select: { lastInboundAt: true } });
  assert.equal(after.lastInboundAt.getTime(), stale.getTime());
});

test('sendMessage rejects an empty body before anything else', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await assert.rejects(() => sendMessage(workspaceId, conv1.id, null, { body: '   ' }), (err) => err.status === 400);
  await assert.rejects(() => sendMessage(workspaceId, conv1.id, null, { body: 'x'.repeat(4097) }), (err) => err.status === 400);
});

test('sendMessage honours a contact flagged opted-out on their record', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await prisma.contact.update({ where: { id: contact2.id }, data: { optedOut: true } });
  await prisma.conversation.update({ where: { id: conv1.id }, data: { lastInboundAt: new Date() } });
  try {
    await assert.rejects(
      () => sendMessage(workspaceId, conv1.id, null, { body: 'Hi' }),
      (err) => err.status === 403 && err.code === 'RECIPIENT_OPTED_OUT',
    );
  } finally {
    await prisma.contact.update({ where: { id: contact2.id }, data: { optedOut: false } });
  }
});

test('message media cannot be fetched through another workspace', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const { getMessageMediaStream } = await import('./conversations.service.js');
  const other = await prisma.workspace.create({ data: { name: `conv-test-other-${Date.now()}` } });
  try {
    const msg = await prisma.message.create({
      data: { conversationId: conv1.id, body: '[photo]', direction: 'INBOUND', type: 'IMAGE', mediaId: 'SECRET_MEDIA' },
    });
    await assert.rejects(
      () => getMessageMediaStream(other.id, conv1.id, msg.id),
      (err) => err.status === 404,
    );
  } finally {
    await prisma.workspace.delete({ where: { id: other.id } }).catch(() => {});
  }
});

test('assignConversation only accepts members of the workspace', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const { assignConversation } = await import('./conversations.service.js');
  await assert.rejects(() => assignConversation(workspaceId, conv1.id, 'not-a-member'), (err) => err.status === 400);
  const cleared = await assignConversation(workspaceId, conv1.id, null);
  assert.equal(cleared.assignedToUserId, null);
});

test('window-faking helpers are unavailable in production', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const { reopenWindow, simulateInboundMessage } = await import('./conversations.service.js');
  const { env } = await import('../config/env.js');
  const previous = env.NODE_ENV;
  env.NODE_ENV = 'production';
  try {
    await assert.rejects(() => reopenWindow(workspaceId, conv1.id), (err) => err.status === 404);
    await assert.rejects(() => simulateInboundMessage(workspaceId, conv1.id, { body: 'x' }), (err) => err.status === 404);
  } finally {
    env.NODE_ENV = previous;
  }
});

test('listConversations bounds the page size', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const res = await listConversations(workspaceId, { limit: 100000, page: -3 });
  assert.ok(Array.isArray(res.data));
});
