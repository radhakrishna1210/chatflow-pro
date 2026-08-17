import axios from 'axios';
import { prisma } from '../lib/prisma.js';

export async function getSettings(workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      webhookUrl: true,
      webhookVerifyToken: true,
      webhookEvents: true,
      notifyNewConversation: true,
      notifyTemplateApproved: true,
      notifyTemplateRejected: true,
      notifyCampaignCompleted: true,
      notifyHighOptout: true,
      notifyRateLimit: true,
      emailNotifyCampaignCompleted: true,
      emailNotifyTemplateApproved: true,
      emailNotifyTemplateRejected: true,
      emailNotifyMemberInvite: true,
      autoLeadFromReply: true,
    },
  });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  return ws;
}

// Only these fields may be changed via the settings API — prevents mass-assignment
// of sensitive columns (plan, webhookVerifyToken, etc.) from the request body.
const ALLOWED_SETTINGS_FIELDS = [
  'webhookUrl',
  'webhookEvents',
  'notifyNewConversation',
  'notifyTemplateApproved',
  'notifyTemplateRejected',
  'notifyCampaignCompleted',
  'notifyHighOptout',
  'notifyRateLimit',
  'emailNotifyCampaignCompleted',
  'emailNotifyTemplateApproved',
  'emailNotifyTemplateRejected',
  'emailNotifyMemberInvite',
  'autoLeadFromReply',
];

export async function updateSettings(workspaceId, updates) {
  const data = {};
  for (const key of ALLOWED_SETTINGS_FIELDS) {
    if (updates[key] !== undefined) data[key] = updates[key];
  }
  return prisma.workspace.update({ where: { id: workspaceId }, data });
}

export async function getInvoices(workspaceId) {
  return prisma.invoice.findMany({ where: { workspaceId }, orderBy: { invoiceDate: 'desc' } });
}

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CURRENCY_SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };

// Builds a self-contained, printable invoice document. Served as a downloadable
// HTML file rather than a PDF so it needs no rendering dependency — the file
// opens in any browser and "Print → Save as PDF" produces the PDF. Before
// this, the Download Invoice control in Payments and Settings did nothing at
// all (it was an <a href="#"> with preventDefault and a button with no
// handler).
export async function getInvoiceDocument(workspaceId, invoiceId) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, workspaceId },
    include: { workspace: { select: { name: true } } },
  });
  if (!invoice) { const e = new Error('Invoice not found'); e.status = 404; throw e; }

  const symbol = CURRENCY_SYMBOLS[invoice.currency] || `${invoice.currency} `;
  const amount = Number(invoice.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const issued = new Date(invoice.invoiceDate);
  const number = `INV-${invoice.id.slice(-10).toUpperCase()}`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(number)} — ChatFlow Pro</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 24px; background: #f4f6fb; color: #111827;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .sheet { max-width: 720px; margin: 0 auto; background: #fff; border-radius: 14px;
           box-shadow: 0 10px 40px rgba(15,23,42,.08); overflow: hidden; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
          padding: 32px 36px; border-bottom: 1px solid #e5e7eb; }
  .brand { font-size: 20px; font-weight: 800; letter-spacing: -.02em; }
  .brand span { color: #1EBF5E; }
  .muted { color: #6b7280; font-size: 13px; }
  .num { text-align: right; }
  .num h1 { margin: 0 0 4px; font-size: 15px; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; }
  .num p { margin: 0; font-size: 18px; font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 20px 28px; padding: 28px 36px; }
  .meta h2 { margin: 0 0 6px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; font-weight: 700; }
  .meta p { margin: 0; font-size: 14px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 14px 36px; text-align: left; font-size: 14px; }
  thead th { background: #f9fafb; border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb;
             font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; }
  td.right, th.right { text-align: right; }
  tfoot td { border-top: 2px solid #111827; font-size: 16px; font-weight: 800; padding-top: 16px; }
  .pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700;
          background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
  .foot { padding: 24px 36px 32px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; line-height: 1.6; }
  @media print { body { background: #fff; padding: 0; } .sheet { box-shadow: none; border-radius: 0; } }
</style>
</head>
<body>
  <div class="sheet">
    <div class="head">
      <div>
        <p class="brand">ChatFlow<span>Pro</span></p>
        <p class="muted">WhatsApp Business Platform</p>
      </div>
      <div class="num">
        <h1>Invoice</h1>
        <p>${escapeHtml(number)}</p>
      </div>
    </div>

    <div class="meta">
      <div>
        <h2>Billed to</h2>
        <p>${escapeHtml(invoice.workspace?.name || 'Workspace')}</p>
      </div>
      <div>
        <h2>Invoice date</h2>
        <p>${escapeHtml(issued.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }))}</p>
      </div>
      <div>
        <h2>Status</h2>
        <p><span class="pill">${escapeHtml(invoice.status)}</span></p>
      </div>
      ${invoice.reference ? `<div><h2>Payment reference</h2><p>${escapeHtml(invoice.reference)}</p></div>` : ''}
    </div>

    <table>
      <thead>
        <tr><th>Description</th><th class="right">Amount</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(invoice.description || 'ChatFlow Pro services')}</td>
          <td class="right">${escapeHtml(symbol)}${escapeHtml(amount)}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr><td>Total</td><td class="right">${escapeHtml(symbol)}${escapeHtml(amount)}</td></tr>
      </tfoot>
    </table>

    <div class="foot">
      <p>This invoice was generated automatically by ChatFlow Pro on ${escapeHtml(new Date().toLocaleString('en-IN'))}.</p>
      <p>To save it as a PDF, open this file in your browser and choose Print → Save as PDF.</p>
    </div>
  </div>
</body>
</html>`;

  return { filename: `${number}.html`, contentType: 'text/html; charset=utf-8', html };
}

// Sends a small sample payload to the workspace's configured webhook URL so
// the user can confirm their endpoint is reachable before relying on it.
export async function testWebhook(workspaceId) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { webhookUrl: true } });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  if (!ws.webhookUrl) { const e = new Error('No webhook URL configured — save one first'); e.status = 400; throw e; }

  try {
    const res = await axios.post(ws.webhookUrl, {
      event: 'test',
      workspaceId,
      timestamp: new Date().toISOString(),
    }, { timeout: 8000, validateStatus: () => true });

    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status };
    }
    const e = new Error(`Webhook endpoint responded with status ${res.status}`);
    e.status = 502;
    throw e;
  } catch (err) {
    if (err.status) throw err;
    const e = new Error(
      err.code === 'ECONNABORTED'
        ? 'Webhook request timed out'
        : `Could not reach webhook URL (${err.code || err.message})`
    );
    e.status = 502;
    throw e;
  }
}
