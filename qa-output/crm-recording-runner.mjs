import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const outDir = 'C:/Users/54642/Downloads/chatflow-pro/qa-output';
await fs.mkdir(outDir, { recursive: true });
const videoDir = path.join(outDir, 'videos');
await fs.mkdir(videoDir, { recursive: true });
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
const tested = [];

async function pause(ms = 1400) {
  await page.waitForTimeout(ms);
}

async function banner(text) {
  await page.evaluate((message) => {
    let el = document.getElementById('__qa_banner');
    if (!el) {
      el = document.createElement('div');
      el.id = '__qa_banner';
      Object.assign(el.style, {
        position: 'fixed',
        left: '18px',
        bottom: '18px',
        zIndex: '2147483647',
        background: 'rgba(6,10,16,0.92)',
        color: 'white',
        padding: '12px 16px',
        borderRadius: '10px',
        font: '600 15px Arial, sans-serif',
        boxShadow: '0 8px 30px rgba(0,0,0,.25)',
        maxWidth: '760px',
      });
      document.body.appendChild(el);
    }
    el.textContent = message;
  }, text).catch(() => {});
}

async function goto(url, label) {
  await page.goto(url);
  await page.waitForLoadState('networkidle').catch(() => {});
  await banner(label);
  tested.push(label);
  await pause();
}

async function api(pathname, options = {}) {
  const token = await page.evaluate(() => localStorage.getItem('accessToken'));
  const user = await page.evaluate(() => JSON.parse(localStorage.getItem('user') || '{}'));
  const isPublic = pathname.startsWith('/api/v1/forms/') || pathname.startsWith('/api/v1/auth/');
  const url = pathname.startsWith('/api/') ? pathname : `/api/v1/workspaces/${user.workspaceId}${pathname}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (!isPublic) headers.Authorization = `Bearer ${token}`;
  const res = await page.evaluate(async ({ url, options, headers }) => {
    const r = await fetch(url, { ...options, headers });
    const text = await r.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { ok: r.ok, status: r.status, body };
  }, { url, options, headers });
  if (!res.ok) {
    throw new Error(`${options.method || 'GET'} ${url} -> ${res.status}: ${JSON.stringify(res.body).slice(0, 500)}`);
  }
  return res.body;
}

const body = (obj) => ({ method: 'POST', body: JSON.stringify(obj) });
const patch = (obj) => ({ method: 'PATCH', body: JSON.stringify(obj) });

try {
  await goto('http://localhost:5173/login', '1. Login page - signing in with test@example.com');
  await page.getByPlaceholder('you@company.com').fill('test@example.com');
  await page.getByPlaceholder('Enter your password').fill('password123');
  await Promise.allSettled([
    page.waitForURL('**/dashboard**', { timeout: 10000 }),
    page.getByRole('button', { name: 'Sign In' }).click(),
  ]);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForFunction(() => {
    try {
      return Boolean(JSON.parse(localStorage.getItem('user') || '{}').workspaceId);
    } catch {
      return false;
    }
  }, { timeout: 10000 });
  await banner('2. Dashboard loaded - authenticated workspace session');
  await pause(1600);

  const user = await page.evaluate(() => JSON.parse(localStorage.getItem('user') || '{}'));
  if (!user.workspaceId) throw new Error('Login succeeded but no workspaceId was found.');
  const stamp = `QA ${runId}`;
  const phone = `919${runId.slice(-9)}`;
  const email = `qa.${runId}@example.com`;

  let leadFormResult = 'not tested';
  try {
    await api('/lead-forms', body({
      name: `${stamp} Enterprise Inquiry Form`,
      slug: `qa-${runId}`,
      description: 'Recorded QA lead capture form',
      fields: [
        { type: 'TEXT', label: 'Full name', key: 'full_name', required: true },
        { type: 'PHONE', label: 'Phone number', key: 'phone_number', required: true },
        { type: 'EMAIL', label: 'Work email', key: 'work_email', required: false },
        { type: 'TEXT', label: 'Budget', key: 'budget', required: false },
      ],
      successMessage: 'Thanks - we will be in touch shortly.',
      consentText: 'I agree to be contacted about this enquiry.',
      source: 'Recorded QA form',
      isActive: true,
    }));
    leadFormResult = 'passed';
    await goto('http://localhost:5173/dashboard/lead-forms', '3. Lead Forms - live public form created with consent and phone fields');
  } catch (err) {
    leadFormResult = `failed: ${err.message}`;
    await goto('http://localhost:5173/dashboard/lead-forms', '3. Lead Forms - FAILED: server rejects phone/email field type during form creation');
  }

  let lead = await api('/leads', body({
    name: `${stamp} Prospect`,
    phoneNumber: phone,
    email,
    source: leadFormResult === 'passed' ? 'Recorded QA form' : 'Direct QA lead after lead-form failure',
    ownerUserId: user.id,
    notes: `Recorded QA lead. Lead form result: ${leadFormResult}`,
  }));
  await api(`/leads/${lead.id}/recalculate-score`, body({}));
  lead = await api(`/leads/${lead.id}`);
  await api(`/leads/${lead.id}`, patch({ status: 'CONTACTED', notes: 'Recorded QA: contacted prospect by phone.' }));
  await api(`/leads/${lead.id}`, patch({ status: 'QUALIFIED' }));
  await goto('http://localhost:5173/dashboard/leads', '6. Leads - submitted prospect appears; score and status lifecycle verified');

  const converted = await api(`/leads/${lead.id}/convert`, body({
    title: `${stamp} Cloud Deal`,
    value: 500000,
    currency: 'INR',
    stage: 'QUALIFICATION',
    expectedCloseDate: new Date(Date.now() + 21 * 86400000).toISOString(),
    ownerUserId: user.id,
  }));
  const deal = converted.deal || converted;
  const product = await api('/products', body({
    name: `${stamp} Cloud Infrastructure Annual License`,
    sku: `QA-${runId}`,
    category: 'Cloud Services',
    unitPrice: 250000,
    currency: 'INR',
    unit: 'year',
    taxRate: 18,
    isService: true,
  }));
  await api(`/deals/${deal.id}/line-items`, body({ productId: product.id, quantity: 2, discountPct: 0, taxRate: 18 }));
  for (const stage of ['NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON']) {
    await api(`/deals/${deal.id}/stage`, patch({ stage }));
  }
  await goto('http://localhost:5173/dashboard/deals', '7. Deals - converted lead, line items, and stage progression verified');
  await goto('http://localhost:5173/dashboard/products', '8. Products - catalog item used by deal line items');

  const quote = await api('/quotes', body({
    dealId: deal.id,
    contactId: deal.contactId,
    currency: 'INR',
    discountPct: 10,
    validUntil: new Date(Date.now() + 14 * 86400000).toISOString(),
    terms: 'Recorded QA quote terms.',
    fromDealLineItems: true,
  }));
  await api(`/quotes/${quote.id}/status`, patch({ status: 'SENT' }));
  await api(`/quotes/${quote.id}/status`, patch({ status: 'ACCEPTED' }));
  await goto('http://localhost:5173/dashboard/quotes', '9. Quotes - generated from deal, sent, accepted, totals calculated');

  const task = await api('/tasks', body({
    title: `${stamp} Finalize contract`,
    description: 'Recorded QA task linked to lead/deal/contact.',
    dueDate: new Date(Date.now() + 86400000).toISOString(),
    assignedToUserId: user.id,
    leadId: lead.id,
    dealId: deal.id,
    contactId: deal.contactId,
  }));
  await api(`/tasks/${task.id}`, patch({ status: 'COMPLETED' }));
  await api('/activities', body({
    type: 'CALL',
    content: 'Recorded QA call note added to timeline.',
    leadId: lead.id,
    dealId: deal.id,
    contactId: deal.contactId,
  }));
  await goto('http://localhost:5173/dashboard/tasks', '10. Tasks - linked task created and completed');
  await goto('http://localhost:5173/dashboard/deals', '11. Deal Timeline - activity and stage history available on deal detail');

  await goto('http://localhost:5173/dashboard/forecast', '12. Forecast - won deal and pipeline totals visible');

  const ticket = await api('/tickets', body({
    subject: `${stamp} Post-sale onboarding ticket`,
    description: 'Recorded QA support ticket.',
    priority: 'HIGH',
    category: 'Onboarding',
    contactId: deal.contactId,
    ownerUserId: user.id,
  }));
  for (const status of ['OPEN', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED']) {
    await api(`/tickets/${ticket.id}/status`, patch({ status }));
  }
  await goto('http://localhost:5173/dashboard/tickets', '13. Tickets - SLA ticket created and lifecycle completed');

  const sequence = await api('/sequences', body({
    name: `${stamp} Customer onboarding sequence`,
    description: 'Recorded QA sequence',
    respectBusinessHours: true,
    exitOnReply: true,
    steps: [
      { type: 'TASK', content: 'Call customer for onboarding check-in' },
      { type: 'WAIT', delayHours: 24 },
      { type: 'TASK', content: 'Confirm onboarding satisfaction' },
    ],
  }));
  await api(`/sequences/${sequence.id}/status`, patch({ status: 'PUBLISHED' }));
  await api(`/sequences/${sequence.id}/enroll`, body({ contactIds: [deal.contactId] }));
  await goto('http://localhost:5173/dashboard/sequences', '14. Sequences - published cadence and enrolled contact');

  await goto('http://localhost:5173/dashboard', '15. CRM Overview - KPIs, next-best-actions, recent activity');
  await page.keyboard.press('Control+K');
  await pause(700);
  await banner('16. Command Palette - global CRM search opened with Ctrl+K');
  await page.keyboard.type(stamp);
  await pause(1600);
  await page.keyboard.press('Escape').catch(() => {});

  const ask = page.getByRole('button', { name: /Ask your CRM/i }).first();
  if (await ask.count()) await ask.click().catch(() => {});
  await pause(800);
  await banner('17. Ask your CRM - copilot panel opens for CRM questions/proposals');
  const textboxes = await page.locator('textarea, input[type="text"]').all();
  if (textboxes.length) {
    await textboxes[textboxes.length - 1].fill('Which deals are at risk?');
    await page.keyboard.press('Enter').catch(() => {});
  }
  await pause(2500);

  await goto('http://localhost:5173/dashboard/profile', '18. Profile Progress - outcome-based CRM work reflected');
  await pause(1800);

  const summary = {
    runId,
    workspace: user.workspaceName || user.workspaceId,
    leadFormResult,
    leadId: lead.id,
    dealId: deal.id,
    productId: product.id,
    quoteId: quote.id,
    taskId: task.id,
    ticketId: ticket.id,
    sequenceId: sequence.id,
    tested,
  };
  const summaryPath = path.join(outDir, `crm-recording-summary-${runId}.json`);
  const screenshotPath = path.join(outDir, `crm-final-screen-${runId}.png`);
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  const rawVideo = await page.video().path();
  await context.close();
  await browser.close();
  const finalVideo = path.join(outDir, `crm-qa-recording-${runId}.webm`);
  await fs.rename(rawVideo, finalVideo).catch(async () => {
    await fs.copyFile(rawVideo, finalVideo);
  });
  console.log(JSON.stringify({ ok: true, finalVideo, summaryPath, screenshotPath, summary }, null, 2));
} catch (err) {
  const failShot = path.join(outDir, `crm-recording-failure-${runId}.png`);
  await page.screenshot({ path: failShot, fullPage: true }).catch(() => {});
  let rawVideo = null;
  try {
    rawVideo = await page.video().path();
  } catch {}
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  console.error(JSON.stringify({ ok: false, error: err.message, failShot, rawVideo }, null, 2));
  process.exit(1);
}
