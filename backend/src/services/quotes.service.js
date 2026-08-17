import { prisma } from '../lib/prisma.js';
import { calculateLine, calculateDocument } from './lineItems.js';

const QUOTE_INCLUDE = {
  contact: { select: { id: true, name: true, phoneNumber: true, email: true } },
  deal: { select: { id: true, title: true, stage: true } },
  createdByUser: { select: { id: true, name: true } },
  lineItems: {
    orderBy: { sortOrder: 'asc' },
    include: { product: { select: { id: true, name: true, sku: true } } },
  },
};

// Which status changes are legal. A quote cannot go back to draft once sent —
// the customer has seen it — and accepted/rejected are terminal.
const ALLOWED_TRANSITIONS = {
  DRAFT: ['SENT', 'EXPIRED'],
  SENT: ['ACCEPTED', 'REJECTED', 'EXPIRED'],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: ['SENT'],
};

// Sequential per workspace: Q-0001, Q-0002. Generated inside the creating
// transaction so two people quoting at once cannot take the same number.
async function nextQuoteNumber(tx, workspaceId) {
  const last = await tx.quote.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    select: { quoteNumber: true },
  });
  const n = last ? (parseInt(String(last.quoteNumber).replace(/\D/g, ''), 10) || 0) + 1 : 1;
  return `Q-${String(n).padStart(4, '0')}`;
}

export async function listQuotes(workspaceId, { status = '', dealId = '' } = {}) {
  const where = { workspaceId, ...(status ? { status } : {}), ...(dealId ? { dealId } : {}) };
  const [data, total] = await Promise.all([
    prisma.quote.findMany({
      where,
      include: { contact: QUOTE_INCLUDE.contact, deal: QUOTE_INCLUDE.deal, _count: { select: { lineItems: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.quote.count({ where }),
  ]);
  return { data, total };
}

export async function getQuote(workspaceId, id) {
  const quote = await prisma.quote.findFirst({ where: { id, workspaceId }, include: QUOTE_INCLUDE });
  if (!quote) { const e = new Error('Quote not found'); e.status = 404; throw e; }
  return quote;
}

// Totals are recomputed from the stored lines on every mutation, so the header
// figures can never drift from the lines that justify them.
async function recalculate(tx, workspaceId, quoteId) {
  const [quote, lines] = await Promise.all([
    tx.quote.findFirst({ where: { id: quoteId, workspaceId }, select: { discountPct: true } }),
    tx.quoteLineItem.findMany({ where: { workspaceId, quoteId }, select: { subtotal: true, taxAmount: true } }),
  ]);
  const totals = calculateDocument(lines, { discountPct: Number(quote?.discountPct ?? 0) });
  await tx.quote.update({
    where: { id: quoteId },
    data: { subtotal: totals.subtotal, taxAmount: totals.taxAmount, total: totals.total },
  });
  return totals;
}

export async function createQuote(workspaceId, body, userId) {
  if (body.dealId) {
    const deal = await prisma.deal.findFirst({ where: { id: body.dealId, workspaceId }, select: { id: true, contactId: true } });
    if (!deal) { const e = new Error('Deal not found'); e.status = 404; throw e; }
    body.contactId = body.contactId ?? deal.contactId;
  }
  if (body.contactId) {
    const contact = await prisma.contact.findFirst({ where: { id: body.contactId, workspaceId }, select: { id: true } });
    if (!contact) { const e = new Error('Contact not found'); e.status = 404; throw e; }
  }

  return prisma.$transaction(async (tx) => {
    const quoteNumber = await nextQuoteNumber(tx, workspaceId);
    const quote = await tx.quote.create({
      data: {
        workspaceId,
        quoteNumber,
        dealId: body.dealId ?? null,
        contactId: body.contactId ?? null,
        currency: body.currency || 'INR',
        discountPct: body.discountPct ?? 0,
        validUntil: body.validUntil ?? null,
        terms: body.terms ?? null,
        notes: body.notes ?? null,
        createdByUserId: userId ?? null,
      },
    });

    // Seeding from a deal copies its line items so a rep does not retype the
    // basket that already exists on the opportunity.
    if (body.fromDealLineItems && body.dealId) {
      const dealLines = await tx.dealLineItem.findMany({
        where: { workspaceId, dealId: body.dealId },
        orderBy: { sortOrder: 'asc' },
      });
      if (dealLines.length) {
        await tx.quoteLineItem.createMany({
          data: dealLines.map((l, i) => ({
            workspaceId,
            quoteId: quote.id,
            productId: l.productId,
            name: l.name,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            taxRate: l.taxRate,
            subtotal: l.subtotal,
            taxAmount: l.taxAmount,
            total: l.total,
            sortOrder: i,
          })),
        });
        await recalculate(tx, workspaceId, quote.id);
      }
    }

    return tx.quote.findFirst({ where: { id: quote.id }, include: QUOTE_INCLUDE });
  });
}

// A sent quote is a commercial document the customer has already seen, so its
// contents are frozen. Only presentational and lifecycle fields stay editable.
async function assertEditable(workspaceId, id) {
  const quote = await prisma.quote.findFirst({ where: { id, workspaceId }, select: { status: true } });
  if (!quote) { const e = new Error('Quote not found'); e.status = 404; throw e; }
  if (quote.status !== 'DRAFT') {
    const e = new Error(`A ${quote.status.toLowerCase()} quote cannot be edited`);
    e.status = 409;
    throw e;
  }
}

export async function updateQuote(workspaceId, id, updates) {
  await assertEditable(workspaceId, id);
  return prisma.$transaction(async (tx) => {
    await tx.quote.update({ where: { id }, data: updates });
    if (updates.discountPct !== undefined) await recalculate(tx, workspaceId, id);
    return tx.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
  });
}

export async function changeQuoteStatus(workspaceId, id, status) {
  const quote = await prisma.quote.findFirst({ where: { id, workspaceId }, select: { status: true } });
  if (!quote) { const e = new Error('Quote not found'); e.status = 404; throw e; }

  const allowed = ALLOWED_TRANSITIONS[quote.status] ?? [];
  if (!allowed.includes(status)) {
    const e = new Error(`A ${quote.status.toLowerCase()} quote cannot become ${status.toLowerCase()}`);
    e.status = 409;
    throw e;
  }

  const stamps = {
    SENT: { sentAt: new Date() },
    ACCEPTED: { acceptedAt: new Date() },
    REJECTED: { rejectedAt: new Date() },
  };

  return prisma.quote.update({
    where: { id },
    data: { status, ...(stamps[status] ?? {}) },
    include: QUOTE_INCLUDE,
  });
}

export async function deleteQuote(workspaceId, id) {
  const quote = await prisma.quote.findFirst({ where: { id, workspaceId }, select: { status: true } });
  if (!quote) { const e = new Error('Quote not found'); e.status = 404; throw e; }
  if (quote.status === 'ACCEPTED') {
    const e = new Error('An accepted quote cannot be deleted'); e.status = 409; throw e;
  }
  await prisma.quote.delete({ where: { id } });
}

export async function addQuoteLineItem(workspaceId, quoteId, body) {
  await assertEditable(workspaceId, quoteId);

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

  return prisma.$transaction(async (tx) => {
    const count = await tx.quoteLineItem.count({ where: { workspaceId, quoteId } });
    await tx.quoteLineItem.create({
      data: { workspaceId, quoteId, productId: body.productId ?? null, name: base.name, sortOrder: count, ...money },
    });
    await recalculate(tx, workspaceId, quoteId);
    return tx.quote.findFirst({ where: { id: quoteId }, include: QUOTE_INCLUDE });
  });
}

export async function deleteQuoteLineItem(workspaceId, quoteId, lineId) {
  await assertEditable(workspaceId, quoteId);
  const line = await prisma.quoteLineItem.findFirst({ where: { id: lineId, workspaceId, quoteId }, select: { id: true } });
  if (!line) { const e = new Error('Line item not found'); e.status = 404; throw e; }

  return prisma.$transaction(async (tx) => {
    await tx.quoteLineItem.delete({ where: { id: lineId } });
    await recalculate(tx, workspaceId, quoteId);
    return tx.quote.findFirst({ where: { id: quoteId }, include: QUOTE_INCLUDE });
  });
}
