import { prisma } from '../lib/prisma.js';

export async function listProducts(workspaceId, { search = '', category = '', includeInactive = false } = {}) {
  const where = {
    workspaceId,
    ...(includeInactive ? {} : { isActive: true }),
    ...(category ? { category } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { sku: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [data, total, categories] = await Promise.all([
    prisma.product.findMany({ where, orderBy: { name: 'asc' } }),
    prisma.product.count({ where }),
    prisma.product.findMany({
      where: { workspaceId, category: { not: null } },
      select: { category: true },
      distinct: ['category'],
    }),
  ]);

  return { data, total, categories: categories.map((c) => c.category).filter(Boolean).sort() };
}

export async function getProduct(workspaceId, id) {
  const product = await prisma.product.findFirst({ where: { id, workspaceId } });
  if (!product) { const e = new Error('Product not found'); e.status = 404; throw e; }
  return product;
}

export async function createProduct(workspaceId, body) {
  if (body.sku) {
    const clash = await prisma.product.findFirst({ where: { workspaceId, sku: body.sku }, select: { id: true } });
    if (clash) { const e = new Error('A product with this SKU already exists'); e.status = 409; throw e; }
  }
  return prisma.product.create({ data: { workspaceId, ...body } });
}

export async function updateProduct(workspaceId, id, updates) {
  await getProduct(workspaceId, id);
  if (updates.sku) {
    const clash = await prisma.product.findFirst({
      where: { workspaceId, sku: updates.sku, id: { not: id } },
      select: { id: true },
    });
    if (clash) { const e = new Error('A product with this SKU already exists'); e.status = 409; throw e; }
  }
  return prisma.product.update({ where: { id }, data: updates });
}

// Products that have been quoted or attached to a deal are deactivated rather
// than deleted: the line items snapshot the name and price, but removing the
// catalogue row would still break the "which product was this?" link on
// historical records.
export async function deleteProduct(workspaceId, id) {
  await getProduct(workspaceId, id);

  const [dealUses, quoteUses] = await Promise.all([
    prisma.dealLineItem.count({ where: { workspaceId, productId: id } }),
    prisma.quoteLineItem.count({ where: { workspaceId, productId: id } }),
  ]);

  if (dealUses + quoteUses > 0) {
    await prisma.product.update({ where: { id }, data: { isActive: false } });
    return { deleted: false, deactivated: true, usedBy: { deals: dealUses, quotes: quoteUses } };
  }

  await prisma.product.delete({ where: { id } });
  return { deleted: true, deactivated: false };
}
