import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Editing a template Meta has already seen: the edit reaches Meta first or is
// refused, so the stored content never drifts from what Meta approved.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;
for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY']) process.env[key] ||= 'x'.repeat(32);
for (const key of ['META_APP_ID', 'META_APP_SECRET', 'META_BUSINESS_ID', 'META_WABA_ID', 'META_SYSTEM_USER_ID',
  'META_SYSTEM_USER_TOKEN', 'META_DISPLAY_NAME', 'META_WEBHOOK_VERIFY_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
  process.env[key] ||= 'test';
}
process.env.ADMIN_EMAIL ||= 'admin@example.test';

const calls = [];
let metaFails = false;
const metaError = () => Object.assign(new Error('Request failed'), {
  response: { status: 400, data: { error: { message: 'Invalid parameter', code: 100 } } },
});

const realMeta = await import('../lib/meta.js');
mock.module('../lib/meta.js', {
  namedExports: {
    ...realMeta,
    editMetaTemplate: async (templateId, body) => {
      calls.push({ kind: 'edit', templateId, body });
      if (metaFails) throw metaError();
      return { success: true };
    },
    createMetaTemplate: async (wabaId, body) => {
      calls.push({ kind: 'create', wabaId, body });
      if (metaFails) throw metaError();
      return { id: 'meta_new' };
    },
  },
});
const realEncryption = await import('../lib/encryption.js');
mock.module('../lib/encryption.js', { namedExports: { ...realEncryption, decrypt: () => 'token' } });

const { prisma } = await import('../lib/prisma.js');

let template;
let saved;
prisma.template.findFirst = async () => structuredClone(template);
prisma.template.update = async ({ data }) => { saved = data; return { ...template, ...data }; };
prisma.waNumber.findFirst = async () => ({ id: 'wa_1', wabaId: 'waba_1', encryptedAccessToken: 'enc' });

const { updateTemplate } = await import('./templates.service.js');

const BODY = (text) => [{ type: 'BODY', text }];

function reset(status, extra = {}) {
  calls.length = 0;
  metaFails = false;
  saved = null;
  template = {
    id: 't_1', workspaceId: 'ws_1', waNumberId: 'wa_1', name: 'promo', category: 'MARKETING', language: 'en',
    components: BODY('Hello {{1}}'), metaTemplateId: 'meta_1', status, ...extra,
  };
}

test('editing an approved template pushes the new content to Meta and marks it for re-review', async () => {
  reset('APPROVED');
  await updateTemplate('ws_1', 't_1', { name: 'promo', category: 'MARKETING', language: 'en', components: BODY('Hi {{1}}, new offer') });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'edit');
  assert.equal(calls[0].templateId, 'meta_1');
  assert.equal(calls[0].body.category, undefined);
  assert.equal(saved.status, 'PENDING');
});

test('a Meta failure leaves the stored template untouched', async () => {
  reset('APPROVED');
  metaFails = true;
  await assert.rejects(
    updateTemplate('ws_1', 't_1', { components: BODY('Changed {{1}}') }),
    /Meta did not accept the edit/,
  );
  assert.equal(saved, null);
});

test('renaming or recategorising an approved template is refused', async () => {
  reset('APPROVED');
  await assert.rejects(updateTemplate('ws_1', 't_1', { name: 'promo_v2' }), (e) => e.status === 409);
  await assert.rejects(updateTemplate('ws_1', 't_1', { category: 'UTILITY' }), (e) => e.status === 409);
  assert.equal(calls.length, 0);
  assert.equal(saved, null);
});

test('a template in review cannot be edited', async () => {
  reset('PENDING');
  await assert.rejects(updateTemplate('ws_1', 't_1', { components: BODY('Changed {{1}}') }), /in review/);
  assert.equal(calls.length, 0);
});

test('saving an approved template unchanged does not call Meta', async () => {
  reset('APPROVED', { components: [{ type: 'BODY', text: 'Hello {{1}}', _note: 'internal' }] });
  await updateTemplate('ws_1', 't_1', { name: 'promo', language: 'en', components: BODY('Hello {{1}}') });
  assert.equal(calls.length, 0);
  assert.equal(saved.status, undefined);
});

test('a rejected template is resubmitted, and only marked PENDING when Meta accepts', async () => {
  reset('REJECTED');
  await updateTemplate('ws_1', 't_1', { components: BODY('Fixed {{1}}'), category: 'UTILITY' });
  assert.equal(calls[0].kind, 'edit');
  assert.equal(calls[0].body.category, 'UTILITY');
  assert.equal(saved.status, 'PENDING');

  reset('REJECTED');
  await updateTemplate('ws_1', 't_1', { name: 'promo_fixed', components: BODY('Fixed {{1}}') });
  assert.equal(calls[0].kind, 'create');
  assert.equal(saved.metaTemplateId, 'meta_new');

  reset('REJECTED');
  metaFails = true;
  await assert.rejects(updateTemplate('ws_1', 't_1', { components: BODY('Fixed {{1}}') }));
  assert.equal(saved, null);
});
