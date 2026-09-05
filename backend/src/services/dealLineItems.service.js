import { prisma } from '../lib/prisma.js';
import { calculateLine, calculateDocument, round2 } from './lineItems.js';

// Resolves a line's name, price and tax from the catalogue when a productId is
// given, letting the caller override any of them. The resolved values are then
// stored on the line, so later catalogue edits never restate an existing deal.
async function resolveLine(workspaceId, body) {
  let base = { name: body.name, unitPrice: body.unitPrice, taxRate: body.taxRate ?? 0 };

  if (body.productId) {
    const product = await prisma.product.findFirst({
      where: { id: body.productId, workspaceId },
      select: { name: true, unitPrice: true, taxRate: true },
    });
    if (!product) { const e = new Error('Product not found in this workspace'); e.status = 404; throw e; }
    base = {
      name: body.name ?? product.name,
      unitPrice: body.unitPrice ?? Number(product.unitPrice),
      taxRate: body.taxRate ?? Number(product.taxRate),
    };
  }

  if (!base.name) { const e = new Error('A line needs a product or a name'); e.status = 400; throw e; }
  if (base.unitPrice == null) { const e = new Error('A line needs a unit price'); e.status = 400; throw e; }

  const money = calculateLine({
    quantity: body.quantity ?? 1,
    unitPrice: base.unitPrice,
    discountPct: body.discountPct ?? 0,
    taxRate: base.taxRate,
  });

  return { name: base.name, productId: body.productId ?? null, ...money };
}

// The deal's own `value` is kept in step with its line items. Once a deal is
// itemised, a hand-typed amount that disagrees with the lines is a reporting
// bug waiting to happen — the pipeline total and the quote would disagree.
async function syncDealValue(tx, workspaceId, dealId) {
  const lines = await tx.dealLineItem.findMany({ where: { workspaceId, dealId }, select: { total: true } });
  if (lines.length === 0) return null;
  const value = round2(lines.reduce((s, l) => s + Number(l.total), 0));
  await tx.deal.update({ where: { id: dealId }, data: { value } });
  return value;
}

async function assertDeal(workspaceId, dealId) {
  const deal = await prisma.deal.findFirst({ where: { id: dealId, workspaceId }, select: { id: true } });
  if (!deal) { const e = new Error('Deal not found'); e.status = 404; throw e; }
}

export async function listDealLineItems(workspaceId, dealId) {
  await assertDeal(workspaceId, dealId);
  const data = await prisma.dealLineItem.findMany({
    where: { workspaceId, dealId },
    include: { product: { select: { id: true, name: true, sku: true } } },
    orderBy: { sortOrder: 'asc' },
  });
  return { data, total: data.length, totals: calculateDocument(data) };
}

export async function addDealLineItem(workspaceId, dealId, body) {
  await assertDeal(workspaceId, dealId);
  const resolved = await resolveLine(workspaceId, body);

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

export async function updateDealLineItem(workspaceId, dealId, lineId, body) {
  const existing = await prisma.dealLineItem.findFirst({ where: { id: lineId, workspaceId, dealId } });
  if (!existing) { const e = new Error('Line item not found'); e.status = 404; throw e; }

  // Merge over the stored line so a partial edit (just the quantity, say)
  // recalculates against the values already on the record.
  const resolved = await resolveLine(workspaceId, {
    productId: body.productId ?? existing.productId,
    name: body.name ?? existing.name,
    unitPrice: body.unitPrice ?? Number(existing.unitPrice),
    quantity: body.quantity ?? Number(existing.quantity),
    discountPct: body.discountPct ?? Number(existing.discountPct),
    taxRate: body.taxRate ?? Number(existing.taxRate),
  });

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

export async function deleteDealLineItem(workspaceId, dealId, lineId) {
  const existing = await prisma.dealLineItem.findFirst({ where: { id: lineId, workspaceId, dealId }, select: { id: true } });
  if (!existing) { const e = new Error('Line item not found'); e.status = 404; throw e; }

  await prisma.$transaction(async (tx) => {
    await tx.dealLineItem.delete({ where: { id: lineId } });
    await syncDealValue(tx, workspaceId, dealId);
  });
}
