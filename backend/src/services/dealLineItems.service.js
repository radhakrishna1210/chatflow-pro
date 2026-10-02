import { prisma } from '../lib/prisma.js';
import { calculateLine, calculateDocument, round2 } from './lineItems.js';
import { scopedWhere } from './recordScope.service.js';

// Column limits: DealLineItem money is Decimal(14,2), Deal.value Decimal(12,2).
// Inputs inside the validator's bounds can still multiply past these, which
// Prisma reports as a numeric-overflow 500; refuse them as a 400 instead.
export const MAX_DEAL_VALUE = 9_999_999_999.99;

const badRequest = (message) => { const e = new Error(message); e.status = 400; return e; };

// Resolves a line's name, price and tax from the catalogue when a productId is
// given, letting the caller override any of them. The resolved values are then
// stored on the line, so later catalogue edits never restate an existing deal.
//
// `newProduct` is false when an edit keeps the product already on the line: a
// product deactivated since then must not make the line uneditable.
async function resolveLine(workspaceId, body, deal, { newProduct = true } = {}) {
  let base = { name: body.name, unitPrice: body.unitPrice, taxRate: body.taxRate ?? 0 };

  if (body.productId) {
    const product = await prisma.product.findFirst({
      where: { id: body.productId, workspaceId },
      select: { name: true, unitPrice: true, taxRate: true, currency: true, isActive: true },
    });
    if (!product) { const e = new Error('Product not found in this workspace'); e.status = 404; throw e; }
    if (newProduct && product.isActive === false) throw badRequest('This product has been deactivated');
    if (newProduct && product.currency && deal.currency && product.currency !== deal.currency) {
      throw badRequest(`This product is priced in ${product.currency} but the deal is in ${deal.currency}`);
    }
    base = {
      name: body.name ?? product.name,
      unitPrice: body.unitPrice ?? Number(product.unitPrice),
      taxRate: body.taxRate ?? Number(product.taxRate),
    };
  }

  if (!base.name) throw badRequest('A line needs a product or a name');
  if (base.unitPrice == null) throw badRequest('A line needs a unit price');

  const money = calculateLine({
    quantity: body.quantity ?? 1,
    unitPrice: base.unitPrice,
    discountPct: body.discountPct ?? 0,
    taxRate: base.taxRate,
  });
  if (money.total > MAX_DEAL_VALUE) throw badRequest('This line is too large: a deal total cannot exceed 9,999,999,999.99');

  return { name: base.name, productId: body.productId ?? null, ...money };
}

// The deal's own `value` is kept in step with its line items. Once a deal is
// itemised, a hand-typed amount that disagrees with the lines is a reporting
// bug waiting to happen — the pipeline total and the quote would disagree.
// Removing the last line clears the value rather than leaving the old total.
async function syncDealValue(tx, workspaceId, dealId) {
  const lines = await tx.dealLineItem.findMany({ where: { workspaceId, dealId }, select: { total: true } });
  const value = lines.length === 0 ? null : round2(lines.reduce((s, l) => s + Number(l.total), 0));
  if (value != null && value > MAX_DEAL_VALUE) throw badRequest('The deal total would exceed 9,999,999,999.99');
  await tx.deal.update({ where: { id: dealId }, data: { value } });
  return value;
}

// Line items are part of the deal, so they are reachable only through a deal
// the caller may open.
async function assertDeal(workspaceId, dealId, user) {
  const deal = await prisma.deal.findFirst({
    where: await scopedWhere(workspaceId, user, { id: dealId, workspaceId }),
    select: { id: true, currency: true },
  });
  if (!deal) { const e = new Error('Deal not found'); e.status = 404; throw e; }
  return deal;
}

export async function listDealLineItems(workspaceId, dealId, user = null) {
  await assertDeal(workspaceId, dealId, user);
  const data = await prisma.dealLineItem.findMany({
    where: { workspaceId, dealId },
    include: { product: { select: { id: true, name: true, sku: true } } },
    orderBy: { sortOrder: 'asc' },
  });
  return { data, total: data.length, totals: calculateDocument(data) };
}

export async function addDealLineItem(workspaceId, dealId, body, user = null) {
  const deal = await assertDeal(workspaceId, dealId, user);
  const resolved = await resolveLine(workspaceId, body, deal);

  return prisma.$transaction(async (tx) => {
    const count = await tx.dealLineItem.count({ where: { workspaceId, dealId } });
    const line = await tx.dealLineItem.create({
      data: { workspaceId, dealId, sortOrder: count, ...resolved },
      include: { product: { select: { id: true, name: true, sku: true } } },
    });
    await syncDealValue(tx, workspaceId, dealId);
    return line;
  });
}

export async function updateDealLineItem(workspaceId, dealId, lineId, body, user = null) {
  const deal = await assertDeal(workspaceId, dealId, user);
  const existing = await prisma.dealLineItem.findFirst({ where: { id: lineId, workspaceId, dealId } });
  if (!existing) { const e = new Error('Line item not found'); e.status = 404; throw e; }

  // Merge over the stored line so a partial edit (just the quantity, say)
  // recalculates against the values already on the record.
  const productId = body.productId ?? existing.productId;
  const resolved = await resolveLine(workspaceId, {
    productId,
    name: body.name ?? existing.name,
    unitPrice: body.unitPrice ?? Number(existing.unitPrice),
    quantity: body.quantity ?? Number(existing.quantity),
    discountPct: body.discountPct ?? Number(existing.discountPct),
    taxRate: body.taxRate ?? Number(existing.taxRate),
  }, deal, { newProduct: productId !== existing.productId });

  return prisma.$transaction(async (tx) => {
    const line = await tx.dealLineItem.update({
      where: { id: lineId },
      data: resolved,
      include: { product: { select: { id: true, name: true, sku: true } } },
    });
    await syncDealValue(tx, workspaceId, dealId);
    return line;
  });
}

export async function deleteDealLineItem(workspaceId, dealId, lineId, user = null) {
  await assertDeal(workspaceId, dealId, user);
  const existing = await prisma.dealLineItem.findFirst({ where: { id: lineId, workspaceId, dealId }, select: { id: true } });
  if (!existing) { const e = new Error('Line item not found'); e.status = 404; throw e; }

  await prisma.$transaction(async (tx) => {
    await tx.dealLineItem.delete({ where: { id: lineId } });
    await syncDealValue(tx, workspaceId, dealId);
  });
}
