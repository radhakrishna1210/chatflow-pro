import test from 'node:test';
import assert from 'node:assert/strict';

// The opt-out helper every send path relies on, against an in-memory store.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';

const { prisma } = await import('../lib/prisma.js');

let optOuts;
let contacts;

const matchesPhone = (c, where) => !where.phoneNumber?.in || where.phoneNumber.in.includes(c.phoneNumber);

prisma.optOut.findUnique = async ({ where }) => {
  const { workspaceId, phoneNumber } = where.workspaceId_phoneNumber;
  return optOuts.find((r) => r.workspaceId === workspaceId && r.phoneNumber === phoneNumber) ?? null;
};
prisma.optOut.findMany = async ({ where }) => optOuts.filter((r) => r.workspaceId === where.workspaceId
  && (where.active === undefined || r.active === where.active)
  && (where.id?.in ? where.id.in.includes(r.id) : true)
  && (where.phoneNumber?.in ? where.phoneNumber.in.includes(r.phoneNumber)
    : typeof where.phoneNumber === 'string' ? r.phoneNumber === where.phoneNumber : true));
prisma.optOut.upsert = async ({ where, create, update }) => {
  const existing = await prisma.optOut.findUnique({ where });
  if (existing) return Object.assign(existing, update);
  const row = { id: `oo_${optOuts.length + 1}`, ...create };
  optOuts.push(row);
  return row;
};
prisma.optOut.updateMany = async ({ where, data }) => {
  const rows = optOuts.filter((r) => r.workspaceId === where.workspaceId && where.id.in.includes(r.id) && r.active === where.active);
  rows.forEach((r) => Object.assign(r, data));
  return { count: rows.length };
};
prisma.contact.findFirst = async ({ where }) => contacts.find((c) => c.workspaceId === where.workspaceId
  && (where.id ? c.id === where.id : true)
  && (where.optedOut === undefined || c.optedOut === where.optedOut)
  && matchesPhone(c, where)) ?? null;
prisma.contact.findMany = async ({ where }) => contacts.filter((c) => c.workspaceId === where.workspaceId
  && (where.optedOut === undefined || c.optedOut === where.optedOut) && matchesPhone(c, where));
prisma.contact.update = async ({ where, data }) => Object.assign(contacts.find((c) => c.id === where.id), data);
prisma.contact.updateMany = async ({ where, data }) => {
  const rows = contacts.filter((c) => c.workspaceId === where.workspaceId && matchesPhone(c, where));
  rows.forEach((c) => Object.assign(c, data));
  return { count: rows.length };
};

const {
  isOptedOut, assertNotOptedOut, getOptedOutPhoneSet, recordOptOut, unblockNumbers, setContactOptOut,
} = await import('./optout.service.js');

test.beforeEach(() => {
  optOuts = [];
  contacts = [{ id: 'ct_1', workspaceId: 'ws_1', phoneNumber: '+919800000001', optedOut: false }];
});

test('an active OptOut row blocks the number in any spelling', async () => {
  optOuts.push({ id: 'oo_1', workspaceId: 'ws_1', phoneNumber: '919800000001', active: true });
  assert.equal(await isOptedOut('ws_1', '+91 98000 00001'), true);
  assert.equal(await isOptedOut('ws_2', '919800000001'), false);
  await assert.rejects(assertNotOptedOut('ws_1', '919800000001'), { code: 'RECIPIENT_OPTED_OUT' });
});

test('a contact flagged optedOut without an OptOut row is still blocked', async () => {
  contacts[0].optedOut = true;
  assert.equal(await isOptedOut('ws_1', '919800000001'), true);
  assert.equal(await isOptedOut('ws_1', '919800000001', { contact: contacts[0] }), true);
  assert.deepEqual([...await getOptedOutPhoneSet('ws_1', ['+919800000001'])], ['919800000001']);
});

test('an unblocked row and an unflagged contact allow sending', async () => {
  optOuts.push({ id: 'oo_1', workspaceId: 'ws_1', phoneNumber: '919800000001', active: false });
  assert.equal(await isOptedOut('ws_1', '919800000001'), false);
  assert.equal((await getOptedOutPhoneSet('ws_1', ['919800000001'])).size, 0);
});

test('recordOptOut and unblockNumbers keep both sources in step', async () => {
  const row = await recordOptOut({ workspaceId: 'ws_1', phoneNumber: '919800000001' });
  assert.equal(row.active, true);
  assert.equal(contacts[0].optedOut, true);

  await unblockNumbers('ws_1', [row.id]);
  assert.equal(optOuts[0].active, false);
  assert.equal(contacts[0].optedOut, false);
  assert.equal(await isOptedOut('ws_1', '919800000001'), false);
});

test('setContactOptOut writes the OptOut list, and clearing it unblocks', async () => {
  await setContactOptOut('ws_1', 'ct_1', true);
  assert.equal(optOuts.length, 1);
  assert.equal(optOuts[0].phoneNumber, '919800000001');
  assert.equal(contacts[0].optedOut, true);

  await setContactOptOut('ws_1', 'ct_1', false);
  assert.equal(optOuts[0].active, false);
  assert.equal(contacts[0].optedOut, false);
});
