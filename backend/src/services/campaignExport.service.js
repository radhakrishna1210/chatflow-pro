import { prisma } from '../lib/prisma.js';

// The campaign report as CSV: one row per recipient with its delivery state,
// retries and failure reason. The detail modal only shows 100 recipients, so
// this is the only complete record of who got what.
//
// Streamed in keyset pages so a 100k-recipient campaign is never held in
// memory or built into one giant string.

const PAGE_SIZE = 1000;

// Spreadsheet formula guard (=, +, -, @ …), with international phone numbers
// exempt so they stay re-importable — same rule as the contacts export.
const PHONE_LIKE = /^\+[\d\s()-]+$/;
export function csvCell(value) {
  const raw = value instanceof Date ? value.toISOString() : String(value ?? '');
  const risky = /^[=+\-@\t\r]/.test(raw) && !PHONE_LIKE.test(raw);
  return `"${(risky ? `'${raw}` : raw).replace(/"/g, '""')}"`;
}

export const CAMPAIGN_EXPORT_COLUMNS = [
  ['Contact name', (r) => r.contact?.name],
  ['Phone number', (r) => r.contact?.phoneNumber],
  ['Status', (r) => r.status],
  ['First attempt', (r) => r.initialStatus],
  ['Sent at', (r) => r.sentAt],
  ['Delivered at', (r) => r.deliveredAt],
  ['Read at', (r) => r.readAt],
  ['Failed at', (r) => r.failedAt],
  ['Failure reason', (r) => r.failReason || r.lastFailureReason],
  ['Retries', (r) => r.retryCount],
  ['Retry status', (r) => r.retryStatus],
  ['Next retry at', (r) => r.nextRetryAt],
  ['Billing', (r) => r.billingStatus],
  ['Charged', (r) => (r.billedAmount == null ? '' : Number(r.billedAmount).toFixed(4))],
];

export const csvRow = (r) => CAMPAIGN_EXPORT_COLUMNS.map(([, read]) => csvCell(read(r))).join(',');

export async function getExportableCampaign(workspaceId, campaignId) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    select: { id: true, name: true },
  });
  if (!campaign) { const e = new Error('Campaign not found'); e.status = 404; throw e; }
  return campaign;
}

// Yields the CSV in chunks: the header, then one chunk per page of recipients.
export async function* campaignRecipientsCsv(campaignId) {
  yield CAMPAIGN_EXPORT_COLUMNS.map(([header]) => csvCell(header)).join(',') + '\r\n';
  let lastId = null;
  for (;;) {
    const page = await prisma.campaignRecipient.findMany({
      where: { campaignId, ...(lastId ? { id: { gt: lastId } } : {}) },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      select: {
        id: true, status: true, initialStatus: true, sentAt: true, deliveredAt: true, readAt: true,
        failedAt: true, failReason: true, lastFailureReason: true, retryCount: true, retryStatus: true,
        nextRetryAt: true, billingStatus: true, billedAmount: true,
        contact: { select: { name: true, phoneNumber: true } },
      },
    });
    if (page.length === 0) return;
    lastId = page[page.length - 1].id;
    yield page.map(csvRow).join('\r\n') + '\r\n';
    if (page.length < PAGE_SIZE) return;
  }
}

export const exportFilename = (campaign) =>
  `campaign-${String(campaign.name || campaign.id).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || campaign.id}.csv`;
