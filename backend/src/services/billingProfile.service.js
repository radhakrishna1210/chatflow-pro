import { prisma } from '../lib/prisma.js';

// The business details a workspace wants on its invoices. Stored server-side
// (they used to live only in the browser's localStorage, so invoices could
// never carry them and they leaked to the next person on a shared machine).

const EMPTY = { businessName: '', email: '', address: '', taxId: '' };

const shape = (row) => (row
  ? { businessName: row.businessName ?? '', email: row.email ?? '', address: row.address ?? '', taxId: row.taxId ?? '' }
  : { ...EMPTY });

export async function getBillingProfile(workspaceId) {
  const row = await prisma.workspaceBillingProfile.findUnique({ where: { workspaceId } });
  return shape(row);
}

// `input` is already validated; blank strings are stored as null.
export async function saveBillingProfile(workspaceId, input = {}) {
  const clean = (v) => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s === '' ? null : s;
  };
  const data = {
    businessName: clean(input.businessName),
    email: clean(input.email),
    address: clean(input.address),
    taxId: clean(input.taxId)?.toUpperCase() ?? null,
  };
  const row = await prisma.workspaceBillingProfile.upsert({
    where: { workspaceId },
    update: data,
    create: { workspaceId, ...data },
  });
  return shape(row);
}
