import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import {
  executeCustomReport,
  listSavedReports,
  saveCustomReport,
  deleteSavedReport,
  PREBUILT_TEMPLATES,
} from './customReports.service.js';

let dbAvailable = false;
let workspaceId;
let userId;

test.before(async () => {
  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    return;
  }
  const stamp = Date.now();
  workspaceId = (await prisma.workspace.create({ data: { name: `test-rep-${stamp}` } })).id;

  userId = (await prisma.user.create({
    data: { name: 'Report User', email: `rep-${stamp}@example.test` },
  })).id;

  const contact1 = await prisma.contact.create({
    data: { workspaceId, name: 'Lead 1', phoneNumber: `+9191${stamp.toString().slice(-8)}` },
  });
  const contact2 = await prisma.contact.create({
    data: { workspaceId, name: 'Lead 2', phoneNumber: `+9192${stamp.toString().slice(-8)}` },
  });

  await prisma.lead.create({
    data: {
      workspaceId,
      contactId: contact1.id,
      ownerUserId: userId,
      category: 'HOT',
      source: 'Website',
      score: 90,
      status: 'QUALIFIED',
    },
  });

  await prisma.lead.create({
    data: {
      workspaceId,
      contactId: contact2.id,
      ownerUserId: userId,
      category: 'WARM',
      source: 'WhatsApp',
      score: 60,
      status: 'NEW',
    },
  });
});

test.after(async () => {
  if (!dbAvailable) return;
  await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
});

test('prebuilt templates exist and are valid', (t) => {
  assert.ok(Array.isArray(PREBUILT_TEMPLATES));
  assert.ok(PREBUILT_TEMPLATES.length >= 4);
});

test('executeCustomReport groups leads by source', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const report = await executeCustomReport(workspaceId, {
    entity: 'leads',
    metric: 'count',
    groupBy: 'source',
    range: 'all',
  });

  assert.equal(report.entity, 'leads');
  assert.equal(report.total, 2);
  assert.ok(report.rows.some((r) => r.label === 'Website' && r.count === 1));
  assert.ok(report.rows.some((r) => r.label === 'WhatsApp' && r.count === 1));
});

test('executeCustomReport groups leads by category with filters', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const report = await executeCustomReport(workspaceId, {
    entity: 'leads',
    metric: 'count',
    groupBy: 'category',
    filters: { category: 'HOT' },
    range: 'all',
  });

  assert.equal(report.total, 1);
  assert.equal(report.rows[0].label, 'HOT');
  assert.equal(report.rows[0].count, 1);
});

test('saveCustomReport and listSavedReports manage user custom reports', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');

  const saved = await saveCustomReport(workspaceId, {
    name: 'My Custom Source Funnel',
    config: { entity: 'leads', groupBy: 'source', chartType: 'bar' },
    isShared: true,
  }, userId);

  assert.ok(saved.id);
  assert.equal(saved.name, 'My Custom Source Funnel');

  const list = await listSavedReports(workspaceId, userId);
  assert.ok(list.saved.some((r) => r.name === 'My Custom Source Funnel'));

  await deleteSavedReport(workspaceId, saved.id, userId);
  const listAfter = await listSavedReports(workspaceId, userId);
  assert.ok(!listAfter.saved.some((r) => r.id === saved.id));
});
