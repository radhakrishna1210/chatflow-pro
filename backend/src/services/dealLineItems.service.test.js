import test from 'node:test';
import assert from 'node:assert/strict';

// Deal line items without a database: scope, catalogue checks, column bounds
// and the deal value after the last line goes.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;

const { prisma } = await import('../lib/prisma.js');
const { addDealLineItem, deleteDealLineItem, updateDealLineItem, listDealLineItems } = await import('./dealLineItems.service.js');

let lines;
let dealValue;
const deal = { id: 'D', workspaceId: 'ws', ownerUserId: 'other', currency: 'INR' };
const products = {
  p_inr: { name: 'Widget', unitPrice: 100, taxRate: 0, currency: 'INR', isActive: true },
  p_usd: { name: 'Gizmo', unitPrice: 5, taxRate: 0, currency: 'USD', isActive: true },
  p_off: { name: 'Old', unitPrice: 10, taxRate: 0, currency: 'INR', isActive: false },
};

prisma.workspace.findUnique = async () => ({ recordVisibility: 'OWN' });
prisma.deal.findFirst = async ({ where }) => {
  const scope = where.AND?.[0];
  if (scope && !scope.OR.some((c) => c.ownerUserId === deal.ownerUserId)) return null;
  return { id: deal.id, currency: deal.currency };
};
prisma.product.findFirst = async ({ where }) => products[where.id] ?? null;
prisma.dealLineItem.findMany = async () => lines;
prisma.dealLineItem.findFirst = async ({ where }) => lines.find((l) => l.id === where.id) ?? null;
const tx = {
  dealLineItem: {
    count: async () => lines.length,
    create: async ({ data }) => { const l = { id: `l${lines.length + 1}`, ...data }; lines.push(l); return l; },
    update: async ({ where, data }) => { const l = lines.find((x) => x.id === where.id); Object.assign(l, data); return l; },
    delete: async ({ where }) => { lines = lines.filter((l) => l.id !== where.id); },
    findMany: async () => lines,
  },
  deal: { update: async ({ data }) => { dealValue = data.value; } },
};
prisma.$transaction = async (fn) => fn(tx);

const owner = { id: 'other', role: 'CLIENT' };
const stranger = { id: 'me', role: 'CLIENT' };

test.beforeEach(() => { lines = []; dealValue = 'untouched'; });

test('lines on a deal outside the caller\'s scope are a 404 for every operation', async () => {
  lines = [{ id: 'l1', productId: null, name: 'x', unitPrice: 1, quantity: 1, discountPct: 0, taxRate: 0, total: 1 }];
  for (const call of [
    () => listDealLineItems('ws', 'D', stranger),
    () => addDealLineItem('ws', 'D', { name: 'x', unitPrice: 1 }, stranger),
    () => updateDealLineItem('ws', 'D', 'l1', { quantity: 2 }, stranger),
    () => deleteDealLineItem('ws', 'D', 'l1', stranger),
  ]) {
    await assert.rejects(call(), (e) => e.status === 404);
  }
  assert.equal(dealValue, 'untouched');
});

test('deleting the last line clears the deal value', async () => {
  await addDealLineItem('ws', 'D', { productId: 'p_inr', quantity: 5 }, owner);
  assert.equal(dealValue, 500);
  await deleteDealLineItem('ws', 'D', 'l1', owner);
  assert.equal(dealValue, null);
});

test('inactive and foreign-currency products are refused when added', async () => {
  await assert.rejects(addDealLineItem('ws', 'D', { productId: 'p_off' }, owner), (e) => e.status === 400 && /deactivated/.test(e.message));
  await assert.rejects(addDealLineItem('ws', 'D', { productId: 'p_usd' }, owner), (e) => e.status === 400 && /USD/.test(e.message));
});

test('editing a line whose product was deactivated later still works', async () => {
  lines = [{ id: 'l1', productId: 'p_off', name: 'Old', unitPrice: 10, quantity: 1, discountPct: 0, taxRate: 0, total: 10 }];
  await updateDealLineItem('ws', 'D', 'l1', { quantity: 3 }, owner);
  assert.equal(dealValue, 30);
});

test('a line or deal total past the column limits is a 400, not a numeric overflow', async () => {
  await assert.rejects(addDealLineItem('ws', 'D', { name: 'big', quantity: 1_000_000, unitPrice: 1_000_000 }, owner), (e) => e.status === 400);
  lines = [{ id: 'l1', productId: null, name: 'a', unitPrice: 9e9, quantity: 1, discountPct: 0, taxRate: 0, total: 9e9 }];
  await assert.rejects(addDealLineItem('ws', 'D', { name: 'b', quantity: 1, unitPrice: 2e9 }, owner), (e) => e.status === 400);
});
