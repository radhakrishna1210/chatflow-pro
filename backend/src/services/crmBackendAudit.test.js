import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { listLeads, createLead, bulkAssignLeads, bulkUpdateStatus, bulkCreateTask, convertLead } from './leads.service.js';
import { listDeals, createDeal } from './deals.service.js';
import { getTask, updateTask, deleteTask } from './tasks.service.js';
import { listDealLineItems, addDealLineItem } from './dealLineItems.service.js';
import { listActivities } from './activities.service.js';
import { listQuotes, createQuote, changeQuoteStatus } from './quotes.service.js';
import { createTicket, listTickets, changeTicketStatus } from './tickets.service.js';
import { saveDistributionRules, evaluateAndAssignLead } from './leadDistribution.service.js';
import { listSavedViews } from './savedViews.service.js';
import { executeCustomReport, saveCustomReport, deleteSavedReport } from './customReports.service.js';
import { getForecast } from './forecast.service.js';
import { importLeads } from './crmImport.service.js';
import { savedViewSchemas, customFieldSchemas, leadSchemas } from '../validators/index.js';

// Regression tests for the crm-backend audit (audit/crm-backend.md). Each test
// names the finding it covers.

let dbAvailable = false;
let ws; // OWN-visibility workspace
let foreignWs;
let ownerA; let ownerB; let outsider; let admin;
let contactB;
const stamp = Date.now();
const phone = (n) => `+9188${String(stamp).slice(-6)}${String(n).padStart(2, '0')}`;
const asUser = (id, role = 'CLIENT') => ({ id, role, workspaceId: ws });

test.before(async () => {
  try { await prisma.$queryRaw`SELECT 1`; dbAvailable = true; } catch { return; }
  ws = (await prisma.workspace.create({ data: { name: `crmbe-${stamp}`, recordVisibility: 'OWN' } })).id;
  foreignWs = (await prisma.workspace.create({ data: { name: `crmbe-foreign-${stamp}` } })).id;
  const mk = async (tag, workspaceId, role) => {
    const u = await prisma.user.create({ data: { name: `crmbe ${tag}`, email: `crmbe-${tag}-${stamp}@example.test` } });
    await prisma.workspaceMember.create({ data: { workspaceId, userId: u.id, role } });
    return u.id;
  };
  admin = await mk('admin', ws, 'ADMIN');
  ownerA = await mk('a', ws, 'CLIENT');
  ownerB = await mk('b', ws, 'CLIENT');
  outsider = await mk('x', foreignWs, 'ADMIN');
  contactB = (await prisma.contact.create({ data: { workspaceId: ws, name: 'Bea Secret', phoneNumber: phone(1) } })).id;
});

test.after(async () => {
  for (const id of [ws, foreignWs]) if (id) await prisma.workspace.delete({ where: { id } }).catch(() => {});
  for (const id of [admin, ownerA, ownerB, outsider]) if (id) await prisma.user.delete({ where: { id } }).catch(() => {});
  await prisma.$disconnect();
});

test('CRMBE-01: status filter neither drops built-in statuses nor bypasses record scope', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const mine = await prisma.contact.create({ data: { workspaceId: ws, name: 'Mine', phoneNumber: phone(2) } });
  await prisma.lead.create({ data: { workspaceId: ws, contactId: mine.id, status: 'NEW', ownerUserId: ownerA, customFields: { prospecting: {} } } });
  await prisma.lead.create({ data: { workspaceId: ws, contactId: contactB, status: 'NEW', ownerUserId: ownerB } });
  const custom = await prisma.contact.create({ data: { workspaceId: ws, name: 'Custom', phoneNumber: phone(3) } });
  await prisma.lead.create({ data: { workspaceId: ws, contactId: custom.id, status: 'NEW', ownerUserId: ownerA, customFields: { statusKey: 'NURTURING' } } });

  const forAdmin = await listLeads(ws, { status: 'NEW' }, asUser(admin, 'ADMIN'));
  assert.equal(forAdmin.total, 2, 'built-in status filter must match leads with and without customFields, and skip custom-status leads');

  const forA = await listLeads(ws, { status: 'NEW' }, asUser(ownerA));
  assert.deepEqual(forA.data.map((l) => l.contact.name), ['Mine'], 'status filter leaked another owner\'s lead');

  const nurturing = await listLeads(ws, { status: 'NURTURING' }, asUser(ownerA));
  assert.deepEqual(nurturing.data.map((l) => l.contact.name), ['Custom']);
});

test('CRMBE-02: deal stage filter matches built-in stages and keeps record scope', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await createDeal(ws, { contactId: contactB, title: 'B proposal', stage: 'PROPOSAL', ownerUserId: ownerB }, admin);
  const all = await listDeals(ws, { stage: 'PROPOSAL' }, asUser(admin, 'ADMIN'));
  assert.equal(all.data.length, 1);
  const forA = await listDeals(ws, { stage: 'PROPOSAL' }, asUser(ownerA));
  assert.equal(forA.data.length, 0, 'stage filter leaked another owner\'s deal');
  await assert.rejects(createDeal(ws, { contactId: contactB, title: 'x', stage: 'NO_SUCH_STAGE' }, admin), /Unknown pipeline stage/);
});

test('CRMBE-03: a task out of scope cannot be read, edited or deleted by id', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const task = await prisma.task.create({ data: { workspaceId: ws, title: 'B private', assignedToUserId: ownerB } });
  await assert.rejects(getTask(ws, task.id, asUser(ownerA)), /not found/i);
  await assert.rejects(updateTask(ws, task.id, { title: 'pwned' }, asUser(ownerA)), /not found/i);
  await assert.rejects(deleteTask(ws, task.id, asUser(ownerA)), /not found/i);
  assert.equal((await getTask(ws, task.id, asUser(ownerB))).title, 'B private');
});

test('CRMBE-04: deal line items follow the deal\'s visibility', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const deal = await prisma.deal.create({ data: { workspaceId: ws, contactId: contactB, title: 'B lines', ownerUserId: ownerB } });
  await assert.rejects(listDealLineItems(ws, deal.id, asUser(ownerA)), /not found/i);
  await assert.rejects(addDealLineItem(ws, deal.id, { name: 'x', unitPrice: 1 }, asUser(ownerA)), /not found/i);
  const line = await addDealLineItem(ws, deal.id, { name: 'Seat', unitPrice: 10, quantity: 2 }, asUser(ownerB));
  assert.equal(Number(line.total), 20);
});

test('CRMBE-05: activities on out-of-scope records are hidden, and the page size is capped', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const lead = await prisma.lead.findFirst({ where: { workspaceId: ws, contactId: contactB } });
  await prisma.crmActivity.create({ data: { workspaceId: ws, type: 'NOTE', content: 'B confidential note', leadId: lead.id } });
  const forA = await listActivities(ws, { limit: 1_000_000 }, asUser(ownerA));
  assert.ok(!forA.data.some((a) => a.content === 'B confidential note'), 'activity on another owner\'s lead leaked');
  const searched = await listActivities(ws, { search: 'confidential' }, asUser(ownerA));
  assert.equal(searched.data.length, 0, 'search must not drop the scope');
  const forB = await listActivities(ws, { search: 'confidential' }, asUser(ownerB));
  assert.equal(forB.data.length, 1);
});

test('CRMBE-06: owners and assignees must be members of the workspace', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await assert.rejects(createLead(ws, { name: 'X', phoneNumber: phone(10), ownerUserId: outsider }), /not a member/);
  await assert.rejects(createDeal(ws, { contactId: contactB, title: 'x', ownerUserId: outsider }, admin), /not a member/);
  await assert.rejects(createTicket(ws, { subject: 's', ownerUserId: outsider }), /not a member/);
  await assert.rejects(bulkAssignLeads(ws, ['any'], outsider, asUser(admin, 'ADMIN')), /not a member/);
  await assert.rejects(importLeads(ws, Buffer.from(`phone\n${phone(11)}\n`), { ownerUserId: outsider }), /not a member/);
});

test('CRMBE-07: concurrent conversions of one lead create exactly one deal', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const c = await prisma.contact.create({ data: { workspaceId: ws, name: 'Conv', phoneNumber: phone(12) } });
  const lead = await prisma.lead.create({ data: { workspaceId: ws, contactId: c.id, status: 'QUALIFIED' } });
  const results = await Promise.allSettled([1, 2, 3, 4].map(() => convertLead(ws, lead.id, { title: 'Deal' }, admin)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await prisma.deal.count({ where: { workspaceId: ws, leadId: lead.id } }), 1);
});

test('CRMBE-08: bulk task creation works (tasks have no priority column) and respects scope', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const leadB = await prisma.lead.findFirst({ where: { workspaceId: ws, contactId: contactB } });
  const blocked = await bulkCreateTask(ws, [leadB.id], { title: 'Call', priority: 'HIGH' }, ownerA, asUser(ownerA));
  assert.equal(blocked.count, 0, 'bulk task reached another owner\'s lead');
  const ok = await bulkCreateTask(ws, [leadB.id], { title: 'Call', priority: 'HIGH' }, admin, asUser(admin, 'ADMIN'));
  assert.equal(ok.count, 1);
});

test('CRMBE-09: bulk status clears a custom lifecycle key so the new status shows', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const lead = await prisma.lead.findFirst({ where: { workspaceId: ws, customFields: { path: ['statusKey'], equals: 'NURTURING' } } });
  await bulkUpdateStatus(ws, [lead.id], 'QUALIFIED', asUser(admin, 'ADMIN'));
  const after = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.equal(after.status, 'QUALIFIED');
  assert.equal(after.customFields?.statusKey, undefined);
  await assert.rejects(bulkUpdateStatus(ws, [lead.id], 'BOGUS', null), /status must be one of/);
});

test('CRMBE-10: quotes follow deal visibility, number uniquely under concurrency, and expire', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const dealB = await prisma.deal.create({ data: { workspaceId: ws, contactId: contactB, title: 'B quoted', ownerUserId: ownerB, currency: 'USD' } });
  const q = await createQuote(ws, { dealId: dealB.id }, ownerB, asUser(ownerB));
  assert.equal(q.currency, 'USD', 'a quote on a deal defaults to the deal currency');
  assert.equal((await listQuotes(ws, {}, asUser(ownerA))).data.filter((x) => x.id === q.id).length, 0);
  await assert.rejects(createQuote(ws, { dealId: dealB.id }, ownerA, asUser(ownerA)), /Deal not found/);

  const many = await Promise.all([1, 2, 3, 4, 5].map(() => createQuote(ws, {}, admin)));
  assert.equal(new Set(many.map((m) => m.quoteNumber)).size, 5);

  const old = await prisma.quote.create({ data: { workspaceId: ws, quoteNumber: `Q-OLD-${stamp}`, status: 'SENT', validUntil: new Date(Date.now() - 86_400_000) } });
  await assert.rejects(changeQuoteStatus(ws, old.id, 'ACCEPTED'), /valid-until/);
});

test('CRMBE-11: a ticket waiting on the customer is not reported overdue', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const tk = await createTicket(ws, { subject: 'Waiting one', priority: 'URGENT' });
  await changeTicketStatus(ws, tk.id, 'WAITING');
  await prisma.crmTicket.update({ where: { id: tk.id }, data: { dueAt: new Date(Date.now() - 3600_000) } });
  const overdue = await listTickets(ws, { view: 'overdue' }, asUser(admin, 'ADMIN'));
  assert.ok(!overdue.data.some((x) => x.id === tk.id));
  const all = await listTickets(ws, { view: 'all' }, asUser(admin, 'ADMIN'));
  assert.equal(all.data.find((x) => x.id === tk.id).isOverdue, false);

  const nums = await Promise.all([1, 2, 3, 4].map(() => createTicket(ws, { subject: 'race' })));
  assert.equal(new Set(nums.map((n) => n.ticketNumber)).size, 4);
});

test('CRMBE-12: round robin skips non-members and gives concurrent leads distinct reps', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await saveDistributionRules(ws, {
    enabled: true,
    rules: [{ name: 'rr', enabled: true, conditions: {}, assignment: { type: 'ROUND_ROBIN', poolUserIds: [ownerA, outsider, ownerB] } }],
  });
  const leads = [];
  for (let i = 0; i < 4; i += 1) {
    const c = await prisma.contact.create({ data: { workspaceId: ws, name: `rr${i}`, phoneNumber: phone(20 + i) } });
    leads.push(await prisma.lead.create({ data: { workspaceId: ws, contactId: c.id } }));
  }
  const res = await Promise.all(leads.map((l) => evaluateAndAssignLead(ws, l.id)));
  const owners = res.map((r) => r.ownerUserId);
  assert.ok(!owners.includes(outsider), 'a user from another workspace was assigned a lead');
  assert.equal(owners.filter((o) => o === ownerA).length, 2);
  assert.equal(owners.filter((o) => o === ownerB).length, 2);
  await assert.rejects(saveDistributionRules(ws, { rules: [{ assignment: { type: 'NOPE' } }] }), /Invalid distribution rule/);
  await saveDistributionRules(ws, { enabled: false, rules: [] });
});

test('CRMBE-13: saved views never expose system records stored in the same table', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const { data } = await listSavedViews(ws, ownerA);
  assert.ok(data.every((v) => ['leads', 'deals', 'tasks'].includes(v.entity)), 'system records listed as saved views');
});

test('CRMBE-14: custom reports are scoped, refuse operator injection, and only the author deletes', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const report = await executeCustomReport(ws, { entity: 'deals', groupBy: 'owner', metric: 'sum_value', range: 'all' }, asUser(ownerA));
  assert.ok(!report.rows.some((r) => r.label === 'crmbe b'), 'a report aggregated another owner\'s deals');
  await assert.rejects(executeCustomReport(ws, { entity: 'leads', filters: { status: 'NOPE' } }), /status must be one of/);
  const injected = await executeCustomReport(ws, { entity: 'leads', groupBy: 'status', filters: { ownerUserId: { not: null } } });
  assert.ok(Array.isArray(injected.rows));
  const saved = await saveCustomReport(ws, { name: 'B report', config: { entity: 'deals' }, isShared: true }, ownerB);
  await assert.rejects(deleteSavedReport(ws, saved.id, ownerA, 'CLIENT'), /Only the author/);
  await deleteSavedReport(ws, saved.id, ownerB, 'CLIENT');
});

test('CRMBE-15: forecast weights custom-stage deals by their own stage and stays scoped', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  await prisma.pipelineStage.create({ data: { workspaceId: ws, key: 'DEMO_DONE', label: 'Demo done', probability: 80, sortOrder: 9 } });
  const close = new Date();
  await prisma.deal.create({
    data: { workspaceId: ws, contactId: contactB, title: 'custom', value: 1000, stage: 'QUALIFICATION', customFields: { stageKey: 'DEMO_DONE' }, expectedCloseDate: close, ownerUserId: ownerA },
  });
  const f = await getForecast(ws, { from: close.toISOString().slice(0, 10), to: close.toISOString().slice(0, 10) }, asUser(ownerA));
  assert.equal(f.totals.commit.count, 1, 'custom stage at 80% should be commit, and a bare to-date includes that whole day');
  assert.equal(f.totals.commit.weighted, 800);
  const forB = await getForecast(ws, {}, asUser(ownerB));
  assert.ok(!forB.byOwner.some((o) => o.ownerUserId === ownerA), 'forecast exposed another owner\'s pipeline');
});

test('CRMBE-16: validators accept what the UI sends', () => {
  assert.equal(savedViewSchemas.create.parse({ entity: 'leads', name: 'x' }).entity, 'leads');
  assert.equal(customFieldSchemas.create.parse({ entity: 'lead', label: 'Tier', type: 'DROPDOWN', options: ['a'] }).type, 'DROPDOWN');
  assert.equal(customFieldSchemas.create.parse({ entity: 'lead', label: 'Tier', type: 'SELECT', options: ['a'] }).type, 'DROPDOWN');
  assert.throws(() => leadSchemas.bulkIds.parse({ ids: Array.from({ length: 1001 }, (_, i) => `id${i}`) }));
  assert.throws(() => leadSchemas.bulkCategory.parse({ ids: ['a'], category: 'LUKEWARM' }));
});

test('CRMBE-17: completing a task that was created already overdue earns no XP', async (t) => {
  if (!dbAvailable) return t.skip('database unavailable');
  const task = await prisma.task.create({ data: { workspaceId: ws, title: 'backdated', assignedToUserId: ownerA, dueDate: new Date(Date.now() - 86_400_000) } });
  await updateTask(ws, task.id, { status: 'COMPLETED' }, asUser(ownerA));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await prisma.xpEvent.count({ where: { workspaceId: ws, userId: ownerA, kind: 'cleared_overdue' } }), 0);
});
