import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { settingsSchemas } from '../validators/index.js';
import { updateSettings, getInvoiceDocument } from './settings.service.js';

let dbAvailable = false;
let workspaceId;

test.before(async () => {
  try { await prisma.$connect(); dbAvailable = true; } catch { return; }
  workspaceId = (await prisma.workspace.create({ data: { name: `test-settings-${Date.now()}` } })).id;
});

test.after(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

test('the settings validator keeps autoLeadFromReply and drops privileged columns', () => {
  const parsed = settingsSchemas.update.parse({
    autoLeadFromReply: true, plan: 'ENTERPRISE', walletBalance: 1e9, suspended: false, webhookVerifyToken: 'x',
  });
  assert.deepEqual(parsed, { autoLeadFromReply: true });
  assert.throws(() => settingsSchemas.update.parse({ autoLeadFromReply: 'yes' }));
});

test('the lead-capture toggle persists through the validator + service path', async (t) => {
  if (!dbAvailable) return t.skip('Database unavailable');
  const body = settingsSchemas.update.parse({ autoLeadFromReply: true, plan: 'ENTERPRISE' });
  const out = await updateSettings(workspaceId, body);
  assert.equal(out.autoLeadFromReply, true);
  assert.equal(out.plan, 'FREE');
});

test('invoice documents escape the workspace name', async (t) => {
  if (!dbAvailable) return t.skip('Database unavailable');
  await prisma.workspace.update({ where: { id: workspaceId }, data: { name: '<script>alert(1)</script>' } });
  const inv = await prisma.invoice.create({
    data: { workspaceId, invoiceDate: new Date(), amount: 10, currency: 'INR', status: 'PAID', description: '<img src=x onerror=1>' },
  });
  const doc = await getInvoiceDocument(workspaceId, inv.id);
  assert.ok(!doc.html.includes('<script>alert'));
  assert.ok(!doc.html.includes('<img src=x'));
  await assert.rejects(getInvoiceDocument(`${workspaceId}x`, inv.id), (e) => e.status === 404);
});
