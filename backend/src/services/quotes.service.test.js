import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { createProduct, deleteProduct } from './products.service.js';
import { addDealLineItem, listDealLineItems, updateDealLineItem, deleteDealLineItem } from './dealLineItems.service.js';
import { createQuote, addQuoteLineItem, changeQuoteStatus, updateQuote, getQuote, deleteQuote } from './quotes.service.js';

let dbAvailable = false;
let workspaceId;
let userId;
let contactId;
let dealId;
let productId;

test.before(async () => {
  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    return;
  }
  const stamp = Date.now();
  workspaceId = (await prisma.workspace.create({ data: { name: `test-cm-${stamp}` } })).id;
  userId = (await prisma.user.create({ data: { name: 'Commerce', email: `cm-${stamp}@example.test` } })).id;
  contactId = (await prisma.contact.create({
    data: { workspaceId, name: 'Buyer Co', phoneNumber: `+9111${stamp.toString().slice(-8)}` },
  })).id;
  dealId = (await prisma.deal.create({
    data: { workspaceId, contactId, title: 'Commerce deal', stage: 'PROPOSAL' },
  })).id;
  productId = (await createProduct(workspaceId, { name: 'Widget', unitPrice: 1000, taxRate: 18, sku: `W-${stamp}` })).id;
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

test('a line item inherits price and tax from the catalogue', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const line = await addDealLineItem(workspaceId, dealId, { productId, quantity: 2 });

  assert.equal(line.name, 'Widget');
  assert.equal(Number(line.unitPrice), 1000);
  assert.equal(Number(line.taxRate), 18);
  assert.equal(Number(line.subtotal), 2000);
  assert.equal(Number(line.taxAmount), 360);
  assert.equal(Number(line.total), 2360);
});

test('totals sent by the client are ignored, not stored', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  // A caller reaching the service directly with forged money must not be able
  // to dictate what is stored.
  const line = await addDealLineItem(workspaceId, dealId, {
    productId, quantity: 1,
    subtotal: 1, taxAmount: 1, total: 1, unitPrice: 1000,
  });

  assert.equal(Number(line.subtotal), 1000, 'a forged subtotal was accepted');
  assert.equal(Number(line.total), 1180, 'a forged total was accepted');
});

test('the deal value tracks the sum of its line items', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { totals } = await listDealLineItems(workspaceId, dealId);
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { value: true } });

  assert.equal(Number(deal.value), totals.total);
  assert.equal(Number(deal.value), 2360 + 1180);
});

test('editing a quantity recalculates the line and the deal', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { data } = await listDealLineItems(workspaceId, dealId);
  const first = data[0];

  const updated = await updateDealLineItem(workspaceId, dealId, first.id, { quantity: 5 });
  assert.equal(Number(updated.subtotal), 5000);
  assert.equal(Number(updated.total), 5900);

  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { value: true } });
  assert.equal(Number(deal.value), 5900 + 1180);
});

test('a quote seeded from a deal copies its lines and totals', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const quote = await createQuote(workspaceId, { dealId, fromDealLineItems: true }, userId);

  assert.match(quote.quoteNumber, /^Q-\d{4}$/);
  assert.equal(quote.contactId, contactId, 'the contact should be inherited from the deal');
  assert.equal(quote.lineItems.length, 2);
  assert.equal(Number(quote.total), 5900 + 1180);
});

test('a document discount reduces the taxable base on the stored quote', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const created = await createQuote(workspaceId, { dealId, contactId }, userId);
  await addQuoteLineItem(workspaceId, created.id, { productId, quantity: 1 });

  const discounted = await updateQuote(workspaceId, created.id, { discountPct: 10 });

  // 1000 + 18% = 1180; less 10% across the document = 900 + 162 = 1062.
  assert.equal(Number(discounted.subtotal), 900);
  assert.equal(Number(discounted.taxAmount), 162);
  assert.equal(Number(discounted.total), 1062);
});

test('quote numbers are sequential within a workspace', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const all = await prisma.quote.findMany({ where: { workspaceId }, select: { quoteNumber: true }, orderBy: { createdAt: 'asc' } });
  const numbers = all.map((q) => parseInt(q.quoteNumber.replace(/\D/g, ''), 10));
  assert.deepEqual(numbers, numbers.map((_, i) => i + 1));
  assert.equal(new Set(numbers).size, numbers.length, 'quote numbers must be unique');
});

test('the status lifecycle refuses illegal transitions', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const quote = await createQuote(workspaceId, { contactId }, userId);
  await addQuoteLineItem(workspaceId, quote.id, { productId, quantity: 1 });

  // Draft cannot jump straight to accepted.
  await assert.rejects(() => changeQuoteStatus(workspaceId, quote.id, 'ACCEPTED'), (e) => e.status === 409);

  const sent = await changeQuoteStatus(workspaceId, quote.id, 'SENT');
  assert.ok(sent.sentAt instanceof Date);

  const accepted = await changeQuoteStatus(workspaceId, quote.id, 'ACCEPTED');
  assert.ok(accepted.acceptedAt instanceof Date);

  // Accepted is terminal.
  await assert.rejects(() => changeQuoteStatus(workspaceId, quote.id, 'REJECTED'), (e) => e.status === 409);
  await assert.rejects(() => deleteQuote(workspaceId, quote.id), (e) => e.status === 409);
});

test('a sent quote is frozen against edits', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const quote = await createQuote(workspaceId, { contactId }, userId);
  await changeQuoteStatus(workspaceId, quote.id, 'SENT');

  await assert.rejects(() => updateQuote(workspaceId, quote.id, { discountPct: 50 }), (e) => e.status === 409);
  await assert.rejects(
    () => addQuoteLineItem(workspaceId, quote.id, { productId, quantity: 1 }),
    (e) => e.status === 409,
    'a line must not be addable to a quote the customer has already seen',
  );
});

test('a product in use is deactivated rather than deleted', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const result = await deleteProduct(workspaceId, productId);
  assert.equal(result.deleted, false);
  assert.equal(result.deactivated, true);
  assert.ok(result.usedBy.deals > 0);

  const still = await prisma.product.findUnique({ where: { id: productId }, select: { isActive: true } });
  assert.equal(still.isActive, false);

  // The historical line keeps its snapshot regardless.
  const { data } = await listDealLineItems(workspaceId, dealId);
  assert.equal(data[0].name, 'Widget');
});

test('an unused product is deleted outright', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const spare = await createProduct(workspaceId, { name: 'Unused', unitPrice: 5 });
  const result = await deleteProduct(workspaceId, spare.id);
  assert.equal(result.deleted, true);
  assert.equal(await prisma.product.findUnique({ where: { id: spare.id } }), null);
});

test('a product from another workspace cannot be added to a line', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const other = await prisma.workspace.create({ data: { name: `test-cm-other-${Date.now()}` } });
  try {
    const foreign = await createProduct(other.id, { name: 'Foreign', unitPrice: 100 });
    await assert.rejects(
      () => addDealLineItem(workspaceId, dealId, { productId: foreign.id, quantity: 1 }),
      (e) => e.status === 404,
    );
  } finally {
    await prisma.workspace.delete({ where: { id: other.id } }).catch(() => {});
  }
});

test('removing every line leaves the deal value untouched rather than zeroed', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const { data } = await listDealLineItems(workspaceId, dealId);
  for (const line of data) await deleteDealLineItem(workspaceId, dealId, line.id);

  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { value: true } });
  // With no lines there is nothing to derive a value from, so the last known
  // amount stands instead of silently becoming zero.
  assert.ok(Number(deal.value) > 0);
});
