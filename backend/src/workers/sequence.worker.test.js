import test from 'node:test';
import assert from 'node:assert/strict';

// A sequence MESSAGE step used to call Meta directly, swallow any failure, and
// record the message as DELIVERED and the step as SENT. It now goes through
// the shared automated-reply path and fails the step when nothing was sent.

const { prisma } = await import('../lib/prisma.js');
const { sendSequenceMessage } = await import('./sequence.worker.js');

const enrollment = { id: 'enr_1', workspaceId: 'ws_seq', contactId: 'ct_seq' };
const created = [];
prisma.contact.findFirst = async ({ where }) => (where.workspaceId === 'ws_seq'
  ? { id: 'ct_seq', phoneNumber: '+919800000001', optedOut: false } : null);
prisma.conversation.findFirst = async () => ({ id: 'conv_seq', waNumberId: 'wa_seq' });
prisma.message.create = async (args) => { created.push(args); return args.data; };

test('a send that Meta did not accept fails the step instead of recording a delivery', async () => {
  created.length = 0;
  await assert.rejects(
    sendSequenceMessage({ enrollment, body: 'Hi' }, { sendReply: async () => null }),
    /not sent/,
  );
  assert.equal(created.length, 0, 'no OUTBOUND row was written for a message that never left');
});

test('a sent message reports the Meta id', async () => {
  const calls = [];
  const detail = await sendSequenceMessage({ enrollment, body: 'Hi there' }, {
    sendReply: async (args) => { calls.push(args); return { id: 'm1', metaMessageId: 'wamid.X' }; },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].conversationId, 'conv_seq');
  assert.equal(calls[0].waNumberId, 'wa_seq');
  assert.equal(calls[0].body, 'Hi there');
  assert.match(detail, /wamid\.X/);
});

test('a contact from another workspace is never messaged', async () => {
  await assert.rejects(
    sendSequenceMessage({ enrollment: { ...enrollment, workspaceId: 'ws_other' }, body: 'Hi' }, { sendReply: async () => ({}) }),
    /no longer exists/,
  );
});
