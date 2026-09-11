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
