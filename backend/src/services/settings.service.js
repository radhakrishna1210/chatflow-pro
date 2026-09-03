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
      // Workspace profile and branding, edited from Settings -> Workspace and
      // Settings -> Branding. `name` is here rather than only on the session
      // user because a rename has to be readable by the page that performs it.
      name: true,
      industry: true,
      timezone: true,
      brandColor: true,
      brandLogoUrl: true,
      plan: true,
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
  // Profile and branding. `plan` is deliberately still absent: it is set by
  // the subscription flow, and letting it through here would be exactly the
  // mass-assignment this list exists to prevent.
  'name',
  'industry',
  'timezone',
  'brandColor',
  'brandLogoUrl',
  'autoLeadFromReply',
];

// A colour the UI can actually use. Anything else is rejected rather than
// silently stored, because a bad value here paints the customer's own widget.
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// Reachable-looking image URL, or nothing. Same reasoning: a logo field that
// accepts "javascript:..." is a stored-XSS vector in every surface that renders
// the brand.
function assertBranding(data) {
  if (data.brandColor !== undefined) {
    const value = String(data.brandColor || '').trim();
    if (!HEX_COLOR.test(value)) {
      const e = new Error('Brand colour must be a 6-digit hex value such as #35e8f2');
      e.status = 400;
      throw e;
    }
    data.brandColor = value;
  }
  if (data.brandLogoUrl !== undefined) {
    const value = String(data.brandLogoUrl || '').trim();
    if (value && !/^https:\/\//i.test(value)) {
      const e = new Error('Logo URL must start with https://');
      e.status = 400;
      throw e;
    }
    data.brandLogoUrl = value || null;
  }
  if (data.name !== undefined) {
    const value = String(data.name || '').trim();
    if (!value) {
      const e = new Error('Workspace name is required');
      e.status = 400;
      throw e;
    }
    data.name = value.slice(0, 120);
  }
  if (data.industry !== undefined) {
    data.industry = String(data.industry || '').trim().slice(0, 80) || null;
  }
  if (data.timezone !== undefined) {
    const value = String(data.timezone || '').trim();
    // Validated against the runtime's own tz database rather than a list that
    // would go stale: an unknown zone would otherwise be stored and then throw
    // every time a campaign tried to schedule against it.
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
    } catch {
      const e = new Error(`Unknown time zone "${value}"`);
      e.status = 400;
      throw e;
    }
    data.timezone = value;
  }
}

export async function updateSettings(workspaceId, updates) {
  const data = {};
  for (const key of ALLOWED_SETTINGS_FIELDS) {
    if (updates[key] !== undefined) data[key] = updates[key];
  }
  assertBranding(data);
  await prisma.workspace.update({ where: { id: workspaceId }, data });
  // Return the same shape GET does, so a save and a reload can never disagree
  // about what the workspace now looks like.
  return getSettings(workspaceId);
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
<title>${escapeHtml(number)} — Spandan</title>
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
        <p class="brand">spandan</p>
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
          <td>${escapeHtml(invoice.description || 'Spandan services')}</td>
          <td class="right">${escapeHtml(symbol)}${escapeHtml(amount)}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr><td>Total</td><td class="right">${escapeHtml(symbol)}${escapeHtml(amount)}</td></tr>
      </tfoot>
    </table>

    <div class="foot">
      <p>This invoice was generated automatically by Spandan on ${escapeHtml(new Date().toLocaleString('en-IN'))}.</p>
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
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { webhookUrl: true, webhookVerifyToken: true },
  });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  if (!ws.webhookUrl) { const e = new Error('No webhook URL configured — save one first'); e.status = 400; throw e; }

  // Signed and shaped exactly like a real delivery. It used to send a bare
  // unsigned {event:'test'} body, so a receiver that verified signatures — the
  // thing the test is meant to prove works — rejected the test and accepted
  // production traffic, or vice versa.
  const { signPayload } = await import('./outgoingWebhook.service.js');
  const { randomUUID } = await import('crypto');
  const deliveryId = randomUUID();
  const body = JSON.stringify({
    id: deliveryId,
    event: 'test',
    workspaceId,
    sentAt: new Date().toISOString(),
    data: { message: 'This is a test delivery from Spandan.' },
  });

  try {
    const res = await axios.post(ws.webhookUrl, body, {
      timeout: 8000,
      validateStatus: () => true,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ChatFlowPro-Webhook/1',
        'X-ChatFlow-Event': 'test',
        'X-ChatFlow-Delivery': deliveryId,
        'X-ChatFlow-Signature-256': signPayload(body, ws.webhookVerifyToken),
      },
    });

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
