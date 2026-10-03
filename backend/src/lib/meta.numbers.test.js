import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// CF-082: a Meta failure while listing a WABA's numbers used to be swallowed
// into an empty list, so connecting a number reported "it has no phone numbers
// yet" during a Meta outage or permission error. It now surfaces the real cause.

let reply;
const fakeClient = { get: async () => reply(), post: async () => ({ data: {} }) };
mock.module('axios', { defaultExport: { create: () => fakeClient, isAxiosError: () => true } });

const { assertNumberOnWaba } = await import('./meta.js');

test('a Meta error while listing numbers is reported, not read as "no numbers"', async () => {
  reply = () => {
    const err = new Error('Request failed with status code 403');
    err.isAxiosError = true;
    err.response = { status: 403, data: { error: { message: 'Missing permission', code: 200 } } };
    throw err;
  };
  await assert.rejects(
    () => assertNumberOnWaba('waba_1', 'pn_1', 'tok'),
    (e) => e.status === 403 && e.expose === true && /permission/i.test(e.message) && !/no phone numbers/.test(e.message),
  );
});

test('a WABA that really has no numbers still says so', async () => {
  reply = () => ({ data: { data: [] } });
  await assert.rejects(() => assertNumberOnWaba('waba_1', 'pn_1', 'tok'), /no phone numbers yet/);
});

test('a number on the WABA is returned', async () => {
  reply = () => ({ data: { data: [{ id: 'pn_1', display_phone_number: '+91 1' }] } });
  assert.equal((await assertNumberOnWaba('waba_1', 'pn_1', 'tok')).id, 'pn_1');
});
