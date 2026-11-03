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
