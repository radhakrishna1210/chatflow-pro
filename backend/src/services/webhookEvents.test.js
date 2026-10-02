import test from 'node:test';
import assert from 'node:assert/strict';
import { splitWebhook } from './webhookEvents.js';

const body = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'waba_1',
    changes: [
      {
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: 'PN_1' },
          contacts: [{ wa_id: '911', profile: { name: 'One' } }, { wa_id: '922', profile: { name: 'Two' } }],
          messages: [
            { from: '911', id: 'wamid.A', type: 'text', text: { body: 'hi' } },
            { from: '922', id: 'wamid.B', type: 'text', text: { body: 'hello' } },
            { from: '911', id: 'wamid.C', type: 'text', text: { body: 'again' } },
          ],
          statuses: [{ id: 'wamid.OUT', status: 'delivered', recipient_id: '922' }],
        },
      },
      { field: 'message_template_status_update', value: { event: 'APPROVED', message_template_id: 7 } },
    ],
  }],
};

test('each message, status and template event becomes its own unit', () => {
  const units = splitWebhook(body);
  assert.equal(units.length, 5);
  for (const u of units) {
    assert.equal(u.payload.entry.length, 1);
    assert.equal(u.payload.entry[0].changes.length, 1);
  }
});

test('one customer\'s events share a key; different customers do not', () => {
  const [a, b, c, status] = splitWebhook(body);
  assert.equal(a.key, c.key);
  assert.notEqual(a.key, b.key);
  assert.equal(status.key, b.key);
});

test('a message unit carries only its own message and the sender\'s profile', () => {
  const [, b] = splitWebhook(body);
  const value = b.payload.entry[0].changes[0].value;
  assert.deepEqual(value.messages.map((m) => m.id), ['wamid.B']);
  assert.equal(value.contacts[0].profile.name, 'Two');
  assert.equal(value.metadata.phone_number_id, 'PN_1');
  assert.equal(value.statuses, undefined);
});

test('job ids are stable across redelivery and contain no colon', () => {
  const first = splitWebhook(body).map((u) => u.jobId);
  const again = splitWebhook(structuredClone(body)).map((u) => u.jobId);
  assert.deepEqual(first, again);
  assert.equal(first[0], 'in__wamid.A');
  assert.equal(first[3], 'st__wamid.OUT__delivered');
  assert.equal(first[4], null);
  const odd = splitWebhook({ entry: [{ id: 'w', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'P' }, messages: [{ from: '1', id: 'wamid:x' }] } }] }] });
  assert.ok(!odd[0].jobId.includes(':'));
});

test('an empty or malformed body yields nothing', () => {
  assert.deepEqual(splitWebhook(null), []);
  assert.deepEqual(splitWebhook({ entry: [{ changes: [{ field: 'messages' }] }] }), []);
});
