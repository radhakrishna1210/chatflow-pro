import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Template sync reads every local copy in one query and writes only what
// changed (CF-153), instead of a findFirst + update per template Meta returns.

let rows;
let metaTemplates;
let calls;
let notes;

const prisma = {
  waNumber: { findFirst: async () => ({ id: 'n1', wabaId: 'waba1', encryptedAccessToken: 'enc' }) },
  template: {
    findFirst: async () => { calls.findFirst += 1; return null; },
    findMany: async ({ where }) => {
      calls.findMany.push(where);
      if (where.metaTemplateId?.in) return rows.filter((r) => where.metaTemplateId.in.includes(r.metaTemplateId));
      return [];
    },
    update: ({ where, data }) => ({ op: 'update', id: where.id, data }),
    createMany: async ({ data }) => { calls.createMany.push(data); return { count: data.length }; },
    create: async () => { calls.create += 1; return {}; },
    updateMany: async () => ({ count: 0 }),
  },
  $transaction: async (ops) => { calls.transactions.push(ops); return ops; },
};

const here = (rel) => new URL(rel, import.meta.url).href;
mock.module(here('../lib/prisma.js'), { namedExports: { prisma } });
mock.module(here('../lib/meta.js'), {
  namedExports: {
    getWabaTemplates: async () => metaTemplates,
    createMetaTemplate: async () => ({}), editMetaTemplate: async () => ({}), deleteMetaTemplate: async () => ({}), uploadTemplateMedia: async () => ({}),
  },
});
mock.module(here('../lib/encryption.js'), { namedExports: { decrypt: () => 'token' } });
mock.module(here('./templateImage.service.js'), { namedExports: { storeAsset: async () => ({}), assertCardAssetsOwned: async () => {} } });
mock.module(here('./notification.service.js'), { namedExports: { notifyWorkspace: async (ws, note) => { notes.push(note); } } });

const { syncTemplatesFromMeta } = await import('./templates.service.js');

const components = [{ type: 'BODY', text: 'Hi {{1}}' }];
const meta = (id, status = 'APPROVED', extra = {}) => ({ id, name: `t${id}`, category: 'MARKETING', language: 'en', status, components, ...extra });
const local = (id, status = 'APPROVED') => ({
  id: `L${id}`, metaTemplateId: id, name: `t${id}`, category: 'MARKETING', language: 'en', status, components, rejectedReason: null,
});

beforeEach(() => {
  calls = { findFirst: 0, create: 0, findMany: [], createMany: [], transactions: [] };
  notes = [];
});

test('one read for all templates, unchanged rows are not written, new ones are inserted together', async () => {
  rows = [local('1'), local('2', 'PENDING')];
  metaTemplates = [meta('1'), meta('2'), meta('3'), meta('4')];

  const r = await syncTemplatesFromMeta('w1', 'n1');

  assert.deepEqual(r, { total: 4, created: 2, updated: 2, removed: 0 });
  assert.equal(calls.findFirst, 0);
  assert.equal(calls.create, 0);
  assert.deepEqual(calls.findMany[0].metaTemplateId.in, ['1', '2', '3', '4']);
  // Only template 2 changed (PENDING -> APPROVED).
  assert.equal(calls.transactions.length, 1);
  assert.deepEqual(calls.transactions[0].map((op) => op.id), ['L2']);
  assert.deepEqual(calls.createMany[0].map((t) => t.metaTemplateId), ['3', '4']);
  assert.deepEqual(notes.map((n) => n.type), ['TEMPLATE_APPROVED']);
});

test('a template deleted locally stays deleted through a sync', async () => {
  rows = [local('1', 'DELETED')];
  metaTemplates = [meta('1', 'APPROVED', { components: [{ type: 'BODY', text: 'changed' }] })];
  await syncTemplatesFromMeta('w1', 'n1');
  assert.equal(calls.transactions[0][0].data.status, 'DELETED');
});
