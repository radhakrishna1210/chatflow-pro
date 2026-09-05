import { prisma } from '../lib/prisma.js';

// Characters that make Excel, LibreOffice and Google Sheets treat a cell as a
// formula rather than text. A contact named `=cmd|'/c calc'!A1` becomes code
// execution on the machine of whoever opens the export, so every exported cell
// is neutralised regardless of where the value came from.
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

export function sanitiseCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.length === 0) return '';
  // A leading apostrophe forces text interpretation in every major
  // spreadsheet, and is stripped on display.
  return FORMULA_TRIGGERS.includes(s[0]) ? `'${s}` : s;
}

// RFC 4180 quoting, applied after sanitising.
export function toCsvValue(value) {
  const s = sanitiseCell(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, columns) {
  const header = columns.map((c) => toCsvValue(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => toCsvValue(c.value(row))).join(','));
  return [header, ...body].join('\r\n');
}

const isoDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

const EXPORTS = {
  leads: {
    filename: 'leads',
    async fetch(workspaceId) {
      return prisma.lead.findMany({
        where: { workspaceId },
        include: { contact: true, owner: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      });
    },
    columns: [
      { label: 'Name', value: (l) => l.contact?.name },
      { label: 'Phone', value: (l) => l.contact?.phoneNumber },
      { label: 'Email', value: (l) => l.contact?.email },
      { label: 'Status', value: (l) => l.status },
      { label: 'Score', value: (l) => l.score },
      { label: 'Source', value: (l) => l.source },
      { label: 'Owner', value: (l) => l.owner?.name || l.owner?.email },
      { label: 'Notes', value: (l) => l.notes },
      { label: 'Created', value: (l) => isoDate(l.createdAt) },
    ],
  },
  deals: {
    filename: 'deals',
    async fetch(workspaceId) {
      return prisma.deal.findMany({
        where: { workspaceId },
        include: { contact: { select: { name: true } }, owner: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      });
    },
    columns: [
      { label: 'Title', value: (d) => d.title },
      { label: 'Contact', value: (d) => d.contact?.name },
      { label: 'Stage', value: (d) => d.stage },
      { label: 'Value', value: (d) => (d.value == null ? '' : Number(d.value)) },
      { label: 'Currency', value: (d) => d.currency },
      { label: 'Owner', value: (d) => d.owner?.name || d.owner?.email },
      { label: 'Expected close', value: (d) => isoDate(d.expectedCloseDate) },
      { label: 'Closed', value: (d) => isoDate(d.closedAt) },
      { label: 'Loss reason', value: (d) => d.lostReason },
      { label: 'Created', value: (d) => isoDate(d.createdAt) },
    ],
  },
  tasks: {
    filename: 'tasks',
    async fetch(workspaceId) {
      return prisma.task.findMany({
        where: { workspaceId },
        include: { assignedTo: { select: { name: true, email: true } }, deal: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
      });
    },
    columns: [
      { label: 'Title', value: (t) => t.title },
      { label: 'Description', value: (t) => t.description },
      { label: 'Status', value: (t) => t.status },
      { label: 'Due', value: (t) => isoDate(t.dueDate) },
      { label: 'Assigned to', value: (t) => t.assignedTo?.name || t.assignedTo?.email },
      { label: 'Deal', value: (t) => t.deal?.title },
      { label: 'Completed', value: (t) => isoDate(t.completedAt) },
    ],
  },
  products: {
    filename: 'products',
    async fetch(workspaceId) {
      return prisma.product.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } });
    },
    columns: [
      { label: 'Name', value: (p) => p.name },
      { label: 'SKU', value: (p) => p.sku },
      { label: 'Category', value: (p) => p.category },
      { label: 'Unit price', value: (p) => Number(p.unitPrice) },
      { label: 'Tax rate', value: (p) => Number(p.taxRate) },
      { label: 'Type', value: (p) => (p.isService ? 'Service' : 'Product') },
      { label: 'Active', value: (p) => (p.isActive ? 'Yes' : 'No') },
    ],
  },
};

export const EXPORTABLE = Object.keys(EXPORTS);

export async function exportEntity(workspaceId, entity) {
  const spec = EXPORTS[entity];
  if (!spec) {
    const e = new Error(`Cannot export "${entity}". Try one of: ${EXPORTABLE.join(', ')}`);
    e.status = 400;
    throw e;
  }
  const rows = await spec.fetch(workspaceId);
  return {
    csv: toCsv(rows, spec.columns),
    filename: `${spec.filename}-${new Date().toISOString().slice(0, 10)}.csv`,
    count: rows.length,
  };
}
