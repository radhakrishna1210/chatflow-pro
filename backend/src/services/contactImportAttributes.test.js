// CSV import keeps extra columns (price, …) as contact attributes: new
// contacts get them on insert, existing contacts have them updated.
import { test, mock, before } from 'node:test';
import assert from 'node:assert/strict';

const db = {
  existing: [{ id: 'c_old', phoneNumber: '+919812345678', attributes: { price: '150', city: 'Pune' } }],
  created: null,
  updates: [],
};

let importContacts;
before(async () => {
  mock.module('../lib/prisma.js', {
    namedExports: {
      prisma: {
        contact: {
          findMany: async ({ select }) => (select?.name
            ? [{ id: 'c_new', name: 'Rahul', phoneNumber: '+919876543210' }, { id: 'c_old', name: 'Priya', phoneNumber: '+919812345678' }]
            : db.existing),
          createMany: async ({ data }) => { db.created = data; return { count: 1 }; },
          update: (args) => { db.updates.push(args); return args; },
        },
        $transaction: async (ops) => ops,
      },
    },
  });
  mock.module('./subscription.service.js', { namedExports: { assertWithinLimit: async () => {} } });
  ({ importContacts } = await import('./contacts.service.js'));
});

test('extra CSV columns are stored and update existing contacts', async () => {
  const csv = Buffer.from('﻿name,phoneNumber,Price\nRahul,+919876543210,180\nPriya,+919812345678,165\n');
  const result = await importContacts('ws_1', csv);

  assert.deepEqual(result.attributeKeys, ['price']);
  assert.equal(result.updated, 1);
  assert.deepEqual(db.created.map((d) => d.attributes), [{ price: '180' }, { price: '165' }]);
  // Existing contact: new price, other columns kept.
  assert.deepEqual(db.updates[0], { where: { id: 'c_old' }, data: { attributes: { price: '165', city: 'Pune' } } });
});

test('semicolon sheets, header variants and ragged rows import instead of silently dropping', async () => {
  db.created = null; db.updates = [];
  const csv = Buffer.from([
    'NAME;Mobile Number;City',
    'Asha;+91 98111 22233;Delhi',
    'Ravi;+919811122244', // short row: no City cell
    'NoPhone;;Mumbai', // no number at all — counted as invalid
    ';;', // blank filler row — ignored
  ].join('\r\n'));
  const result = await importContacts('ws_1', csv);

  assert.equal(result.invalid, 1);
  assert.deepEqual(result.attributeKeys, ['city']);
  assert.deepEqual(db.created.map((d) => [d.name, d.phoneNumber, d.attributes ?? null]), [
    ['Asha', '+919811122233', { city: 'Delhi' }],
    ['Ravi', '+919811122244', null],
  ]);
});

test('a number listed twice in one sheet is reported as a duplicate', async () => {
  db.created = null; db.updates = [];
  const csv = Buffer.from('phone,name\n+919800000001,A\n+91 98000 00001,B\n');
  const result = await importContacts('ws_1', csv);
  assert.equal(db.created.length, 1);
  assert.equal(result.duplicates, 1);
});
