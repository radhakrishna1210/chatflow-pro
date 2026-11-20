// The real WhatsApp send functions, with only the HTTP client replaced.
//
// Every other test stubs lib/meta.js as a whole, so nothing ran these bodies:
// when the recipient helper was renamed, the form-screen and order-button
// sends kept calling the old name and threw at the first real message. This
// runs each send far enough to build its request.
import { test, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const posts = [];

let meta;
before(async () => {
  const client = { post: async (url, body) => { posts.push({ url, body }); return { data: { messages: [{ id: 'wamid.1' }] } }; } };
  mock.module('axios', { defaultExport: { create: () => client, post: client.post, get: async () => ({ data: {} }) } });
  meta = await import('./meta.js');
});

beforeEach(() => { posts.length = 0; });

const TO = '+91 92263 81481';
const last = () => posts.at(-1);

test('order buttons go out with the caller\'s ids and a digits-only recipient', async () => {
  await meta.sendReplyButtons('pn1', 'token', TO, {
    body: 'New order #1',
    buttons: [{ id: 'ord:o1:ok', title: 'Available' }, { id: 'ord:o1:change', title: 'Edit quantities' }, { id: 'ord:o1:cancel', title: 'Cancel order' }],
  });
  assert.equal(last().url, '/pn1/messages');
  assert.equal(last().body.to, '919226381481');
  assert.equal(last().body.interactive.type, 'button');
  assert.deepEqual(last().body.interactive.action.buttons.map((b) => b.reply), [
    { id: 'ord:o1:ok', title: 'Available' }, { id: 'ord:o1:change', title: 'Edit quantities' }, { id: 'ord:o1:cancel', title: 'Cancel order' },
  ]);
  await assert.rejects(meta.sendReplyButtons('pn1', 'token', TO, { body: 'x', buttons: [] }), /at least one button/);
});

test('the form screen goes out as a flow message', async () => {
  await meta.sendFlowMessage('pn1', 'token', TO, { body: 'Mushroom Order', cta: 'Open form', flowId: 'flow1', flowToken: 's1.abc', screen: 'FORM' });
  assert.equal(last().body.to, '919226381481');
  assert.equal(last().body.interactive.type, 'flow');
  assert.deepEqual(last().body.interactive.action.parameters, {
    flow_message_version: '3', flow_token: 's1.abc', flow_id: 'flow1', flow_cta: 'Open form',
    flow_action: 'navigate', flow_action_payload: { screen: 'FORM' },
  });
});

test('every other send builds its request too', async () => {
  await meta.sendTextMessage('pn1', 'token', TO, 'hello');
  assert.equal(last().body.to, '919226381481');

  await meta.sendButtonMessage('pn1', 'token', TO, { body: 'Pick', buttons: ['Place order', 'Know more'] });
  assert.deepEqual(last().body.interactive.action.buttons.map((b) => b.reply.title), ['Place order', 'Know more']);

  await meta.sendListMessage('pn1', 'token', TO, { body: 'Pick', rows: ['A', 'B', 'C', 'D'] });
  assert.equal(last().body.interactive.type, 'list');

  await meta.sendMediaMessage('pn1', 'token', TO, { mediaId: 'm1', type: 'image', caption: 'Scan to pay' });
  assert.deepEqual(last().body.image, { id: 'm1', caption: 'Scan to pay' });

  await meta.sendWhatsAppMessage('pn1', 'token', TO, { name: 'order_update', language: { code: 'en' } });
  assert.equal(last().body.to, '919226381481');
  assert.equal(posts.length, 5);
});
